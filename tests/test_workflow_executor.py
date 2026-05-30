"""Workflow executor join-barrier semantics (no Docker — _run_node is stubbed)."""
import asyncio
import json
import uuid

from sqlmodel import Session, SQLModel, create_engine


def _setup(tmp_path, monkeypatch, nodes, edges):
    import backend.workflows.executor as ex
    from backend.workflows.models import Workflow, WorkflowRun
    import backend.activity.models  # noqa: F401 — register table for log_activity

    engine = create_engine(f"sqlite:///{tmp_path / 'wf.db'}")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(ex, "engine", engine)

    wf_id, run_id = str(uuid.uuid4()), str(uuid.uuid4())
    with Session(engine) as s:
        s.add(Workflow(id=wf_id, name="t", nodes=json.dumps(nodes), edges=json.dumps(edges)))
        s.add(WorkflowRun(id=run_id, workflow_id=wf_id, status="queued"))
        s.commit()
    return ex, engine, run_id


def test_join_barrier_runs_once_and_merges_payloads(tmp_path, monkeypatch):
    nodes = [{"id": n, "pybookId": "pb", "label": n} for n in ["A", "B", "C", "D"]]
    edges = [
        {"id": "e1", "from": "A", "to": "B", "condition": "always", "mappings": []},
        {"id": "e2", "from": "A", "to": "C", "condition": "always", "mappings": []},
        {"id": "e3", "from": "B", "to": "D", "condition": "always", "mappings": [{"key": "b", "source": "$.vars.bv"}]},
        {"id": "e4", "from": "C", "to": "D", "condition": "always", "mappings": [{"key": "c", "source": "$.vars.cv"}]},
    ]
    ex, engine, run_id = _setup(tmp_path, monkeypatch, nodes, edges)

    calls = []
    payloads = {}
    outmap = {"A": {}, "B": {"bv": "B-val"}, "C": {"cv": "C-val"}, "D": {}}

    async def fake_run_node(wrid, node, payload):
        nid = node["id"]
        calls.append(nid)
        payloads[nid] = payload
        return nid, "success", outmap[nid]

    monkeypatch.setattr(ex, "_run_node", fake_run_node)
    asyncio.run(ex.execute_workflow(run_id))

    # D is a join of B and C — it must run exactly once...
    assert calls.count("D") == 1
    assert sorted(calls) == ["A", "B", "C", "D"]
    # ...and receive the merged payload from BOTH parents.
    assert payloads["D"].get("b") == "B-val"
    assert payloads["D"].get("c") == "C-val"

    from backend.workflows.models import WorkflowRun
    with Session(engine) as s:
        assert s.get(WorkflowRun, run_id).status == "success"


def test_unmatched_branch_is_skipped(tmp_path, monkeypatch):
    nodes = [{"id": n, "pybookId": "pb", "label": n} for n in ["A", "B", "C"]]
    edges = [
        {"id": "e1", "from": "A", "to": "B", "condition": "on_success", "mappings": []},
        {"id": "e2", "from": "A", "to": "C", "condition": "on_failure", "mappings": []},
    ]
    ex, engine, run_id = _setup(tmp_path, monkeypatch, nodes, edges)

    calls = []

    async def fake_run_node(wrid, node, payload):
        calls.append(node["id"])
        # A fails; B (on_success) must be skipped, C (on_failure) must run
        return node["id"], ("error" if node["id"] == "A" else "success"), {}

    monkeypatch.setattr(ex, "_run_node", fake_run_node)
    asyncio.run(ex.execute_workflow(run_id))

    assert "A" in calls and "C" in calls
    assert "B" not in calls

    from backend.workflows.models import WorkflowRun
    with Session(engine) as s:
        assert s.get(WorkflowRun, run_id).status == "error"
