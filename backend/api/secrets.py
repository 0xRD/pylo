import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, verify_token
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core.crypto import encrypt
from backend.database import get_session
from backend.secrets.models import Secret

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
async def list_secrets(session: Session = Depends(get_session)):
    return session.exec(select(Secret)).all()


@router.post("", response_model=SecretResponse, status_code=201)
async def create_secret(
    body: SecretCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
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
    secret_id: str, body: SecretUpdate, session: Session = Depends(get_session)
):
    secret = session.get(Secret, secret_id)
    if not secret:
        raise HTTPException(status_code=404, detail="Secret not found")
    if body.name is not None:
        secret.name = body.name
    if body.description is not None:
        secret.description = body.description
    if body.value is not None:
        secret.encrypted_value = encrypt(body.value)
    secret.updated_at = datetime.now(timezone.utc)
    session.add(secret)
    session.commit()
    session.refresh(secret)
    return secret


@router.delete("/{secret_id}", status_code=204)
async def delete_secret(
    secret_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    secret = session.get(Secret, secret_id)
    if not secret:
        raise HTTPException(status_code=404, detail="Secret not found")
    secret_name = secret.name
    session.delete(secret)
    log_activity(session, "secret.deleted", actor=current_user.username,
                 resource_type="secret", resource_id=secret_id, resource_name=secret_name)
    session.commit()
