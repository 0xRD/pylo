import json
import logging
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlmodel import Session, select

from backend.database import engine
from backend.pybooks.models import PyBook, PyBookRun

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


def _parse_cron(expr: str):
    """Return CronTrigger kwargs from a 5-part cron expression, or None if invalid."""
    parts = expr.strip().split()
    if len(parts) != 5:
        return None
    minute, hour, day, month, day_of_week = parts
    return dict(minute=minute, hour=hour, day=day, month=month, day_of_week=day_of_week)


async def _run_cron_pybook(pybook_id: str):
    from backend.core import queue_manager

    with Session(engine) as session:
        pb = session.get(PyBook, pybook_id)
        if not pb or not pb.is_active:
            return
        now = datetime.now(timezone.utc)
        run = PyBookRun(
            id=str(uuid.uuid4()),
            pybook_id=pybook_id,
            status="queued",
            trigger_source="cron",
            trigger_payload="{}",
            started_at=now,
        )
        session.add(run)
        session.commit()

    queue_manager.enqueue(pybook_id, run.id)


async def _fetch_cron_blueprint(type_id: str):
    """Scheduled auto-fetch for an ObjectType."""
    from backend.api.blueprints import _do_fetch
    from backend.database import get_session_ctx

    try:
        with Session(engine) as session:
            result = await _do_fetch(type_id, session)
            logger.info("Cron fetch for Blueprint %s: %s", type_id, result)
    except Exception as exc:
        logger.error("Cron fetch failed for Blueprint %s: %s", type_id, exc)




async def _run_cron_workflow(workflow_id: str):
    import uuid as _uuid
    from datetime import datetime, timezone as _tz
    from backend.workflows.models import Workflow, WorkflowRun
    from backend.database import engine as _engine
    from sqlmodel import Session as _Session

    with _Session(_engine) as session:
        wf = session.get(Workflow, workflow_id)
        if not wf or not wf.is_active:
            return
        now = datetime.now(_tz.utc)
        wf_run = WorkflowRun(
            id=str(_uuid.uuid4()),
            workflow_id=workflow_id,
            status="pending",
            trigger_source="cron",
            started_at=now,
        )
        session.add(wf_run)
        session.commit()
        wf_run_id = wf_run.id

    from backend.workflows.executor import execute_workflow
    try:
        await execute_workflow(wf_run_id)
    except Exception as exc:
        logger.exception("Cron workflow run %s crashed: %s", wf_run_id, exc)

def sync_cron_jobs():
    """Rebuild all cron jobs from the database. Call on startup and after updates."""
    # ── PyBook cron jobs ──────────────────────────────────────────────────────
    with Session(engine) as session:
        pybooks = session.exec(
            select(PyBook).where(PyBook.trigger_type == "cron", PyBook.is_active == True)
        ).all()

    for job in scheduler.get_jobs():
        if job.id.startswith("cron_pb_"):
            job.remove()

    for pb in pybooks:
        try:
            config = json.loads(pb.trigger_config or "{}")
            cron_expr = config.get("cron", "")
            kwargs = _parse_cron(cron_expr)
            if not kwargs:
                logger.warning("Invalid cron for PyBook %s: %s", pb.id, cron_expr)
                continue
            scheduler.add_job(
                _run_cron_pybook, CronTrigger(**kwargs),
                args=[pb.id], id=f"cron_pb_{pb.id}",
                replace_existing=True, misfire_grace_time=60,
            )
            logger.info("Scheduled cron PyBook %s: %s", pb.name, cron_expr)
        except Exception as exc:
            logger.error("Failed to schedule PyBook %s: %s", pb.id, exc)

    # ── ObjectType fetch cron jobs ────────────────────────────────────────────
    from backend.objects.models import Blueprint

    with Session(engine) as session:
        blueprints = session.exec(
            select(Blueprint).where(
                Blueprint.fetch_cron != None,
                Blueprint.fetch_is_active == True,
            )
        ).all()

    for job in scheduler.get_jobs():
        if job.id.startswith("cron_obj_"):
            job.remove()

    for ot in blueprints:
        kwargs = _parse_cron(ot.fetch_cron)
        if not kwargs:
            logger.warning("Invalid fetch_cron for Blueprint %s: %s", ot.id, ot.fetch_cron)
            continue
        scheduler.add_job(
            _fetch_cron_blueprint, CronTrigger(**kwargs),
            args=[ot.id], id=f"cron_obj_{ot.id}",
            replace_existing=True, misfire_grace_time=60,
        )
        logger.info("Scheduled cron fetch Blueprint %s: %s", ot.name, ot.fetch_cron)

    # ── Workflow cron jobs ────────────────────────────────────────────────────
    from backend.workflows.models import Workflow

    with Session(engine) as session:
        workflows = session.exec(
            select(Workflow).where(Workflow.trigger_type == "cron", Workflow.is_active == True)
        ).all()

    for job in scheduler.get_jobs():
        if job.id.startswith("cron_wf_"):
            job.remove()

    for wf in workflows:
        try:
            config = json.loads(wf.trigger_config or "{}")
            cron_expr = config.get("cron", "")
            kwargs = _parse_cron(cron_expr)
            if not kwargs:
                logger.warning("Invalid cron for Workflow %s: %s", wf.id, cron_expr)
                continue
            scheduler.add_job(
                _run_cron_workflow, CronTrigger(**kwargs),
                args=[wf.id], id=f"cron_wf_{wf.id}",
                replace_existing=True, misfire_grace_time=60,
            )
            logger.info("Scheduled cron Workflow %s: %s", wf.name, cron_expr)
        except Exception as exc:
            logger.error("Failed to schedule Workflow %s: %s", wf.id, exc)


async def _cleanup_activity_log():
    from backend.api.settings import get_setting
    from backend.activity.models import ActivityEvent
    from datetime import timedelta

    with Session(engine) as session:
        retention_raw = get_setting(session, "activity_retention_days")
        days = int(retention_raw or 7)
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        events = session.exec(
            select(ActivityEvent).where(ActivityEvent.created_at < cutoff)
        ).all()
        for ev in events:
            session.delete(ev)
        session.commit()
        if events:
            logger.info("Activity log cleanup: deleted %d events older than %d days", len(events), days)


async def _run_auto_backup():
    """Scheduled auto-backup job: saves a ZIP to disk and prunes old files."""
    from backend.api.export_import import save_backup_to_disk, prune_old_backups
    from backend.api.settings import get_setting
    from backend.activity.logger import log_activity

    try:
        with Session(engine) as session:
            filename = save_backup_to_disk(session)
            retention = int(get_setting(session, "backup_retention") or 7)
            prune_old_backups(retention)
            log_activity(session, "backup.saved", actor="scheduler",
                         detail={"filename": filename, "trigger": "auto"})
            session.commit()
        logger.info("Auto-backup saved: %s", filename)
    except Exception as exc:
        logger.error("Auto-backup failed: %s", exc)


def sync_backup_job():
    """Add, update, or remove the auto-backup APScheduler job based on current settings."""
    from backend.api.settings import get_setting

    JOB_ID = "auto_backup"
    for job in scheduler.get_jobs():
        if job.id == JOB_ID:
            job.remove()

    with Session(engine) as session:
        cron_expr = get_setting(session, "backup_cron") or ""

    if not cron_expr.strip():
        logger.info("Auto-backup: disabled (no cron expression set)")
        return

    kwargs = _parse_cron(cron_expr)
    if not kwargs:
        logger.warning("Auto-backup: invalid cron expression '%s', job not scheduled", cron_expr)
        return

    scheduler.add_job(
        _run_auto_backup, CronTrigger(**kwargs),
        id=JOB_ID, replace_existing=True, misfire_grace_time=3600,
    )
    logger.info("Auto-backup scheduled: %s", cron_expr)


def start_scheduler():
    sync_cron_jobs()
    sync_backup_job()
    scheduler.add_job(
        _cleanup_activity_log, "cron",
        hour=3, minute=0, id="cleanup_activity_log",
        replace_existing=True, misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("APScheduler started")


def stop_scheduler():
    scheduler.shutdown(wait=False)
