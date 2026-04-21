from typing import Optional
from sqlmodel import SQLModel, Field


class SystemSetting(SQLModel, table=True):
    __tablename__ = "system_setting"
    key: str = Field(primary_key=True)
    value: str
