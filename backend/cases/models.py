from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Case(SQLModel, table=True):
    __tablename__ = "cases"

    id: str = Field(primary_key=True)
    title: str
    description: Optional[str] = None
    status: str = "open"       # open | in_progress | resolved | closed
    severity: str = "medium"   # low | medium | high | critical
    assignee: Optional[str] = None
    created_by: str
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class CaseComment(SQLModel, table=True):
    __tablename__ = "case_comment"

    id: str = Field(primary_key=True)
    case_id: str = Field(index=True)
    author: str
    body: str
    created_at: datetime = Field(default_factory=_now)


class CaseLink(SQLModel, table=True):
    __tablename__ = "case_link"

    id: str = Field(primary_key=True)
    case_id: str = Field(index=True)
    link_type: str          # "entry" | "pybook_run" | "workflow_run"
    link_id: str
    label: Optional[str] = None   # human-readable label set at creation
    created_at: datetime = Field(default_factory=_now)
