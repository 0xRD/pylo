from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
import bcrypt
from jose import JWTError, jwt
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session

_api_key_header = APIKeyHeader(name="X-API-Token", auto_error=False)

ALGORITHM = "HS256"
VALID_ROLES = frozenset({"admin", "viewer"})
MIN_PASSWORD_LEN = 8
_RUN_TOKEN_TYPE = "pylo_run"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


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
    def __init__(self, username: str, role: str, run_id: str | None = None, pybook_id: str | None = None):
        self.username = username
        self.role = role
        self.run_id = run_id
        self.pybook_id = pybook_id

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_runner(self) -> bool:
        return self.role == "runner"


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


def verify_token(
    api_key: str = Security(_api_key_header),
    pylo_token: Optional[str] = Cookie(default=None),
    session: Session = Depends(get_session),
) -> AuthUser:
    # Master API_TOKEN (for external admin scripts only; never injected into PyBooks)
    if api_key:
        if api_key == settings.API_TOKEN:
            return AuthUser(username="api_token", role="admin")
        runner = auth_user_from_run_token(api_key)
        if runner:
            return runner

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
