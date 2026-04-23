import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session

logger = logging.getLogger(__name__)


def _category(event_type: str) -> str:
    return event_type.split(".")[0]


def log_activity(
    session: Session,
    event_type: str,
    actor: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    resource_name: Optional[str] = None,
    detail: Optional[dict] = None,
) -> None:
    from backend.activity.models import ActivityEvent
    try:
        event = ActivityEvent(
            id=str(uuid.uuid4()),
            event_type=event_type,
            category=_category(event_type),
            actor=actor,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            resource_name=resource_name,
            detail=json.dumps(detail or {}),
            created_at=datetime.now(timezone.utc),
        )
        session.add(event)
    except Exception as exc:
        logger.warning("Failed to log activity %s: %s", event_type, exc)
