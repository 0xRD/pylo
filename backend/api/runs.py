import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from backend.core.auth import verify_token, is_master_token, AuthUser
from backend.database import engine, get_session
from backend.pybooks.models import PyBookRun

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/runs", tags=["runs"])

# Everything except the (potentially multi-megabyte) log columns.
_SUMMARY_COLUMNS = [col for name, col in PyBookRun.__table__.columns.items() if name not in ("stdout", "stderr")]


def select_runs(include_output: bool):
    """Select full runs, or lightweight summaries that skip loading stdout/stderr."""
    return select(PyBookRun) if include_output else select(*_SUMMARY_COLUMNS)


def run_rows(session: Session, stmt, include_output: bool) -> list:
    rows = session.exec(stmt).all()
    return rows if include_output else [dict(row._mapping) for row in rows]

TERMINAL = {"success", "error", "timeout", "cancelled", "dead_letter"}


def _enforce_run_access(user: AuthUser, run_id: str) -> None:
    """Run tokens are scoped to a single run; block access to any other run."""
    if user.is_runner and user.run_id != run_id:
        raise HTTPException(status_code=403, detail="Run token can only access its own run")


@router.get("", dependencies=[Depends(verify_token)])
async def list_runs(
    pybook_id: Optional[str] = Query(None),
    status: List[str] = Query(default=[]),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_output: bool = Query(True, description="Set false to omit stdout/stderr (much smaller responses)"),
    session: Session = Depends(get_session),
):
    stmt = select_runs(include_output)
    if pybook_id:
        stmt = stmt.where(PyBookRun.pybook_id == pybook_id)
    if status:
        stmt = stmt.where(PyBookRun.status.in_(status))
    stmt = stmt.order_by(PyBookRun.started_at.desc()).offset(offset).limit(limit)
    return run_rows(session, stmt, include_output)



@router.get("/queue", dependencies=[Depends(verify_token)])
async def queue_stats():
    from backend.core import queue_manager
    return queue_manager.get_stats()

@router.get("/{run_id}")
async def get_run(run_id: str, session: Session = Depends(get_session), current_user: AuthUser = Depends(verify_token)):
    _enforce_run_access(current_user, run_id)
    run = session.get(PyBookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.websocket("/{run_id}/ws")
async def run_status_ws(run_id: str, websocket: WebSocket, token: Optional[str] = Query(None)):
    from backend.config import settings
    from backend.core.auth import auth_user_from_jwt, auth_user_from_run_token

    def _valid_run_token(value: str | None) -> bool:
        runner = auth_user_from_run_token(value or "")
        return bool(runner and runner.run_id == run_id)

    cookie = websocket.cookies.get("pylo_token")
    header_key = websocket.headers.get("x-api-token")
    with Session(engine) as session:
        cookie_user = auth_user_from_jwt(cookie, session) if cookie else None
    authorized = (
        is_master_token(header_key)
        or _valid_run_token(header_key)
        or bool(cookie_user)
        or (token and (is_master_token(token) or _valid_run_token(token)))
    )
    if not authorized:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    try:
        while True:
            with Session(engine) as session:
                run = session.get(PyBookRun, run_id)
                if not run:
                    await websocket.send_json({"error": "not found"})
                    break
                payload = {
                    "id": run.id,
                    "pybook_id": run.pybook_id,
                    "status": run.status,
                    "stdout": run.stdout,
                    "stderr": run.stderr,
                    "exit_code": run.exit_code,
                    "duration_ms": run.duration_ms,
                    "trigger_source": run.trigger_source,
                    "started_at": run.started_at.isoformat() if run.started_at else None,
                    "ended_at": run.ended_at.isoformat() if run.ended_at else None,
                }
                await websocket.send_json(payload)
                if run.status in TERMINAL:
                    break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass


@router.post("/{run_id}/output")
async def set_run_output(run_id: str, body: dict, session: Session = Depends(get_session), current_user: AuthUser = Depends(verify_token)):
    """Merge key-value pairs into a run's output_vars (called by pylo.set_output())."""
    import json as _json
    _enforce_run_access(current_user, run_id)
    run = session.get(PyBookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    existing = _json.loads(run.output_vars or "{}")
    existing.update(body)
    run.output_vars = _json.dumps(existing)
    session.add(run)
    session.commit()
    return {"ok": True}

@router.delete("/{run_id}")
async def cancel_run(run_id: str, session: Session = Depends(get_session), current_user: AuthUser = Depends(verify_token)):
    """Cancel a queued or pending run. Has no effect on running/terminal runs."""
    _enforce_run_access(current_user, run_id)
    run = session.get(PyBookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status not in ("queued", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel run in status '{run.status}' — only queued/pending runs can be cancelled",
        )
    run.status = "cancelled"
    run.ended_at = __import__('datetime').datetime.now(__import__('datetime').timezone.utc)
    session.add(run)
    session.commit()
    return {"ok": True, "run_id": run_id, "status": "cancelled"}
