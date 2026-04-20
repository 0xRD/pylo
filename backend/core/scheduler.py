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
    from backend.api.pybooks import _execute_run

    with Session(engine) as session:
        pb = session.get(PyBook, pybook_id)
        if not pb or not pb.is_active:
            return
        now = datetime.now(timezone.utc)
        run = PyBookRun(
            id=str(uuid.uuid4()),
            pybook_id=pybook_id,
            status="pending",
            trigger_source="cron",
            trigger_payload="{}",
            started_at=now,
        )
        session.add(run)
        session.commit()

    await _execute_run(pybook_id, run.id)


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


def start_scheduler():
    sync_cron_jobs()
    scheduler.start()
    logger.info("APScheduler started")


def stop_scheduler():
    scheduler.shutdown(wait=False)
