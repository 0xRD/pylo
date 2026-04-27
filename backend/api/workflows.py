import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, verify_token
from backend.database import get_session, engine
from backend.workflows.models import Workflow, WorkflowRun, WorkflowNodeRun

router = APIRouter(
    prefix="/api/workflows",
    tags=["workflows"],
    dependencies=[Depends(verify_token)],
)


class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = True
    trigger_type: str = "manual"
    nodes: str = "[]"
    edges: str = "[]"


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[str] = None
    nodes: Optional[str] = None
    edges: Optional[str] = None


@router.get("")
async def list_workflows(session: Session = Depends(get_session)):
    return session.exec(select(Workflow).order_by(Workflow.created_at.desc())).all()


@router.post("", status_code=201)
async def create_workflow(
    body: WorkflowCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    now = datetime.now(timezone.utc)
    wf = Workflow(id=str(uuid.uuid4()), **body.model_dump(), created_at=now, updated_at=now)
    session.add(wf)
    log_activity(session, "workflow.created", actor=current_user.username,
                 resource_type="workflow", resource_id=wf.id, resource_name=wf.name)
    session.commit()
    session.refresh(wf)
    return wf


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str, session: Session = Depends(get_session)):
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    body: WorkflowUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    patch = body.model_dump(exclude_none=True)
    for k, v in patch.items():
        setattr(wf, k, v)
    wf.updated_at = datetime.now(timezone.utc)
    session.add(wf)
    log_activity(session, "workflow.updated", actor=current_user.username,
                 resource_type="workflow", resource_id=workflow_id, resource_name=wf.name,
                 detail={"changed_fields": list(patch.keys())})
    session.commit()
    session.refresh(wf)
    return wf


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    wf_name = wf.name
    runs = session.exec(select(WorkflowRun).where(WorkflowRun.workflow_id == workflow_id)).all()
    for run in runs:
        nrs = session.exec(select(WorkflowNodeRun).where(WorkflowNodeRun.workflow_run_id == run.id)).all()
        for nr in nrs:
            session.delete(nr)
        session.delete(run)
    session.delete(wf)
    log_activity(session, "workflow.deleted", actor=current_user.username,
                 resource_type="workflow", resource_id=workflow_id, resource_name=wf_name)
    session.commit()


@router.post("/{workflow_id}/run")
async def trigger_workflow_run(
    workflow_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    now = datetime.now(timezone.utc)
    wf_run = WorkflowRun(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        status="pending",
        trigger_source=current_user.username,
        started_at=now,
    )
    session.add(wf_run)
    session.commit()
    session.refresh(wf_run)
    wf_run_id = wf_run.id

    asyncio.create_task(_run_bg(wf_run_id))
    return wf_run


async def _run_bg(workflow_run_id: str) -> None:
    from backend.workflows.executor import execute_workflow
    try:
        await execute_workflow(workflow_run_id)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Workflow run %s crashed: %s", workflow_run_id, exc)


@router.get("/{workflow_id}/runs")
async def list_workflow_runs(workflow_id: str, session: Session = Depends(get_session)):
    return session.exec(
        select(WorkflowRun)
        .where(WorkflowRun.workflow_id == workflow_id)
        .order_by(WorkflowRun.started_at.desc())
    ).all()


@router.get("/{workflow_id}/runs/{run_id}")
async def get_workflow_run(
    workflow_id: str,
    run_id: str,
    session: Session = Depends(get_session),
):
    run = session.get(WorkflowRun, run_id)
    if not run or run.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Run not found")
    node_runs = session.exec(
        select(WorkflowNodeRun).where(WorkflowNodeRun.workflow_run_id == run_id)
    ).all()
    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "status": run.status,
        "trigger_source": run.trigger_source,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "ended_at": run.ended_at.isoformat() if run.ended_at else None,
        "duration_ms": run.duration_ms,
        "node_runs": [
            {
                "id": nr.id,
                "node_id": nr.node_id,
                "pybook_run_id": nr.pybook_run_id,
                "status": nr.status,
                "started_at": nr.started_at.isoformat() if nr.started_at else None,
                "ended_at": nr.ended_at.isoformat() if nr.ended_at else None,
                "duration_ms": nr.duration_ms,
            }
            for nr in node_runs
        ],
    }
