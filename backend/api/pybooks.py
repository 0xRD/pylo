import asyncio
import json
import os
import re
import shutil
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, verify_token
from backend.core import queue_manager
from backend.database import get_session, engine
from backend.pybooks.models import PyBook, PyBookRun
from backend.pybooks.models import PyBookVersion
from backend.pybooks.store import write_script, get_script_path, sync_script_file, STORAGE_ROOT
from backend.pybooks.versions import current_version_number, record_version, sync_version

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pybooks", tags=["pybooks"], dependencies=[Depends(verify_token)])


class PyBookCreate(BaseModel):
    name: str
    description: Optional[str] = None
    script: str = "# Your PyBook script\nprint('Hello from Pylo!')\n"
    is_sub_pybook: bool = False
    dependencies: str = "[]"
    trigger_type: str = "manual"
    trigger_config: str = "{}"
    required_secrets: str = "[]"
    tags: str = "[]"
    network_policy: str = "default"
    allowed_hosts: str = "[]"


class PyBookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    script: Optional[str] = None
    is_sub_pybook: Optional[bool] = None
    dependencies: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[str] = None
    is_active: Optional[bool] = None
    required_secrets: Optional[str] = None
    tags: Optional[str] = None
    network_policy: Optional[str] = None
    allowed_hosts: Optional[str] = None
    commit_message: Optional[str] = None  # recorded in the script history when `script` changes


class RunTrigger(BaseModel):
    trigger_source: str = "manual"
    trigger_payload: dict = {}
    max_retries: int = 0


_TERMINAL_STATUSES = {"success", "error", "timeout", "cancelled", "dead_letter"}
TRIGGER_TYPES = {"manual", "cron", "webhook", "blueprint", "object_event"}
NETWORK_POLICIES = {"default", "none", "allowlisted"}
MAX_RUN_RETRIES = 10
_HOSTNAME_RE = re.compile(r"^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$")


def _json_list_of_str(raw: str, field: str) -> list[str]:
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be valid JSON")
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise HTTPException(status_code=422, detail=f"{field} must be a JSON array of strings")
    return value


def _validate_pybook_fields(fields: dict, current: Optional[PyBook] = None) -> None:
    """Reject malformed PyBook settings at write time instead of failing (or being
    silently ignored) at run time."""
    for field in ("dependencies", "required_secrets", "tags"):
        if fields.get(field) is not None:
            _json_list_of_str(fields[field], field)
    if fields.get("dependencies") is not None:
        from backend.core.image_builder import _validate_dependency
        for dep in json.loads(fields["dependencies"]):
            try:
                _validate_dependency(dep)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))
    if fields.get("network_policy") is not None and fields["network_policy"] not in NETWORK_POLICIES:
        raise HTTPException(status_code=422, detail=f"network_policy must be one of {sorted(NETWORK_POLICIES)}")
    if fields.get("allowed_hosts") is not None:
        for host in _json_list_of_str(fields["allowed_hosts"], "allowed_hosts"):
            if not _HOSTNAME_RE.fullmatch(host.strip()):
                raise HTTPException(
                    status_code=422,
                    detail=f"allowed_hosts: '{host}' is not a hostname (use e.g. api.example.com, without scheme or path)",
                )
    trigger_type = fields.get("trigger_type")
    if trigger_type is not None and trigger_type not in TRIGGER_TYPES:
        raise HTTPException(status_code=422, detail=f"trigger_type must be one of {sorted(TRIGGER_TYPES)}")
    config = None
    if fields.get("trigger_config") is not None:
        try:
            config = json.loads(fields["trigger_config"])
            if not isinstance(config, dict):
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="trigger_config must be a JSON object")
    effective_type = trigger_type or (current.trigger_type if current else "manual")
    if effective_type == "cron" and (trigger_type is not None or config is not None):
        if config is None:
            try:
                config = json.loads((current.trigger_config if current else "") or "{}")
            except ValueError:
                config = {}
        from backend.core.scheduler import is_valid_cron
        if not is_valid_cron(config.get("cron")):
            raise HTTPException(status_code=422, detail="Cron trigger needs a valid 5-part cron expression")


def _resync_schedules() -> None:
    from backend.core.scheduler import sync_cron_jobs
    try:
        sync_cron_jobs()
    except Exception:  # scheduling problems must not fail the save itself
        logger.exception("Could not resync cron jobs")


async def _execute_run(pybook_id: str, run_id: str):
    """Executes a run inside its own DB session, called by the queue worker."""
    from backend.core.runner import run_pybook

    # Session 1: read config, check not cancelled, mark running, release connection
    with Session(engine) as session:
        pb = session.get(PyBook, pybook_id)
        run = session.get(PyBookRun, run_id)
        if not pb or not run:
            logger.error("PyBook or Run not found: %s / %s", pybook_id, run_id)
            return

        # Skip runs that were cancelled while waiting in the queue
        if run.status == "cancelled":
            logger.info("Run %s was cancelled before execution — skipping", run_id)
            return

        sync_script_file(pb.id, pb.script)
        run.status = "running"
        sync_version(session, pb)
        run.script_version = current_version_number(session, pybook_id)
        session.add(run)
        session.commit()

        script_path = str(get_script_path(pb.id))
        try:
            deps = json.loads(pb.dependencies or "[]")
        except (json.JSONDecodeError, ValueError):
            logger.warning("PyBook %s has invalid dependencies JSON: %s", pb.id, pb.dependencies)
            deps = []
        try:
            secrets = json.loads(pb.required_secrets or "[]")
        except (json.JSONDecodeError, ValueError):
            logger.warning("PyBook %s has invalid required_secrets JSON", pb.id)
            secrets = []
        try:
            hosts = json.loads(pb.allowed_hosts or "[]")
        except (json.JSONDecodeError, ValueError):
            hosts = []

        payload = json.loads(run.trigger_payload or "{}")
        pb_id = pb.id
        pb_name = pb.name
        trigger_source = run.trigger_source
        network_policy = pb.network_policy or "default"
        retry_count = run.retry_count
        max_retries = run.max_retries
    # connection returned to pool here — Docker run happens outside the session

    started = datetime.now(timezone.utc)
    stdout, stderr, exit_code = "", "", -1
    final_status = "error"

    try:
        stdout, stderr, exit_code = await run_pybook(
            pybook_id=pb_id,
            run_id=run_id,
            script_path=script_path,
            dependencies=deps,
            required_secrets=secrets,
            trigger_payload=payload,
            network_policy=network_policy,
            allowed_hosts=hosts,
        )
        final_status = "success" if exit_code == 0 else "error"
    except TimeoutError as exc:
        final_status = "timeout"
        stdout = getattr(exc, "stdout", "")
        stderr = (getattr(exc, "stderr", "") + f"\n[{exc}]").lstrip("\n")
        exit_code = -1
    except Exception as exc:
        final_status = "error"
        stderr = str(exc)
        exit_code = -1
        logger.exception("Unexpected error running pybook %s", pb_id)

    ended = datetime.now(timezone.utc)
    duration_ms = int((ended - started).total_seconds() * 1000)

    # A cancel request (which also kills the container) wins over the outcome.
    with Session(engine) as session:
        run = session.get(PyBookRun, run_id)
        if run and run.status == "cancelled":
            run.stdout = stdout
            run.stderr = (stderr + "\n[Cancelled by user]").lstrip("\n")
            run.exit_code = exit_code
            run.ended_at = ended
            run.duration_ms = duration_ms
            session.add(run)
            log_activity(session, "pybook.run", actor=trigger_source,
                         resource_type="pybook", resource_id=pb_id, resource_name=pb_name,
                         detail={"run_id": run_id, "exit_code": exit_code,
                                 "status": "cancelled", "duration_ms": duration_ms})
            session.commit()
            return

    # Retry logic: on error/timeout, re-enqueue if retries remain
    if final_status in ("error", "timeout") and retry_count < max_retries:
        with Session(engine) as session:
            run = session.get(PyBookRun, run_id)
            if run:
                run.stdout = stdout
                run.stderr = stderr + f"\n[Retry {retry_count + 1}/{max_retries} scheduled]"
                run.exit_code = exit_code
                run.status = "queued"
                run.retry_count = retry_count + 1
                run.ended_at = None
                run.duration_ms = None
                session.add(run)
                session.commit()
        logger.info("Re-enqueuing run %s (retry %d/%d)", run_id, retry_count + 1, max_retries)
        queue_manager.enqueue(pb_id, run_id)
        return

    # Mark permanently failed after all retries exhausted
    if final_status in ("error", "timeout") and retry_count >= max_retries and max_retries > 0:
        final_status = "dead_letter"

    # Session 2: write results
    with Session(engine) as session:
        run = session.get(PyBookRun, run_id)
        if run:
            run.stdout = stdout
            run.stderr = stderr
            run.exit_code = exit_code
            run.status = final_status
            run.ended_at = ended
            run.duration_ms = duration_ms
            session.add(run)
            log_activity(session, "pybook.run", actor=trigger_source,
                         resource_type="pybook", resource_id=pb_id, resource_name=pb_name,
                         detail={"run_id": run_id, "exit_code": exit_code,
                                 "status": final_status, "duration_ms": duration_ms})
            session.commit()


@router.get("")
async def list_pybooks(session: Session = Depends(get_session)):
    return session.exec(select(PyBook)).all()


@router.post("", status_code=201)
async def create_pybook(
    body: PyBookCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    _validate_pybook_fields(body.model_dump())
    now = datetime.now(timezone.utc)
    pb = PyBook(id=str(uuid.uuid4()), **body.model_dump(), created_at=now, updated_at=now)
    write_script(pb.id, pb.script)
    session.add(pb)
    record_version(session, pb.id, pb.script, author=current_user.username, message="Initial version")
    log_activity(session, "pybook.created", actor=current_user.username,
                 resource_type="pybook", resource_id=pb.id, resource_name=pb.name)
    session.commit()
    session.refresh(pb)
    if pb.trigger_type == "cron":
        _resync_schedules()
    return pb


@router.get("/{pybook_id}")
async def get_pybook(pybook_id: str, session: Session = Depends(get_session)):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    return pb


@router.put("/{pybook_id}")
async def update_pybook(
    pybook_id: str,
    body: PyBookUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    updated = body.model_dump(exclude_none=True, exclude={"commit_message"})
    _validate_pybook_fields(updated, current=pb)
    if body.script is not None:
        sync_version(session, pb)  # capture any out-of-band change before overwriting it
    for field, value in updated.items():
        setattr(pb, field, value)
    pb.updated_at = datetime.now(timezone.utc)
    if body.script is not None:
        write_script(pb.id, body.script)
        record_version(session, pb.id, body.script, author=current_user.username,
                       message=body.commit_message or "")
    session.add(pb)
    log_activity(session, "pybook.updated", actor=current_user.username,
                 resource_type="pybook", resource_id=pybook_id, resource_name=pb.name,
                 detail={"changed_fields": list(updated.keys())})
    session.commit()
    session.refresh(pb)
    if body.trigger_type is not None or body.trigger_config is not None or body.is_active is not None:
        _resync_schedules()
    return pb


@router.delete("/{pybook_id}", status_code=204)
async def delete_pybook(
    pybook_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    pb_name = pb.name
    runs = session.exec(select(PyBookRun).where(PyBookRun.pybook_id == pybook_id)).all()
    for run in runs:
        session.delete(run)
    for version in session.exec(select(PyBookVersion).where(PyBookVersion.pybook_id == pybook_id)).all():
        session.delete(version)
    try:
        script_dir = os.path.realpath(str(get_script_path(pb.id).parent))
    except ValueError:
        script_dir = None  # legacy unsafe id: remove the row, never touch the filesystem
    root = os.path.realpath(str(STORAGE_ROOT))
    if script_dir and script_dir.startswith(root + os.sep):
        shutil.rmtree(script_dir, ignore_errors=True)
    session.delete(pb)
    log_activity(session, "pybook.deleted", actor=current_user.username,
                 resource_type="pybook", resource_id=pybook_id, resource_name=pb_name)
    session.commit()
    _resync_schedules()
    from backend.core.image_builder import remove_pybook_images
    await asyncio.to_thread(remove_pybook_images, pybook_id)


@router.post("/{pybook_id}/run")
async def run_pybook_endpoint(
    pybook_id: str,
    body: RunTrigger,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    if not pb.is_active:
        raise HTTPException(status_code=400, detail="PyBook is inactive")

    trigger_source = current_user.username if body.trigger_source == "manual" else body.trigger_source
    now = datetime.now(timezone.utc)
    run = PyBookRun(
        id=str(uuid.uuid4()),
        pybook_id=pybook_id,
        status="queued",
        trigger_source=trigger_source,
        trigger_payload=json.dumps(body.trigger_payload),
        started_at=now,
        max_retries=max(0, min(body.max_retries, MAX_RUN_RETRIES)),
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    queue_manager.enqueue(pybook_id, run.id)
    return run


@router.post("/{pybook_id}/build")
async def build_pybook_image(pybook_id: str, session: Session = Depends(get_session)):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    from backend.core.image_builder import ensure_image
    try:
        deps = json.loads(pb.dependencies or "[]")
        # Image builds take minutes: keep them off the event loop.
        image_tag = await asyncio.to_thread(ensure_image, pb.id, deps)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Image build failed: {exc}")
    pb.docker_image_tag = image_tag
    pb.updated_at = datetime.now(timezone.utc)
    session.add(pb)
    session.commit()
    return {"image_tag": image_tag}


@router.get("/{pybook_id}/runs")
async def list_pybook_runs(
    pybook_id: str,
    limit: int = Query(100, ge=1, le=1000),
    include_output: bool = Query(True, description="Set false to omit stdout/stderr (much smaller responses)"),
    session: Session = Depends(get_session),
):
    from backend.api.runs import run_rows, select_runs

    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    stmt = (
        select_runs(include_output)
        .where(PyBookRun.pybook_id == pybook_id)
        .order_by(PyBookRun.started_at.desc())
        .limit(limit)
    )
    return run_rows(session, stmt, include_output)


# ── Script version history ────────────────────────────────────────────────────

def _version_summary(v: PyBookVersion) -> dict:
    return {
        "version": v.version, "message": v.message, "author": v.author,
        "additions": v.additions, "deletions": v.deletions,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("/{pybook_id}/versions")
async def list_versions(pybook_id: str, session: Session = Depends(get_session)):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    if sync_version(session, pb):
        session.commit()
    versions = session.exec(
        select(PyBookVersion).where(PyBookVersion.pybook_id == pybook_id).order_by(PyBookVersion.version.desc())
    ).all()
    return [_version_summary(v) for v in versions]


def _get_version(session: Session, pybook_id: str, version: int) -> PyBookVersion:
    v = session.exec(
        select(PyBookVersion).where(PyBookVersion.pybook_id == pybook_id, PyBookVersion.version == version)
    ).first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    return v


@router.get("/{pybook_id}/versions/{version}")
async def get_version(pybook_id: str, version: int, session: Session = Depends(get_session)):
    v = _get_version(session, pybook_id, version)
    return {**_version_summary(v), "script": v.script}


@router.post("/{pybook_id}/versions/{version}/restore")
async def restore_version(
    pybook_id: str,
    version: int,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    v = _get_version(session, pybook_id, version)
    sync_version(session, pb)
    pb.script = v.script
    pb.updated_at = datetime.now(timezone.utc)
    write_script(pb.id, v.script)
    session.add(pb)
    record_version(session, pb.id, v.script, author=current_user.username, message=f"Restore v{version}")
    log_activity(session, "pybook.updated", actor=current_user.username,
                 resource_type="pybook", resource_id=pybook_id, resource_name=pb.name,
                 detail={"changed_fields": ["script"], "restored_version": version})
    session.commit()
    session.refresh(pb)
    return pb
