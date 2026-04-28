"""
Workflow DAG executor.
Runs a WorkflowRun by traversing nodes/edges in topological order,
executing independent branches in parallel via asyncio.gather.
"""
import asyncio
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlmodel import Session

from backend.database import engine
from backend.pybooks.models import PyBook, PyBookRun
from backend.activity.logger import log_activity
from backend.workflows.models import Workflow, WorkflowRun, WorkflowNodeRun

logger = logging.getLogger(__name__)


def _resolve_jsonpath(path: str, output_vars: dict):
    """Resolve $.vars.key references against an output_vars dict."""
    if isinstance(path, str) and path.startswith("$.vars."):
        return output_vars.get(path[len("$.vars."):])
    return path


def _build_payload(mappings: list, output_vars: dict) -> dict:
    result = {}
    for m in mappings:
        key = m.get("key", "")
        if key:
            result[key] = _resolve_jsonpath(m.get("source", ""), output_vars)
    return result


async def _run_node(workflow_run_id: str, node: dict, payload: dict) -> tuple[str, str, dict]:
    """
    Execute a single workflow node (one PyBook run).
    Returns (node_id, final_status, output_vars).
    """
    from backend.core.runner import run_pybook
    from backend.pybooks.store import get_script_path

    node_id = node["id"]
    pybook_id = node.get("pybookId", "")

    with Session(engine) as session:
        pb = session.get(PyBook, pybook_id)
        if not pb:
            logger.error("PyBook %s not found for node %s", pybook_id, node_id)
            return node_id, "error", {}

        now = datetime.now(timezone.utc)
        pb_run = PyBookRun(
            id=str(uuid.uuid4()),
            pybook_id=pybook_id,
            status="queued",
            trigger_source="workflow",
            trigger_payload=json.dumps(payload),
            started_at=now,
        )
        session.add(pb_run)
        node_run = WorkflowNodeRun(
            id=str(uuid.uuid4()),
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            pybook_run_id=pb_run.id,
            status="running",
            started_at=now,
        )
        session.add(node_run)
        session.commit()
        pb_run_id = pb_run.id
        node_run_id = node_run.id
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

    started = datetime.now(timezone.utc)
    final_status = "error"
    output_vars: dict = {}

    try:
        stdout, stderr, exit_code = await run_pybook(
            pybook_id=pybook_id,
            run_id=pb_run_id,
            script_path=script_path,
            dependencies=deps,
            required_secrets=secrets,
            trigger_payload=payload,
        )
        ended = datetime.now(timezone.utc)
        final_status = "success" if exit_code == 0 else "error"

        with Session(engine) as session:
            pb_run_obj = session.get(PyBookRun, pb_run_id)
            if pb_run_obj:
                pb_run_obj.stdout = stdout
                pb_run_obj.stderr = stderr
                pb_run_obj.exit_code = exit_code
                pb_run_obj.status = final_status
                pb_run_obj.ended_at = ended
                pb_run_obj.duration_ms = int((ended - started).total_seconds() * 1000)
                session.add(pb_run_obj)
                session.commit()
                output_vars = json.loads(pb_run_obj.output_vars or "{}")

    except TimeoutError:
        ended = datetime.now(timezone.utc)
        final_status = "timeout"
        with Session(engine) as session:
            pb_run_obj = session.get(PyBookRun, pb_run_id)
            if pb_run_obj:
                pb_run_obj.status = "timeout"
                pb_run_obj.exit_code = -1
                pb_run_obj.ended_at = ended
                pb_run_obj.duration_ms = int((ended - started).total_seconds() * 1000)
                session.add(pb_run_obj)
                session.commit()
    except Exception as exc:
        ended = datetime.now(timezone.utc)
        final_status = "error"
        logger.exception("Error running node %s: %s", node_id, exc)
        with Session(engine) as session:
            pb_run_obj = session.get(PyBookRun, pb_run_id)
            if pb_run_obj:
                pb_run_obj.status = "error"
                pb_run_obj.stderr = str(exc)
                pb_run_obj.exit_code = -1
                pb_run_obj.ended_at = ended
                pb_run_obj.duration_ms = int((ended - started).total_seconds() * 1000)
                session.add(pb_run_obj)
                session.commit()

    ended_final = datetime.now(timezone.utc)
    with Session(engine) as session:
        nr = session.get(WorkflowNodeRun, node_run_id)
        if nr:
            nr.status = final_status
            nr.output_vars = json.dumps(output_vars)
            nr.ended_at = ended_final
            nr.duration_ms = int((ended_final - started).total_seconds() * 1000)
            session.add(nr)
            session.commit()

    return node_id, final_status, output_vars


async def execute_workflow(workflow_run_id: str) -> None:
    """Main entry point — runs the full workflow DAG."""
    trigger_payload = {}
    with Session(engine) as session:
        wf_run = session.get(WorkflowRun, workflow_run_id)
        if not wf_run:
            logger.error("WorkflowRun %s not found", workflow_run_id)
            return
        wf = session.get(Workflow, wf_run.workflow_id)
        if not wf:
            logger.error("Workflow %s not found for run %s", wf_run.workflow_id, workflow_run_id)
            return
        nodes = json.loads(wf.nodes or "[]")
        edges = json.loads(wf.edges or "[]")
        trigger_payload = json.loads(getattr(wf_run, "trigger_payload", None) or "{}")
        wf_run.status = "running"
        session.add(wf_run)
        session.commit()

    if not nodes:
        _finish(workflow_run_id, "success")
        return

    # Build adjacency structures
    outgoing: dict = defaultdict(list)
    in_degree: dict = defaultdict(int)
    for e in edges:
        outgoing[e["from"]].append(e)
        in_degree[e["to"]] += 1

    node_map = {n["id"]: n for n in nodes}
    start_nodes = [n for n in nodes if in_degree[n["id"]] == 0]

    # DAG traversal — recursive async with parallel branches
    triggered: set = set()
    completed: dict = {}  # node_id -> (status, output_vars)

    async def visit(node: dict, payload: dict) -> None:
        nid = node["id"]
        if nid in triggered:
            return
        triggered.add(nid)

        nid, status, out_vars = await _run_node(workflow_run_id, node, payload)
        completed[nid] = (status, out_vars)

        next_tasks = []
        for edge in outgoing[nid]:
            cond = edge.get("condition", "always")
            should_fire = (
                cond == "always"
                or (cond == "on_success" and status == "success")
                or (cond == "on_failure" and status in ("error", "timeout"))
            )
            if should_fire:
                to_id = edge["to"]
                if to_id not in triggered and to_id in node_map:
                    next_payload = _build_payload(edge.get("mappings", []), out_vars)
                    next_tasks.append(visit(node_map[to_id], next_payload))
        if next_tasks:
            await asyncio.gather(*next_tasks)

    started = datetime.now(timezone.utc)
    try:
        await asyncio.gather(*[visit(n, trigger_payload) for n in start_nodes])
        statuses = [v[0] for v in completed.values()]
        final = "success" if all(s == "success" for s in statuses) else "error"
    except Exception as exc:
        logger.exception("Workflow run %s failed: %s", workflow_run_id, exc)
        final = "error"

    _finish(workflow_run_id, final, started)


def _finish(workflow_run_id: str, status: str, started: datetime | None = None) -> None:
    ended = datetime.now(timezone.utc)
    with Session(engine) as session:
        wf_run = session.get(WorkflowRun, workflow_run_id)
        if wf_run:
            wf_run.status = status
            wf_run.ended_at = ended
            if started:
                wf_run.duration_ms = int((ended - started).total_seconds() * 1000)
            session.add(wf_run)
            wf = session.get(Workflow, wf_run.workflow_id)
            log_activity(
                session, "workflow.run",
                actor=wf_run.trigger_source,
                resource_type="workflow",
                resource_id=wf_run.workflow_id,
                resource_name=wf.name if wf else None,
                detail={"run_id": wf_run.id, "status": status,
                        "duration_ms": wf_run.duration_ms},
            )
            session.commit()
