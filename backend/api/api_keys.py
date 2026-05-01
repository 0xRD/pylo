import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, VALID_API_KEY_SCOPES, create_api_key_token, hash_api_key, require_admin, verify_token
from backend.database import get_session
from backend.users.models import ApiKey

router = APIRouter(prefix="/api/api-keys", tags=["api_keys"], dependencies=[Depends(verify_token)])


class ApiKeyCreate(BaseModel):
    name: str
    scopes: list[str]


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    scopes: list[str]
    is_active: bool
    created_at: datetime
    last_used_at: datetime | None = None


class ApiKeyCreated(ApiKeyResponse):
    token: str


def _scopes(raw: str) -> list[str]:
    try:
        values = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [s for s in values if s in VALID_API_KEY_SCOPES]


def _serialize(api_key: ApiKey) -> dict:
    return {
        "id": api_key.id,
        "name": api_key.name,
        "scopes": _scopes(api_key.scopes),
        "is_active": api_key.is_active,
        "created_at": api_key.created_at,
        "last_used_at": api_key.last_used_at,
    }


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(session: Session = Depends(get_session), _: AuthUser = Depends(require_admin)):
    keys = session.exec(select(ApiKey).order_by(ApiKey.created_at.desc())).all()
    return [_serialize(k) for k in keys]


@router.post("", response_model=ApiKeyCreated, status_code=201)
async def create_api_key(
    body: ApiKeyCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="API key name is required")
    scopes = sorted(set(body.scopes) & VALID_API_KEY_SCOPES)
    if not scopes:
        raise HTTPException(status_code=422, detail="At least one valid scope is required")

    token = create_api_key_token()
    api_key = ApiKey(name=name, key_hash=hash_api_key(token), scopes=json.dumps(scopes))
    session.add(api_key)
    session.commit()
    session.refresh(api_key)
    log_activity(session, "api_key.created", actor=current_user.username,
                 resource_type="api_key", resource_id=str(api_key.id), resource_name=name,
                 detail={"scopes": scopes})
    session.commit()
    return {**_serialize(api_key), "token": token}


@router.delete("/{api_key_id}", status_code=204)
async def revoke_api_key(
    api_key_id: int,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    api_key = session.get(ApiKey, api_key_id)
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.is_active = False
    session.add(api_key)
    log_activity(session, "api_key.revoked", actor=current_user.username,
                 resource_type="api_key", resource_id=str(api_key.id), resource_name=api_key.name)
    session.commit()
