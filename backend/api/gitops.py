"""
GitOps API — dev → prod config promotion via a shared git repository.

Dev instance  : writes objects to git (Commit & Push)
Prod instance : reads objects from git (Sync / Apply)

Git repo layout:
  manifest.json
  blueprints/<slug>.json
  pybooks/<slug>.json
  workflows/<slug>.json   ← nodes reference pybooks by name slug, not UUID
"""

import base64
import json
import logging
import os
import pathlib
import re
import subprocess
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, require_admin, verify_token
from backend.core.crypto import encrypt as _enc, decrypt as _dec
from backend.database import get_session
from backend.objects.models import Blueprint
from backend.pybooks.models import PyBook
from backend.workflows.models import Workflow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/gitops", tags=["gitops"], dependencies=[Depends(verify_token)])

GITOPS_DIR = pathlib.Path("/app/objects_storage/gitops_repo")

# Fields ignored during diff comparison (volatile / instance-specific)
_VOLATILE = {"id", "is_active", "created_at", "updated_at",
             "pylo_export", "version", "exported_at", "entries"}


# ── Settings helpers ──────────────────────────────────────────────────────────

def _gs(session: Session, key: str) -> str:
    from backend.api.settings import get_setting
    return get_setting(session, key) or ""


def _ss(session: Session, key: str, value: str) -> None:
    from backend.api.settings import set_setting
    set_setting(session, key, value)


# ── Git helpers ───────────────────────────────────────────────────────────────

def _auth_env(token: str) -> dict:
    """Git auth via environment-only config, so the token never lands in
    .git/config, process arguments, or git's error messages."""
    if not token:
        return {}
    # Same credential semantics as the former https://<token>@host URLs.
    basic = base64.b64encode(f"{token}:".encode()).decode()
    return {
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "http.extraHeader",
        "GIT_CONFIG_VALUE_0": f"Authorization: Basic {basic}",
    }


def _strip_credentials(url: str) -> str:
    """Drop any user:password@ from an HTTPS URL (also cleans remotes written by older versions)."""
    if not url.startswith("http"):
        return url
    parsed = urlparse(url)
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


def _git(args: list, cwd: pathlib.Path | None = None, check: bool = True, extra_env: dict = None):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", **(extra_env or {})}
    r = subprocess.run(["git"] + args, cwd=str(cwd or GITOPS_DIR), capture_output=True, text=True, env=env)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip() or f"git {args[0]} failed")
    return r


def _ensure_repo(url: str, branch: str, token: str = "") -> None:
    """Clone if not present, then fetch latest from remote."""
    GITOPS_DIR.parent.mkdir(parents=True, exist_ok=True)
    url = _strip_credentials(url)
    auth = _auth_env(token)

    if not (GITOPS_DIR / ".git").exists():
        r = _git(["clone", url, str(GITOPS_DIR)], cwd=GITOPS_DIR.parent, check=False, extra_env=auth)
        if r.returncode != 0:
            # Possibly empty repo — init locally and add remote
            GITOPS_DIR.mkdir(exist_ok=True)
            _git(["init"], check=False)
            _git(["remote", "add", "origin", url], check=False)
    else:
        _git(["remote", "set-url", "origin", url], check=False)

    # Fetch (may fail silently for brand-new empty repos)
    _git(["fetch", "origin"], check=False, extra_env=auth)

    # Checkout the target branch (tracking remote if available)
    r = _git(["checkout", "-B", branch, f"origin/{branch}"], check=False)
    if r.returncode != 0:
        _git(["checkout", "-B", branch], check=False)


# ── Object serialisation for the git repo ────────────────────────────────────

def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", (name or "").strip()).strip("_")


def _blueprint_for_git(session: Session, bp: Blueprint) -> dict:
    return {
        "name": bp.name,
        "description": bp.description,
        "source_url": bp.source_url,
        "source_method": bp.source_method,
        "source_headers": bp.source_headers,
        "source_body": bp.source_body,
        "field_mappings": bp.field_mappings,
        "fetch_cron": bp.fetch_cron,
        "fetch_is_active": bp.fetch_is_active,
        "is_manual": bp.is_manual,
        "pagination_type": bp.pagination_type,
        "pagination_param": bp.pagination_param,
        "pagination_path": bp.pagination_path,
        "pagination_items_path": bp.pagination_items_path,
        "pagination_max_pages": bp.pagination_max_pages,
        "fetch_entry_limit": bp.fetch_entry_limit,
        "fetch_retry_count": bp.fetch_retry_count,
        "fetch_retry_delay_seconds": bp.fetch_retry_delay_seconds,
        "fetch_on_fail_pybook_id": bp.fetch_on_fail_pybook_id,
        "max_entries": bp.max_entries,
        "retention_days": bp.retention_days,
        "retention_minutes": bp.retention_minutes,
        "mutable_mode": bp.mutable_mode,
    }


def _pybook_for_git(pb: PyBook) -> dict:
    return {
        "name": pb.name,
        "description": pb.description,
        "script": pb.script,
        "is_sub_pybook": pb.is_sub_pybook,
        "dependencies": pb.dependencies,
        "trigger_type": pb.trigger_type,
        "trigger_config": pb.trigger_config,
        "required_secrets": pb.required_secrets,
        "tags": pb.tags,
    }


def _workflow_for_git(session: Session, wf: Workflow) -> dict:
    """Workflow with pybook UUIDs replaced by name slugs for portability."""
    nodes = json.loads(wf.nodes or "[]")
    # Build UUID → name-slug map
    id_to_slug: dict[str, str] = {}
    for node in nodes:
        pb_id = node.get("pybookId")
        if pb_id and pb_id not in id_to_slug:
            pb = session.get(PyBook, pb_id)
            id_to_slug[pb_id] = _slug(pb.name) if pb else pb_id

    nodes_portable = []
    for node in nodes:
        n = dict(node)
        pb_id = n.pop("pybookId", None)
        if pb_id:
            n["pybookSlug"] = id_to_slug.get(pb_id, pb_id)
        nodes_portable.append(n)

    return {
        "name": wf.name,
        "description": wf.description,
        "trigger_type": wf.trigger_type,
        "trigger_config": wf.trigger_config,
        "nodes": json.dumps(nodes_portable),
        "edges": wf.edges,
    }


# ── Diff helpers ──────────────────────────────────────────────────────────────

def _read_folder(folder: str) -> dict[str, dict]:
    """Read all JSON files from a subfolder of GITOPS_DIR. Returns {slug: data}."""
    path = GITOPS_DIR / folder
    if not path.exists():
        return {}
    result: dict[str, dict] = {}
    for f in sorted(path.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            name = data.get("name", "").strip()
            if name:
                result[_slug(name)] = data
        except Exception:
            pass
    return result


def _db_state(session: Session) -> dict:
    blueprints = {_slug(bp.name): _blueprint_for_git(session, bp)
                  for bp in session.exec(select(Blueprint)).all()}
    pybooks = {_slug(pb.name): _pybook_for_git(pb)
               for pb in session.exec(select(PyBook)).all()}
    workflows = {_slug(wf.name): _workflow_for_git(session, wf)
                 for wf in session.exec(select(Workflow)).all()}
    return {"blueprints": blueprints, "pybooks": pybooks, "workflows": workflows}


def _repo_state() -> dict:
    return {
        "blueprints": _read_folder("blueprints"),
        "pybooks": _read_folder("pybooks"),
        "workflows": _read_folder("workflows"),
    }


def _field_diff(old: dict, new: dict) -> list:
    all_keys = sorted(set(old) | set(new))
    return [
        {"field": k, "old": old.get(k), "new": new.get(k)}
        for k in all_keys
        if old.get(k) != new.get(k)
    ]


def _diff(repo: dict[str, dict], db: dict[str, dict], object_type: str) -> dict:
    new_objs, modified_objs, deleted_objs = [], [], []

    for s, data in db.items():
        if s not in repo:
            new_objs.append({"slug": s, "name": data.get("name", s), "data": data})
        else:
            changed = _field_diff(repo[s], data)
            if changed:
                modified_objs.append({
                    "slug": s, "name": data.get("name", s),
                    "data": data, "changed_fields": changed,
                })

    for s, data in repo.items():
        if s not in db:
            deleted_objs.append({"slug": s, "name": data.get("name", s)})

    return {"type": object_type, "new": new_objs, "modified": modified_objs, "deleted": deleted_objs}


def _count_pending(repo_state: dict, db_state: dict) -> int:
    total = 0
    for key in ("blueprints", "pybooks", "workflows"):
        d = _diff(repo_state.get(key, {}), db_state.get(key, {}), key)
        total += len(d["new"]) + len(d["modified"]) + len(d["deleted"])
    return total


# ── Endpoints ─────────────────────────────────────────────────────────────────

class GitConfig(BaseModel):
    environment: str = "dev"        # "dev" or "prod"
    git_repo_url: str = ""
    git_branch: str = "main"
    git_token: Optional[str] = None  # plain; set to "" to clear, None to leave unchanged
    git_committer_name: str = "Pylo"
    git_committer_email: str = "pylo@localhost"


@router.get("/config")
async def get_git_config(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    token_enc = _gs(session, "git_token_enc")
    return {
        "environment": _gs(session, "environment") or "dev",
        "git_repo_url": _gs(session, "git_repo_url"),
        "git_branch": _gs(session, "git_branch") or "main",
        "git_token_set": bool(token_enc),
        "git_committer_name": _gs(session, "git_committer_name"),
        "git_committer_email": _gs(session, "git_committer_email"),
    }


@router.put("/config")
async def update_git_config(
    body: GitConfig,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    if body.environment not in ("dev", "prod"):
        raise HTTPException(400, "environment must be 'dev' or 'prod'")

    _ss(session, "environment", body.environment)
    _ss(session, "git_repo_url", body.git_repo_url)
    _ss(session, "git_branch", body.git_branch or "main")
    _ss(session, "git_committer_name", body.git_committer_name)
    _ss(session, "git_committer_email", body.git_committer_email)

    if body.git_token is not None:
        if body.git_token:
            _ss(session, "git_token_enc", _enc(body.git_token))
        else:
            _ss(session, "git_token_enc", "")

    log_activity(session, "gitops.config.updated", actor=current_user.username,
                 detail={"environment": body.environment})
    return {"ok": True}


@router.get("/status")
async def git_status(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    """Quick status: pending change count (dev) or remote-ahead flag (prod). No full diff."""
    env = _gs(session, "environment") or "dev"
    url = _gs(session, "git_repo_url")
    if not url:
        return {"environment": env, "configured": False, "pending_count": 0, "remote_ahead": False}

    token_enc = _gs(session, "git_token_enc")
    token = _dec(token_enc) if token_enc else ""
    branch = _gs(session, "git_branch") or "main"

    try:
        _ensure_repo(url, branch, token)
    except Exception as exc:
        return {"environment": env, "configured": True, "error": str(exc),
                "pending_count": 0, "remote_ahead": False}

    # Check if repo has any commits
    r = _git(["rev-parse", "HEAD"], check=False)
    if r.returncode != 0:
        # Empty repo — everything in DB is "new"
        db = _db_state(session)
        total = sum(len(v) for v in db.values())
        return {"environment": env, "configured": True, "pending_count": total, "remote_ahead": False}

    repo = _repo_state()
    db = _db_state(session)
    pending = _count_pending(repo, db)

    # For prod: check if remote is ahead of local
    remote_ahead = False
    if env == "prod":
        r2 = _git(["rev-list", "--count", f"HEAD..origin/{branch}"], check=False)
        try:
            remote_ahead = int(r2.stdout.strip()) > 0
        except ValueError:
            pass

    return {
        "environment": env,
        "configured": True,
        "pending_count": pending,
        "remote_ahead": remote_ahead,
    }


@router.get("/diff")
async def git_diff(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    """Full diff — for opening the Commit or Sync panel."""
    url = _gs(session, "git_repo_url")
    if not url:
        raise HTTPException(400, "Git repository not configured")

    token_enc = _gs(session, "git_token_enc")
    token = _dec(token_enc) if token_enc else ""
    branch = _gs(session, "git_branch") or "main"

    try:
        _ensure_repo(url, branch, token)
    except Exception as exc:
        raise HTTPException(500, f"Git error: {exc}")

    repo = _repo_state()
    db = _db_state(session)

    return {
        "blueprints": _diff(repo.get("blueprints", {}), db.get("blueprints", {}), "blueprint"),
        "pybooks": _diff(repo.get("pybooks", {}), db.get("pybooks", {}), "pybook"),
        "workflows": _diff(repo.get("workflows", {}), db.get("workflows", {}), "workflow"),
    }


class CommitBody(BaseModel):
    message: str = "Pylo config update"
    blueprints: list[str] = []   # slugs to include (new + modified)
    pybooks: list[str] = []
    workflows: list[str] = []
    delete_blueprints: list[str] = []  # slugs to delete from repo
    delete_pybooks: list[str] = []
    delete_workflows: list[str] = []


@router.post("/commit")
async def git_commit(
    body: CommitBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    """(Dev only) Write selected objects to the git repo and push."""
    env = _gs(session, "environment") or "dev"
    if env != "dev":
        raise HTTPException(403, "Commit is only available in dev mode")

    url = _gs(session, "git_repo_url")
    if not url:
        raise HTTPException(400, "Git repository not configured")

    token_enc = _gs(session, "git_token_enc")
    token = _dec(token_enc) if token_enc else ""
    branch = _gs(session, "git_branch") or "main"
    committer_name = _gs(session, "git_committer_name") or "Pylo"
    committer_email = _gs(session, "git_committer_email") or "pylo@localhost"

    try:
        _ensure_repo(url, branch, token)
    except Exception as exc:
        raise HTTPException(500, f"Git error: {exc}")

    # Build DB state (objects keyed by slug)
    db = _db_state(session)
    now_iso = datetime.now(timezone.utc).isoformat()

    def _safe_path(folder: str, slug: str) -> str:
        if folder not in ("blueprints", "pybooks", "workflows") or \
                not re.fullmatch(r"[A-Za-z0-9_.-]+", slug or ""):
            raise HTTPException(400, f"Invalid slug: {slug!r}")
        base = os.path.realpath(str(GITOPS_DIR))
        full = os.path.realpath(os.path.join(base, folder, f"{slug}.json"))
        if not full.startswith(base + os.sep):
            raise HTTPException(400, f"Invalid slug: {slug!r}")
        return full

    def _write(folder: str, slug: str, data: dict):
        full = _safe_path(folder, slug)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as fh:
            fh.write(json.dumps(data, indent=2, ensure_ascii=False))

    def _delete(folder: str, slug: str):
        full = _safe_path(folder, slug)
        if os.path.exists(full):
            os.remove(full)

    written = 0

    for slug in body.blueprints:
        data = db["blueprints"].get(slug)
        if data:
            _write("blueprints", slug, data)
            written += 1
    for slug in body.delete_blueprints:
        _delete("blueprints", slug)
        written += 1

    for slug in body.pybooks:
        data = db["pybooks"].get(slug)
        if data:
            _write("pybooks", slug, data)
            written += 1
    for slug in body.delete_pybooks:
        _delete("pybooks", slug)
        written += 1

    for slug in body.workflows:
        data = db["workflows"].get(slug)
        if data:
            _write("workflows", slug, data)
            written += 1
    for slug in body.delete_workflows:
        _delete("workflows", slug)
        written += 1

    # Write manifest
    manifest = {
        "pylo_export": "gitops",
        "pushed_at": now_iso,
        "pushed_by": current_user.username,
        "counts": {
            "blueprints": len(list((GITOPS_DIR / "blueprints").glob("*.json"))) if (GITOPS_DIR / "blueprints").exists() else 0,
            "pybooks": len(list((GITOPS_DIR / "pybooks").glob("*.json"))) if (GITOPS_DIR / "pybooks").exists() else 0,
            "workflows": len(list((GITOPS_DIR / "workflows").glob("*.json"))) if (GITOPS_DIR / "workflows").exists() else 0,
        },
    }
    (GITOPS_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    if written == 0 and not body.delete_blueprints and not body.delete_pybooks and not body.delete_workflows:
        raise HTTPException(400, "Nothing selected to commit")

    git_env = {
        "GIT_AUTHOR_NAME": committer_name,
        "GIT_AUTHOR_EMAIL": committer_email,
        "GIT_COMMITTER_NAME": committer_name,
        "GIT_COMMITTER_EMAIL": committer_email,
    }

    try:
        _git(["add", "-A"], extra_env=git_env)
        r = _git(["diff", "--cached", "--quiet"], check=False, extra_env=git_env)
        if r.returncode == 0:
            raise HTTPException(400, "No changes to commit (objects are identical to repo)")
        _git(["commit", "-m", body.message or "Pylo config update"], extra_env=git_env)
        _git(["push", "origin", branch], extra_env={**git_env, **_auth_env(token)})
        sha_r = _git(["rev-parse", "--short", "HEAD"], extra_env=git_env)
        sha = sha_r.stdout.strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Git commit/push failed: {exc}")

    log_activity(session, "gitops.committed", actor=current_user.username,
                 detail={"sha": sha, "message": body.message,
                         "written": written})
    session.commit()
    return {"ok": True, "sha": sha}


class SyncBody(BaseModel):
    blueprints: list[str] = []   # slugs to apply
    pybooks: list[str] = []
    workflows: list[str] = []


@router.post("/sync")
async def git_sync(
    body: SyncBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    """(Prod only) Apply selected objects from the remote git repo to the local DB."""
    env = _gs(session, "environment") or "dev"
    if env != "prod":
        raise HTTPException(403, "Sync is only available in prod mode")

    url = _gs(session, "git_repo_url")
    if not url:
        raise HTTPException(400, "Git repository not configured")

    token_enc = _gs(session, "git_token_enc")
    token = _dec(token_enc) if token_enc else ""
    branch = _gs(session, "git_branch") or "main"

    try:
        _ensure_repo(url, branch, token)
    except Exception as exc:
        raise HTTPException(500, f"Git error: {exc}")

    repo = _repo_state()
    now = datetime.now(timezone.utc)

    from backend.api.export_import import (
        _upsert_blueprint, _upsert_pybook, write_script,
    )
    from backend.pybooks.store import write_script as _write_script

    applied = {"blueprints": 0, "pybooks": 0, "workflows": 0}
    pybook_slug_to_id: dict[str, str] = {}

    # 1. Apply PyBooks first (workflows may reference them)
    for slug in body.pybooks:
        data = repo["pybooks"].get(slug)
        if not data:
            continue
        from sqlmodel import select as _sel
        existing = session.exec(_sel(PyBook).where(PyBook.name == data["name"])).first()
        if existing:
            for k, v in data.items():
                if k != "name" and hasattr(existing, k):
                    setattr(existing, k, v)
            existing.updated_at = now
            _write_script(existing.id, existing.script)
            session.add(existing)
            pybook_slug_to_id[slug] = existing.id
        else:
            import uuid as _uuid
            new_id = str(_uuid.uuid4())
            pb = PyBook(id=new_id, name=data["name"], created_at=now, updated_at=now,
                        description=data.get("description"),
                        script=data.get("script", ""),
                        is_sub_pybook=data.get("is_sub_pybook", False),
                        dependencies=data.get("dependencies", "[]"),
                        trigger_type=data.get("trigger_type", "manual"),
                        trigger_config=data.get("trigger_config", "{}"),
                        required_secrets=data.get("required_secrets", "[]"),
                        tags=data.get("tags", "[]"))
            _write_script(pb.id, pb.script)
            session.add(pb)
            pybook_slug_to_id[slug] = new_id
        applied["pybooks"] += 1

    session.flush()

    # 2. Apply Blueprints
    for slug in body.blueprints:
        data = repo["blueprints"].get(slug)
        if not data:
            continue
        from sqlmodel import select as _sel
        existing = session.exec(_sel(Blueprint).where(Blueprint.name == data["name"])).first()
        if existing:
            for k, v in data.items():
                if k != "name" and hasattr(existing, k):
                    setattr(existing, k, v)
            session.add(existing)
        else:
            import uuid as _uuid
            bp = Blueprint(id=str(_uuid.uuid4()), created_at=now,
                           name=data["name"],
                           description=data.get("description"),
                           source_url=data.get("source_url"),
                           source_method=data.get("source_method", "GET"),
                           source_headers=data.get("source_headers", "{}"),
                           source_body=data.get("source_body", "{}"),
                           field_mappings=data.get("field_mappings", "[]"),
                           fetch_cron=data.get("fetch_cron"),
                           fetch_is_active=data.get("fetch_is_active", False),
                           is_manual=data.get("is_manual", False),
                           pagination_type=data.get("pagination_type", "none"),
                           pagination_param=data.get("pagination_param"),
                           pagination_path=data.get("pagination_path"),
                           pagination_items_path=data.get("pagination_items_path"),
                           pagination_max_pages=data.get("pagination_max_pages", 50),
                           fetch_entry_limit=data.get("fetch_entry_limit"),
                           fetch_retry_count=data.get("fetch_retry_count", 0),
                           fetch_retry_delay_seconds=data.get("fetch_retry_delay_seconds", 2),
                           fetch_on_fail_pybook_id=data.get("fetch_on_fail_pybook_id"),
                           max_entries=data.get("max_entries"),
                           retention_days=data.get("retention_days"),
                           retention_minutes=data.get("retention_minutes"),
                           mutable_mode=data.get("mutable_mode", "none"))
            session.add(bp)
        applied["blueprints"] += 1

    # 3. Apply Workflows (resolving pybookSlug → local UUID)
    # Build full slug→id map from DB after pybook upserts
    all_pbs = session.exec(select(PyBook)).all()
    full_slug_map = {_slug(pb.name): pb.id for pb in all_pbs}
    full_slug_map.update(pybook_slug_to_id)  # include freshly created ones

    for wf_slug in body.workflows:
        data = repo["workflows"].get(wf_slug)
        if not data:
            continue

        # Resolve pybookSlug references back to local UUIDs
        nodes = json.loads(data.get("nodes", "[]"))
        nodes_resolved = []
        for node in nodes:
            n = dict(node)
            pb_slug = n.pop("pybookSlug", None)
            if pb_slug:
                n["pybookId"] = full_slug_map.get(pb_slug, pb_slug)
            nodes_resolved.append(n)

        from sqlmodel import select as _sel
        existing_wf = session.exec(_sel(Workflow).where(Workflow.name == data["name"])).first()
        if existing_wf:
            existing_wf.description = data.get("description")
            existing_wf.trigger_type = data.get("trigger_type", "manual")
            existing_wf.trigger_config = data.get("trigger_config", "{}")
            existing_wf.nodes = json.dumps(nodes_resolved)
            existing_wf.edges = data.get("edges", "[]")
            existing_wf.updated_at = now
            session.add(existing_wf)
        else:
            import uuid as _uuid
            new_wf = Workflow(
                id=str(_uuid.uuid4()), created_at=now, updated_at=now,
                name=data["name"],
                description=data.get("description"),
                is_active=False,  # never auto-activate on sync
                trigger_type=data.get("trigger_type", "manual"),
                trigger_config=data.get("trigger_config", "{}"),
                nodes=json.dumps(nodes_resolved),
                edges=data.get("edges", "[]"),
            )
            session.add(new_wf)
        applied["workflows"] += 1

    session.commit()
    log_activity(session, "gitops.synced", actor=current_user.username, detail=applied)
    session.commit()
    return {"ok": True, "applied": applied}
