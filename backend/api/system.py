"""Backend self-update and system info API."""
import asyncio
import json
import logging
import os
import subprocess
import threading

from fastapi import APIRouter, Depends, HTTPException

from backend.core.auth import require_admin, verify_token

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(verify_token)])
logger = logging.getLogger(__name__)

_REPO_PATH = "/app/repo"

# In-memory state for the current update job
_update_lock = threading.Lock()
_update_state: dict = {"status": "idle", "log": "", "error": None, "started_at": None, "finished_at": None}


def _git(*args, **kwargs):
    """Run a git command in the repo. Returns (stdout, stderr, returncode)."""
    result = subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", _REPO_PATH],
        capture_output=True, text=True
    )
    result = subprocess.run(
        ["git", "-C", _REPO_PATH, *args],
        capture_output=True, text=True, timeout=30, **kwargs
    )
    return result.stdout.strip(), result.stderr.strip(), result.returncode


@router.get("/info")
async def system_info():
    """Return current git commit and basic info."""
    stdout, _, rc = _git("rev-parse", "HEAD")
    short, _, _ = _git("rev-parse", "--short", "HEAD")
    branch, _, _ = _git("rev-parse", "--abbrev-ref", "HEAD")
    desc, _, _ = _git("log", "-1", "--pretty=%s")
    return {
        "commit": stdout if rc == 0 else "unknown",
        "short": short if rc == 0 else "?",
        "branch": branch if rc == 0 else "unknown",
        "message": desc if rc == 0 else "",
        "git_available": rc == 0,
        "repo_path": _REPO_PATH,
    }


@router.get("/update/check")
async def check_update():
    """Compare local HEAD with remote main via git ls-remote."""
    local, _, rc_local = _git("rev-parse", "HEAD")
    if rc_local != 0:
        raise HTTPException(status_code=500, detail="Cannot read local git HEAD")

    # Fetch remote HEAD without pulling
    remote_out, remote_err, rc_remote = _git("ls-remote", "origin", "HEAD")
    if rc_remote != 0:
        raise HTTPException(status_code=502, detail=f"Cannot reach remote: {remote_err}")

    remote = remote_out.split()[0] if remote_out else None
    up_to_date = local == remote

    # Count commits behind (requires fetching first — skip for speed, just compare SHAs)
    return {
        "current": local,
        "current_short": local[:7] if local else "?",
        "latest": remote,
        "latest_short": remote[:7] if remote else "?",
        "up_to_date": up_to_date,
        "can_update": bool(remote and not up_to_date),
    }


def _do_apply():
    from datetime import datetime, timezone
    _update_state["status"] = "running"
    _update_state["log"] = ""
    _update_state["error"] = None
    _update_state["started_at"] = datetime.now(timezone.utc).isoformat()
    _update_state["finished_at"] = None

    def _run_cmd(cmd, timeout=300):
        _update_state["log"] += f"\n$ {' '.join(cmd)}\n"
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout,
            env={**os.environ, "DOCKER_HOST": "unix:///var/run/docker.sock"},
        )
        _update_state["log"] += result.stdout + result.stderr
        return result.returncode

    try:
        # 1. Make git safe
        subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", _REPO_PATH],
            capture_output=True
        )
        # 2. Pull latest
        rc = _run_cmd(["git", "-C", _REPO_PATH, "pull", "--ff-only", "origin", "main"])
        if rc != 0:
            raise RuntimeError("git pull failed — check logs")
        # 3. Rebuild + restart
        rc = _run_cmd(
            ["docker", "compose", "-f", f"{_REPO_PATH}/docker-compose.yml", "up", "-d", "--build"],
            timeout=600,
        )
        if rc != 0:
            raise RuntimeError("docker compose up failed — check logs")
        _update_state["status"] = "done"
    except Exception as exc:
        _update_state["status"] = "error"
        _update_state["error"] = str(exc)
        logger.error("Self-update failed: %s", exc)
    finally:
        from datetime import datetime, timezone
        _update_state["finished_at"] = datetime.now(timezone.utc).isoformat()


@router.post("/update/apply", dependencies=[Depends(require_admin)])
async def apply_update():
    """Pull latest code from origin/main and rebuild containers."""
    with _update_lock:
        if _update_state["status"] == "running":
            raise HTTPException(status_code=409, detail="Update already in progress")
        thread = threading.Thread(target=_do_apply, daemon=True)
        thread.start()
    return {"ok": True, "message": "Update started in background"}


@router.get("/update/status")
async def update_status():
    """Return current update job state."""
    return dict(_update_state)
