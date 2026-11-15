"""
Persistent execution queue for PyBook and Workflow runs.

Runs are persisted as status='queued' before any worker picks them up.
A single asyncio worker drains the queue. On startup, any runs left in
'queued' or 'pending' state are re-enqueued, and runs stranded in 'running'
by a restart are marked as error.

Concurrency: one slot = one PyBook container. Standalone PyBook runs take a
slot before they start; a workflow run is only orchestration (no container),
so it takes no slot itself and each of its PyBook nodes takes one through
``container_slot()``. The live "max concurrent runs" setting is therefore the
real ceiling on containers running at the same time, however they were started.

Jobs are tagged by kind: ("pybook", pybook_id, run_id) or
("workflow", workflow_run_id, "").
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

logger = logging.getLogger(__name__)

_queue: Optional[asyncio.Queue] = None
_limit_condition: Optional[asyncio.Condition] = None
_worker_task: Optional[asyncio.Task] = None
_running_count: int = 0
_current_limit: int = 0
_waiting_count: int = 0
# asyncio only keeps weak references to tasks: hold them until they finish.
_active_tasks: set[asyncio.Task] = set()


def _get_max() -> int:
    from backend.config import settings
    return settings.PYLO_MAX_CONCURRENT_RUNS


def get_stats() -> dict:
    return {
        "queued": (_queue.qsize() if _queue else 0) + _waiting_count,
        "running": _running_count,
        "max_concurrent": _current_limit,
    }


def update_limit(new_limit: int) -> None:
    """Resize the concurrency limit. Takes effect before starting new runs."""
    global _current_limit
    _current_limit = max(1, new_limit)
    if _limit_condition is None:
        return

    async def _wake_waiters() -> None:
        async with _limit_condition:
            _limit_condition.notify_all()

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_wake_waiters())


async def _reserve_slot() -> None:
    global _running_count, _waiting_count
    async with _limit_condition:
        _waiting_count += 1
        try:
            await _limit_condition.wait_for(lambda: _running_count < _current_limit)
        finally:
            _waiting_count -= 1
        _running_count += 1


@asynccontextmanager
async def container_slot():
    """Hold one concurrency slot for the duration of a container run.

    Used by workflow nodes. Falls back to no limit when the queue manager is
    not running (unit tests that drive the executor directly).
    """
    if _limit_condition is None:
        yield
        return
    await _reserve_slot()
    try:
        yield
    finally:
        await _release_slot()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _active_tasks.add(task)
    task.add_done_callback(_active_tasks.discard)


def _fail_run(model, run_id: str, message: str) -> None:
    """Last-resort bookkeeping so a crashed job never leaves a run stuck as active."""
    from datetime import datetime, timezone
    from sqlmodel import Session
    from backend.database import engine

    try:
        with Session(engine) as session:
            run = session.get(model, run_id)
            if run and run.status in ("queued", "pending", "running"):
                run.status = "error"
                run.ended_at = datetime.now(timezone.utc)
                if hasattr(run, "stderr"):
                    run.stderr = ((run.stderr or "") + f"\n[Internal error: {message}]").lstrip("\n")
                    if run.exit_code is None:
                        run.exit_code = -1
                session.add(run)
                session.commit()
    except Exception:
        logger.exception("Could not mark run %s as failed", run_id)


async def _release_slot() -> None:
    global _running_count
    async with _limit_condition:
        _running_count -= 1
        _limit_condition.notify_all()


def _put(job: tuple) -> None:
    if _queue is None:
        logger.warning("Queue not started - job %r dropped", job)
        return
    _queue.put_nowait(job)
    logger.debug("Enqueued %r (queue depth now %d)", job, _queue.qsize())


def enqueue(pybook_id: str, run_id: str) -> None:
    """Enqueue a PyBook run (already persisted as status='queued')."""
    _put(("pybook", pybook_id, run_id))


def enqueue_workflow(workflow_run_id: str) -> None:
    """Enqueue a Workflow run (already persisted as status='queued')."""
    _put(("workflow", workflow_run_id, ""))


def _mark_pending(model, run_id: str) -> None:
    from sqlmodel import Session
    from backend.database import engine

    with Session(engine) as session:
        run = session.get(model, run_id)
        if run and run.status == "queued":
            run.status = "pending"
            session.add(run)
            session.commit()


async def _run_pybook_job(pybook_id: str, run_id: str) -> None:
    from backend.api.pybooks import _execute_run
    from backend.pybooks.models import PyBookRun
    try:
        await _execute_run(pybook_id, run_id)
    except Exception as exc:
        logger.exception("Unhandled error executing run %s: %s", run_id, exc)
        _fail_run(PyBookRun, run_id, str(exc))
    finally:
        await _release_slot()
    from backend.core.notifications import notify_pybook_run
    await notify_pybook_run(run_id)


async def _run_workflow_job(workflow_run_id: str) -> None:
    from backend.workflows.executor import execute_workflow
    from backend.workflows.models import WorkflowRun
    try:
        await execute_workflow(workflow_run_id)
    except Exception as exc:
        logger.exception("Unhandled error executing workflow run %s: %s", workflow_run_id, exc)
        _fail_run(WorkflowRun, workflow_run_id, str(exc))
    from backend.core.notifications import notify_workflow_run
    await notify_workflow_run(workflow_run_id)


async def _worker() -> None:
    logger.info("Queue worker started (max_concurrent=%d)", _current_limit)
    from backend.pybooks.models import PyBookRun
    from backend.workflows.models import WorkflowRun

    while True:
        try:
            kind, id_a, id_b = await _queue.get()
            if kind == "workflow":
                # Orchestration only: its PyBook nodes take the container slots.
                _mark_pending(WorkflowRun, id_a)
                _spawn(_run_workflow_job(id_a))
            else:
                _mark_pending(PyBookRun, id_b)
                await _reserve_slot()
                _spawn(_run_pybook_job(id_a, id_b))
            _queue.task_done()
        except asyncio.CancelledError:
            logger.info("Queue worker shutting down")
            break
        except Exception as exc:
            logger.exception("Queue worker error: %s", exc)


async def start() -> None:
    global _queue, _limit_condition, _worker_task, _current_limit
    from sqlmodel import Session, select
    from backend.database import engine
    from backend.pybooks.models import PyBookRun
    from backend.workflows.models import WorkflowRun
    from backend.core.settings_model import SystemSetting
    from datetime import datetime, timezone as tz

    now = datetime.now(tz.utc)
    pybook_orphans: list = []
    workflow_orphans: list = []

    with Session(engine) as session:
        row = session.get(SystemSetting, "max_concurrent_runs")
        try:
            max_concurrent = max(1, int(row.value)) if row else _get_max()
        except (TypeError, ValueError):
            max_concurrent = _get_max()  # a corrupt setting must not block startup

        pb_orphans = session.exec(
            select(PyBookRun).where(PyBookRun.status.in_(["queued", "pending"]))
        ).all()
        pybook_orphans = [(r.pybook_id, r.id) for r in pb_orphans]

        wf_orphans = session.exec(
            select(WorkflowRun).where(WorkflowRun.status.in_(["queued", "pending"]))
        ).all()
        workflow_orphans = [r.id for r in wf_orphans]

        stranded_pb = session.exec(
            select(PyBookRun).where(PyBookRun.status == "running")
        ).all()
        for run in stranded_pb:
            run.status = "error"
            run.ended_at = now
            run.stderr = (run.stderr or "") + "\n[Interrupted: backend restarted while run was active]"
            if run.exit_code is None:
                run.exit_code = -1
            session.add(run)

        stranded_wf = session.exec(
            select(WorkflowRun).where(WorkflowRun.status == "running")
        ).all()
        for run in stranded_wf:
            run.status = "error"
            run.ended_at = now
            session.add(run)

        from backend.workflows.models import WorkflowNodeRun
        for node_run in session.exec(select(WorkflowNodeRun).where(WorkflowNodeRun.status == "running")).all():
            node_run.status = "error"
            node_run.ended_at = now
            session.add(node_run)

        if stranded_pb or stranded_wf:
            session.commit()
            logger.warning("Reset %d stranded runs to error after restart",
                           len(stranded_pb) + len(stranded_wf))

    from backend.config import settings
    _current_limit = max(1, min(max_concurrent, settings.concurrency_ceiling))
    _queue = asyncio.Queue()
    _limit_condition = asyncio.Condition()
    _worker_task = asyncio.create_task(_worker())

    for pybook_id, run_id in pybook_orphans:
        _queue.put_nowait(("pybook", pybook_id, run_id))
    for wf_run_id in workflow_orphans:
        _queue.put_nowait(("workflow", wf_run_id, ""))
    recovered = len(pybook_orphans) + len(workflow_orphans)
    if recovered:
        logger.info("Recovered %d orphaned runs from DB", recovered)


def stop() -> None:
    if _worker_task:
        _worker_task.cancel()
