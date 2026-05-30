import pytest
from fastapi import HTTPException

from backend.api.blueprints import _validate_fetch_url
from backend.core.auth import auth_user_from_run_token, create_run_token
from backend.core.image_builder import _validate_dependency


def test_run_token_decodes_as_runner_scope():
    token = create_run_token("run-123", "pybook-456")

    user = auth_user_from_run_token(token)

    assert user is not None
    assert user.role == "runner"
    assert user.run_id == "run-123"
    assert user.pybook_id == "pybook-456"


@pytest.mark.parametrize(
    "dependency",
    [
        "requests\nRUN touch /tmp/pwned",
        "requests @ https://example.com/pkg.tar.gz",
        "",
    ],
)
def test_dependency_validator_rejects_injection_primitives(dependency):
    with pytest.raises(ValueError):
        _validate_dependency(dependency)


def test_dependency_validator_accepts_normal_package_specifier():
    assert _validate_dependency("requests==2.32.3") == "requests==2.32.3"


@pytest.mark.parametrize("url", ["http://localhost:8000/health", "http://127.0.0.1:8000/health"])
def test_blueprint_fetch_blocks_local_targets(url):
    with pytest.raises(HTTPException) as exc:
        _validate_fetch_url(url)

    assert exc.value.status_code == 400



def test_blueprint_fetch_blocks_dns_resolution_to_private_ip(monkeypatch):
    import socket

    def fake_getaddrinfo(*args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.10", 443))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    with pytest.raises(HTTPException) as exc:
        _validate_fetch_url("https://public.example.com/api")

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_blueprint_fetch_blocks_redirect_to_private_target():
    import httpx
    import respx
    from backend.api.blueprints import _request_with_ssrf_guard

    with respx.mock:
        respx.get("https://public.example.test/start").respond(
            status_code=302,
            headers={"Location": "http://127.0.0.1:8000/metadata"},
        )
        async with httpx.AsyncClient() as client:
            with pytest.raises(HTTPException) as exc:
                await _request_with_ssrf_guard(client, "GET", "https://public.example.test/start")

    assert exc.value.status_code == 400


def test_scoped_api_key_authenticates_and_updates_last_used(tmp_path):
    from sqlmodel import Session, SQLModel, create_engine
    from backend.core.auth import api_key_prefix, auth_user_from_scoped_api_key, create_api_key_token, hash_api_key
    from backend.users.models import ApiKey

    engine = create_engine(f"sqlite:///{tmp_path / 'keys.db'}")
    SQLModel.metadata.create_all(engine)
    token = create_api_key_token()
    with Session(engine) as session:
        session.add(ApiKey(name="siem", key_prefix=api_key_prefix(token), key_hash=hash_api_key(token), scopes='["entries:read"]'))
        session.commit()

    with Session(engine) as session:
        user = auth_user_from_scoped_api_key(token, session)
        key = session.get(ApiKey, user.api_key_id)

    assert user.username == "api_key:siem"
    assert user.has_scope("entries:read")
    assert not user.has_scope("entries:write")
    assert key.last_used_at is not None


def test_scoped_api_key_verifies_only_matching_prefix(tmp_path, monkeypatch):
    from sqlmodel import Session, SQLModel, create_engine
    import backend.core.auth as auth
    from backend.users.models import ApiKey

    db_path = tmp_path / "keys.db"
    engine = create_engine(f"sqlite:///{db_path}")
    SQLModel.metadata.create_all(engine)
    token = auth.create_api_key_token()
    calls = []

    def fake_verify(plain, hashed):
        calls.append((plain, hashed))
        return plain == token and hashed == "target-hash"

    monkeypatch.setattr(auth, "verify_password", fake_verify)
    with Session(engine) as session:
        for idx in range(20):
            session.add(ApiKey(name=f"decoy-{idx}", key_prefix=f"decoy-prefix-{idx}", key_hash="decoy-hash"))
        session.add(ApiKey(name="target", key_prefix=auth.api_key_prefix(token), key_hash="target-hash", scopes='["entries:read"]'))
        session.commit()

    with Session(engine) as session:
        user = auth.auth_user_from_scoped_api_key(token, session)

    assert user.username == "api_key:target"
    assert calls == [(token, "target-hash")]


def test_scoped_api_key_gate_allows_only_matching_scope():
    from backend.core.auth import AuthUser
    from backend.main import _scoped_can_access

    user = AuthUser(username="api_key:read", role="api_key", scopes={"entries:read"})

    assert _scoped_can_access(user, "GET", "/api/blueprints/entries")
    assert not _scoped_can_access(user, "DELETE", "/api/blueprints/entries/e-1")


def test_secret_access_activity_logs_names_not_values(tmp_path, monkeypatch):
    import json
    from sqlmodel import Session, SQLModel, create_engine, select
    from backend.activity.models import ActivityEvent
    from backend.core.crypto import encrypt
    from backend.core.runner import _collect_secrets
    from backend.secrets.models import Secret
    import backend.database as database

    engine = create_engine(f"sqlite:///{tmp_path / 'secrets.db'}")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(database, "engine", engine)

    with Session(engine) as session:
        session.add(Secret(id="sec-1", name="vt", encrypted_value=encrypt("super-secret-value")))
        session.commit()

    env = _collect_secrets("pb-1", "run-1", ["vt"])

    with Session(engine) as session:
        event = session.exec(select(ActivityEvent).where(ActivityEvent.event_type == "secret.accessed")).one()

    assert env["SECRET_vt"] == "super-secret-value"
    detail = json.loads(event.detail)
    assert detail == {"secret_names": ["vt"]}
    assert "super-secret-value" not in event.detail


def test_secret_encryption_uses_dedicated_pbkdf2_key():
    from cryptography.fernet import InvalidToken
    from backend.core.crypto import decrypt, encrypt, _legacy_fernet
    from backend.config import settings

    token = encrypt("super-secret-value")

    assert decrypt(token) == "super-secret-value"
    with pytest.raises(InvalidToken):
        _legacy_fernet(settings.SECRET_KEY).decrypt(token.encode())


def test_legacy_secret_ciphertexts_rotate_to_current_key(tmp_path, monkeypatch):
    from cryptography.fernet import InvalidToken
    from sqlmodel import Session, SQLModel, create_engine
    import backend.database as database
    from backend.config import settings
    from backend.core.crypto import _legacy_fernet, decrypt, encrypt
    from backend.secrets.models import Secret

    db_path = tmp_path / "rotate.db"
    engine = create_engine(f"sqlite:///{db_path}")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(database, "engine", engine)
    legacy_token = _legacy_fernet(settings.SECRET_KEY).encrypt(b"old-secret-value").decode()

    with Session(engine) as session:
        session.add(Secret(id="sec-1", name="old", encrypted_value=legacy_token))
        session.add(Secret(id="sec-2", name="new", encrypted_value=encrypt("new-secret-value")))
        session.commit()

    database.rotate_legacy_secret_ciphertexts()

    with Session(engine) as session:
        old_secret = session.get(Secret, "sec-1")
        new_secret = session.get(Secret, "sec-2")

    assert decrypt(old_secret.encrypted_value) == "old-secret-value"
    assert decrypt(new_secret.encrypted_value) == "new-secret-value"
    with pytest.raises(InvalidToken):
        _legacy_fernet(settings.SECRET_KEY).decrypt(old_secret.encrypted_value.encode())


def test_run_token_can_only_access_its_own_run():
    from backend.core.auth import AuthUser
    from backend.api.runs import _enforce_run_access

    runner = AuthUser(username="pybook:pb-1", role="runner", run_id="run-A", pybook_id="pb-1")

    # Own run is allowed
    _enforce_run_access(runner, "run-A")

    # Any other run is rejected
    with pytest.raises(HTTPException) as exc:
        _enforce_run_access(runner, "run-B")
    assert exc.value.status_code == 403

    # Admin and scoped-key principals are unaffected
    _enforce_run_access(AuthUser(username="admin", role="admin"), "run-B")
    _enforce_run_access(AuthUser(username="api_key:siem", role="api_key"), "run-B")
