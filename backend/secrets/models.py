from datetime import datetime, timezone
from typing import Optional
from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Secret(SQLModel, table=True):
    __tablename__ = "secret"

    id: str = Field(primary_key=True)
    name: str = Field(unique=True, index=True)   # e.g. "virustotal_api_key"
    description: Optional[str] = None
    encrypted_value: str                          # Fernet-encrypted, never returned by API
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
