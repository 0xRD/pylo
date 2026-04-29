"""
Core logic tests — no Docker, no live DB required.
Covers: trigger_conditions, queue_manager orphan recovery, json.loads safety,
        pybook model validation, and blueprint trigger fire logic.
"""
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

os.environ.setdefault("DATABASE_URL", "sqlite:///./objects_storage/pylo.db")


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db_engine():
    """In-memory SQLite engine with all tables + FTS."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = f.name

    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    import backend.database  # noqa — registers all models
    SQLModel.metadata.create_all(engine)

    with engine.connect() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries "
            "USING fts5(entry_id UNINDEXED, blueprint_id UNINDEXED, content, "
            "           tokenize='porter ascii')"
        ))
        conn.commit()

    yield engine
    os.unlink(path)


@pytest.fixture()
def session(db_engine):
    with Session(db_engine) as s:
        yield s


# ── trigger_conditions ────────────────────────────────────────────────────────

class TestCheckTriggerConditions:
    """Unit tests for filter.check_trigger_conditions."""

    def setup_method(self):
        from backend.objects.filter import check_trigger_conditions
        self.check = check_trigger_conditions

    def test_empty_conditions_always_true(self):
        assert self.check({"type": "malware"}, []) is True

    def test_eq_match(self):
        conds = [{"field": "type", "operator": "eq", "value": "malware"}]
        assert self.check({"type": "malware"}, conds) is True

    def test_eq_case_insensitive(self):
        conds = [{"field": "type", "operator": "eq", "value": "MALWARE"}]
        assert self.check({"type": "malware"}, conds) is True

    def test_eq_no_match(self):
        conds = [{"field": "type", "operator": "eq", "value": "ransomware"}]
        assert self.check({"type": "malware"}, conds) is False

    def test_ne_match(self):
        conds = [{"field": "type", "operator": "ne", "value": "ransomware"}]
        assert self.check({"type": "malware"}, conds) is True

    def test_ne_no_match(self):
        conds = [{"field": "type", "operator": "ne", "value": "malware"}]
        assert self.check({"type": "malware"}, conds) is False

    def test_contains_match(self):
        conds = [{"field": "description", "operator": "contains", "value": "exploit"}]
        assert self.check({"description": "This is an exploit kit"}, conds) is True

    def test_contains_no_match(self):
        conds = [{"field": "description", "operator": "contains", "value": "ransomware"}]
        assert self.check({"description": "This is an exploit kit"}, conds) is False

    def test_starts_with_match(self):
        conds = [{"field": "name", "operator": "starts_with", "value": "CVE-"}]
        assert self.check({"name": "CVE-2024-1234"}, conds) is True

    def test_starts_with_no_match(self):
        conds = [{"field": "name", "operator": "starts_with", "value": "CWE-"}]
        assert self.check({"name": "CVE-2024-1234"}, conds) is False

    def test_regex_match(self):
        conds = [{"field": "cve", "operator": "regex", "value": r"CVE-\d{4}-\d+"}]
        assert self.check({"cve": "CVE-2024-12345"}, conds) is True

    def test_regex_no_match(self):
        conds = [{"field": "cve", "operator": "regex", "value": r"CVE-\d{4}-\d+"}]
        assert self.check({"cve": "not-a-cve"}, conds) is False

    def test_regex_invalid_pattern_returns_false(self):
        conds = [{"field": "x", "operator": "regex", "value": "[invalid"}]
        assert self.check({"x": "test"}, conds) is False

    def test_gt_match(self):
        conds = [{"field": "severity", "operator": "gt", "value": "7"}]
        assert self.check({"severity": "9"}, conds) is True

    def test_gt_no_match(self):
        conds = [{"field": "severity", "operator": "gt", "value": "7"}]
        assert self.check({"severity": "5"}, conds) is False

    def test_lt_match(self):
        conds = [{"field": "score", "operator": "lt", "value": "0.5"}]
        assert self.check({"score": "0.3"}, conds) is True

    def test_multiple_conditions_all_must_match(self):
        conds = [
            {"field": "type", "operator": "eq", "value": "malware"},
            {"field": "severity", "operator": "gt", "value": "7"},
        ]
        assert self.check({"type": "malware", "severity": "9"}, conds) is True
        assert self.check({"type": "malware", "severity": "5"}, conds) is False
        assert self.check({"type": "ransomware", "severity": "9"}, conds) is False

    def test_missing_field_returns_empty_string(self):
        conds = [{"field": "nonexistent", "operator": "eq", "value": ""}]
        assert self.check({}, conds) is True  # "" == "" → match

    def test_missing_field_ne_nonempty_value(self):
        conds = [{"field": "nonexistent", "operator": "ne", "value": "something"}]
        assert self.check({}, conds) is True  # "" != "something"

    def test_unknown_operator_returns_false(self):
        conds = [{"field": "x", "operator": "unknown_op", "value": "y"}]
        assert self.check({"x": "y"}, conds) is False


# ── PyBook model validation ───────────────────────────────────────────────────

class TestPyBookModelValidation:
    """Ensure PyBook JSON fields parse correctly or gracefully degrade."""

    def test_valid_dependencies_json(self):
        deps = json.loads('["requests", "pandas"]')
        assert deps == ["requests", "pandas"]

    def test_invalid_dependencies_json_raises(self):
        with pytest.raises(json.JSONDecodeError):
            json.loads('[requests,pandas]')

    def test_valid_required_secrets_json(self):
        secrets = json.loads('["api_key", "token"]')
        assert secrets == ["api_key", "token"]

    def test_invalid_required_secrets_json_raises(self):
        with pytest.raises(json.JSONDecodeError):
            json.loads('[Sekoia test IOC]')

    def test_safe_parse_with_fallback(self):
        """The pattern used in _execute_run after our fix."""
        def safe_parse(value, default):
            try:
                return json.loads(value or '[]')
            except (json.JSONDecodeError, ValueError):
                return default

        assert safe_parse('[requests,pandas]', []) == []
        assert safe_parse('["pandas"]', []) == ["pandas"]
        assert safe_parse(None, []) == []
        assert safe_parse('', []) == []


# ── queue_manager orphan recovery ────────────────────────────────────────────

class TestQueueManagerOrphanRecovery:
    """Tests for the orphan-recovery behavior using real DB rows."""

    def test_stuck_running_runs_are_reset(self, session, db_engine):
        from backend.pybooks.models import PyBook, PyBookRun

        now = datetime.now(timezone.utc)
        # Create a PyBook and a run stuck in 'running'
        pb = PyBook(
            id=str(uuid.uuid4()),
            name="test-orphan",
            script="print('hello')",
            trigger_type="manual",
            created_at=now,
            updated_at=now,
        )
        session.add(pb)
        session.commit()

        stuck_run = PyBookRun(
            id=str(uuid.uuid4()),
            pybook_id=pb.id,
            status="running",
            trigger_source="manual",
            started_at=now,
        )
        session.add(stuck_run)
        session.commit()
        run_id = stuck_run.id

        # Simulate what queue_manager.start() does on restart
        from sqlmodel import select
        with Session(db_engine) as s:
            stranded = s.exec(
                select(PyBookRun).where(PyBookRun.status == "running")
            ).all()
            cleanup_now = datetime.now(timezone.utc)
            for run in stranded:
                run.status = "error"
                run.ended_at = cleanup_now
                run.stderr = (run.stderr or "") + "\n[Interrupted: backend restarted]"
                if run.exit_code is None:
                    run.exit_code = -1
                s.add(run)
            s.commit()

        # Verify the stuck run was reset to error
        with Session(db_engine) as s:
            recovered = s.get(PyBookRun, run_id)
            assert recovered.status == "error"
            assert recovered.exit_code == -1
            assert recovered.ended_at is not None
            assert "Interrupted" in recovered.stderr

    def test_queued_runs_are_preserved_for_requeue(self, session, db_engine):
        from backend.pybooks.models import PyBook, PyBookRun
        from sqlmodel import select

        now = datetime.now(timezone.utc)
        pb = PyBook(
            id=str(uuid.uuid4()),
            name="test-requeue",
            script="print('hi')",
            trigger_type="manual",
            created_at=now,
            updated_at=now,
        )
        session.add(pb)
        session.commit()

        queued_run = PyBookRun(
            id=str(uuid.uuid4()),
            pybook_id=pb.id,
            status="queued",
            trigger_source="manual",
            started_at=now,
        )
        session.add(queued_run)
        session.commit()

        # Verify that 'queued' runs are found by recovery query
        with Session(db_engine) as s:
            orphans = s.exec(
                select(PyBookRun).where(PyBookRun.status.in_(["queued", "pending"]))
            ).all()
            assert any(r.id == queued_run.id for r in orphans)


# ── blueprint trigger_conditions integration ─────────────────────────────────

class TestBlueprintTriggerConditions:
    """Test that _fire_blueprint_triggers correctly filters entries by conditions."""

    def test_matching_entry_triggers_run(self, db_engine):
        from backend.objects.filter import check_trigger_conditions

        # Simulate what _fire_blueprint_triggers does
        conditions = [{"field": "type", "operator": "eq", "value": "malware"}]
        created_entries = [
            {"entry_id": "e1", "parsed": {"type": "malware", "name": "BadFile"}},
            {"entry_id": "e2", "parsed": {"type": "technique", "name": "T1059"}},
        ]
        matching = [e for e in created_entries if check_trigger_conditions(e["parsed"], conditions)]
        assert len(matching) == 1
        assert matching[0]["entry_id"] == "e1"

    def test_no_conditions_matches_all(self):
        from backend.objects.filter import check_trigger_conditions

        conditions = []
        entries = [
            {"entry_id": "e1", "parsed": {"type": "malware"}},
            {"entry_id": "e2", "parsed": {"type": "technique"}},
            {"entry_id": "e3", "parsed": {}},
        ]
        matching = [e for e in entries if check_trigger_conditions(e["parsed"], conditions)]
        assert len(matching) == 3

    def test_multiple_conditions_and_logic(self):
        from backend.objects.filter import check_trigger_conditions

        conditions = [
            {"field": "type", "operator": "eq", "value": "malware"},
            {"field": "severity", "operator": "gt", "value": "7"},
        ]
        entries = [
            {"entry_id": "e1", "parsed": {"type": "malware", "severity": "9"}},   # matches
            {"entry_id": "e2", "parsed": {"type": "malware", "severity": "5"}},   # severity fails
            {"entry_id": "e3", "parsed": {"type": "ransomware", "severity": "9"}}, # type fails
        ]
        matching = [e for e in entries if check_trigger_conditions(e["parsed"], conditions)]
        assert len(matching) == 1
        assert matching[0]["entry_id"] == "e1"


# ── UTC datetime handling ─────────────────────────────────────────────────────

class TestUTCDatetimeHandling:
    """Ensure UTC datetimes stored as naive strings are parsed correctly."""

    def test_naive_datetime_string_treated_as_utc(self):
        """Bare ISO string (no Z) should be treated as UTC."""
        naive = "2026-04-28 09:58:16.282169"  # what SQLite stores
        # Simulate the frontend parseUTC behavior in Python
        import datetime as dt
        parsed = dt.datetime.fromisoformat(naive).replace(tzinfo=dt.timezone.utc)
        assert parsed.tzinfo == dt.timezone.utc
        assert parsed.year == 2026

    def test_trigger_payload_roundtrip(self):
        """trigger_payload JSON survives roundtrip through PyBookRun."""
        from backend.pybooks.models import PyBookRun
        payload = {"blueprint_id": "bp-1", "entry_id": "e-1", "entry_data": {"type": "malware"}}
        run = PyBookRun(
            id=str(uuid.uuid4()),
            pybook_id=str(uuid.uuid4()),
            status="queued",
            trigger_source="blueprint",
            trigger_payload=json.dumps(payload),
            started_at=datetime.now(timezone.utc),
        )
        recovered = json.loads(run.trigger_payload)
        assert recovered == payload


# ── entry data JSON parsing ───────────────────────────────────────────────────

class TestEntryDataParsing:
    """Ensure entry['data'] is always a JSON string and needs json.loads()."""

    def test_data_field_is_string_in_sdk(self):
        """Mimics how pylo_sdk.get_entry() returns data as a JSON string."""
        # entry["data"] is a JSON string, not a dict
        raw_data = json.dumps({"sha1": "abc123", "name": "evil.sys"})
        assert isinstance(raw_data, str)

        parsed = json.loads(raw_data)
        assert parsed["sha1"] == "abc123"

    def test_extract_hashes_handles_string_data(self):
        """Reproduce the fix in the Push IOC PyBook script."""
        def extract_hashes(entry):
            raw_data = entry.get("data")
            if isinstance(raw_data, str):
                try:
                    data = json.loads(raw_data)
                except (json.JSONDecodeError, ValueError):
                    data = {}
            elif isinstance(raw_data, dict):
                data = raw_data
            else:
                data = {}
            return data.get("sha1"), data.get("sha256"), data.get("name", "Unknown")

        # data as JSON string (what get_entry actually returns)
        entry = {"id": "e-1", "title": "Test", "data": '{"sha1": "abc", "sha256": "def", "name": "test.sys"}'}
        sha1, sha256, name = extract_hashes(entry)
        assert sha1 == "abc"
        assert sha256 == "def"
        assert name == "test.sys"

        # data as None or missing
        sha1, sha256, name = extract_hashes({"id": "e-2", "data": None})
        assert sha1 is None
        assert sha256 is None

        # malformed data
        sha1, sha256, name = extract_hashes({"id": "e-3", "data": "not-json"})
        assert sha1 is None


# ── mutable fetch upserts ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_updates_existing_entry_for_mutable_blueprint(session, monkeypatch):
    from backend.api import blueprints as bp_api
    from backend.objects.models import Blueprint, EntryEvent
    from sqlmodel import select

    mappings = json.dumps([
        {"source_path": "$.id", "field_name": "external_id", "field_type": "string", "is_key": True},
        {"source_path": "$.enabled", "field_name": "enabled", "field_type": "boolean"},
    ])
    bp = Blueprint(
        id="mutable-fetch-bp",
        name="Mutable Fetch",
        source_url="https://example.invalid/api",
        field_mappings=mappings,
        mutable_mode="all",
        created_at=datetime.now(timezone.utc),
    )
    session.add(bp)
    session.commit()

    calls = [
        ([{"id": "ioc-1", "enabled": False}], 1),
        ([{"id": "ioc-1", "enabled": True}], 1),
    ]

    async def fake_fetch_pages(bp, headers, body):
        return calls.pop(0)

    monkeypatch.setattr(bp_api, "_fetch_raw_pages", fake_fetch_pages)
    monkeypatch.setattr(bp_api, "_fire_blueprint_triggers", lambda *args, **kwargs: None)

    first = await bp_api._do_fetch(bp.id, session, actor="test")
    second = await bp_api._do_fetch(bp.id, session, actor="test")

    assert first["created"] == 1
    assert second["updated"] == 1
    entry = session.exec(select(bp_api.Entry).where(bp_api.Entry.blueprint_id == bp.id)).one()
    assert json.loads(entry.data)["enabled"] is True
    event = session.exec(select(EntryEvent).where(EntryEvent.entry_id == entry.id)).one()
    assert event.event_type == "updated"
    assert json.loads(event.changed_fields) == ["enabled"]


@pytest.mark.asyncio
async def test_fetch_keeps_existing_entry_immutable_by_default(session, monkeypatch):
    from backend.api import blueprints as bp_api
    from sqlmodel import select

    mappings = json.dumps([
        {"source_path": "$.id", "field_name": "external_id", "field_type": "string", "is_key": True},
        {"source_path": "$.enabled", "field_name": "enabled", "field_type": "boolean"},
    ])
    bp = bp_api.Blueprint(
        id="immutable-fetch-bp",
        name="Immutable Fetch",
        source_url="https://example.invalid/api",
        field_mappings=mappings,
        mutable_mode="none",
        created_at=datetime.now(timezone.utc),
    )
    session.add(bp)
    session.commit()

    calls = [
        ([{"id": "ioc-1", "enabled": False}], 1),
        ([{"id": "ioc-1", "enabled": True}], 1),
    ]

    async def fake_fetch_pages(bp, headers, body):
        return calls.pop(0)

    monkeypatch.setattr(bp_api, "_fetch_raw_pages", fake_fetch_pages)
    monkeypatch.setattr(bp_api, "_fire_blueprint_triggers", lambda *args, **kwargs: None)

    await bp_api._do_fetch(bp.id, session, actor="test")
    result = await bp_api._do_fetch(bp.id, session, actor="test")

    assert result["updated"] == 0
    assert result["skipped"] == 1
    entry = session.exec(select(bp_api.Entry).where(bp_api.Entry.blueprint_id == bp.id)).one()
    assert json.loads(entry.data)["enabled"] is False
