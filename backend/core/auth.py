from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session

_api_key_header = APIKeyHeader(name="X-API-Token", auto_error=False)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(username: str, role: str, expire_hours: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=expire_hours)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire},
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
    def __init__(self, username: str, role: str):
        self.username = username
        self.role = role

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def verify_token(
    api_key: str = Security(_api_key_header),
    pylo_token: Optional[str] = Cookie(default=None),
    session: Session = Depends(get_session),
) -> AuthUser:
    # Master API_TOKEN (for SDK / external scripts)
    if api_key and api_key == settings.API_TOKEN:
        return AuthUser(username="api_token", role="admin")

    # JWT cookie
    if pylo_token:
        payload = _decode_jwt(pylo_token)
        if payload:
            return AuthUser(username=payload["sub"], role=payload.get("role", "viewer"))

    raise HTTPException(status_code=401, detail="Unauthorized")


def require_admin(user: AuthUser = Depends(verify_token)) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
