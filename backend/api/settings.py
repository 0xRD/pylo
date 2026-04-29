from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, require_admin, verify_token
from backend.core.settings_model import SystemSetting
from backend.database import get_session

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(verify_token)])

DEFAULTS = {
    "max_concurrent_runs": "5",
    "jwt_expire_hours": None,  # falls back to JWT_EXPIRE_HOURS env
    "activity_retention_days": "7",
    "backup_cron": "",          # empty = auto-backup disabled
    "backup_retention": "7",    # number of auto-backup files to keep
    # GitOps settings (managed via /api/gitops/config, read here for convenience)
    "environment": "dev",
    "git_repo_url": "",
    "git_branch": "main",
    "git_token_enc": "",
    "git_committer_name": "Pylo",
    "git_committer_email": "pylo@localhost",
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
    retention_raw = get_setting(session, "activity_retention_days")
    backup_cron = get_setting(session, "backup_cron")
    backup_retention_raw = get_setting(session, "backup_retention")
    stats = queue_manager.get_stats()
    return {
        "max_concurrent_runs": int(max_runs or cfg.PYLO_MAX_CONCURRENT_RUNS),
        "jwt_expire_hours": int(jwt_hours_raw) if jwt_hours_raw else cfg.JWT_EXPIRE_HOURS,
        "activity_retention_days": int(retention_raw or 7),
        "backup_cron": backup_cron or "",
        "backup_retention": int(backup_retention_raw or 7),
        **stats,
    }


class SettingsUpdate(BaseModel):
    max_concurrent_runs: int | None = None
    jwt_expire_hours: int | None = None
    activity_retention_days: int | None = None
    backup_cron: str | None = None
    backup_retention: int | None = None


@router.put("")
async def update_settings(
    body: SettingsUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
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
    if body.activity_retention_days is not None:
        days = max(1, min(body.activity_retention_days, 365))
        set_setting(session, "activity_retention_days", str(days))
        result["activity_retention_days"] = days
    if body.backup_cron is not None:
        set_setting(session, "backup_cron", body.backup_cron.strip())
        result["backup_cron"] = body.backup_cron.strip()
        # Re-sync the auto-backup scheduler job
        from backend.core.scheduler import sync_backup_job
        sync_backup_job()
    if body.backup_retention is not None:
        retention = max(1, min(body.backup_retention, 365))
        set_setting(session, "backup_retention", str(retention))
        result["backup_retention"] = retention
    if result:
        log_activity(session, "settings.updated", actor=current_user.username,
                     detail={"changed": list(result.keys())})
        session.commit()
    return result
