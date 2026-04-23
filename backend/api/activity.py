import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlmodel import Session, func, select

from backend.activity.models import ActivityEvent
from backend.core.auth import verify_token
from backend.database import get_session

router = APIRouter(prefix="/api/activity", tags=["activity"], dependencies=[Depends(verify_token)])


def _serialize(e: ActivityEvent) -> dict:
    return {
        "id": e.id,
        "event_type": e.event_type,
        "category": e.category,
        "actor": e.actor,
        "resource_type": e.resource_type,
        "resource_id": e.resource_id,
        "resource_name": e.resource_name,
        "detail": json.loads(e.detail or "{}"),
        "created_at": e.created_at.isoformat() + "Z",
    }


def _apply_filters(stmt, event_type, category, actor, resource_id, resource_name, from_, to):
    if event_type:
        stmt = stmt.where(ActivityEvent.event_type == event_type)
    if category:
        stmt = stmt.where(ActivityEvent.category == category)
    if actor:
        stmt = stmt.where(ActivityEvent.actor == actor)
    if resource_id:
        stmt = stmt.where(ActivityEvent.resource_id == resource_id)
    if resource_name:
        stmt = stmt.where(ActivityEvent.resource_name.ilike(f"%{resource_name}%"))
    if from_:
        stmt = stmt.where(ActivityEvent.created_at >= from_)
    if to:
        stmt = stmt.where(ActivityEvent.created_at <= to)
    return stmt


@router.get("")
async def list_activity(
    event_type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    actor: Optional[str] = Query(None),
    resource_id: Optional[str] = Query(None),
    resource_name: Optional[str] = Query(None),
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    def _utc(dt):
        if dt and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    from_ = _utc(from_)
    to = _utc(to)

    base = _apply_filters(select(ActivityEvent), event_type, category, actor, resource_id, resource_name, from_, to)
    count = _apply_filters(
        select(func.count(ActivityEvent.id)), event_type, category, actor, resource_id, resource_name, from_, to
    )

    total = session.exec(count).one()
    items = session.exec(base.order_by(desc(ActivityEvent.created_at)).offset(offset).limit(limit)).all()

    return {"items": [_serialize(e) for e in items], "total": total}
