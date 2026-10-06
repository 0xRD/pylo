from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import hmac as _hmac
import json
import secrets

from fastapi import Cookie, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
import bcrypt
import jwt
from jwt import PyJWTError as JWTError
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session

_api_key_header = APIKeyHeader(name="X-API-Token", auto_error=False)

ALGORITHM = "HS256"
VALID_ROLES = frozenset({"admin", "viewer"})
MIN_PASSWORD_LEN = 8
_RUN_TOKEN_TYPE = "pylo_run"
VALID_API_KEY_SCOPES = frozenset({
    "blueprints:read",
    "entries:read",
    "entries:write",
    "pybooks:trigger",
    "runs:read",
})


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_api_key_token() -> str:
    return f"pylok_{secrets.token_urlsafe(32)}"


def api_key_prefix(token: str) -> str:
    return token[:16]


def hash_api_key(token: str) -> str:
    """HMAC-SHA256 of the token keyed by SECRET_KEY.

    API keys are already 256-bit random secrets, so bcrypt's intentional
    slowness adds ~100-200 ms per request with zero security benefit.
    HMAC-SHA256 is cryptographically sufficient, O(1) fast, and binds the
    stored hash to the SECRET_KEY (rainbow tables useless without it).
    """
    return _hmac.new(settings.SECRET_KEY.encode(), token.encode(), hashlib.sha256).hexdigest()


def _verify_api_key(token: str, stored_hash: str) -> bool:
    """Constant-time comparison. Falls back to bcrypt for legacy hashes."""
    if stored_hash.startswith(("$2b$", "$2a$")):
        # Legacy bcrypt hash — accept and let the caller upgrade it
        return verify_password(token, stored_hash)
    return _hmac.compare_digest(hash_api_key(token), stored_hash)


def create_access_token(username: str, role: str, expire_hours: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=expire_hours)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def create_run_token(run_id: str, pybook_id: str) -> str:
    ttl = max(60, settings.PYLO_RUN_TOKEN_TTL_SECONDS)
    expire = datetime.now(timezone.utc) + timedelta(seconds=ttl)
    return jwt.encode(
        {
            "typ": _RUN_TOKEN_TYPE,
            "sub": f"pybook:{pybook_id}",
            "role": "runner",
            "run_id": run_id,
            "pybook_id": pybook_id,
            "exp": expire,
        },
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _decode_jwt(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def _get_jwt_expire_hours(session: Session) -> int:
    from backend.core.settings_model import SystemSetting
    row = session.get(SystemSetting, "jwt_expire_hours")
    if row:
        try:
            return int(row.value)
        except ValueError:
            pass
    return settings.JWT_EXPIRE_HOURS


class AuthUser:
    def __init__(
        self,
        username: str,
        role: str,
        run_id: str | None = None,
        pybook_id: str | None = None,
        api_key_id: int | None = None,
        scopes: set[str] | None = None,
    ):
        self.username = username
        self.role = role
        self.run_id = run_id
        self.pybook_id = pybook_id
        self.api_key_id = api_key_id
        self.scopes = scopes or set()

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_runner(self) -> bool:
        return self.role == "runner"

    @property
    def is_api_key(self) -> bool:
        return self.role == "api_key"

    def has_scope(self, scope: str) -> bool:
        return self.is_admin or scope in self.scopes


def auth_user_from_jwt(token: str, session: Session) -> AuthUser | None:
    payload = _decode_jwt(token)
    if not payload or payload.get("typ") == _RUN_TOKEN_TYPE:
        return None
    username = payload.get("sub")
    if not username:
        return None
    from backend.users.models import User
    user = session.exec(select(User).where(User.username == username)).first()
    if not user or not user.is_active:
        return None
    return AuthUser(username=user.username, role=user.role)


def auth_user_from_run_token(token: str) -> AuthUser | None:
    payload = _decode_jwt(token)
    if not payload or payload.get("typ") != _RUN_TOKEN_TYPE:
        return None
    run_id = payload.get("run_id")
    pybook_id = payload.get("pybook_id")
    if not run_id or not pybook_id:
        return None
    return AuthUser(
        username=payload.get("sub", f"pybook:{pybook_id}"),
        role="runner",
        run_id=run_id,
        pybook_id=pybook_id,
    )


def auth_user_from_scoped_api_key(token: str, session: Session) -> AuthUser | None:
    if not token or not token.startswith("pylok_"):
        return None
    from backend.users.models import ApiKey

    sha_hash = hash_api_key(token)

    # Fast path: O(1) lookup by HMAC-SHA256 hash (new keys)
    api_key = session.exec(
        select(ApiKey).where(ApiKey.is_active == True, ApiKey.key_hash == sha_hash)
    ).first()

    if api_key is None:
        # Legacy path: prefix lookup → bcrypt verify (keys created before this fix)
        api_key = session.exec(
            select(ApiKey).where(
                ApiKey.is_active == True,
                ApiKey.key_prefix == api_key_prefix(token),
            )
        ).first()
        if api_key is None or not verify_password(token, api_key.key_hash):
            return None
        # Auto-upgrade: replace bcrypt hash with HMAC-SHA256 so next call is O(1)
        api_key.key_hash = sha_hash

    try:
        scopes = set(json.loads(api_key.scopes or "[]"))
    except json.JSONDecodeError:
        scopes = set()
    api_key.last_used_at = datetime.now(timezone.utc)
    session.add(api_key)
    session.commit()
    return AuthUser(
        username=f"api_key:{api_key.name}",
        role="api_key",
        api_key_id=api_key.id,
        scopes=scopes & VALID_API_KEY_SCOPES,
    )


def is_master_token(candidate: Optional[str]) -> bool:
    """Constant-time comparison against the master API token."""
    if not candidate:
        return False
    return _hmac.compare_digest(candidate.encode("utf-8"), settings.API_TOKEN.encode("utf-8"))


def verify_token(
    api_key: str = Security(_api_key_header),
    pylo_token: Optional[str] = Cookie(default=None),
    session: Session = Depends(get_session),
) -> AuthUser:
    # Master API_TOKEN (for external admin scripts only; never injected into PyBooks)
    if api_key:
        if is_master_token(api_key):
            return AuthUser(username="api_token", role="admin")
        runner = auth_user_from_run_token(api_key)
        if runner:
            return runner
        scoped_user = auth_user_from_scoped_api_key(api_key, session)
        if scoped_user:
            return scoped_user

    # JWT cookie; role and active state are always read from the database.
    if pylo_token:
        user = auth_user_from_jwt(pylo_token, session)
        if user:
            return user

    raise HTTPException(status_code=401, detail="Unauthorized")


def require_admin(user: AuthUser = Depends(verify_token)) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
