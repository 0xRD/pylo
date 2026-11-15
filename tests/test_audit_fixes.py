"""Regression tests for the security / reliability audit fixes."""
import asyncio
import base64
import io
import json
import uuid
import zipfile

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select


# ── Storage paths and imported ids ───────────────────────────────────────────

@pytest.mark.parametrize("bad_id", ["../backend", "/etc/cron.d", "a/b", "..", "", "x" * 65, "a b"])
def test_script_path_rejects_ids_that_escape_storage(bad_id):
    from backend.pybooks.store import get_script_path, is_safe_id

    assert not is_safe_id(bad_id)
    with pytest.raises(ValueError):
        get_script_path(bad_id)


def test_script_path_accepts_generated_ids():
    from backend.pybooks.store import STORAGE_ROOT, get_script_path

    pybook_id = str(uuid.uuid4())
    assert get_script_path(pybook_id) == STORAGE_ROOT / pybook_id / "main.py"


def test_import_drops_unsafe_ids():
    from backend.api.export_import import _safe_import_id

    assert _safe_import_id("../backend") is None
    assert _safe_import_id({"id": 1}) is None
    safe = str(uuid.uuid4())
    assert _safe_import_id(safe) == safe


def test_pybook_export_fields_keep_network_policy():
    from backend.api.export_import import _pybook_fields_from_export

    fields = _pybook_fields_from_export({"network_policy": "none", "allowed_hosts": '["api.example.com"]'})
    assert fields["network_policy"] == "none"
    assert fields["allowed_hosts"] == '["api.example.com"]'
    # Unknown policies and old exports fall back to the default instead of being stored as-is.
    assert _pybook_fields_from_export({"network_policy": "wide-open"})["network_policy"] == "default"
    assert _pybook_fields_from_export({})["allowed_hosts"] == "[]"


# ── Network guards ───────────────────────────────────────────────────────────

def test_host_allowlist_matching():
    from backend.core.netguard import host_allowed

    allowed = ["api.example.com", "*.github.com", "Example.ORG."]
    assert host_allowed("api.example.com", allowed)
    assert host_allowed("v2.api.example.com", allowed)
    assert host_allowed("API.GITHUB.COM", allowed)
    assert host_allowed("example.org", allowed)
    assert not host_allowed("example.com", allowed)
    assert not host_allowed("evilapi.example.com.attacker.net", allowed)
    assert not host_allowed("notgithub.com", allowed)
    assert not host_allowed("", allowed)
    assert not host_allowed("api.example.com", [])


@pytest.mark.parametrize("address", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "::ffff:10.0.0.5", "0.0.0.0"])
def test_blocked_ip_ranges(address):
    from backend.core.netguard import is_blocked_ip

    assert is_blocked_ip(address)


def test_public_ip_not_blocked():
    from backend.core.netguard import is_blocked_ip

    assert not is_blocked_ip("93.184.216.34")


def test_network_settings_per_policy():
    from backend.config import settings
    from backend.core.runner import network_settings

    assert network_settings("none", "tok") == ({"network_mode": "none"}, {})

    kwargs, env = network_settings("default", "tok")
    assert kwargs == {"network": settings.DOCKER_NETWORK} and env == {}

    kwargs, env = network_settings("allowlisted", "tok")
    assert kwargs == {"network": settings.PYLO_RUNNER_INTERNAL_NETWORK}
    assert kwargs["network"] != settings.DOCKER_NETWORK
    assert env["HTTPS_PROXY"] == env["https_proxy"] == "http://pylo:tok@backend:8001"
    assert "backend" in env["NO_PROXY"].split(",")


# ── Egress proxy ─────────────────────────────────────────────────────────────

async def _proxy_request(port: int, request: bytes) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(request)
    await writer.drain()
    data = await asyncio.wait_for(reader.read(65536), timeout=5)
    writer.close()
    return data


def _basic(token: str) -> str:
    return base64.b64encode(f"pylo:{token}".encode()).decode()


@pytest.mark.asyncio
async def test_egress_proxy_enforces_allowlist(monkeypatch):
    from backend.core import egress_proxy

    seen: list[bytes] = []

    async def upstream(reader, writer):
        seen.append(await reader.readuntil(b"\r\n\r\n"))
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
        await writer.drain()
        writer.close()

    upstream_server = await asyncio.start_server(upstream, "127.0.0.1", 0)
    upstream_port = upstream_server.sockets[0].getsockname()[1]

    monkeypatch.setattr(
        egress_proxy, "_allowed_hosts_for_token",
        lambda token: ("pb-1", ["allowed.test"]) if token == "good" else None,
    )

    async def fake_resolve(host, port):
        return "127.0.0.1"

    monkeypatch.setattr(egress_proxy, "_resolve_public", fake_resolve)

    proxy = await asyncio.start_server(egress_proxy._handle, "127.0.0.1", 0)
    port = proxy.sockets[0].getsockname()[1]
    try:
        # No / wrong credentials
        reply = await _proxy_request(port, b"CONNECT allowed.test:443 HTTP/1.1\r\nHost: allowed.test:443\r\n\r\n")
        assert reply.startswith(b"HTTP/1.1 407")
        reply = await _proxy_request(
            port, f"CONNECT allowed.test:443 HTTP/1.1\r\nProxy-Authorization: Basic {_basic('bad')}\r\n\r\n".encode())
        assert reply.startswith(b"HTTP/1.1 407")

        # Host outside the allowlist
        reply = await _proxy_request(
            port, f"CONNECT evil.test:443 HTTP/1.1\r\nProxy-Authorization: Basic {_basic('good')}\r\n\r\n".encode())
        assert reply.startswith(b"HTTP/1.1 403")
        assert b"evil.test" in reply

        # Allowed plain-HTTP request is forwarded in origin form, without proxy credentials
        reply = await _proxy_request(
            port,
            (f"GET http://allowed.test:{upstream_port}/path?x=1 HTTP/1.1\r\nHost: allowed.test\r\n"
             f"Proxy-Authorization: Basic {_basic('good')}\r\n\r\n").encode(),
        )
        assert reply.startswith(b"HTTP/1.1 200 OK") and reply.endswith(b"ok")
        assert seen[-1].startswith(b"GET /path?x=1 HTTP/1.1\r\n")
        assert b"Proxy-Authorization" not in seen[-1]

        # The Host header cannot point at another site behind the same address, and a
        # second request cannot be pipelined behind the authorised one.
        reply = await _proxy_request(
            port,
            (f"GET http://allowed.test:{upstream_port}/ HTTP/1.1\r\nHost: internal.evil.test\r\n"
             f"Proxy-Authorization: Basic {_basic('good')}\r\n\r\n"
             "GET /smuggled HTTP/1.1\r\nHost: internal.evil.test\r\n\r\n").encode(),
        )
        assert reply.startswith(b"HTTP/1.1 200 OK")
        assert f"Host: allowed.test:{upstream_port}\r\n".encode() in seen[-1]
        assert b"evil" not in seen[-1] and b"smuggled" not in b"".join(seen)

        reply = await _proxy_request(
            port,
            (f"POST http://allowed.test:{upstream_port}/ HTTP/1.1\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n"
             f"Proxy-Authorization: Basic {_basic('good')}\r\n\r\n").encode(),
        )
        assert reply.startswith(b"HTTP/1.1 400")

        # Allowed CONNECT opens a tunnel
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(
            f"CONNECT allowed.test:{upstream_port} HTTP/1.1\r\nProxy-Authorization: Basic {_basic('good')}\r\n\r\n".encode())
        await writer.drain()
        established = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5)
        assert established.startswith(b"HTTP/1.1 200")
        writer.write(b"GET / HTTP/1.1\r\nHost: allowed.test\r\n\r\n")
        await writer.drain()
        tunnelled = await asyncio.wait_for(reader.read(65536), timeout=5)
        assert tunnelled.endswith(b"ok")
        writer.close()
    finally:
        proxy.close()
        upstream_server.close()


@pytest.mark.asyncio
async def test_egress_proxy_refuses_internal_addresses(monkeypatch):
    """An allowed hostname that resolves to a private address must not be reachable."""
    from backend.core import egress_proxy

    monkeypatch.setattr(egress_proxy.settings, "PYLO_ALLOW_PRIVATE_FETCH", False)
    assert await egress_proxy._resolve_public("127.0.0.1", 5432) is None
    assert await egress_proxy._resolve_public("localhost", 5432) is None


# ── Runner: timeouts kill the container ──────────────────────────────────────

class _FakeContainer:
    def __init__(self, exits_after: int | None, exit_code: int = 0):
        self.name = "pylo-run-test"
        self.status = "running"
        self.attrs = {"State": {"ExitCode": exit_code}}
        self._reloads = 0
        self._exits_after = exits_after
        self.killed = False
        self.removed = False

    def reload(self):
        self._reloads += 1
        if self.killed or (self._exits_after is not None and self._reloads > self._exits_after):
            self.status = "exited"

    def logs(self, stdout=True, stderr=True, tail="all"):
        return b"partial out\n" if stdout else b"partial err\n"

    def kill(self):
        self.killed = True

    def remove(self, force=False):
        self.removed = True


def _patch_runner(monkeypatch, container):
    from docker.errors import NotFound

    from backend.core import runner

    class _Containers:
        def get(self, name):
            raise NotFound("no leftover container")

        def run(self, **kwargs):
            container.run_kwargs = kwargs
            return container

    class _Client:
        containers = _Containers()

    monkeypatch.setattr(runner.docker, "from_env", lambda: _Client())
    monkeypatch.setattr(runner, "ensure_image", lambda pybook_id, deps: "image:tag")
    monkeypatch.setattr(runner, "_store_live_output", lambda *a, **k: None)
    monkeypatch.setattr(runner, "_run_was_cancelled", lambda run_id: False)
    monkeypatch.setattr(runner, "_POLL_INTERVAL", 0.01)
    return runner


def test_runner_kills_and_removes_container_on_timeout(monkeypatch):
    container = _FakeContainer(exits_after=None)
    runner = _patch_runner(monkeypatch, container)

    with pytest.raises(runner.RunTimeout) as exc:
        runner._run_container_sync("pb", "run-1", [], [], {}, "none", [], timeout=0.05)

    assert container.killed and container.removed
    assert exc.value.stdout == "partial out\n"  # output captured before the kill is kept
    assert exc.value.stderr == "partial err\n"
    assert isinstance(exc.value, TimeoutError)


def test_runner_returns_both_streams_and_exit_code_on_failure(monkeypatch):
    container = _FakeContainer(exits_after=1, exit_code=3)
    runner = _patch_runner(monkeypatch, container)

    stdout, stderr, exit_code = runner._run_container_sync("pb", "run-2", [], [], {"a": 1}, "none", [], timeout=5)

    assert (stdout, stderr, exit_code) == ("partial out\n", "partial err\n", 3)
    assert container.removed and not container.killed
    assert container.run_kwargs["network_mode"] == "none"
    assert container.run_kwargs["name"] == runner.container_name("run-2")
    assert container.run_kwargs["detach"] is True


def test_runner_skips_container_when_cancelled_during_build(monkeypatch):
    container = _FakeContainer(exits_after=1)
    runner = _patch_runner(monkeypatch, container)
    monkeypatch.setattr(runner, "_run_was_cancelled", lambda run_id: True)

    assert runner._run_container_sync("pb", "run-3", [], [], {}, "none", [], timeout=5) == ("", "", -1)
    assert not hasattr(container, "run_kwargs")  # never started


def test_output_is_capped():
    from backend.core import runner

    text = "x" * (runner.MAX_OUTPUT_BYTES + 10)
    capped = runner._truncate(text)
    assert capped.startswith("[output truncated")
    assert len(capped) < len(text) + 100
    assert runner._truncate("short") == "short"


# ── GitOps input validation ──────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "ext::sh -c 'id > /tmp/pwned'",
    "--upload-pack=touch /tmp/pwned",
    "file:///etc/passwd",
    "/srv/repos/local.git",
    "git@github.com:org/repo.git",
    "https://",
    "https://github.com/org/repo.git --config=core.sshCommand=id",
])
def test_gitops_rejects_dangerous_repo_urls(url):
    from backend.api.gitops import _validate_repo_url

    with pytest.raises(HTTPException) as exc:
        _validate_repo_url(url)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("url", ["https://github.com/org/repo.git", "ssh://git@github.com/org/repo.git"])
def test_gitops_accepts_network_repo_urls(url):
    from backend.api.gitops import _validate_repo_url

    assert _validate_repo_url(f"  {url} ") == url


@pytest.mark.parametrize("branch", ["--upload-pack=x", "-b", "a..b", "feat ure", "x" * 201, "main;id"])
def test_gitops_rejects_bad_branch_names(branch):
    from backend.api.gitops import _validate_branch

    with pytest.raises(HTTPException):
        _validate_branch(branch)


def test_gitops_branch_defaults_and_accepts_normal_names():
    from backend.api.gitops import _validate_branch

    assert _validate_branch("") == "main"
    assert _validate_branch("release/1.2_x") == "release/1.2_x"


def test_gitops_sync_fields_cannot_overwrite_identity():
    from backend.api.gitops import _BLUEPRINT_SYNC_FIELDS, _PYBOOK_SYNC_FIELDS

    for fields in (_PYBOOK_SYNC_FIELDS, _BLUEPRINT_SYNC_FIELDS):
        assert not fields & {"id", "name", "created_at"}
    assert {"network_policy", "allowed_hosts", "script"} <= _PYBOOK_SYNC_FIELDS


# ── Scheduling ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("expr,valid", [
    ("0 * * * *", True),
    ("*/5 8-18 * * mon-fri", True),
    ("99 99 99 99 99", False),
    ("not a cron", False),
    ("* * * *", False),
    ("", False),
    (None, False),
])
def test_is_valid_cron(expr, valid):
    from backend.core.scheduler import is_valid_cron

    assert is_valid_cron(expr) is valid


def test_int_setting_survives_corrupt_values():
    from backend.api.settings import get_int_setting
    from backend.core.settings_model import SystemSetting

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[SystemSetting.__table__])
    with Session(engine) as session:
        session.add(SystemSetting(key="max_concurrent_runs", value="lots"))
        session.add(SystemSetting(key="run_retention_days", value="0"))
        session.commit()
        assert get_int_setting(session, "max_concurrent_runs", 5) == 5
        assert get_int_setting(session, "run_retention_days", 30) == 0
        assert get_int_setting(session, "activity_retention_days", 7) == 7


# ── Sessions and accounts ────────────────────────────────────────────────────

def test_session_token_dies_with_password_change():
    from backend.core.auth import auth_user_from_jwt, create_access_token, hash_password
    from backend.users.models import User

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    with Session(engine) as session:
        user = User(username="alice", hashed_password=hash_password("first-password"), role="admin")
        session.add(user)
        session.commit()
        session.refresh(user)

        token = create_access_token(user.username, user.role, 1, user.hashed_password)
        assert auth_user_from_jwt(token, session).username == "alice"

        # A token without the password binding (issued by an older version) is rejected.
        assert auth_user_from_jwt(create_access_token("alice", "admin", 1), session) is None

        user.hashed_password = hash_password("second-password")
        session.add(user)
        session.commit()
        assert auth_user_from_jwt(token, session) is None


def test_last_active_admin_is_protected():
    from backend.api.users import _guard_last_admin
    from backend.users.models import User

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    with Session(engine) as session:
        admin = User(username="root", hashed_password="x", role="admin")
        disabled = User(username="old", hashed_password="x", role="admin", is_active=False)
        viewer = User(username="eve", hashed_password="x", role="viewer")
        session.add_all([admin, disabled, viewer])
        session.commit()

        with pytest.raises(HTTPException) as exc:
            _guard_last_admin(session, admin)
        assert exc.value.status_code == 400
        _guard_last_admin(session, viewer)  # non-admins are never blocked

        session.add(User(username="second", hashed_password="x", role="admin"))
        session.commit()
        _guard_last_admin(session, admin)  # another active admin exists


@pytest.mark.parametrize("username", ["", "   ", "a b", "x" * 65, "bo\nb", "-flag", "<script>"])
def test_username_validation_rejects(username):
    from backend.api.auth import validate_username

    with pytest.raises(HTTPException):
        validate_username(username)


def test_username_validation_accepts():
    from backend.api.auth import validate_username

    assert validate_username(" jane.doe@example.com ") == "jane.doe@example.com"


# ── API validation (real app + database) ─────────────────────────────────────

@pytest.fixture(scope="module")
def api():
    from backend import database
    from backend import main as app_module

    database.init_db()
    client = TestClient(app_module.app, headers={"X-API-Token": app_module.settings.API_TOKEN})
    created: dict[str, list[str]] = {"pybooks": [], "blueprints": []}
    yield client, created
    for pybook_id in created["pybooks"]:
        client.delete(f"/api/pybooks/{pybook_id}")
    for blueprint_id in created["blueprints"]:
        client.delete(f"/api/blueprints/{blueprint_id}")


@pytest.mark.parametrize("patch,expected", [
    ({"network_policy": "wide-open"}, "network_policy"),
    ({"allowed_hosts": '["https://api.example.com/v1"]'}, "allowed_hosts"),
    ({"allowed_hosts": "not json"}, "allowed_hosts"),
    ({"dependencies": '["requests @ https://evil.example/pkg.tar.gz"]'}, "URL"),
    ({"trigger_type": "cron", "trigger_config": '{"cron": "99 99 99 99 99"}'}, "cron"),
    ({"trigger_type": "telepathy"}, "trigger_type"),
    ({"tags": '{"a": 1}'}, "tags"),
])
def test_pybook_create_rejects_invalid_settings(api, patch, expected):
    client, _ = api
    response = client.post("/api/pybooks", json={"name": f"audit-invalid-{uuid.uuid4().hex[:6]}", **patch})
    assert response.status_code == 422, response.text
    assert expected in response.text


def test_pybook_create_accepts_valid_settings_and_caps_retries(api, monkeypatch):
    client, created = api
    from backend.core import queue_manager

    monkeypatch.setattr(queue_manager, "enqueue", lambda *a, **k: None)
    response = client.post("/api/pybooks", json={
        "name": f"audit-valid-{uuid.uuid4().hex[:6]}",
        "network_policy": "allowlisted",
        "allowed_hosts": '["api.example.com", "*.github.com"]',
        "trigger_type": "cron",
        "trigger_config": '{"cron": "*/15 * * * *"}',
    })
    assert response.status_code == 201, response.text
    pybook_id = response.json()["id"]
    created["pybooks"].append(pybook_id)

    # The cron job exists right away (it used to need an update or a restart).
    from backend.core.scheduler import scheduler
    assert scheduler.get_job(f"cron_pb_{pybook_id}") is not None

    run = client.post(f"/api/pybooks/{pybook_id}/run", json={"max_retries": 10_000})
    assert run.status_code == 200, run.text
    assert run.json()["max_retries"] == 10
    client.delete(f"/api/runs/{run.json()['id']}")

    client.delete(f"/api/pybooks/{pybook_id}")
    created["pybooks"].remove(pybook_id)
    assert scheduler.get_job(f"cron_pb_{pybook_id}") is None


def test_cancel_running_run_kills_its_container(api, monkeypatch):
    client, created = api
    from backend import database
    from backend.core import queue_manager, runner
    from backend.pybooks.models import PyBookRun

    monkeypatch.setattr(queue_manager, "enqueue", lambda *a, **k: None)
    killed = []
    monkeypatch.setattr(runner, "kill_run", lambda run_id: killed.append(run_id) or True)

    pybook_id = client.post("/api/pybooks", json={"name": f"audit-cancel-{uuid.uuid4().hex[:6]}"}).json()["id"]
    created["pybooks"].append(pybook_id)
    run_id = client.post(f"/api/pybooks/{pybook_id}/run", json={}).json()["id"]
    with Session(database.engine) as session:
        run = session.get(PyBookRun, run_id)
        run.status = "running"
        session.add(run)
        session.commit()

    response = client.delete(f"/api/runs/{run_id}")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert killed == [run_id]

    # A finished run cannot be cancelled again.
    with Session(database.engine) as session:
        run = session.get(PyBookRun, run_id)
        run.status = "success"
        session.add(run)
        session.commit()
    assert client.delete(f"/api/runs/{run_id}").status_code == 400


@pytest.mark.parametrize("patch", [
    {"fetch_cron": "every day at noon"},
    {"source_method": "DELETE"},
    {"source_headers": "{not json"},
    {"source_url": "file:///etc/passwd"},
])
def test_blueprint_create_rejects_invalid_settings(api, patch):
    client, _ = api
    response = client.post("/api/blueprints", json={"name": f"audit-bp-{uuid.uuid4().hex[:6]}", **patch})
    assert response.status_code == 422, response.text


def test_settings_reject_invalid_backup_cron(api):
    client, _ = api
    response = client.put("/api/settings", json={"backup_cron": "99 99 99 99 99"})
    assert response.status_code == 422


def test_secret_names_are_validated(api):
    client, _ = api
    response = client.post("/api/secrets", json={"name": "bad name=1", "value": "v"})
    assert response.status_code == 422


def test_full_restore_cannot_write_outside_storage(api, tmp_path, monkeypatch):
    """A crafted backup used to place main.py anywhere via a PyBook id like ../x."""
    client, created = api
    from backend.pybooks import store

    storage = tmp_path / "pybooks_storage"
    storage.mkdir()
    monkeypatch.setattr(store, "STORAGE_ROOT", storage)

    name = f"audit-traversal-{uuid.uuid4().hex[:6]}"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"pylo_export": "full_backup", "version": 1}))
        zf.writestr("pybooks/evil.json", json.dumps({
            "pylo_export": "pybook", "id": "../escaped", "name": name,
            "script": "print('owned')", "network_policy": "none",
        }))
        zf.writestr("settings.json", json.dumps({
            "max_concurrent_runs": "not-a-number",
            "run_retention_days": "99999",
            "git_token_enc": "attacker-controlled",
            "made_up_key": "x",
        }))

    response = client.post("/api/import/full?confirm=RESTORE", content=buffer.getvalue())
    assert response.status_code == 200, response.text

    assert not (tmp_path / "escaped").exists()
    pybooks = [p for p in client.get("/api/pybooks").json() if p["name"] == name]
    assert len(pybooks) == 1
    created["pybooks"].append(pybooks[0]["id"])
    assert pybooks[0]["id"] != "../escaped"
    uuid.UUID(pybooks[0]["id"])
    assert pybooks[0]["network_policy"] == "none"
    assert (storage / pybooks[0]["id"] / "main.py").read_text() == "print('owned')"

    # Settings: unknown / credential keys ignored, numbers clamped, garbage skipped.
    from backend import database
    from backend.core.settings_model import SystemSetting
    with Session(database.engine) as session:
        assert session.get(SystemSetting, "made_up_key") is None
        token_row = session.get(SystemSetting, "git_token_enc")
        assert token_row is None or token_row.value != "attacker-controlled"
        assert session.get(SystemSetting, "run_retention_days").value == "3650"
        concurrency = session.get(SystemSetting, "max_concurrent_runs")
        assert concurrency is None or concurrency.value.isdigit()
        row = session.get(SystemSetting, "run_retention_days")
        session.delete(row)
        session.commit()


# ── Entry search (documented syntax) ─────────────────────────────────────────

def test_pg_tsquery_translation():
    from backend.objects.indexer import _pg_tsquery

    sql, params = _pg_tsquery("mimikatz NOT lolbas")
    assert params == {"query": "mimikatz -lolbas"}
    assert "websearch_to_tsquery" in sql

    sql, params = _pg_tsquery("exec* shell")
    assert params == {"query": "shell", "prefix0": "'exec':*"}
    assert "to_tsquery('simple', :prefix0)" in sql

    sql, params = _pg_tsquery("exec*")
    assert params == {"prefix0": "'exec':*"}

    # Quotes and operators in user input never reach to_tsquery unescaped.
    _, params = _pg_tsquery("it's a 'test'* & | !")
    assert all("'" not in v or k == "query" for k, v in params.items())


def test_entry_filters_and_search_on_real_database(api):
    client, created = api
    from backend import database

    if database.engine.dialect.name != "postgresql":
        pytest.skip("exercises the Postgres query path")

    blueprint_id = client.post("/api/blueprints", json={
        "name": f"audit-search-{uuid.uuid4().hex[:6]}", "is_manual": True,
    }).json()["id"]
    created["blueprints"].append(blueprint_id)
    rows = [
        {"name": "mimikatz", "os": "Windows", "score": 95, "note": "credential dumping"},
        {"name": "lolbas", "os": "Windows", "score": 40, "note": "living off the land"},
        {"name": "executor", "os": "Linux", "score": "n/a", "note": "cmd.exe /c whoami"},
        {"name": "100%_legit", "os": "macOS", "score": 7.5, "note": "mimikatz lolbas combo"},
    ]
    for row in rows:
        assert client.post(f"/api/blueprints/{blueprint_id}/entries", json={"fields": row}).status_code == 201

    def names(query: str) -> set[str]:
        response = client.get("/api/blueprints/entries", params={"blueprint_id": blueprint_id, "q": query})
        assert response.status_code == 200, f"{query!r}: {response.text}"
        return {json.loads(item["data"])["name"] for item in response.json()["items"]}

    # Numeric comparisons skip non-numeric values instead of failing the query.
    assert names("score >= 40") == {"mimikatz", "lolbas"}
    assert names("score < 10") == {"100%_legit"}
    assert names("score > abc") == set()
    assert names('os starts_with "win"') == {"mimikatz", "lolbas"}
    assert names("name ends_with katz") == {"mimikatz"}
    assert names("name contains EXEC") == {"executor"}
    # LIKE wildcards in the value are literal.
    assert names("name contains %") == {"100%_legit"}
    assert names("os = Windows AND score > 50") == {"mimikatz"}

    # Full-text syntax shown in the search help.
    assert names("mimikatz lolbas") == {"100%_legit"}
    assert names("mimikatz OR lolbas") == {"mimikatz", "lolbas", "100%_legit"}
    assert names("mimikatz NOT lolbas") == {"mimikatz"}
    assert names('"living off"') == {"lolbas"}
    assert names("exec*") == {"executor"}
    assert names("os = Linux AND exec*") == {"executor"}

    # Deleting entries leaves no history or search rows behind.
    from sqlalchemy import text
    assert client.delete(f"/api/blueprints/{blueprint_id}/entries").status_code == 204
    with Session(database.engine) as session:
        assert session.exec(text("SELECT count(*) FROM fts_entries WHERE blueprint_id = :b"),
                            params={"b": blueprint_id}).one()[0] == 0
        assert session.exec(text("SELECT count(*) FROM entry_event WHERE blueprint_id = :b"),
                            params={"b": blueprint_id}).one()[0] == 0


def test_fetch_persistence_deduplicates_in_batches(api):
    client, created = api
    from backend import database
    from backend.api.blueprints import _persist_fetch_items
    from backend.objects.models import Entry

    blueprint_id = client.post("/api/blueprints", json={
        "name": f"audit-fetch-{uuid.uuid4().hex[:6]}",
        "field_mappings": json.dumps([
            {"source_path": "$.id", "field_name": "external_id", "field_type": "string", "is_key": True},
            {"source_path": "$.v", "field_name": "v", "field_type": "number", "mutable": True},
        ]),
        "mutable_mode": "per_field",
        "max_entries": 1100,
    }).json()["id"]
    created["blueprints"].append(blueprint_id)

    items = [{"id": f"k{i}", "v": i} for i in range(1200)] + [{"id": "k5", "v": 5}]  # one in-batch duplicate
    result, triggers = _persist_fetch_items(blueprint_id, items, 1, "test", database.engine)
    assert result["created"] == 1200 and result["skipped"] == 1
    assert result["retention_deleted"] == 100  # max_entries enforced without loading every row
    assert len(triggers) == 1200

    again, _ = _persist_fetch_items(blueprint_id, [{"id": "k1199", "v": -1}, {"id": "new", "v": 1}], 1, "test",
                                    database.engine)
    assert again["updated"] + again["created"] == 2 and again["skipped"] == 0
    with Session(database.engine) as session:
        count = len(session.exec(select(Entry.id).where(Entry.blueprint_id == blueprint_id)).all())
    assert count <= 1100
