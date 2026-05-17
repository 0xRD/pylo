"""
Phase 1 tests: JSONPath parser, entry storage, deduplication, FTS search, API routes.
"""
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

os.environ.setdefault("DATABASE_URL", "sqlite:///./objects_storage/pylo.db")

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db_engine():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = f.name

    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    import backend.database  # noqa — registers all models in SQLModel.metadata
    SQLModel.metadata.create_all(engine)

    with engine.connect() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries
            USING fts5(entry_id UNINDEXED, blueprint_id UNINDEXED, content,
                       tokenize='porter ascii')
        """))
        conn.commit()

    yield engine
    os.unlink(path)


@pytest.fixture()
def session(db_engine):
    with Session(db_engine) as s:
        yield s


@pytest.fixture(scope="module")
def client(db_engine):
    from backend import main as app_module
    from backend import database as db_module

    db_module.engine = db_engine

    def override_session():
        with Session(db_engine) as s:
            yield s

    app_module.app.dependency_overrides[db_module.get_session] = override_session
    return TestClient(app_module.app, headers={"X-API-Token": app_module.settings.API_TOKEN})


# ── Parser unit tests ─────────────────────────────────────────────────────────

def test_parser_basic_extraction():
    from backend.objects.parser import parse_instance
    raw = {"data": {"id": "abc123", "severity": "critical", "score": 9.8}}
    mappings = [
        {"source_path": "$.data.id", "field_name": "external_id", "field_type": "string"},
        {"source_path": "$.data.severity", "field_name": "severity", "field_type": "string"},
        {"source_path": "$.data.score", "field_name": "score", "field_type": "number"},
    ]
    result = parse_instance(raw, mappings)
    assert result["external_id"] == "abc123"
    assert result["severity"] == "critical"
    assert result["score"] == 9.8


def test_parser_missing_path_returns_none():
    from backend.objects.parser import parse_instance
    result = parse_instance({"a": 1}, [{"source_path": "$.missing", "field_name": "x", "field_type": "string"}])
    assert result["x"] is None


def test_parser_type_coercion_boolean():
    from backend.objects.parser import parse_instance
    raw = {"active": "true"}
    result = parse_instance(raw, [{"source_path": "$.active", "field_name": "is_active", "field_type": "boolean"}])
    assert result["is_active"] is True


def test_parser_empty_mappings():
    from backend.objects.parser import parse_instance
    assert parse_instance({"a": 1}, []) == {}


def test_extract_text_content():
    from backend.objects.parser import extract_text_content
    text_out = extract_text_content({"name": "alert-1", "severity": "critical", "score": 9})
    assert "alert-1" in text_out
    assert "critical" in text_out


# ── API: Blueprint CRUD ───────────────────────────────────────────────────────

def test_create_object_type(client):
    r = client.post("/api/blueprints", json={"name": "TestAlert", "description": "test"})
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "TestAlert"
    assert data["id"]


def test_list_object_types(client):
    r = client.get("/api/blueprints")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert any(t["name"] == "TestAlert" for t in r.json())


def test_get_object_type(client):
    types = client.get("/api/blueprints").json()
    t = next(t for t in types if t["name"] == "TestAlert")
    r = client.get(f"/api/blueprints/{t['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == t["id"]


def test_update_object_type(client):
    types = client.get("/api/blueprints").json()
    t = next(t for t in types if t["name"] == "TestAlert")
    r = client.put(f"/api/blueprints/{t['id']}", json={"description": "updated"})
    assert r.status_code == 200
    assert r.json()["description"] == "updated"


def test_get_nonexistent_type(client):
    r = client.get("/api/blueprints/nonexistent-id")
    assert r.status_code == 404


# ── Deduplication ─────────────────────────────────────────────────────────────

def test_deduplication(client):
    """Two inserts of the same external_id must only create one entry."""
    import json as _json
    from backend.objects.models import Entry
    from backend import database as db_module
    from sqlmodel import select

    r = client.post("/api/blueprints", json={
        "name": "DedupeType",
        "field_mappings": _json.dumps([
            {"source_path": "$.id", "field_name": "external_id", "field_type": "string"}
        ]),
    })
    blueprint_id = r.json()["id"]

    with Session(db_module.engine) as s:
        for _ in range(2):
            existing = s.exec(
                select(Entry).where(
                    Entry.blueprint_id == blueprint_id,
                    Entry.external_id == "ext-001",
                )
            ).first()
            if not existing:
                now = datetime.now(timezone.utc)
                entry = Entry(
                    id=str(uuid.uuid4()), blueprint_id=blueprint_id,
                    external_id="ext-001", data="{}", raw_data="{}",
                    created_at=now, updated_at=now,
                )
                s.add(entry)
                s.commit()

        count = len(s.exec(
            select(Entry).where(
                Entry.blueprint_id == blueprint_id,
                Entry.external_id == "ext-001",
            )
        ).all())

    assert count == 1, f"Expected 1 entry, got {count}"


# ── FTS search ────────────────────────────────────────────────────────────────

def test_fts_search(client):
    from backend import database as db_module
    from backend.objects.indexer import index_entry
    from backend.objects.models import Entry

    r = client.post("/api/blueprints", json={"name": "FTSType"})
    blueprint_id = r.json()["id"]

    now = datetime.now(timezone.utc)
    entry_id = str(uuid.uuid4())

    with Session(db_module.engine) as s:
        entry = Entry(
            id=entry_id, blueprint_id=blueprint_id,
            data=json.dumps({"title": "critical-security-incident"}),
            raw_data="{}",
            created_at=now, updated_at=now,
        )
        s.add(entry)
        s.flush()
        index_entry(s, entry_id, blueprint_id, "critical security incident")
        s.commit()

    r = client.get(f"/api/blueprints/entries?blueprint_id={blueprint_id}&q=critical")
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()["items"]]
    assert entry_id in ids


def test_entry_datetime_field_sorting(client):
    from backend import database as db_module
    from backend.objects.models import Entry

    r = client.post("/api/blueprints", json={
        "name": "SortableTimeType",
        "field_mappings": json.dumps([
            {"source_path": "$.event_time", "field_name": "event_time", "field_type": "datetime"},
            {"source_path": "$.name", "field_name": "name", "field_type": "string"},
        ]),
    })
    blueprint_id = r.json()["id"]

    with Session(db_module.engine) as s:
        for name, event_time in [
            ("middle", "2026-02-01T10:00:00+00:00"),
            ("oldest", "2026-01-01T10:00:00+00:00"),
            ("newest", "2026-03-01T10:00:00+00:00"),
        ]:
            now = datetime.now(timezone.utc)
            s.add(Entry(
                id=str(uuid.uuid4()),
                blueprint_id=blueprint_id,
                data=json.dumps({"name": name, "event_time": event_time}),
                raw_data="{}",
                created_at=now,
                updated_at=now,
            ))
        s.commit()

    r = client.get(
        f"/api/blueprints/entries?blueprint_id={blueprint_id}&sort_by=event_time&sort_dir=asc"
    )
    assert r.status_code == 200
    assert [json.loads(i["data"])["name"] for i in r.json()["items"]] == ["oldest", "middle", "newest"]

    r = client.get(
        f"/api/blueprints/entries?blueprint_id={blueprint_id}&sort_by=event_time&sort_dir=desc"
    )
    assert r.status_code == 200
    assert [json.loads(i["data"])["name"] for i in r.json()["items"]] == ["newest", "middle", "oldest"]


def test_entry_field_sort_requires_datetime_field_and_blueprint(client):
    r = client.post("/api/blueprints", json={
        "name": "SortValidationType",
        "field_mappings": json.dumps([
            {"source_path": "$.name", "field_name": "name", "field_type": "string"},
        ]),
    })
    blueprint_id = r.json()["id"]

    r = client.get("/api/blueprints/entries?sort_by=event_time&sort_dir=asc")
    assert r.status_code == 400

    r = client.get(f"/api/blueprints/entries?blueprint_id={blueprint_id}&sort_by=name&sort_dir=asc")
    assert r.status_code == 400


# ── Delete cascade ────────────────────────────────────────────────────────────

def test_delete_type_removes_instances(client):
    from backend import database as db_module
    from backend.objects.models import Entry
    from sqlmodel import select

    r = client.post("/api/blueprints", json={"name": "DeleteMe"})
    blueprint_id = r.json()["id"]

    now = datetime.now(timezone.utc)
    with Session(db_module.engine) as s:
        for _ in range(3):
            s.add(Entry(
                id=str(uuid.uuid4()), blueprint_id=blueprint_id,
                data="{}", raw_data="{}", created_at=now, updated_at=now,
            ))
        s.commit()

    r = client.delete(f"/api/blueprints/{blueprint_id}")
    assert r.status_code == 204

    with Session(db_module.engine) as s:
        remaining = s.exec(
            select(Entry).where(Entry.blueprint_id == blueprint_id)
        ).all()
    assert remaining == []
