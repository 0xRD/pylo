import json
import logging
import uuid
from datetime import datetime, timezone

from backend.core.auth import verify_token
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from backend.database import get_session
from backend.pybooks.models import PyBook, PyBookRun
from backend.core import queue_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"], dependencies=[Depends(verify_token)])


@router.post("/{pybook_id}")
async def receive_webhook(
    pybook_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    if not pb.is_active:
        raise HTTPException(status_code=400, detail="PyBook is inactive")
    if pb.trigger_type not in ("webhook", "manual"):
        raise HTTPException(status_code=400, detail="PyBook is not configured for webhook triggers")

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    now = datetime.now(timezone.utc)
    run = PyBookRun(
        id=str(uuid.uuid4()),
        pybook_id=pybook_id,
        status="queued",
        trigger_source="webhook",
        trigger_payload=json.dumps(payload),
        started_at=now,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    from backend.api.pybooks import _execute_run
    queue_manager.enqueue(pybook_id, run.id)
    return {"run_id": run.id, "status": "accepted"}


@router.post("/workflows/{workflow_id}")
async def receive_workflow_webhook(
    workflow_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    """Start a workflow whose trigger type is "webhook"; the JSON body becomes its payload."""
    from backend.workflows.models import Workflow, WorkflowRun
    from backend.workflows.validator import validate_dag

    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not wf.is_active:
        raise HTTPException(status_code=400, detail="Workflow is inactive")
    if wf.trigger_type != "webhook":
        raise HTTPException(status_code=400, detail="Workflow is not configured for webhook triggers")
    if validate_dag(wf.nodes, wf.edges, session):
        raise HTTPException(status_code=422, detail="Workflow has validation errors")

    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {"data": payload}

    run = WorkflowRun(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        status="queued",
        trigger_source="webhook",
        trigger_payload=json.dumps(payload),
        started_at=datetime.now(timezone.utc),
    )
    session.add(run)
    session.commit()
    queue_manager.enqueue_workflow(run.id)
    return {"run_id": run.id, "status": "accepted"}
