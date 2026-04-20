from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ObjectType(SQLModel, table=True):
    __tablename__ = "object_type"

    id: str = Field(primary_key=True)
    name: str
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_method: str = "GET"
    source_headers: str = "{}"
    source_body: str = "{}"
    field_mappings: str = "[]"
    trigger_pybook_id: Optional[str] = None
    polling_interval_seconds: Optional[int] = None
    created_at: datetime = Field(default_factory=_now)


class ObjectInstance(SQLModel, table=True):
    __tablename__ = "object_instance"

    id: str = Field(primary_key=True)
    object_type_id: str = Field(index=True)
    external_id: Optional[str] = None
    data: str = "{}"
    raw_data: str = "{}"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
