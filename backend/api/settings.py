from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core.auth import verify_token
from backend.core.settings_model import SystemSetting
from backend.database import get_session

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(verify_token)])

DEFAULTS = {
    "max_concurrent_runs": "5",
}


def get_setting(session: Session, key: str) -> str:
    row = session.get(SystemSetting, key)
    return row.value if row else DEFAULTS.get(key, "")


def set_setting(session: Session, key: str, value: str) -> None:
    row = session.get(SystemSetting, key)
    if row:
        row.value = value
    else:
        row = SystemSetting(key=key, value=value)
    session.add(row)
    session.commit()


@router.get("")
async def get_settings(session: Session = Depends(get_session)):
    from backend.config import settings as cfg
    from backend.core import queue_manager
    max_runs = get_setting(session, "max_concurrent_runs")
    stats = queue_manager.get_stats()
    return {
        "max_concurrent_runs": int(max_runs or cfg.PYLO_MAX_CONCURRENT_RUNS),
        **stats,
    }


class SettingsUpdate(BaseModel):
    max_concurrent_runs: int


@router.put("")
async def update_settings(body: SettingsUpdate, session: Session = Depends(get_session)):
    from backend.core import queue_manager
    limit = max(1, min(body.max_concurrent_runs, 50))
    set_setting(session, "max_concurrent_runs", str(limit))
    queue_manager.update_limit(limit)
    return {"max_concurrent_runs": limit}
