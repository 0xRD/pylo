from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import Session, select, func

from backend.activity.logger import log_activity
from backend.core.auth import (
    AuthUser,
    MIN_PASSWORD_LEN,
    create_access_token,
    hash_password,
    verify_password,
    verify_token,
    _get_jwt_expire_hours,
    _decode_jwt,
)
from backend.database import get_session
from backend.users.models import User
from backend.users.invitation import Invitation

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "pylo_token"
COOKIE_KWARGS = dict(httponly=True, samesite="strict", secure=False)  # set secure=True behind HTTPS


class LoginBody(BaseModel):
    username: str
    password: str


class SetupBody(BaseModel):
    username: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class AcceptInviteBody(BaseModel):
    username: str
    password: str


def _user_count(session: Session) -> int:
    return session.exec(select(func.count()).select_from(User)).one()


def _set_session_cookie(response: Response, user: User, session: Session) -> None:
    expire_hours = _get_jwt_expire_hours(session)
    token = create_access_token(user.username, user.role, expire_hours)
    response.set_cookie(COOKIE_NAME, token, max_age=expire_hours * 3600, **COOKIE_KWARGS)


@router.get("/setup")
async def setup_status(session: Session = Depends(get_session)):
    return {"required": _user_count(session) == 0}


@router.post("/setup", status_code=201)
async def setup_first_admin(body: SetupBody, response: Response, session: Session = Depends(get_session)):
    if _user_count(session) > 0:
        raise HTTPException(status_code=403, detail="Setup already completed")
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    user = User(username=body.username, hashed_password=hash_password(body.password), role="admin")
    session.add(user)
    log_activity(session, "user.created", actor=body.username,
                 resource_type="user", resource_name=body.username,
                 detail={"role": "admin", "via": "setup"})
    log_activity(session, "auth.login", actor=body.username)
    session.commit()
    session.refresh(user)
    _set_session_cookie(response, user, session)
    return {"username": user.username, "role": user.role}


@router.post("/login")
async def login(body: LoginBody, response: Response, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not verify_password(body.password, user.hashed_password):
        log_activity(session, "auth.login_failed", actor=body.username)
        session.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    log_activity(session, "auth.login", actor=body.username)
    session.commit()
    _set_session_cookie(response, user, session)
    return {"username": user.username, "role": user.role}


@router.post("/logout")
async def logout(request: Request, response: Response, session: Session = Depends(get_session)):
    actor = "unknown"
    token = request.cookies.get(COOKIE_NAME)
    if token:
        payload = _decode_jwt(token)
        if payload:
            actor = payload.get("sub", "unknown")
    log_activity(session, "auth.logout", actor=actor)
    session.commit()
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
async def me(current_user: AuthUser = Depends(verify_token)):
    return {"username": current_user.username, "role": current_user.role}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody,
    current_user: AuthUser = Depends(verify_token),
    session: Session = Depends(get_session),
):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    user = session.exec(select(User).where(User.username == current_user.username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    user.hashed_password = hash_password(body.new_password)
    session.add(user)
    log_activity(session, "user.updated", actor=current_user.username,
                 resource_type="user", resource_name=current_user.username,
                 detail={"changed": "password"})
    session.commit()
    return {"ok": True}


@router.get("/invite/{token}")
async def validate_invite(token: str, session: Session = Depends(get_session)):
    inv = session.exec(select(Invitation).where(Invitation.token == token)).first()
    if not inv or not inv.is_valid:
        raise HTTPException(status_code=404, detail="Invitation not found or expired")
    return {"role": inv.role, "expires_at": inv.expires_at.isoformat()}


@router.post("/invite/{token}", status_code=201)
async def accept_invite(
    token: str,
    body: AcceptInviteBody,
    response: Response,
    session: Session = Depends(get_session),
):
    inv = session.exec(select(Invitation).where(Invitation.token == token)).first()
    if not inv or not inv.is_valid:
        raise HTTPException(status_code=404, detail="Invitation not found or expired")
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    existing = session.exec(select(User).where(User.username == body.username)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(username=body.username, hashed_password=hash_password(body.password), role=inv.role)
    session.add(user)

    inv.used_at = datetime.now(timezone.utc)
    inv.used_by = body.username
    session.add(inv)

    log_activity(session, "user.created", actor=inv.created_by,
                 resource_type="user", resource_name=body.username,
                 detail={"role": inv.role, "via": "invite"})
    log_activity(session, "invite.used", actor=body.username,
                 detail={"invited_by": inv.created_by, "role": inv.role})
    log_activity(session, "auth.login", actor=body.username)
    session.commit()
    session.refresh(user)

    _set_session_cookie(response, user, session)
    return {"username": user.username, "role": user.role}
