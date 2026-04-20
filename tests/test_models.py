"""
Step 3: verify all SQLModel tables and the FTS5 virtual table are created correctly.
"""
import os
import tempfile
import pytest
from sqlalchemy import inspect, text
from sqlmodel import create_engine, Session, SQLModel

# Point to a temp DB so tests are isolated
os.environ.setdefault("DATABASE_URL", "sqlite:///./objects_storage/pylo.db")


@pytest.fixture(scope="module")
def engine():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    _engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

    # Import models to register them
    from backend.pybooks.models import PyBook, PyBookRun  # noqa
    from backend.objects.models import ObjectType, ObjectInstance  # noqa

    SQLModel.metadata.create_all(_engine)

    # FTS5 virtual table
    with _engine.connect() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_objects
            USING fts5(
                instance_id UNINDEXED,
                object_type_id UNINDEXED,
                content,
                tokenize='porter ascii'
            )
        """))
        conn.commit()

    yield _engine

    os.unlink(db_path)


def test_pybook_table_exists(engine):
    inspector = inspect(engine)
    assert "pybook" in inspector.get_table_names()


def test_pybook_run_table_exists(engine):
    inspector = inspect(engine)
    assert "pybook_run" in inspector.get_table_names()


def test_object_type_table_exists(engine):
    inspector = inspect(engine)
    assert "object_type" in inspector.get_table_names()


def test_object_instance_table_exists(engine):
    inspector = inspect(engine)
    assert "object_instance" in inspector.get_table_names()


def test_fts_table_exists(engine):
    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='fts_objects'"
        )).fetchone()
    assert result is not None, "fts_objects virtual table not found"


def test_pybook_columns(engine):
    inspector = inspect(engine)
    cols = {c["name"] for c in inspector.get_columns("pybook")}
    expected = {"id", "name", "description", "script", "is_sub_pybook", "dependencies",
                "trigger_type", "trigger_config", "is_active", "docker_image_tag",
                "created_at", "updated_at"}
    assert expected <= cols


def test_pybook_run_columns(engine):
    inspector = inspect(engine)
    cols = {c["name"] for c in inspector.get_columns("pybook_run")}
    expected = {"id", "pybook_id", "status", "trigger_source", "trigger_payload",
                "stdout", "stderr", "exit_code", "started_at", "ended_at", "duration_ms"}
    assert expected <= cols


def test_object_type_columns(engine):
    inspector = inspect(engine)
    cols = {c["name"] for c in inspector.get_columns("object_type")}
    expected = {"id", "name", "description", "source_url", "source_method",
                "source_headers", "source_body", "field_mappings",
                "trigger_pybook_id", "polling_interval_seconds", "created_at"}
    assert expected <= cols


def test_object_instance_columns(engine):
    inspector = inspect(engine)
    cols = {c["name"] for c in inspector.get_columns("object_instance")}
    expected = {"id", "object_type_id", "external_id", "data", "raw_data",
                "created_at", "updated_at"}
    assert expected <= cols


def test_crud_roundtrip(engine):
    """Insert one row into each table and read it back."""
    import uuid
    from datetime import datetime
    from backend.pybooks.models import PyBook, PyBookRun
    from backend.objects.models import ObjectType, ObjectInstance

    with Session(engine) as session:
        pb = PyBook(id=str(uuid.uuid4()), name="test-pb", script="print('hi')",
                    trigger_type="manual", created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        ot = ObjectType(id=str(uuid.uuid4()), name="TestType", created_at=datetime.utcnow())
        session.add(pb)
        session.add(ot)
        session.commit()

        run = PyBookRun(id=str(uuid.uuid4()), pybook_id=pb.id,
                        trigger_source="manual", started_at=datetime.utcnow())
        oi = ObjectInstance(id=str(uuid.uuid4()), object_type_id=ot.id,
                            created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        session.add(run)
        session.add(oi)
        session.commit()

        assert session.get(PyBook, pb.id).name == "test-pb"
        assert session.get(PyBookRun, run.id).pybook_id == pb.id
        assert session.get(ObjectType, ot.id).name == "TestType"
        assert session.get(ObjectInstance, oi.id).object_type_id == ot.id
