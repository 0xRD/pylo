import asyncio
import io
import json
import os
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException, Response
from sqlmodel import Session, SQLModel, create_engine, select
from starlette.requests import Request

from backend.api import auth as auth_api
from backend.api import export_import
from backend.core.auth import hash_password
from backend.core.rate_limit import FailureLimiter, ip_limiter, login_limiter
from backend.core.scheduler import cleanup_run_history
from backend.pybooks.models import PyBookRun
from backend.users.models import User
from backend.workflows.models import WorkflowNodeRun, WorkflowRun


@pytest.fixture(autouse=True)
def _reset_limiters():
    login_limiter.clear()
    ip_limiter.clear()
    yield
    login_limiter.clear()
    ip_limiter.clear()


def _engine():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    return engine


def _request(ip: str = "203.0.113.5") -> Request:
    return Request({"type": "http", "method": "POST", "path": "/api/auth/login",
                    "headers": [(b"x-real-ip", ip.encode())], "client": (ip, 1234)})


def test_failure_limiter_blocks_after_threshold_and_resets():
    limiter = FailureLimiter(max_failures=3, window_seconds=60)
    for _ in range(3):
        limiter.check("k")
        limiter.fail("k")
    with pytest.raises(HTTPException) as exc:
        limiter.check("k")
    assert exc.value.status_code == 429
    assert int(exc.value.headers["Retry-After"]) > 0
    limiter.reset("k")
    limiter.check("k")


def test_login_is_throttled_after_repeated_failures():
    engine = _engine()
    with Session(engine) as session:
        session.add(User(username="alice", hashed_password=hash_password("correct-horse"), role="admin"))
        session.commit()

        def attempt(password):
            body = auth_api.LoginBody(username="alice", password=password)
            return asyncio.run(auth_api.login(body, _request(), Response(), session))

        for _ in range(login_limiter.max_failures):
            with pytest.raises(HTTPException) as exc:
                attempt("wrong")
            assert exc.value.status_code == 401

        # Even the correct password is refused while the account is throttled.
        with pytest.raises(HTTPException) as exc:
            attempt("correct-horse")
        assert exc.value.status_code == 429

        login_limiter.clear()
        assert attempt("correct-horse")["username"] == "alice"


def test_run_history_cleanup_keeps_recent_and_active_runs():
    engine = _engine()
    old = datetime.now(timezone.utc) - timedelta(days=40)
    recent = datetime.now(timezone.utc) - timedelta(days=1)
    with Session(engine) as session:
        session.add_all([
            PyBookRun(id="old-done", pybook_id="p", status="success", trigger_source="manual", started_at=old),
            PyBookRun(id="old-running", pybook_id="p", status="running", trigger_source="manual", started_at=old),
            PyBookRun(id="recent", pybook_id="p", status="error", trigger_source="manual", started_at=recent),
            WorkflowRun(id="wf-old", workflow_id="w", status="success", started_at=old),
            WorkflowRun(id="wf-new", workflow_id="w", status="success", started_at=recent),
            WorkflowNodeRun(id="n-old", workflow_run_id="wf-old", node_id="n1"),
            WorkflowNodeRun(id="n-new", workflow_run_id="wf-new", node_id="n1"),
        ])
        session.commit()

        assert cleanup_run_history(session, 0) == {"pybook_runs": 0, "workflow_runs": 0}
        deleted = cleanup_run_history(session, 30)
        assert deleted == {"pybook_runs": 1, "workflow_runs": 1}

        assert {r.id for r in session.exec(select(PyBookRun)).all()} == {"old-running", "recent"}
        assert {r.id for r in session.exec(select(WorkflowRun)).all()} == {"wf-new"}
        assert {r.id for r in session.exec(select(WorkflowNodeRun)).all()} == {"n-new"}


def test_backup_kdf_honours_recorded_iteration_count():
    salt = os.urandom(16)
    legacy_key = export_import._derive_fernet_key("pass", salt, export_import.LEGACY_BACKUP_KDF_ITERATIONS)
    assert legacy_key != export_import._derive_fernet_key("pass", salt)

    # A backup written before the KDF upgrade must still decrypt with its recorded count.
    token = Fernet(legacy_key).encrypt(b"s3cret")
    rederived = export_import._derive_fernet_key("pass", salt, 100_000)
    assert Fernet(rederived).decrypt(token) == b"s3cret"


def test_new_backup_records_current_kdf_iterations(monkeypatch):
    engine = _engine()
    monkeypatch.setattr("backend.core.crypto.decrypt", lambda value: "plain")
    from backend.secrets.models import Secret
    with Session(engine) as session:
        session.add(Secret(id="s1", name="token", encrypted_value="ignored"))
        session.commit()
        data, _ = export_import._build_full_zip(session, include_secrets=True, passphrase="pass")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        payload = json.loads(zf.read("secrets/encrypted.json"))
    assert payload["iterations"] == export_import.BACKUP_KDF_ITERATIONS


def test_manual_workflow_run_stores_payload_and_rejects_inactive(monkeypatch):
    from backend.api import workflows as wf_api
    from backend.core.auth import AuthUser
    from backend.workflows.models import Workflow

    enqueued = []
    monkeypatch.setattr(wf_api.queue_manager, "enqueue_workflow", enqueued.append)
    engine = _engine()
    user = AuthUser(username="alice", role="admin")
    with Session(engine) as session:
        nodes = json.dumps([{"id": "if1", "type": "condition", "label": "If", "config": {"conditions": [{"field": "ip", "operator": "eq", "value": "x"}]}}])
        session.add(Workflow(id="w1", name="wf", nodes=nodes, edges="[]"))
        session.add(Workflow(id="w2", name="off", nodes=nodes, edges="[]", is_active=False))
        session.commit()

        body = wf_api.WorkflowRunTrigger(trigger_payload={"ip": "198.51.100.7"})
        run = asyncio.run(wf_api.trigger_workflow_run("w1", body, session, user))
        assert json.loads(run.trigger_payload) == {"ip": "198.51.100.7"}
        assert enqueued == [run.id]

        no_body = asyncio.run(wf_api.trigger_workflow_run("w1", None, session, user))
        assert json.loads(no_body.trigger_payload) == {}

        with pytest.raises(HTTPException) as exc:
            asyncio.run(wf_api.trigger_workflow_run("w2", body, session, user))
        assert exc.value.status_code == 400


def test_failure_notification_posts_only_for_failed_runs(monkeypatch):
    import httpx
    import respx
    from backend.api.settings import set_setting
    from backend.core import notifications
    from backend.pybooks.models import PyBook

    engine = _engine()
    monkeypatch.setattr(notifications, "engine", engine)
    with Session(engine) as session:
        set_setting(session, "notify_webhook_url", "https://hooks.example.test/pylo")
        session.add(PyBook(id="p1", name="Enrich IP"))
        session.add(PyBookRun(id="bad", pybook_id="p1", status="dead_letter", trigger_source="cron", stderr="boom"))
        session.add(PyBookRun(id="good", pybook_id="p1", status="success", trigger_source="cron"))
        session.commit()

    with respx.mock(assert_all_called=False) as mock:
        route = mock.post("https://hooks.example.test/pylo").mock(return_value=httpx.Response(200))
        asyncio.run(notifications.notify_pybook_run("good"))
        assert route.call_count == 0
        asyncio.run(notifications.notify_pybook_run("bad"))
        assert route.call_count == 1
        sent = json.loads(route.calls[0].request.content)
        assert sent["kind"] == "pybook" and sent["status"] == "dead_letter" and "Enrich IP" in sent["text"]


def test_notification_webhook_url_hidden_from_non_admins():
    from backend.api import settings as settings_api
    from backend.core.auth import AuthUser

    engine = _engine()
    with Session(engine) as session:
        settings_api.set_setting(session, "notify_webhook_url", "https://hooks.example.test/secret")
        viewer = asyncio.run(settings_api.get_settings(session, AuthUser(username="v", role="viewer")))
        admin = asyncio.run(settings_api.get_settings(session, AuthUser(username="a", role="admin")))
    assert viewer["notify_webhook_url"] == "" and viewer["notify_webhook_set"] is True
    assert admin["notify_webhook_url"] == "https://hooks.example.test/secret"
