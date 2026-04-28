import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

os.environ.setdefault("DATABASE_URL", "sqlite:///./objects_storage/pylo.db")


@pytest.fixture(scope="module")
def db_engine():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = f.name

    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    import backend.database  # noqa: F401
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


@pytest.fixture(scope="module")
def client(db_engine):
    from backend import database as db_module
    from backend import main as app_module

    db_module.engine = db_engine

    def override_session():
        with Session(db_engine) as s:
            yield s

    app_module.app.dependency_overrides[db_module.get_session] = override_session
    return TestClient(app_module.app, headers={"X-API-Token": "change_me_in_production"})


def test_dashboard_summary_shape(client):
    response = client.get("/api/dashboard/summary?days=7")
    assert response.status_code == 200
    data = response.json()

    assert data["days"] == 7
    assert set(["blueprints", "entries", "pybooks", "workflows", "runs"]).issubset(data["counts"])
    assert len(data["series"]["entries"]) == 7
    assert len(data["series"]["pybook_runs"]) == 7
    assert len(data["series"]["workflow_runs"]) == 7
    assert len(data["series"]["success_rate"]) == 7
    assert "queued" in data["queue"]
    assert "recent_failures" in data
    assert "top_blueprints" in data


def test_dashboard_summary_rejects_unsupported_window(client):
    response = client.get("/api/dashboard/summary?days=13")
    assert response.status_code == 400
