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
    trigger_conditions: str = Field(default="[]")
    polling_interval_seconds: Optional[int] = None
    fetch_cron: Optional[str] = None
    fetch_is_active: bool = Field(default=False)
    is_manual: bool = Field(default=False)
    pagination_type: str = Field(default="none")
    pagination_param: Optional[str] = None
    pagination_path: Optional[str] = None
    pagination_items_path: Optional[str] = None
    pagination_max_pages: int = Field(default=50)
    fetch_entry_limit: Optional[int] = None
    fetch_retry_count: int = Field(default=0, sa_column_kwargs={"server_default": "0"})
    fetch_retry_delay_seconds: int = Field(default=2, sa_column_kwargs={"server_default": "2"})
    fetch_on_fail_pybook_id: Optional[str] = None
    max_entries: Optional[int] = None
    retention_days: Optional[int] = None
    retention_minutes: Optional[int] = None
    mutable_mode: str = Field(default="none")
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


class EntryEvent(SQLModel, table=True):
    __tablename__ = "entry_event"

    id: str = Field(primary_key=True)
    entry_id: str = Field(index=True)
    blueprint_id: str = Field(index=True)
    event_type: str  # "created" | "updated"
    changed_fields: str = "[]"
    old_values: str = "{}"
    new_values: str = "{}"
    actor: str
    created_at: datetime = Field(default_factory=_now)
