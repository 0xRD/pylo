from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, MIN_PASSWORD_LEN, VALID_ROLES, hash_password, require_admin, verify_token
from backend.database import get_session
from backend.users.models import User

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(verify_token)])


def _serialize(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat(),
    }


@router.get("")
async def list_users(session: Session = Depends(get_session), _: AuthUser = Depends(require_admin)):
    users = session.exec(select(User).order_by(User.created_at)).all()
    return [_serialize(u) for u in users]


class CreateUserBody(BaseModel):
    username: str
    password: str
    role: str = "viewer"


@router.post("", status_code=201)
async def create_user(
    body: CreateUserBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Role must be 'admin' or 'viewer'")
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    existing = session.exec(select(User).where(User.username == body.username)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(username=body.username, hashed_password=hash_password(body.password), role=body.role)
    session.add(user)
    log_activity(session, "user.created", actor=current_user.username,
                 resource_type="user", resource_name=body.username,
                 detail={"role": body.role})
    session.commit()
    session.refresh(user)
    return _serialize(user)


class UpdateUserBody(BaseModel):
    role: str | None = None
    password: str | None = None
    is_active: bool | None = None


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    body: UpdateUserBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    changed = {}
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=422, detail="Role must be 'admin' or 'viewer'")
        user.role = body.role
        changed["role"] = body.role
    if body.password is not None:
        if len(body.password) < MIN_PASSWORD_LEN:
            raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
        user.hashed_password = hash_password(body.password)
        changed["password"] = True
    if body.is_active is not None:
        user.is_active = body.is_active
        changed["is_active"] = body.is_active
    session.add(user)
    log_activity(session, "user.updated", actor=current_user.username,
                 resource_type="user", resource_name=user.username,
                 detail={"changed": list(changed.keys())})
    session.commit()
    session.refresh(user)
    return _serialize(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == current_user.username:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    username = user.username
    session.delete(user)
    log_activity(session, "user.deleted", actor=current_user.username,
                 resource_type="user", resource_name=username)
    session.commit()
