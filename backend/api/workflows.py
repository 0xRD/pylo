import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, verify_token
from backend.core import queue_manager
from backend.database import get_session, engine
from backend.pybooks.models import PyBook, PyBookRun
from backend.workflows.models import Workflow, WorkflowRun, WorkflowNodeRun
from backend.workflows.validator import validate_dag

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
    trigger_config: str = "{}"
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


TRIGGER_TYPES = {"manual", "cron", "webhook", "blueprint"}
TERMINAL_STATUSES = {"success", "error", "timeout", "cancelled"}


def _validate_definition(nodes: Optional[str], edges: Optional[str], trigger_type: Optional[str],
                         trigger_config: Optional[str]) -> None:
    """Reject malformed graphs at write time instead of failing at run time."""
    def _array(raw: str, field: str) -> list:
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"{field} must be valid JSON")
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise HTTPException(status_code=422, detail=f"{field} must be a JSON array of objects")
        return value

    if nodes is not None:
        ids = [n.get("id") for n in _array(nodes, "nodes")]
        if any(not i for i in ids) or len(set(ids)) != len(ids):
            raise HTTPException(status_code=422, detail="Every node needs a unique id")
    if edges is not None:
        _array(edges, "edges")
    if trigger_type is not None and trigger_type not in TRIGGER_TYPES:
        raise HTTPException(status_code=422, detail=f"trigger_type must be one of {sorted(TRIGGER_TYPES)}")
    if trigger_config is not None:
        try:
            if not isinstance(json.loads(trigger_config), dict):
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="trigger_config must be a JSON object")


def _auto_layout(nodes_json: Optional[str], edges_json: Optional[str]) -> Optional[str]:
    """Give canvas coordinates to nodes saved without them (API clients, scripts).

    Nodes are placed left to right by their depth in the graph. Nodes that
    already carry numeric ``x``/``y`` are left where they are.
    """
    if nodes_json is None:
        return None
    nodes = json.loads(nodes_json)

    def _placed(node: dict) -> bool:
        return all(isinstance(node.get(k), (int, float)) and not isinstance(node.get(k), bool) for k in ("x", "y"))

    if all(_placed(n) for n in nodes):
        return nodes_json
    try:
        edges = json.loads(edges_json or "[]")
    except (TypeError, ValueError):
        edges = []
    ids = [n["id"] for n in nodes]
    parents: dict[str, list[str]] = {i: [] for i in ids}
    for edge in edges if isinstance(edges, list) else []:
        src, tgt = edge.get("from"), edge.get("to")
        if src in parents and tgt in parents and src != tgt:
            parents[tgt].append(src)
    depth: dict[str, int] = {}

    def _depth(node_id: str, trail: tuple = ()) -> int:
        if node_id in depth:
            return depth[node_id]
        if node_id in trail:  # cycle: the validator reports it, layout just must not loop
            return 0
        depth[node_id] = 1 + max((_depth(p, trail + (node_id,)) for p in parents[node_id]), default=-1)
        return depth[node_id]

    rows: dict[int, int] = {}
    for node in nodes:
        column = _depth(node["id"])
        row = rows.get(column, 0)
        rows[column] = row + 1
        if not _placed(node):
            node["x"], node["y"] = 80 + column * 290, 80 + row * 140
    return json.dumps(nodes)


def _resync_schedules() -> None:
    from backend.core.scheduler import sync_cron_jobs
    try:
        sync_cron_jobs()
    except Exception:  # scheduling problems must not fail the save itself
        import logging
        logging.getLogger(__name__).exception("Could not resync cron jobs")


@router.get("")
async def list_workflows(session: Session = Depends(get_session)):
    return session.exec(select(Workflow).order_by(Workflow.created_at.desc())).all()


@router.post("", status_code=201)
async def create_workflow(
    body: WorkflowCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    _validate_definition(body.nodes, body.edges, body.trigger_type, body.trigger_config)
    body.nodes = _auto_layout(body.nodes, body.edges)
    now = datetime.now(timezone.utc)
    wf = Workflow(id=str(uuid.uuid4()), **body.model_dump(), created_at=now, updated_at=now)
    session.add(wf)
    log_activity(session, "workflow.created", actor=current_user.username,
                 resource_type="workflow", resource_id=wf.id, resource_name=wf.name)
    session.commit()
    session.refresh(wf)
    _resync_schedules()
    return wf



@router.get("/runs")
async def list_all_workflow_runs(
    workflow_id: Optional[str] = None,
    status: List[str] = Query(default=[]),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    stmt = select(WorkflowRun).order_by(WorkflowRun.started_at.desc())
    if workflow_id:
        stmt = stmt.where(WorkflowRun.workflow_id == workflow_id)
    if status:
        stmt = stmt.where(WorkflowRun.status.in_(status))
    stmt = stmt.offset(offset).limit(limit)
    return session.exec(stmt).all()

@router.post("/runs/{run_id}/cancel")
async def cancel_workflow_run(
    run_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    """Cancel a queued or running workflow run. Containers of nodes that are
    executing are killed and no further nodes are started."""
    run = session.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Run already finished ({run.status})")
    run.status = "cancelled"
    # Set even for running runs: the executor overwrites it when it finishes,
    # but a backend restart in between would otherwise leave it unset forever.
    run.ended_at = run.ended_at or datetime.now(timezone.utc)
    session.add(run)
    wf = session.get(Workflow, run.workflow_id)
    log_activity(session, "workflow.run_cancelled", actor=current_user.username,
                 resource_type="workflow", resource_id=run.workflow_id,
                 resource_name=wf.name if wf else None, detail={"run_id": run_id})
    session.commit()
    if was_running:
        import asyncio
        from backend.core.runner import kill_run
        active = session.exec(
            select(WorkflowNodeRun).where(
                WorkflowNodeRun.workflow_run_id == run_id, WorkflowNodeRun.status == "running"
            )
        ).all()
        for node_run in active:
            if node_run.pybook_run_id:
                await asyncio.to_thread(kill_run, node_run.pybook_run_id)
    return {"id": run.id, "status": run.status}


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
    _validate_definition(patch.get("nodes"), patch.get("edges"), patch.get("trigger_type"), patch.get("trigger_config"))
    if "nodes" in patch:
        patch["nodes"] = _auto_layout(patch["nodes"], patch.get("edges", wf.edges))
    for k, v in patch.items():
        setattr(wf, k, v)
    wf.updated_at = datetime.now(timezone.utc)
    session.add(wf)
    log_activity(session, "workflow.updated", actor=current_user.username,
                 resource_type="workflow", resource_id=workflow_id, resource_name=wf.name,
                 detail={"changed_fields": list(patch.keys())})
    session.commit()
    session.refresh(wf)
    if patch.keys() & {"trigger_type", "trigger_config", "is_active"}:
        _resync_schedules()
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
    _resync_schedules()


@router.get("/{workflow_id}/validate")
async def validate_workflow(
    workflow_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    """Validate a workflow's DAG — checks cycles, missing/inactive PyBooks, broken edges."""
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    errors = validate_dag(wf.nodes, wf.edges, session)
    return {"valid": len(errors) == 0, "errors": errors}


class WorkflowRunTrigger(BaseModel):
    trigger_payload: dict = {}


@router.post("/{workflow_id}/run")
async def trigger_workflow_run(
    workflow_id: str,
    body: Optional[WorkflowRunTrigger] = None,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not wf.is_active:
        raise HTTPException(status_code=400, detail="Workflow is inactive")

    # Block run if DAG is invalid
    errors = validate_dag(wf.nodes, wf.edges, session)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Workflow has validation errors", "errors": errors},
        )

    now = datetime.now(timezone.utc)
    wf_run = WorkflowRun(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        status="queued",
        trigger_source=current_user.username,
        trigger_payload=json.dumps(body.trigger_payload if body else {}),
        started_at=now,
    )
    session.add(wf_run)
    session.commit()
    session.refresh(wf_run)
    wf_run_id = wf_run.id

    queue_manager.enqueue_workflow(wf_run_id)
    return wf_run


@router.get("/{workflow_id}/runs")
async def list_workflow_runs(
    workflow_id: str,
    limit: int = Query(50, ge=1, le=500),
    session: Session = Depends(get_session),
):
    return session.exec(
        select(WorkflowRun)
        .where(WorkflowRun.workflow_id == workflow_id)
        .order_by(WorkflowRun.started_at.desc())
        .limit(limit)
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
        select(WorkflowNodeRun)
        .where(WorkflowNodeRun.workflow_run_id == run_id)
        .order_by(WorkflowNodeRun.started_at)
    ).all()
    # Enrich node runs with their label, PyBook and the script version that ran.
    wf = session.get(Workflow, workflow_id)
    try:
        node_defs = {n.get("id"): n for n in json.loads(wf.nodes or "[]")} if wf else {}
    except (TypeError, ValueError):
        node_defs = {}
    pb_run_ids = [nr.pybook_run_id for nr in node_runs if nr.pybook_run_id]
    pb_runs = {r.id: r for r in session.exec(select(PyBookRun).where(PyBookRun.id.in_(pb_run_ids))).all()} if pb_run_ids else {}
    pb_names = {p.id: p.name for p in session.exec(
        select(PyBook).where(PyBook.id.in_({r.pybook_id for r in pb_runs.values()}))
    ).all()} if pb_runs else {}
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
                "node_label": (node_defs.get(nr.node_id) or {}).get("label"),
                "node_type": (node_defs.get(nr.node_id) or {}).get("type", "pybook"),
                "pybook_run_id": nr.pybook_run_id,
                "pybook_id": pb_runs[nr.pybook_run_id].pybook_id if nr.pybook_run_id in pb_runs else None,
                "pybook_name": pb_names.get(pb_runs[nr.pybook_run_id].pybook_id) if nr.pybook_run_id in pb_runs else None,
                "script_version": pb_runs[nr.pybook_run_id].script_version if nr.pybook_run_id in pb_runs else None,
                "status": nr.status,
                "output_vars": nr.output_vars,
                "started_at": nr.started_at.isoformat() if nr.started_at else None,
                "ended_at": nr.ended_at.isoformat() if nr.ended_at else None,
                "duration_ms": nr.duration_ms,
            }
            for nr in node_runs
        ],
    }
