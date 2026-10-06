from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PyBook(SQLModel, table=True):
    __tablename__ = "pybook"

    id: str = Field(primary_key=True)
    name: str
    description: Optional[str] = None
    script: str = ""
    is_sub_pybook: bool = False
    dependencies: str = "[]"
    trigger_type: str = "manual"      # "manual" | "cron" | "webhook" | "object_event"
    trigger_config: str = "{}"
    is_active: bool = True
    docker_image_tag: Optional[str] = None
    required_secrets: str = "[]"      # JSON list of secret names to inject as env vars
    tags: str = "[]"                  # JSON list of tag strings
    network_policy: str = "default"   # "default" | "none" | "allowlisted"
    allowed_hosts: str = "[]"         # JSON list of hostnames for allowlisted policy
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class PyBookRun(SQLModel, table=True):
    __tablename__ = "pybook_run"

    id: str = Field(primary_key=True)
    pybook_id: str = Field(index=True)
    # statuses: queued | pending | running | success | error | timeout | cancelled | dead_letter
    status: str = Field(default="pending", index=True)
    trigger_source: str               # "manual" | "cron" | "webhook" | "object_event" | "sub_pybook"
    trigger_payload: str = "{}"
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    started_at: datetime = Field(default_factory=_now, index=True)
    ended_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    output_vars: str = "{}"           # JSON dict populated by pylo.set_output()
    retry_count: int = Field(default=0, sa_column_kwargs={"server_default": "0"})
    max_retries: int = Field(default=0, sa_column_kwargs={"server_default": "0"})
    script_version: Optional[int] = None  # PyBookVersion.version that executed


class PyBookVersion(SQLModel, table=True):
    """Immutable snapshot of a PyBook script, recorded whenever it changes."""
    __tablename__ = "pybook_version"

    id: str = Field(primary_key=True)
    pybook_id: str = Field(index=True)
    version: int                       # 1, 2, 3… per PyBook
    script: str = ""
    message: str = ""
    author: str = "system"
    additions: int = 0                 # lines added vs. the previous version
    deletions: int = 0                 # lines removed vs. the previous version
    created_at: datetime = Field(default_factory=_now, index=True)
