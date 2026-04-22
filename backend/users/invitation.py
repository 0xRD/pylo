import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import SQLModel, Field


class Invitation(SQLModel, table=True):
    __tablename__ = "invitation"

    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(unique=True, index=True)
    role: str = Field(default="viewer")
    created_by: str
    expires_at: datetime
    used_at: Optional[datetime] = None
    used_by: Optional[str] = None

    @property
    def is_valid(self) -> bool:
        return self.used_at is None and datetime.now(timezone.utc) < self.expires_at.replace(tzinfo=timezone.utc)


def generate_token() -> str:
    return secrets.token_urlsafe(32)
