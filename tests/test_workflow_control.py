import json

from backend.workflows.executor import _build_payload, _edge_matches, _path_get
from backend.workflows.validator import validate_dag
from sqlmodel import Session, SQLModel, create_engine


def test_workflow_control_nodes_validate_without_pybooks():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    nodes = [
        {"id": "if1", "type": "condition", "label": "If", "config": {"conditions": [{"field": "severity", "operator": "eq", "value": "high"}]}},
        {"id": "loop1", "type": "loop", "label": "Loop", "config": {"items_path": "$.items"}},
    ]
    edges = [{"id": "e1", "from": "if1", "to": "loop1", "condition": "true"}]
    with Session(engine) as session:
        assert validate_dag(json.dumps(nodes), json.dumps(edges), session) == []


def test_workflow_payload_mapping_reads_payload_and_vars():
    payload = {"entry": {"id": "e1"}, "items": [1, 2]}
    vars_ = {"score": 99}
    mapped = _build_payload([
        {"key": "entry_id", "source": "$.payload.entry.id"},
        {"key": "score", "source": "$.vars.score"},
    ], payload, vars_)

    assert mapped["entry_id"] == "e1"
    assert mapped["score"] == 99
    assert mapped["items"] == [1, 2]


def test_workflow_edge_matches_condition_and_loop_labels():
    assert _edge_matches({"condition": "true"}, {"type": "condition"}, "success", {"result": True}) is True
    assert _edge_matches({"condition": "false"}, {"type": "condition"}, "success", {"result": True}) is False
    assert _edge_matches({"condition": "loop_item"}, {"type": "loop"}, "success", {"items": [1]}) is True
    assert _path_get({"items": [{"id": "a"}]}, "$.items.0.id") == "a"
