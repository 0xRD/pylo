"""Failure notifications: POST a JSON message to an admin-configured webhook.

The payload carries a Slack/Mattermost-compatible ``text`` field plus structured
fields for generic receivers. Delivery is best-effort and never raises.
"""
import logging

import httpx
from sqlmodel import Session

from backend.database import engine

logger = logging.getLogger(__name__)

FAILURE_STATUSES = {"error", "timeout", "dead_letter"}


def _settings(session: Session) -> str:
    from backend.api.settings import get_setting
    return (get_setting(session, "notify_webhook_url") or "").strip()


def build_failure_message(kind: str, name: str, status: str, run_id: str, detail: str = "") -> dict:
    text = f":rotating_light: Pylo {kind} *{name}* finished with status `{status}` (run {run_id})"
    if detail:
        text += f"\n```{detail[-500:]}```"
    return {
        "text": text,
        "event": f"{kind}.run.failed",
        "kind": kind,
        "name": name,
        "status": status,
        "run_id": run_id,
    }


async def send_webhook(url: str, message: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            resp = await client.post(url, json=message)
        if resp.status_code >= 400:
            logger.warning("Notification webhook returned HTTP %s", resp.status_code)
            return False
        return True
    except Exception as exc:  # never let notifications break run processing
        logger.warning("Notification webhook failed: %s", exc)
        return False


async def notify_pybook_run(run_id: str) -> None:
    from backend.pybooks.models import PyBook, PyBookRun

    with Session(engine) as session:
        url = _settings(session)
        run = session.get(PyBookRun, run_id)
        if not url or not run or run.status not in FAILURE_STATUSES:
            return
        pb = session.get(PyBook, run.pybook_id)
        message = build_failure_message("pybook", pb.name if pb else run.pybook_id,
                                        run.status, run.id, run.stderr or "")
    await send_webhook(url, message)


async def notify_workflow_run(workflow_run_id: str) -> None:
    from backend.workflows.models import Workflow, WorkflowRun

    with Session(engine) as session:
        url = _settings(session)
        run = session.get(WorkflowRun, workflow_run_id)
        if not url or not run or run.status not in FAILURE_STATUSES:
            return
        wf = session.get(Workflow, run.workflow_id)
        message = build_failure_message("workflow", wf.name if wf else run.workflow_id, run.status, run.id)
    await send_webhook(url, message)
