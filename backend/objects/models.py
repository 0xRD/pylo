from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Blueprint(SQLModel, table=True):
    __tablename__ = "blueprint"

    id: str = Field(primary_key=True)
    name: str
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_method: str = "GET"
    source_headers: str = "{}"
    source_body: str = "{}"
    field_mappings: str = "[]"
    trigger_pybook_id: Optional[str] = None
    trigger_event: str = Field(default="on_create")
    polling_interval_seconds: Optional[int] = None
    fetch_cron: Optional[str] = None
    fetch_is_active: bool = Field(default=False)
    is_manual: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_now)


class Entry(SQLModel, table=True):
    __tablename__ = "entry"

    id: str = Field(primary_key=True)
    blueprint_id: str = Field(index=True)
    external_id: Optional[str] = None
    data: str = "{}"
    raw_data: str = "{}"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
# trigger_event added via migration
