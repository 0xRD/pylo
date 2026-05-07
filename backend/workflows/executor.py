"""
Workflow DAG executor.
Runs workflow nodes in graph order. PyBook nodes execute containers;
condition and loop nodes provide lightweight control flow without requiring
cycles in the stored graph.
"""
import asyncio
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlmodel import Session

from backend.activity.logger import log_activity
from backend.database import engine
from backend.objects.filter import check_trigger_conditions
from backend.pybooks.models import PyBook, PyBookRun
from backend.workflows.models import Workflow, WorkflowNodeRun, WorkflowRun

logger = logging.getLogger(__name__)


def _path_get(data, path: str):
    if path == "$":
        return data
    if not isinstance(path, str) or not path.startswith("$."):
        return path
    cur = data
    for part in path[2:].split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            idx = int(part)
            cur = cur[idx] if idx < len(cur) else None
        else:
            return None
    return cur


def _resolve_jsonpath(path: str, payload: dict, output_vars: dict):
    """Resolve $.vars.key and $.payload.key references for edge mappings."""
    if isinstance(path, str) and path.startswith("$.vars."):
        return _path_get(output_vars, "$" + path[len("$.vars"):])
    if isinstance(path, str) and path.startswith("$.payload."):
        return _path_get(payload, "$" + path[len("$.payload"):])
    return path


def _build_payload(mappings: list, payload: dict, output_vars: dict) -> dict:
    if not mappings:
        return dict(payload or {})
    result = dict(payload or {})
    for m in mappings:
        key = m.get("key", "")
        if key:
            result[key] = _resolve_jsonpath(m.get("source", ""), payload, output_vars)
    return result


def _node_retry_count(node: dict) -> int:
    try:
        return max(0, min(int(node.get("retry_count") or 0), 5))
    except (TypeError, ValueError):
        return 0


def _edge_matches(edge: dict, node: dict, status: str, output_vars: dict) -> bool:
    cond = edge.get("condition", "always")
    node_type = node.get("type", "pybook")
    if cond == "always":
        return True
    if cond == "on_success":
        return status == "success"
    if cond == "on_failure":
        return status in ("error", "timeout")
    if node_type == "condition":
        result = bool(output_vars.get("result"))
        return (cond == "true" and result) or (cond == "false" and not result)
    if node_type == "loop":
        return cond == "loop_item"
    return False


def _record_control_node_run(workflow_run_id: str, node_id: str, status: str, output_vars: dict, started: datetime) -> None:
    ended = datetime.now(timezone.utc)
    with Session(engine) as session:
        session.add(WorkflowNodeRun(
            id=str(uuid.uuid4()),
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            status=status,
            output_vars=json.dumps(output_vars),
            started_at=started,
            ended_at=ended,
            duration_ms=int((ended - started).total_seconds() * 1000),
        ))
        session.commit()


async def _run_condition_node(workflow_run_id: str, node: dict, payload: dict) -> tuple[str, str, dict]:
    started = datetime.now(timezone.utc)
    config = node.get("config") or {}
    conditions = config.get("conditions") or node.get("conditions") or []
    result = check_trigger_conditions(payload or {}, conditions)
    output_vars = {"result": result}
    _record_control_node_run(workflow_run_id, node["id"], "success", output_vars, started)
    return node["id"], "success", output_vars


async def _run_loop_node(workflow_run_id: str, node: dict, payload: dict) -> tuple[str, str, dict]:
    started = datetime.now(timezone.utc)
    config = node.get("config") or {}
    items_path = config.get("items_path") or node.get("items_path") or "$.items"
    items = _path_get(payload or {}, items_path)
    if items is None:
        items = []
    if not isinstance(items, list):
        items = [items]
    output_vars = {"count": len(items), "items": items}
    _record_control_node_run(workflow_run_id, node["id"], "success", output_vars, started)
    return node["id"], "success", output_vars


async def _run_pybook_node(workflow_run_id: str, node: dict, payload: dict) -> tuple[str, str, dict]:
    """Execute a single PyBook workflow node."""
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
    stdout, stderr, exit_code = "", "", -1
    final_status = "error"
    output_vars: dict = {}

    for attempt in range(_node_retry_count(node) + 1):
        try:
            stdout, stderr, exit_code = await run_pybook(
                pybook_id=pybook_id,
                run_id=pb_run_id,
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
            logger.exception("Error running node %s attempt %s: %s", node_id, attempt + 1, exc)
        if final_status == "success" or attempt == _node_retry_count(node):
            break

    ended = datetime.now(timezone.utc)
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

        nr = session.get(WorkflowNodeRun, node_run_id)
        if nr:
            nr.status = final_status
            nr.output_vars = json.dumps(output_vars)
            nr.ended_at = ended
            nr.duration_ms = int((ended - started).total_seconds() * 1000)
            session.add(nr)
            session.commit()

    return node_id, final_status, output_vars


async def _run_node(workflow_run_id: str, node: dict, payload: dict) -> tuple[str, str, dict]:
    node_type = node.get("type", "pybook")
    if node_type == "condition":
        return await _run_condition_node(workflow_run_id, node, payload)
    if node_type == "loop":
        return await _run_loop_node(workflow_run_id, node, payload)
    return await _run_pybook_node(workflow_run_id, node, payload)


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

    outgoing: dict = defaultdict(list)
    in_degree: dict = defaultdict(int)
    for e in edges:
        outgoing[e["from"]].append(e)
        in_degree[e["to"]] += 1

    node_map = {n["id"]: n for n in nodes}
    start_nodes = [n for n in nodes if in_degree[n["id"]] == 0]

    triggered: set = set()
    completed: dict = {}

    async def visit(node: dict, payload: dict, repeat: bool = False) -> None:
        nid = node["id"]
        if not repeat and node.get("type") != "loop" and nid in triggered:
            return
        if not repeat and node.get("type") != "loop":
            triggered.add(nid)

        nid, status, out_vars = await _run_node(workflow_run_id, node, payload)
        completed[nid] = (status, out_vars)

        next_tasks = []
        for edge in outgoing[nid]:
            if not _edge_matches(edge, node, status, out_vars):
                continue
            to_id = edge["to"]
            if to_id not in node_map:
                continue
            if node.get("type") == "loop":
                for index, item in enumerate(out_vars.get("items") or []):
                    item_payload = {**(payload or {}), "item": item, "loop_index": index}
                    next_tasks.append(visit(node_map[to_id], _build_payload(edge.get("mappings", []), item_payload, out_vars), True))
            elif repeat or to_id not in triggered:
                next_payload = _build_payload(edge.get("mappings", []), payload, out_vars)
                next_tasks.append(visit(node_map[to_id], next_payload, repeat))
        if next_tasks:
            await asyncio.gather(*next_tasks)

    started = datetime.now(timezone.utc)
    try:
        await asyncio.gather(*[visit(n, trigger_payload) for n in start_nodes])
        statuses = [v[0] for v in completed.values()]
        final = "success" if statuses and all(s == "success" for s in statuses) else "error"
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
