import asyncio
import json

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from backend.pybooks.models import PyBook, PyBookRun
from backend.pybooks.versions import record_version
from backend.workflows import executor
from backend.workflows.models import Workflow, WorkflowNodeRun, WorkflowRun


@pytest.fixture
def engine(monkeypatch):
    eng = create_engine("sqlite://")
    SQLModel.metadata.create_all(eng)
    monkeypatch.setattr(executor, "engine", eng)
    return eng


def _setup(engine, nodes, edges, status="queued"):
    with Session(engine) as session:
        session.add(PyBook(id="p1", name="Enrich", script="print(2)\n"))
        session.flush()
        record_version(session, "p1", "print(1)\n", author="alice")
        record_version(session, "p1", "print(2)\n", author="alice")
        session.add(Workflow(id="w1", name="wf", nodes=json.dumps(nodes), edges=json.dumps(edges)))
        session.add(WorkflowRun(id="r1", workflow_id="w1", status=status))
        session.commit()


def test_node_runs_record_script_version_and_running_status(engine, monkeypatch):
    seen = []

    async def fake_run_pybook(pybook_id, run_id, **kwargs):
        with Session(engine) as session:
            seen.append(session.get(PyBookRun, run_id).status)
        return "ok", "", 0

    monkeypatch.setattr("backend.core.runner.run_pybook", fake_run_pybook)
    nodes = [{"id": "n1", "pybookId": "p1", "label": "Enrich"},
             {"id": "n2", "pybookId": "gone", "label": "Missing"}]
    _setup(engine, nodes, [{"id": "e1", "from": "n1", "to": "n2", "condition": "on_success"}])

    asyncio.run(executor.execute_workflow("r1"))

    # While executing, the PyBook run must not look "queued" (restart recovery re-enqueues those).
    assert seen == ["running"]
    with Session(engine) as session:
        pb_run = session.exec(select(PyBookRun)).one()
        assert pb_run.script_version == 2 and pb_run.status == "success"
        node_runs = {nr.node_id: nr for nr in session.exec(select(WorkflowNodeRun)).all()}
        # A node whose PyBook no longer exists is still recorded, with the reason.
        assert node_runs["n2"].status == "error"
        assert "not found" in json.loads(node_runs["n2"].output_vars)["error"]
        assert session.get(WorkflowRun, "r1").status == "error"


def test_cancelled_run_stops_before_next_node(engine, monkeypatch):
    calls = []

    async def fake_run_pybook(pybook_id, run_id, **kwargs):
        calls.append(run_id)
        with Session(engine) as session:  # user cancels while the first node runs
            run = session.get(WorkflowRun, "r1")
            run.status = "cancelled"
            session.add(run)
            session.commit()
        return "ok", "", 0

    monkeypatch.setattr("backend.core.runner.run_pybook", fake_run_pybook)
    nodes = [{"id": "n1", "pybookId": "p1"}, {"id": "n2", "pybookId": "p1"}]
    _setup(engine, nodes, [{"id": "e1", "from": "n1", "to": "n2"}])

    asyncio.run(executor.execute_workflow("r1"))

    assert len(calls) == 1
    with Session(engine) as session:
        assert session.get(WorkflowRun, "r1").status == "cancelled"


def test_cancelled_before_start_and_missing_workflow(engine, monkeypatch):
    monkeypatch.setattr("backend.core.runner.run_pybook", lambda **kw: pytest.fail("must not run"))
    _setup(engine, [{"id": "n1", "pybookId": "p1"}], [], status="cancelled")
    asyncio.run(executor.execute_workflow("r1"))
    with Session(engine) as session:
        assert session.get(WorkflowRun, "r1").status == "cancelled"
        session.add(WorkflowRun(id="orphan", workflow_id="deleted"))
        session.commit()
    asyncio.run(executor.execute_workflow("orphan"))
    with Session(engine) as session:
        assert session.get(WorkflowRun, "orphan").status == "error"  # no longer stuck


@pytest.mark.parametrize("nodes,edges,trigger,config", [
    ("not json", None, None, None),
    ('{"id": "n1"}', None, None, None),
    ('[{"id": "n1"}, {"id": "n1"}]', None, None, None),
    (None, '"x"', None, None),
    (None, None, "email", None),
    (None, None, None, "[]"),
])
def test_workflow_definition_validation_rejects_bad_input(nodes, edges, trigger, config):
    from backend.api.workflows import _validate_definition
    with pytest.raises(HTTPException) as exc:
        _validate_definition(nodes, edges, trigger, config)
    assert exc.value.status_code == 422


def test_cancel_endpoint_and_enriched_run_detail(engine):
    from backend.api import workflows as wf_api
    from backend.core.auth import AuthUser

    admin = AuthUser(username="admin", role="admin")
    _setup(engine, [{"id": "n1", "pybookId": "p1", "label": "Enrich IP"}], [])
    with Session(engine) as session:
        assert asyncio.run(wf_api.cancel_workflow_run("r1", session, admin))["status"] == "cancelled"
        with pytest.raises(HTTPException) as exc:
            asyncio.run(wf_api.cancel_workflow_run("r1", session, admin))
        assert exc.value.status_code == 409

        session.add(PyBookRun(id="pr", pybook_id="p1", status="success", trigger_source="workflow", script_version=2))
        session.add(WorkflowNodeRun(id="nr", workflow_run_id="r1", node_id="n1", pybook_run_id="pr", status="success"))
        session.commit()
        detail = asyncio.run(wf_api.get_workflow_run("w1", "r1", session))
    node = detail["node_runs"][0]
    assert (node["node_label"], node["pybook_name"], node["script_version"]) == ("Enrich IP", "Enrich", 2)
