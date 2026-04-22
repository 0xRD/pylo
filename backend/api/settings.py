from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core.auth import require_admin, verify_token
from backend.core.settings_model import SystemSetting
from backend.database import get_session

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(verify_token)])

DEFAULTS = {
    "max_concurrent_runs": "5",
    "jwt_expire_hours": None,  # falls back to JWT_EXPIRE_HOURS env
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
    jwt_hours_raw = get_setting(session, "jwt_expire_hours")
    stats = queue_manager.get_stats()
    return {
        "max_concurrent_runs": int(max_runs or cfg.PYLO_MAX_CONCURRENT_RUNS),
        "jwt_expire_hours": int(jwt_hours_raw) if jwt_hours_raw else cfg.JWT_EXPIRE_HOURS,
        **stats,
    }


class SettingsUpdate(BaseModel):
    max_concurrent_runs: int | None = None
    jwt_expire_hours: int | None = None


@router.put("")
async def update_settings(
    body: SettingsUpdate,
    session: Session = Depends(get_session),
    _=Depends(require_admin),
):
    from backend.core import queue_manager
    result = {}
    if body.max_concurrent_runs is not None:
        limit = max(1, min(body.max_concurrent_runs, 50))
        set_setting(session, "max_concurrent_runs", str(limit))
        queue_manager.update_limit(limit)
        result["max_concurrent_runs"] = limit
    if body.jwt_expire_hours is not None:
        hours = max(1, min(body.jwt_expire_hours, 720))
        set_setting(session, "jwt_expire_hours", str(hours))
        result["jwt_expire_hours"] = hours
    return result
