import io
import json
import os
import tempfile
import zipfile

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


def _backup_zip(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps({
            "pylo_export": "full_backup",
            "version": 1,
            "include_secrets": False,
        }))
        zf.writestr("settings.json", "{}")
        for name, data in files.items():
            zf.writestr(name, json.dumps(data))
    return buffer.getvalue()


def test_full_backup_export_returns_zip_manifest(client):
    response = client.get("/api/export/full")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["pylo_export"] == "full_backup"
        assert manifest["include_secrets"] is False
        assert "settings.json" in zf.namelist()
        assert "secrets/README.txt" in zf.namelist()


def test_full_backup_import_requires_restore_confirmation(client):
    response = client.post("/api/import/full?confirm=NO", content=b"not-a-zip")

    assert response.status_code == 400
    assert "RESTORE" in response.json()["detail"]


def test_full_backup_import_creates_pybook(client):
    payload = _backup_zip({
        "pybooks/demo.json": {
            "pylo_export": "pybook",
            "version": 1,
            "id": "pb-from-backup",
            "name": "Backup Demo",
            "description": "restored",
            "script": "print('restored')",
            "is_sub_pybook": False,
            "dependencies": "[]",
            "trigger_type": "manual",
            "trigger_config": "{}",
            "required_secrets": "[]",
            "tags": "[]",
        }
    })

    response = client.post("/api/import/full?confirm=RESTORE", content=payload, headers={"Content-Type": "application/zip"})

    assert response.status_code == 200
    assert response.json()["imported"]["pybooks"] == 1

    pybooks = client.get("/api/pybooks").json()
    restored = next(pb for pb in pybooks if pb["name"] == "Backup Demo")
    assert restored["script"] == "print('restored')"
