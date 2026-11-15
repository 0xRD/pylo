import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, require_admin, verify_token
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core.crypto import encrypt
from backend.database import get_session
from backend.secrets.models import Secret

_SECRET_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,63}$")


def _validate_name(name: str) -> str:
    # Secrets are injected as SECRET_<name> environment variables.
    name = (name or "").strip()
    if not _SECRET_NAME_RE.fullmatch(name):
        raise HTTPException(status_code=422, detail="Secret name must be 1-64 letters, digits, '_', '-' or '.' "
                                                    "and cannot start with a digit")
    return name


router = APIRouter(prefix="/api/secrets", tags=["secrets"], dependencies=[Depends(verify_token)])


class SecretCreate(BaseModel):
    name: str
    value: str
    description: Optional[str] = None


class SecretUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[str] = None
    description: Optional[str] = None


class SecretResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    # encrypted_value intentionally excluded


@router.get("", response_model=list[SecretResponse])
async def list_secrets(session: Session = Depends(get_session), _: AuthUser = Depends(require_admin)):
    return session.exec(select(Secret)).all()


@router.post("", response_model=SecretResponse, status_code=201)
async def create_secret(
    body: SecretCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    body.name = _validate_name(body.name)
    existing = session.exec(select(Secret).where(Secret.name == body.name)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Secret '{body.name}' already exists")
    now = datetime.now(timezone.utc)
    secret = Secret(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        encrypted_value=encrypt(body.value),
        created_at=now,
        updated_at=now,
    )
    session.add(secret)
    log_activity(session, "secret.created", actor=current_user.username,
                 resource_type="secret", resource_id=secret.id, resource_name=body.name)
    session.commit()
    session.refresh(secret)
    return secret


@router.put("/{secret_id}", response_model=SecretResponse)
async def update_secret(
    secret_id: str,
    body: SecretUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    secret = session.get(Secret, secret_id)
    if not secret:
        raise HTTPException(status_code=404, detail="Secret not found")
    if body.name is not None and body.name != secret.name:
        name = _validate_name(body.name)
        if session.exec(select(Secret).where(Secret.name == name, Secret.id != secret_id)).first():
            raise HTTPException(status_code=409, detail=f"Secret '{name}' already exists")
        secret.name = name
    if body.description is not None:
        secret.description = body.description
    if body.value is not None:
        secret.encrypted_value = encrypt(body.value)
    secret.updated_at = datetime.now(timezone.utc)
    session.add(secret)
    log_activity(session, "secret.updated", actor=current_user.username,
                 resource_type="secret", resource_id=secret.id, resource_name=secret.name,
                 detail={"value_changed": body.value is not None})
    session.commit()
    session.refresh(secret)
    return secret


@router.delete("/{secret_id}", status_code=204)
async def delete_secret(
    secret_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    secret = session.get(Secret, secret_id)
    if not secret:
        raise HTTPException(status_code=404, detail="Secret not found")
    secret_name = secret.name
    session.delete(secret)
    log_activity(session, "secret.deleted", actor=current_user.username,
                 resource_type="secret", resource_id=secret_id, resource_name=secret_name)
    session.commit()
