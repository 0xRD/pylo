"""
Persistent PyBook execution queue.

Runs are persisted as status='queued' before any worker picks them up.
A single asyncio worker drains the queue, gated by a semaphore equal to
PYLO_MAX_CONCURRENT_RUNS. On startup, any runs left in 'queued' or
'pending' state are automatically re-enqueued.
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_queue: Optional[asyncio.Queue] = None
_semaphore: Optional[asyncio.Semaphore] = None
_worker_task: Optional[asyncio.Task] = None
_running_count: int = 0
_current_limit: int = 0  # tracks the live semaphore capacity


def _get_max() -> int:
    from backend.config import settings
    return settings.PYLO_MAX_CONCURRENT_RUNS


def get_stats() -> dict:
    return {
        "queued": _queue.qsize() if _queue else 0,
        "running": _running_count,
        "max_concurrent": _current_limit,
    }


def update_limit(new_limit: int) -> None:
    """Resize the concurrency limit. Takes effect for future semaphore acquisitions."""
    global _semaphore, _current_limit
    if _semaphore is None:
        return
    # Add permits if increasing; decreases are enforced passively —
    # no new tasks start until running count drops below new_limit.
    diff = new_limit - _current_limit
    if diff > 0:
        for _ in range(diff):
            _semaphore.release()
    _current_limit = new_limit


def enqueue(pybook_id: str, run_id: str) -> None:
    if _queue is None:
        logger.warning("Queue not started — run %s dropped", run_id)
        return
    _queue.put_nowait((pybook_id, run_id))
    logger.debug("Enqueued run %s (queue depth now %d)", run_id, _queue.qsize())


async def _execute_with_semaphore(pybook_id: str, run_id: str) -> None:
    global _running_count
    from backend.api.pybooks import _execute_run
    _running_count += 1
    try:
        await _execute_run(pybook_id, run_id)
    except Exception as exc:
        logger.exception("Unhandled error executing run %s: %s", run_id, exc)
    finally:
        _running_count -= 1
        _semaphore.release()


async def _worker() -> None:
    logger.info("PyBook queue worker started (max_concurrent=%d)", _current_limit)
    while True:
        try:
            pybook_id, run_id = await _queue.get()
            await _semaphore.acquire()
            asyncio.create_task(_execute_with_semaphore(pybook_id, run_id))
            _queue.task_done()
        except asyncio.CancelledError:
            logger.info("Queue worker shutting down")
            break
        except Exception as exc:
            logger.exception("Queue worker error: %s", exc)


async def start() -> None:
    global _queue, _semaphore, _worker_task, _current_limit
    from sqlmodel import Session, select
    from backend.database import engine
    from backend.pybooks.models import PyBookRun
    from backend.core.settings_model import SystemSetting

    # Prefer the persisted DB setting over the env var default
    with Session(engine) as session:
        row = session.get(SystemSetting, "max_concurrent_runs")
        max_concurrent = int(row.value) if row else _get_max()

        # Runs left in queued/pending state can be safely re-queued
        orphans = session.exec(
            select(PyBookRun).where(PyBookRun.status.in_(["queued", "pending"]))
        ).all()
        orphan_ids = [(r.pybook_id, r.id) for r in orphans]

        # Runs stuck in running state were interrupted by a restart — mark as error
        from datetime import datetime, timezone as tz
        now = datetime.now(tz.utc)
        stranded = session.exec(
            select(PyBookRun).where(PyBookRun.status == "running")
        ).all()
        for run in stranded:
            run.status = "error"
            run.ended_at = now
            run.stderr = (run.stderr or "") + "
[Interrupted: backend restarted while run was active]"
            if run.exit_code is None:
                run.exit_code = -1
            session.add(run)
        if stranded:
            session.commit()
            logger.warning("Reset %d stranded runs to error after restart", len(stranded))

    _current_limit = max_concurrent
    _queue = asyncio.Queue()
    _semaphore = asyncio.Semaphore(max_concurrent)
    _worker_task = asyncio.create_task(_worker())

    # Recover runs stuck in queued/pending state from before last restart
    for pybook_id, run_id in orphan_ids:
        _queue.put_nowait((pybook_id, run_id))
    if orphan_ids:
        logger.info("Recovered %d orphaned runs from DB", len(orphan_ids))


def stop() -> None:
    if _worker_task:
        _worker_task.cancel()
