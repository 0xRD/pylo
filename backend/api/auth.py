from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import Session, select, func

from backend.core.auth import (
    AuthUser,
    create_access_token,
    hash_password,
    verify_password,
    verify_token,
    _get_jwt_expire_hours,
)
from backend.database import get_session
from backend.users.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "pylo_token"
COOKIE_KWARGS = dict(httponly=True, samesite="strict", secure=False)  # set secure=True behind HTTPS


class LoginBody(BaseModel):
    username: str
    password: str


class SetupBody(BaseModel):
    username: str
    password: str


def _user_count(session: Session) -> int:
    return session.exec(select(func.count()).select_from(User)).one()


@router.get("/setup")
async def setup_status(session: Session = Depends(get_session)):
    return {"required": _user_count(session) == 0}


@router.post("/setup", status_code=201)
async def setup_first_admin(body: SetupBody, response: Response, session: Session = Depends(get_session)):
    if _user_count(session) > 0:
        raise HTTPException(status_code=403, detail="Setup already completed")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    user = User(username=body.username, hashed_password=hash_password(body.password), role="admin")
    session.add(user)
    session.commit()
    session.refresh(user)

    expire_hours = _get_jwt_expire_hours(session)
    token = create_access_token(user.username, user.role, expire_hours)
    response.set_cookie(COOKIE_NAME, token, max_age=expire_hours * 3600, **COOKIE_KWARGS)
    return {"username": user.username, "role": user.role}


@router.post("/login")
async def login(body: LoginBody, response: Response, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    expire_hours = _get_jwt_expire_hours(session)
    token = create_access_token(user.username, user.role, expire_hours)
    response.set_cookie(COOKIE_NAME, token, max_age=expire_hours * 3600, **COOKIE_KWARGS)
    return {"username": user.username, "role": user.role}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
async def me(current_user: AuthUser = Depends(verify_token)):
    return {"username": current_user.username, "role": current_user.role}
