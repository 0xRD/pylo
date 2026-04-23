from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ActivityEvent(SQLModel, table=True):
    __tablename__ = "activityevent"

    id: str = Field(primary_key=True)
    event_type: str = Field(index=True)
    category: str = Field(index=True)
    actor: str = Field(index=True)
    resource_type: Optional[str] = None
    resource_id: Optional[str] = Field(default=None, index=True)
    resource_name: Optional[str] = None
    detail: str = Field(default="{}")
    created_at: datetime = Field(default_factory=_now, index=True)
