import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, verify_token
from backend.core import queue_manager
from backend.database import get_session, engine
from backend.pybooks.models import PyBook, PyBookRun
from backend.pybooks.store import write_script, get_script_path

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


class RunTrigger(BaseModel):
    trigger_source: str = "manual"
    trigger_payload: dict = {}


async def _execute_run(pybook_id: str, run_id: str):
    """Executes a run inside its own DB session, called by the queue worker."""
    from backend.core.runner import run_pybook

    # Session 1: read config, mark running, then release the connection before
    # the long Docker execution so the pool isn't held during the run.
    with Session(engine) as session:
        pb = session.get(PyBook, pybook_id)
        run = session.get(PyBookRun, run_id)
        if not pb or not run:
            logger.error("PyBook or Run not found: %s / %s", pybook_id, run_id)
            return

        run.status = "running"
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
            logger.warning("PyBook %s has invalid required_secrets JSON: %s", pb.id, pb.required_secrets)
            secrets = []
        payload = json.loads(run.trigger_payload or "{}")
        pb_id = pb.id
        pb_name = pb.name
        trigger_source = run.trigger_source
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
        )
        final_status = "success" if exit_code == 0 else "error"
    except TimeoutError as exc:
        final_status = "timeout"
        stderr = str(exc)
        exit_code = -1
    except Exception as exc:
        final_status = "error"
        stderr = str(exc)
        exit_code = -1
        logger.exception("Unexpected error running pybook %s", pb_id)

    ended = datetime.now(timezone.utc)
    duration_ms = int((ended - started).total_seconds() * 1000)

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
    now = datetime.now(timezone.utc)
    pb = PyBook(id=str(uuid.uuid4()), **body.model_dump(), created_at=now, updated_at=now)
    write_script(pb.id, pb.script)
    session.add(pb)
    log_activity(session, "pybook.created", actor=current_user.username,
                 resource_type="pybook", resource_id=pb.id, resource_name=pb.name)
    session.commit()
    session.refresh(pb)
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
    updated = body.model_dump(exclude_none=True)
    for field, value in updated.items():
        setattr(pb, field, value)
    pb.updated_at = datetime.now(timezone.utc)
    if body.script is not None:
        write_script(pb.id, body.script)
    session.add(pb)
    log_activity(session, "pybook.updated", actor=current_user.username,
                 resource_type="pybook", resource_id=pybook_id, resource_name=pb.name,
                 detail={"changed_fields": list(updated.keys())})
    session.commit()
    session.refresh(pb)
    if body.trigger_type is not None or body.trigger_config is not None or body.is_active is not None:
        from backend.core.scheduler import sync_cron_jobs
        sync_cron_jobs()
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
    session.delete(pb)
    log_activity(session, "pybook.deleted", actor=current_user.username,
                 resource_type="pybook", resource_id=pybook_id, resource_name=pb_name)
    session.commit()


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
    deps = json.loads(pb.dependencies or "[]")
    image_tag = ensure_image(pb.id, deps)
    pb.docker_image_tag = image_tag
    pb.updated_at = datetime.now(timezone.utc)
    session.add(pb)
    session.commit()
    return {"image_tag": image_tag}


@router.get("/{pybook_id}/runs")
async def list_pybook_runs(pybook_id: str, session: Session = Depends(get_session)):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    return session.exec(
        select(PyBookRun)
        .where(PyBookRun.pybook_id == pybook_id)
        .order_by(PyBookRun.started_at.desc())
    ).all()
