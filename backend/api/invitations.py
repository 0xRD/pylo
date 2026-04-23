from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, VALID_ROLES, require_admin, verify_token
from backend.database import get_session
from backend.users.invitation import Invitation, generate_token

router = APIRouter(prefix="/api/invitations", tags=["invitations"], dependencies=[Depends(verify_token)])

INVITE_EXPIRE_HOURS = 24


def _serialize(inv: Invitation) -> dict:
    return {
        "id": inv.id,
        "token": inv.token,
        "role": inv.role,
        "created_by": inv.created_by,
        "expires_at": inv.expires_at.isoformat(),
        "used_at": inv.used_at.isoformat() if inv.used_at else None,
        "used_by": inv.used_by,
        "is_valid": inv.is_valid,
    }


@router.get("")
async def list_invitations(
    session: Session = Depends(get_session),
    _: AuthUser = Depends(require_admin),
):
    invitations = session.exec(select(Invitation).order_by(Invitation.id.desc())).all()
    return [_serialize(i) for i in invitations]


class CreateInvitationBody(BaseModel):
    role: str = "viewer"


@router.post("", status_code=201)
async def create_invitation(
    body: CreateInvitationBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Role must be 'admin' or 'viewer'")

    inv = Invitation(
        token=generate_token(),
        role=body.role,
        created_by=current_user.username,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=INVITE_EXPIRE_HOURS),
    )
    session.add(inv)
    log_activity(session, "invite.created", actor=current_user.username,
                 detail={"role": body.role})
    session.commit()
    session.refresh(inv)
    return _serialize(inv)


@router.delete("/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: int,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    inv = session.get(Invitation, invitation_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    session.delete(inv)
    log_activity(session, "invite.revoked", actor=current_user.username,
                 detail={"role": inv.role, "intended_for": inv.used_by})
    session.commit()
