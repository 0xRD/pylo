import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core.auth import verify_token
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


class RunTrigger(BaseModel):
    trigger_source: str = "manual"
    trigger_payload: dict = {}


async def _execute_run(pybook_id: str, run_id: str):
    """Background task: opens its own session so it's not tied to the request session."""
    from backend.core.runner import run_pybook

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
        deps = json.loads(pb.dependencies or "[]")
        secrets = json.loads(pb.required_secrets or "[]")
        payload = json.loads(run.trigger_payload or "{}")
        started = datetime.now(timezone.utc)

        try:
            stdout, stderr, exit_code = await run_pybook(
                pybook_id=pb.id,
                run_id=run.id,
                script_path=script_path,
                dependencies=deps,
                required_secrets=secrets,
                trigger_payload=payload,
            )
            ended = datetime.now(timezone.utc)
            run.stdout = stdout
            run.stderr = stderr
            run.exit_code = exit_code
            run.status = "success" if exit_code == 0 else "error"
        except TimeoutError as exc:
            ended = datetime.now(timezone.utc)
            run.status = "timeout"
            run.stderr = str(exc)
            run.exit_code = -1
        except Exception as exc:
            ended = datetime.now(timezone.utc)
            run.status = "error"
            run.stderr = str(exc)
            run.exit_code = -1
            logger.exception("Unexpected error running pybook %s", pb.id)

        run.ended_at = ended
        run.duration_ms = int((ended - started).total_seconds() * 1000)
        session.add(run)
        session.commit()


@router.get("")
async def list_pybooks(session: Session = Depends(get_session)):
    return session.exec(select(PyBook)).all()


@router.post("", status_code=201)
async def create_pybook(body: PyBookCreate, session: Session = Depends(get_session)):
    now = datetime.now(timezone.utc)
    pb = PyBook(id=str(uuid.uuid4()), **body.model_dump(), created_at=now, updated_at=now)
    write_script(pb.id, pb.script)
    session.add(pb)
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
    pybook_id: str, body: PyBookUpdate, session: Session = Depends(get_session)
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(pb, field, value)
    pb.updated_at = datetime.now(timezone.utc)
    if body.script is not None:
        write_script(pb.id, body.script)
    session.add(pb)
    session.commit()
    session.refresh(pb)
    # Re-sync cron if trigger config changed
    if body.trigger_type is not None or body.trigger_config is not None or body.is_active is not None:
        from backend.core.scheduler import sync_cron_jobs
        sync_cron_jobs()
    return pb


@router.delete("/{pybook_id}", status_code=204)
async def delete_pybook(pybook_id: str, session: Session = Depends(get_session)):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    runs = session.exec(select(PyBookRun).where(PyBookRun.pybook_id == pybook_id)).all()
    for run in runs:
        session.delete(run)
    session.delete(pb)
    session.commit()


@router.post("/{pybook_id}/run")
async def run_pybook_endpoint(
    pybook_id: str,
    body: RunTrigger,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    if not pb.is_active:
        raise HTTPException(status_code=400, detail="PyBook is inactive")

    now = datetime.now(timezone.utc)
    run = PyBookRun(
        id=str(uuid.uuid4()),
        pybook_id=pybook_id,
        status="pending",
        trigger_source=body.trigger_source,
        trigger_payload=json.dumps(body.trigger_payload),
        started_at=now,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    # Pass only IDs — background task opens its own session
    background_tasks.add_task(_execute_run, pybook_id, run.id)
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
