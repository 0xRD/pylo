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
        session.refresh(run)
        await _execute_run(pb, run, session)


def sync_cron_jobs():
    """Rebuild all cron jobs from the database. Call on startup and after PyBook updates."""
    with Session(engine) as session:
        pybooks = session.exec(
            select(PyBook).where(PyBook.trigger_type == "cron", PyBook.is_active == True)
        ).all()

    # Remove all existing pybook cron jobs
    for job in scheduler.get_jobs():
        if job.id.startswith("cron_"):
            job.remove()

    for pb in pybooks:
        try:
            config = json.loads(pb.trigger_config or "{}")
            cron_expr = config.get("cron", "")
            if not cron_expr:
                continue
            parts = cron_expr.strip().split()
            if len(parts) != 5:
                logger.warning("Invalid cron expression for PyBook %s: %s", pb.id, cron_expr)
                continue
            minute, hour, day, month, day_of_week = parts
            scheduler.add_job(
                _run_cron_pybook,
                CronTrigger(
                    minute=minute, hour=hour,
                    day=day, month=month, day_of_week=day_of_week,
                ),
                args=[pb.id],
                id=f"cron_{pb.id}",
                replace_existing=True,
                misfire_grace_time=60,
            )
            logger.info("Scheduled cron job for PyBook %s: %s", pb.name, cron_expr)
        except Exception as exc:
            logger.error("Failed to schedule PyBook %s: %s", pb.id, exc)


def start_scheduler():
    sync_cron_jobs()
    scheduler.start()
    logger.info("APScheduler started")


def stop_scheduler():
    scheduler.shutdown(wait=False)
