import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlmodel import Session, func, select

from backend.activity.models import ActivityEvent
from backend.core import queue_manager
from backend.core.auth import verify_token
from backend.database import get_session
from backend.objects.models import Blueprint, Entry
from backend.pybooks.models import PyBook, PyBookRun
from backend.workflows.models import Workflow, WorkflowRun

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(verify_token)])

RUN_STATUSES = ["queued", "pending", "running", "success", "error", "timeout"]
AUTOMATION_TYPES = ["cron", "webhook", "blueprint"]


def _count(session: Session, model, field="id") -> int:
    return session.exec(select(func.count(getattr(model, field)))).one()


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _json_loads(raw: str | None, fallback):
    try:
        return json.loads(raw or "")
    except Exception:
        return fallback


def _empty_days(days: int) -> dict[str, dict]:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    return {(start + timedelta(days=i)).isoformat(): {} for i in range(days)}


def _series_from_rows(days: int, rows, value_factory, merge_row) -> list[dict]:
    buckets = _empty_days(days)
    for key in buckets:
        buckets[key] = value_factory(key)
    for row in rows:
        merge_row(buckets, row)
    return list(buckets.values())


def _status_totals(session: Session, model, since: datetime) -> dict[str, int]:
    totals = {status: 0 for status in RUN_STATUSES}
    rows = session.exec(
        select(model.status, func.count(model.id))
        .where(model.started_at >= since)
        .group_by(model.status)
    ).all()
    for status, count in rows:
        totals[status or "pending"] = count
    return totals


def _run_series(session: Session, model, days: int, since: datetime) -> list[dict]:
    rows = session.exec(
        select(model.started_at, model.status)
        .where(model.started_at >= since)
        .order_by(model.started_at)
    ).all()

    def value_factory(day: str) -> dict:
        item = {"date": day, "total": 0}
        item.update({status: 0 for status in RUN_STATUSES})
        return item

    def merge_row(buckets: dict[str, dict], row) -> None:
        started_at, status = row
        day = started_at.date().isoformat()
        if day not in buckets:
            return
        safe_status = status or "pending"
        if safe_status not in RUN_STATUSES:
            buckets[day][safe_status] = 0
        buckets[day][safe_status] += 1
        buckets[day]["total"] += 1

    return _series_from_rows(days, rows, value_factory, merge_row)


def _entry_series(session: Session, days: int, since: datetime) -> list[dict]:
    rows = session.exec(
        select(Entry.created_at, func.count(Entry.id))
        .where(Entry.created_at >= since)
        .group_by(func.date(Entry.created_at))
        .order_by(Entry.created_at)
    ).all()

    def value_factory(day: str) -> dict:
        return {"date": day, "count": 0}

    def merge_row(buckets: dict[str, dict], row) -> None:
        created_at, count = row
        day = created_at.date().isoformat()
        if day in buckets:
            buckets[day]["count"] = count

    return _series_from_rows(days, rows, value_factory, merge_row)


def _success_rate(pybook_series: list[dict], workflow_series: list[dict]) -> list[dict]:
    rates = []
    for pybook_day, workflow_day in zip(pybook_series, workflow_series):
        success = pybook_day.get("success", 0) + workflow_day.get("success", 0)
        total = pybook_day.get("total", 0) + workflow_day.get("total", 0)
        rates.append({
            "date": pybook_day["date"],
            "success": success,
            "total": total,
            "rate": round((success / total) * 100, 1) if total else None,
        })
    return rates


def _automation_summary(items) -> dict[str, int]:
    summary = {key: 0 for key in AUTOMATION_TYPES}
    for item in items:
        if not item.is_active:
            continue
        if item.trigger_type in summary:
            summary[item.trigger_type] += 1
    return summary


def _recent_failures(session: Session) -> list[dict]:
    pybook_names = {p.id: p.name for p in session.exec(select(PyBook)).all()}
    workflow_names = {w.id: w.name for w in session.exec(select(Workflow)).all()}

    pybook_runs = session.exec(
        select(PyBookRun)
        .where(PyBookRun.status.in_(["error", "timeout"]))
        .order_by(desc(PyBookRun.started_at))
        .limit(8)
    ).all()
    workflow_runs = session.exec(
        select(WorkflowRun)
        .where(WorkflowRun.status.in_(["error", "timeout"]))
        .order_by(desc(WorkflowRun.started_at))
        .limit(8)
    ).all()

    items = []
    for run in pybook_runs:
        items.append({
            "type": "pybook",
            "id": run.id,
            "owner_id": run.pybook_id,
            "owner_name": pybook_names.get(run.pybook_id, "Unknown PyBook"),
            "status": run.status,
            "started_at": _iso(run.started_at),
            "duration_ms": run.duration_ms,
            "trigger_source": run.trigger_source,
        })
    for run in workflow_runs:
        items.append({
            "type": "workflow",
            "id": run.id,
            "owner_id": run.workflow_id,
            "owner_name": workflow_names.get(run.workflow_id, "Unknown Workflow"),
            "status": run.status,
            "started_at": _iso(run.started_at),
            "duration_ms": run.duration_ms,
            "trigger_source": run.trigger_source,
        })
    return sorted(items, key=lambda item: item["started_at"] or "", reverse=True)[:8]


def _top_blueprints(session: Session) -> list[dict]:
    names = {b.id: b.name for b in session.exec(select(Blueprint)).all()}
    rows = session.exec(
        select(Entry.blueprint_id, func.count(Entry.id))
        .group_by(Entry.blueprint_id)
        .order_by(desc(func.count(Entry.id)))
        .limit(8)
    ).all()
    return [
        {"id": blueprint_id, "name": names.get(blueprint_id, blueprint_id), "entries": count}
        for blueprint_id, count in rows
    ]


def _latest_activity(session: Session) -> list[dict]:
    events = session.exec(
        select(ActivityEvent)
        .order_by(desc(ActivityEvent.created_at))
        .limit(8)
    ).all()
    return [{
        "id": event.id,
        "event_type": event.event_type,
        "category": event.category,
        "actor": event.actor,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "resource_name": event.resource_name,
        "detail": _json_loads(event.detail, {}),
        "created_at": _iso(event.created_at),
    } for event in events]


def _retention_deleted(session: Session, since: datetime) -> int:
    events = session.exec(
        select(ActivityEvent)
        .where(ActivityEvent.created_at >= since)
        .where(ActivityEvent.event_type == "blueprint.fetch")
    ).all()
    total = 0
    for event in events:
        detail = _json_loads(event.detail, {})
        total += int(detail.get("retention_deleted") or 0)
    return total


@router.get("/summary")
async def dashboard_summary(
    days: int = Query(14),
    session: Session = Depends(get_session),
):
    if days not in (7, 14, 30):
        raise HTTPException(status_code=400, detail="days must be one of 7, 14, 30")

    today = datetime.now(timezone.utc).date()
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), tzinfo=timezone.utc)

    pybook_series = _run_series(session, PyBookRun, days, since)
    workflow_series = _run_series(session, WorkflowRun, days, since)
    pybooks = session.exec(select(PyBook)).all()
    workflows = session.exec(select(Workflow)).all()

    pybook_status = _status_totals(session, PyBookRun, since)
    workflow_status = _status_totals(session, WorkflowRun, since)
    total_runs = sum(pybook_status.values()) + sum(workflow_status.values())

    return {
        "days": days,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "counts": {
            "blueprints": _count(session, Blueprint),
            "entries": _count(session, Entry),
            "pybooks": len(pybooks),
            "active_pybooks": sum(1 for item in pybooks if item.is_active),
            "workflows": len(workflows),
            "active_workflows": sum(1 for item in workflows if item.is_active),
            "runs": total_runs,
        },
        "queue": queue_manager.get_stats(),
        "series": {
            "entries": _entry_series(session, days, since),
            "pybook_runs": pybook_series,
            "workflow_runs": workflow_series,
            "success_rate": _success_rate(pybook_series, workflow_series),
        },
        "status_totals": {
            "pybook": pybook_status,
            "workflow": workflow_status,
        },
        "recent_failures": _recent_failures(session),
        "top_blueprints": _top_blueprints(session),
        "automations": {
            "pybooks": _automation_summary(pybooks),
            "workflows": _automation_summary(workflows),
        },
        "retention": {"deleted_entries": _retention_deleted(session, since)},
        "activity": _latest_activity(session),
    }
