import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from backend.core.auth import verify_token
from backend.database import engine, get_session
from backend.pybooks.models import PyBookRun

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/runs", tags=["runs"])

TERMINAL = {"success", "error", "timeout"}


@router.get("", dependencies=[Depends(verify_token)])
async def list_runs(
    pybook_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    stmt = select(PyBookRun)
    if pybook_id:
        stmt = stmt.where(PyBookRun.pybook_id == pybook_id)
    if status:
        stmt = stmt.where(PyBookRun.status == status)
    stmt = stmt.order_by(PyBookRun.started_at.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()



@router.get("/queue", dependencies=[Depends(verify_token)])
async def queue_stats():
    from backend.core import queue_manager
    return queue_manager.get_stats()

@router.get("/{run_id}", dependencies=[Depends(verify_token)])
async def get_run(run_id: str, session: Session = Depends(get_session)):
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
        (header_key and header_key == settings.API_TOKEN)
        or _valid_run_token(header_key)
        or bool(cookie_user)
        or (token and (token == settings.API_TOKEN or _valid_run_token(token)))
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


@router.post("/{run_id}/output", dependencies=[Depends(verify_token)])
async def set_run_output(run_id: str, body: dict, session: Session = Depends(get_session)):
    """Merge key-value pairs into a run's output_vars (called by pylo.set_output())."""
    import json as _json
    run = session.get(PyBookRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    existing = _json.loads(run.output_vars or "{}")
    existing.update(body)
    run.output_vars = _json.dumps(existing)
    session.add(run)
    session.commit()
    return {"ok": True}
