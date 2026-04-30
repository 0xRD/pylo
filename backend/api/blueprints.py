import asyncio
import ipaddress
import json
import logging
import re
import uuid
from urllib.parse import urlparse
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, cast, or_, String as SAString
from sqlmodel import Session, select
from jsonpath_ng import parse as jsonpath_parse

from backend.activity.logger import log_activity
from backend.config import settings
from backend.core.auth import AuthUser, verify_token
from backend.database import get_session
from backend.objects.indexer import index_entry, remove_from_index, search_fts
from backend.objects.models import Entry, Blueprint, EntryEvent
from backend.objects.parser import extract_text_content, parse_instance

logger = logging.getLogger(__name__)
_MAX_TRIGGERS_PER_FETCH = 50
router = APIRouter(prefix="/api/blueprints", tags=["blueprints"], dependencies=[Depends(verify_token)])


# ── Pydantic request/response schemas ────────────────────────────────────────

class BlueprintCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_method: str = "GET"
    source_headers: str = "{}"
    source_body: str = "{}"
    field_mappings: str = "[]"
    trigger_pybook_id: Optional[str] = None
    polling_interval_seconds: Optional[int] = None
    fetch_cron: Optional[str] = None
    fetch_is_active: bool = False
    is_manual: bool = False
    trigger_event: str = "on_create"
    mutable_mode: str = "none"
    pagination_type: str = "none"
    pagination_param: Optional[str] = None
    pagination_path: Optional[str] = None
    pagination_items_path: Optional[str] = None
    pagination_max_pages: int = 50
    max_entries: Optional[int] = None
    retention_days: Optional[int] = None
    retention_minutes: Optional[int] = None


class BlueprintUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_method: Optional[str] = None
    source_headers: Optional[str] = None
    source_body: Optional[str] = None
    field_mappings: Optional[str] = None
    trigger_pybook_id: Optional[str] = None
    polling_interval_seconds: Optional[int] = None
    fetch_cron: Optional[str] = None
    fetch_is_active: Optional[bool] = None
    is_manual: Optional[bool] = None
    trigger_event: Optional[str] = None
    mutable_mode: Optional[str] = None
    pagination_type: Optional[str] = None
    pagination_param: Optional[str] = None
    pagination_path: Optional[str] = None
    pagination_items_path: Optional[str] = None
    pagination_max_pages: Optional[int] = None
    max_entries: Optional[int] = None
    retention_days: Optional[int] = None
    retention_minutes: Optional[int] = None


# ── Blueprint CRUD ────────────────────────────────────────────────────────────

@router.get("")
async def list_blueprints(session: Session = Depends(get_session)):
    return session.exec(select(Blueprint)).all()


@router.post("", status_code=201)
async def create_blueprint(
    body: BlueprintCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = Blueprint(
        id=str(uuid.uuid4()),
        **body.model_dump(),
        created_at=datetime.now(timezone.utc),
    )
    session.add(bp)
    log_activity(session, "blueprint.created", actor=current_user.username,
                 resource_type="blueprint", resource_id=bp.id, resource_name=bp.name)
    session.commit()
    session.refresh(bp)
    return bp


# ── Query parser (FTS + field filters) ───────────────────────────────────────

_RESERVED = {'and', 'or', 'not'}

# fullmatch: entire segment must be a field expression
_FIELD_EXPR = re.compile(
    r'(?P<field>[a-zA-Z_]\w*)\s*(?P<op>=|!=|contains)\s*'
    r'(?:"(?P<qval>[^"]*?)"|(?P<val>\S+))',
    re.IGNORECASE,
)


def _parse_query(raw: str) -> tuple[list[tuple], str]:
    """Split a raw query into field filters + remaining FTS text.

    Splits on AND / OR, classifies each segment as a field expression or a
    FTS term, and records the connective (and|or|None) preceding each filter.
    Returns ([(field, op, value, connective), …], fts_text).
    """
    if not raw or not raw.strip():
        return [], ''

    # re.split with a capturing group keeps the separators at odd indices
    parts = re.split(r'\s+(AND|OR)\s+', raw.strip(), flags=re.IGNORECASE)

    filters: list[tuple] = []
    fts_parts: list[str] = []

    for i, part in enumerate(parts):
        if i % 2 == 1:
            continue  # connective, read below via index

        connective = parts[i - 1].lower() if i > 0 else None
        part = part.strip()
        if not part:
            continue

        m = _FIELD_EXPR.fullmatch(part)
        if m and m.group('field').lower() not in _RESERVED:
            field = m.group('field').lower()
            op = m.group('op').lower()
            value = m.group('qval') if m.group('qval') is not None else m.group('val')
            filters.append((field, op, value, connective))
        else:
            if fts_parts and connective:
                fts_parts.append(connective.upper())
            fts_parts.append(part)

    return filters, ' '.join(fts_parts).strip()


def _field_clause(field: str, op: str, value: str):
    """Return a SQLAlchemy WHERE clause for one field filter."""
    from sqlalchemy import func as sqf
    if field == 'external_id':
        col = Entry.external_id
    else:
        col = cast(sqf.json_extract(Entry.data, f'$.{field}'), SAString)

    if op == '=':
        return col == value
    if op == '!=':
        return col != value
    if op == 'contains':
        return col.like(f'%{value}%')
    return col == value


def _build_filter_clause(filters: list[tuple]):
    """Combine field filters into one WHERE clause with AND > OR precedence.

    Splits at OR boundaries, ANDs within each group, ORs across groups.
    E.g. A AND B OR C AND D → OR(AND(A, B), AND(C, D))
    """
    if not filters:
        return None

    groups: list[list] = [[]]
    for field, op, value, connective in filters:
        if connective == 'or':
            groups.append([])
        groups[-1].append(_field_clause(field, op, value))

    and_groups = [and_(*g) if len(g) > 1 else g[0] for g in groups if g]
    return or_(*and_groups) if len(and_groups) > 1 else and_groups[0]


@router.get("/entries")
async def list_entries(
    blueprint_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    from sqlalchemy import text as sa_text

    field_filters, fts_text = _parse_query(q or '')
    filter_clause = _build_filter_clause(field_filters)

    # ── Base statement ────────────────────────────────────────────────────────
    stmt = select(Entry)
    if blueprint_id:
        stmt = stmt.where(Entry.blueprint_id == blueprint_id)
    if filter_clause is not None:
        stmt = stmt.where(filter_clause)

    # ── FTS ───────────────────────────────────────────────────────────────────
    fts_ids: list[str] | None = None
    if fts_text:
        if filter_clause is not None:
            # Mixed mode: fetch all FTS matches then intersect via IN
            fts_ids = search_fts(session, fts_text, blueprint_id=blueprint_id, limit=10_000)
            if not fts_ids:
                return {"items": [], "total": 0}
            stmt = stmt.where(Entry.id.in_(fts_ids))
        else:
            # Pure FTS: fast SQL count, BM25 ordering
            if blueprint_id:
                count_sql = sa_text(
                    "SELECT count(*) FROM fts_entries "
                    "WHERE fts_entries MATCH :q AND blueprint_id = :bp"
                )
                total = session.exec(count_sql, params={"q": fts_text, "bp": blueprint_id}).fetchone()[0]
            else:
                count_sql = sa_text("SELECT count(*) FROM fts_entries WHERE fts_entries MATCH :q")
                total = session.exec(count_sql, params={"q": fts_text}).fetchone()[0]

            ids = search_fts(session, fts_text, blueprint_id=blueprint_id, limit=limit, offset=offset)
            if not ids:
                return {"items": [], "total": total}
            entries = session.exec(select(Entry).where(Entry.id.in_(ids))).all()
            order = {eid: i for i, eid in enumerate(ids)}
            return {"items": sorted(entries, key=lambda x: order.get(x.id, 999)), "total": total}

    # ── Count + paginate ──────────────────────────────────────────────────────
    count_stmt = select(func.count(Entry.id))
    if blueprint_id:
        count_stmt = count_stmt.where(Entry.blueprint_id == blueprint_id)
    if filter_clause is not None:
        count_stmt = count_stmt.where(filter_clause)
    if fts_ids is not None:
        count_stmt = count_stmt.where(Entry.id.in_(fts_ids))

    total = session.exec(count_stmt).one()
    items = session.exec(stmt.order_by(Entry.created_at.desc()).offset(offset).limit(limit)).all()
    return {"items": items, "total": total}


@router.get("/entries/{entry_id}")
async def get_entry(entry_id: str, session: Session = Depends(get_session)):
    entry = session.get(Entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    entry = session.get(Entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    remove_from_index(session, entry_id)
    session.delete(entry)
    log_activity(session, "entry.deleted", actor=current_user.username,
                 resource_type="entry", resource_id=entry_id,
                 detail={"blueprint_id": entry.blueprint_id})
    session.commit()


@router.get("/{blueprint_id}")
async def get_blueprint(blueprint_id: str, session: Session = Depends(get_session)):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    return bp


@router.put("/{blueprint_id}")
async def update_blueprint(
    blueprint_id: str,
    body: BlueprintUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    updated = body.model_dump(exclude_none=True)
    old_mappings = bp.field_mappings
    for field, value in updated.items():
        setattr(bp, field, value)
    session.add(bp)
    log_activity(session, "blueprint.updated", actor=current_user.username,
                 resource_type="blueprint", resource_id=blueprint_id, resource_name=bp.name,
                 detail={"changed_fields": list(updated.keys())})
    session.commit()
    session.refresh(bp)
    if "fetch_cron" in updated or "fetch_is_active" in updated:
        from backend.core.scheduler import sync_cron_jobs
        sync_cron_jobs()
    if "field_mappings" in updated and old_mappings != bp.field_mappings:
        _reparse_state[blueprint_id] = {"status": "running", "processed": 0, "total": 0}
        asyncio.get_running_loop().create_task(_reparse_entries_bg(blueprint_id, bp.field_mappings))
    return bp


@router.delete("/{blueprint_id}", status_code=204)
async def delete_blueprint(
    blueprint_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    bp_name = bp.name
    entries = session.exec(
        select(Entry).where(Entry.blueprint_id == blueprint_id)
    ).all()
    for entry in entries:
        remove_from_index(session, entry.id)
        session.delete(entry)
    session.delete(bp)
    log_activity(session, "blueprint.deleted", actor=current_user.username,
                 resource_type="blueprint", resource_id=blueprint_id, resource_name=bp_name,
                 detail={"entries_deleted": len(entries)})
    session.commit()


@router.delete("/{blueprint_id}/entries", status_code=204)
async def delete_all_entries(
    blueprint_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    entries = session.exec(select(Entry).where(Entry.blueprint_id == blueprint_id)).all()
    for entry in entries:
        _delete_entry_row(session, entry)
    log_activity(session, "blueprint.entries_cleared", actor=current_user.username,
                 resource_type="blueprint", resource_id=blueprint_id, resource_name=bp.name,
                 detail={"entries_deleted": len(entries)})
    session.commit()


@router.get("/{blueprint_id}/reparse/status")
async def get_reparse_status(blueprint_id: str):
    return _reparse_state.get(blueprint_id, {"status": "idle", "processed": 0, "total": 0})


# ── Auto-fetch helper (also used by cron scheduler) ──────────────────────────



_reparse_state: dict[str, dict] = {}


def _do_reparse_sync(blueprint_id: str, field_mappings_json: str) -> None:
    from backend.database import engine as _engine
    from backend.objects.parser import parse_instance, extract_text_content

    field_mappings = json.loads(field_mappings_json)
    with Session(_engine) as session:
        entries = session.exec(select(Entry).where(Entry.blueprint_id == blueprint_id)).all()
        total = len(entries)
        _reparse_state[blueprint_id]["total"] = total
        for i, entry in enumerate(entries):
            raw = json.loads(entry.raw_data or "{}")
            parsed = parse_instance(raw, field_mappings)
            entry.data = json.dumps(parsed)
            entry.updated_at = datetime.now(timezone.utc)
            session.add(entry)
            index_entry(session, entry.id, blueprint_id, extract_text_content(parsed))
            if (i + 1) % 100 == 0 or i == total - 1:
                session.commit()
            _reparse_state[blueprint_id]["processed"] = i + 1
        _reparse_state[blueprint_id]["status"] = "done"


async def _reparse_entries_bg(blueprint_id: str, field_mappings_json: str) -> None:
    try:
        await asyncio.to_thread(_do_reparse_sync, blueprint_id, field_mappings_json)
    except Exception as exc:
        logger.exception("Reparse failed for blueprint %s: %s", blueprint_id, exc)
        state = _reparse_state.get(blueprint_id, {})
        _reparse_state[blueprint_id] = {
            "status": "error",
            "error": str(exc),
            "processed": state.get("processed", 0),
            "total": state.get("total", 0),
        }


def _trigger_event_matches(entry_info: dict, trigger_event: str) -> bool:
    event_type = entry_info.get("event_type", "created")
    if trigger_event == "on_create_or_update":
        return event_type in {"created", "updated"}
    return event_type == "created"


def _fire_blueprint_triggers(bp, created_entries: list) -> None:
    """Enqueue runs for PyBook and Workflow subscribers of this blueprint."""
    from backend.objects.filter import check_trigger_conditions
    from backend.core import queue_manager
    from backend.pybooks.models import PyBook, PyBookRun
    from backend.workflows.models import Workflow, WorkflowRun
    from backend.database import engine as _engine

    if not created_entries:
        return

    try:
        with Session(_engine) as _ts:
            # PyBook subscribers
            subscribers = [
                pb for pb in _ts.exec(
                    select(PyBook).where(PyBook.trigger_type == "blueprint", PyBook.is_active == True)
                ).all()
                if json.loads(pb.trigger_config or "{}").get("blueprint_id") == bp.id
            ]
            for sub in subscribers:
                cfg = json.loads(sub.trigger_config or "{}")
                trigger_event = cfg.get("trigger_event", "on_create")
                conditions = cfg.get("trigger_conditions", [])
                matching = [
                    e for e in created_entries
                    if _trigger_event_matches(e, trigger_event) and check_trigger_conditions(e["parsed"], conditions)
                ]
                if not matching:
                    continue
                matching = matching[:_MAX_TRIGGERS_PER_FETCH]
                runs = []
                for entry_info in matching:
                    run = PyBookRun(
                        id=str(uuid.uuid4()),
                        pybook_id=sub.id,
                        status="queued",
                        trigger_source="blueprint",
                        trigger_payload=json.dumps({
                            "blueprint_id": bp.id,
                            "entry_id": entry_info["entry_id"],
                            "entry_data": entry_info["parsed"],
                            "event_type": entry_info.get("event_type", "created"),
                        }),
                        started_at=datetime.now(timezone.utc),
                    )
                    _ts.add(run)
                    runs.append(run)
                _ts.commit()
                for run in runs:
                    queue_manager.enqueue(sub.id, run.id)

            # Workflow subscribers
            wf_subscribers = [
                wf for wf in _ts.exec(
                    select(Workflow).where(Workflow.trigger_type == "blueprint", Workflow.is_active == True)
                ).all()
                if json.loads(wf.trigger_config or "{}").get("blueprint_id") == bp.id
            ]
            import asyncio as _asyncio
            for wf in wf_subscribers:
                cfg = json.loads(wf.trigger_config or "{}")
                trigger_event = cfg.get("trigger_event", "on_create")
                if trigger_event not in ("on_create", "on_create_or_update"):
                    continue
                conditions = cfg.get("trigger_conditions", [])
                matching = [
                    e for e in created_entries
                    if _trigger_event_matches(e, trigger_event) and check_trigger_conditions(e["parsed"], conditions)
                ]
                if not matching:
                    continue
                matching = matching[:_MAX_TRIGGERS_PER_FETCH]
                for entry_info in matching:
                    wf_run = WorkflowRun(
                        id=str(uuid.uuid4()),
                        workflow_id=wf.id,
                        status="pending",
                        trigger_source="blueprint",
                        trigger_payload=json.dumps({
                            "blueprint_id": bp.id,
                            "entry_id": entry_info["entry_id"],
                            "entry_data": entry_info["parsed"],
                            "event_type": entry_info.get("event_type", "created"),
                        }),
                        started_at=datetime.now(timezone.utc),
                    )
                    _ts.add(wf_run)
                    _ts.commit()
                    wf_run_id = wf_run.id
                    try:
                        loop = _asyncio.get_running_loop()
                        loop.create_task(_execute_workflow_bg(wf_run_id))
                    except RuntimeError:
                        pass
    except Exception as exc:
        logger.warning("Failed to fire blueprint triggers: %s", exc)


async def _execute_workflow_bg(workflow_run_id: str) -> None:
    from backend.workflows.executor import execute_workflow
    try:
        await execute_workflow(workflow_run_id)
    except Exception as exc:
        logger.exception("Workflow run %s crashed: %s", workflow_run_id, exc)


def _jsonpath_first(data, path: str):
    matches = jsonpath_parse(path).find(data)
    return matches[0].value if matches else None


def _is_private_fetch_host(hostname: str) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if host in {"localhost", "ip6-localhost"} or host.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any([
        ip.is_private,
        ip.is_loopback,
        ip.is_link_local,
        ip.is_multicast,
        ip.is_reserved,
        ip.is_unspecified,
    ])


def _validate_fetch_url(url: str) -> None:
    parsed = urlparse(url or "")
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Blueprint fetch URL must be http(s)")
    if not settings.PYLO_ALLOW_PRIVATE_FETCH and _is_private_fetch_host(parsed.hostname):
        raise HTTPException(status_code=400, detail="Private, local, and link-local fetch targets are blocked")


def _extract_fetch_items(raw_data, items_path: Optional[str]) -> list:
    data = raw_data
    if items_path:
        data = _jsonpath_first(raw_data, items_path)
    if data is None:
        return []
    return data if isinstance(data, list) else [data]


_COMMON_ITEM_KEYS = ("items", "data", "results", "records", "value")
_KEY_FIELD_NAMES = ("applicationid", "application_id", "externalid", "external_id", "id", "uuid")


def _jsonpath_child(root: str, key: str) -> str:
    if re.match(r"^[A-Za-z_]\w*$", key):
        return f"{root}.{key}"
    return f"{root}['{key}']"


def _infer_items_path(raw_data) -> Optional[str]:
    if isinstance(raw_data, list):
        return None
    if not isinstance(raw_data, dict):
        return None

    candidates = []
    for key, value in raw_data.items():
        if not isinstance(value, list) or not value:
            continue
        if not any(isinstance(item, dict) for item in value[:5]):
            continue
        priority = _COMMON_ITEM_KEYS.index(key) if key in _COMMON_ITEM_KEYS else len(_COMMON_ITEM_KEYS)
        candidates.append((priority, -len(value), _jsonpath_child("$", key)))

    if not candidates:
        return None
    return sorted(candidates)[0][2]


def _field_type_for_value(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    return "string"


def _field_name_from_key(key: str) -> str:
    name = re.sub(r"\W+", "_", key).strip("_")
    if not name:
        return "field"
    if name[0].isdigit():
        return f"field_{name}"
    return name


def _build_auto_mappings(sample_item) -> list[dict]:
    if not isinstance(sample_item, dict):
        return []

    mappings = []
    key_index = None
    key_priority = None
    for idx, (key, value) in enumerate(sample_item.items()):
        field_name = _field_name_from_key(key)
        lower_name = field_name.lower()
        if lower_name in _KEY_FIELD_NAMES:
            priority = _KEY_FIELD_NAMES.index(lower_name)
            if key_priority is None or priority < key_priority:
                key_index = idx
                key_priority = priority
        mappings.append({
            "source_path": _jsonpath_child("$", key),
            "field_name": field_name,
            "field_type": _field_type_for_value(value),
            "is_key": False,
            "mutable": False,
        })

    if mappings:
        mappings[key_index if key_index is not None else 0]["is_key"] = True
    return mappings


def _pagination_value(bp: Blueprint, page_number: int, offset: int, cursor):
    ptype = (bp.pagination_type or "none").lower()
    if ptype == "page_number":
        return page_number
    if ptype == "offset":
        return offset
    if ptype == "cursor":
        return cursor
    return None


def _mutable_fetch_fields(bp: Blueprint, field_mappings: list[dict], parsed: dict) -> set[str]:
    mutable_mode = (getattr(bp, "mutable_mode", "none") or "none").lower()
    if mutable_mode == "all":
        return set(parsed.keys())
    if mutable_mode == "per_field":
        return {m.get("field_name") for m in field_mappings if m.get("mutable") and m.get("field_name")}
    return set()


def _update_entry_from_fetch(
    session: Session,
    bp: Blueprint,
    entry: Entry,
    parsed: dict,
    raw_item,
    mutable_fields: set[str],
    actor: str,
) -> list[str]:
    if not mutable_fields:
        return []

    old_data = json.loads(entry.data or "{}")
    updates = {k: parsed[k] for k in mutable_fields if k in parsed and old_data.get(k) != parsed[k]}
    if not updates:
        return []

    new_data = {**old_data, **updates}
    changed = list(updates.keys())
    entry.data = json.dumps(new_data)
    entry.raw_data = json.dumps(raw_item)
    entry.updated_at = datetime.now(timezone.utc)
    session.add(entry)

    ev = EntryEvent(
        id=str(uuid.uuid4()),
        entry_id=entry.id,
        blueprint_id=bp.id,
        event_type="updated",
        changed_fields=json.dumps(changed),
        old_values=json.dumps({k: old_data.get(k) for k in changed}),
        new_values=json.dumps(updates),
        actor="API",
        created_at=datetime.now(timezone.utc),
    )
    session.add(ev)
    index_entry(session, entry.id, bp.id, extract_text_content(new_data))
    return changed


def _delete_entry_row(session: Session, entry: Entry) -> None:
    remove_from_index(session, entry.id)
    events = session.exec(select(EntryEvent).where(EntryEvent.entry_id == entry.id)).all()
    for event in events:
        session.delete(event)
    session.delete(entry)


def _enforce_entry_retention(session: Session, bp: Blueprint) -> int:
    deleted = 0
    retention_mins = bp.retention_minutes or (bp.retention_days * 1440 if bp.retention_days else None)
    if retention_mins and retention_mins > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=retention_mins)
        expired = session.exec(
            select(Entry)
            .where(Entry.blueprint_id == bp.id, Entry.created_at < cutoff)
            .order_by(Entry.created_at)
        ).all()
        for entry in expired:
            _delete_entry_row(session, entry)
            deleted += 1

    if bp.max_entries and bp.max_entries > 0:
        entries = session.exec(
            select(Entry)
            .where(Entry.blueprint_id == bp.id)
            .order_by(Entry.created_at.desc())
        ).all()
        for entry in entries[bp.max_entries:]:
            _delete_entry_row(session, entry)
            deleted += 1

    return deleted


async def _fetch_raw_pages(bp: Blueprint, headers: dict, body: dict) -> tuple[list, int]:
    _validate_fetch_url(bp.source_url)
    ptype = (bp.pagination_type or "none").lower()
    if ptype not in {"none", "page_number", "offset", "cursor"}:
        ptype = "none"

    param = (bp.pagination_param or "").strip()
    max_pages = max(1, min(int(bp.pagination_max_pages or 50), 500))
    all_items: list = []
    page_number = 1
    offset = 0
    cursor = None
    seen_cursors = set()

    async with httpx.AsyncClient(timeout=30) as client:
        for page_idx in range(max_pages):
            page_body = dict(body or {})
            params = {}
            page_value = _pagination_value(bp, page_number, offset, cursor)
            if ptype != "none" and param and page_value not in (None, ""):
                if bp.source_method.upper() == "POST":
                    page_body[param] = page_value
                else:
                    params[param] = page_value

            if bp.source_method.upper() == "POST":
                response = await client.post(bp.source_url, headers=headers, json=page_body, params=params or None)
            else:
                response = await client.get(bp.source_url, headers=headers, params=params or None)
            response.raise_for_status()
            raw_data = response.json()
            items = _extract_fetch_items(raw_data, bp.pagination_items_path)
            all_items.extend(items)

            if ptype == "none":
                return all_items, 1
            if not items:
                return all_items, page_idx + 1

            if ptype == "page_number":
                page_number += 1
            elif ptype == "offset":
                offset += len(items)
            elif ptype == "cursor":
                if not bp.pagination_path:
                    return all_items, page_idx + 1
                next_cursor = _jsonpath_first(raw_data, bp.pagination_path)
                if next_cursor in (None, "") or next_cursor in seen_cursors:
                    return all_items, page_idx + 1
                seen_cursors.add(next_cursor)
                cursor = next_cursor

    return all_items, max_pages


async def _do_fetch(blueprint_id: str, session: Session, actor: str = "scheduler") -> dict:
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise ValueError(f"Blueprint {blueprint_id} not found")
    if not bp.source_url:
        raise ValueError("Blueprint has no source_url configured")

    field_mappings = json.loads(bp.field_mappings or "[]")
    req_headers = json.loads(bp.source_headers or "{}")
    req_body = json.loads(bp.source_body or "{}")

    try:
        from backend.core.crypto import decrypt, resolve_secret_templates
        from backend.secrets.models import Secret
        from sqlmodel import select as _select
        secrets_map = {s.name: decrypt(s.encrypted_value) for s in session.exec(_select(Secret)).all()}
        raw_headers_str = resolve_secret_templates(bp.source_headers or '{}', secrets_map)
        raw_body_str = resolve_secret_templates(bp.source_body or '{}', secrets_map)
        req_headers = json.loads(raw_headers_str)
        req_body = json.loads(raw_body_str)
    except Exception:
        pass

    try:
        items, pages_fetched = await _fetch_raw_pages(bp, req_headers, req_body)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Upstream fetch failed: {exc}")

    key_field = next(
        (m["field_name"] for m in field_mappings if m.get("is_key")),
        "external_id",
    )
    created_count = 0
    updated_count = 0
    skipped_count = 0
    trigger_entries: list[dict] = []
    mutable_fields = _mutable_fetch_fields(bp, field_mappings, {})

    for item in items:
        parsed = parse_instance(item, field_mappings)
        if (getattr(bp, "mutable_mode", "none") or "none").lower() == "all":
            mutable_fields = _mutable_fetch_fields(bp, field_mappings, parsed)
        external_id = parsed.get(key_field)

        if external_id:
            existing = session.exec(
                select(Entry).where(
                    Entry.blueprint_id == blueprint_id,
                    Entry.external_id == str(external_id),
                )
            ).first()
            if existing:
                changed = _update_entry_from_fetch(session, bp, existing, parsed, item, mutable_fields, actor)
                if changed:
                    updated_count += 1
                    trigger_entries.append({"entry_id": existing.id, "parsed": json.loads(existing.data or "{}"), "event_type": "updated"})
                else:
                    skipped_count += 1
                continue

        now = datetime.now(timezone.utc)
        entry = Entry(
            id=str(uuid.uuid4()),
            blueprint_id=blueprint_id,
            external_id=str(external_id) if external_id else None,
            data=json.dumps(parsed),
            raw_data=json.dumps(item),
            created_at=now,
            updated_at=now,
        )
        session.add(entry)
        session.flush()
        index_entry(session, entry.id, blueprint_id, extract_text_content(parsed))
        created_count += 1
        trigger_entries.append({"entry_id": entry.id, "parsed": parsed, "event_type": "created"})

    retention_deleted = _enforce_entry_retention(session, bp)
    log_activity(session, "blueprint.fetch", actor=actor,
                 resource_type="blueprint", resource_id=blueprint_id, resource_name=bp.name,
                 detail={"created": created_count, "updated": updated_count, "skipped": skipped_count, "total": len(items), "pages_fetched": pages_fetched, "retention_deleted": retention_deleted})
    session.commit()

    if trigger_entries:
        _fire_blueprint_triggers(bp, trigger_entries)

    return {"created": created_count, "updated": updated_count, "skipped": skipped_count, "total": len(items), "pages_fetched": pages_fetched, "retention_deleted": retention_deleted}


@router.post("/{blueprint_id}/fetch")
async def fetch_blueprint(
    blueprint_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    if not bp.source_url:
        raise HTTPException(status_code=400, detail="Blueprint has no source_url configured")
    try:
        return await _do_fetch(blueprint_id, session, actor=current_user.username)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Endpoint preview (no persistence) ────────────────────────────────────────

class PreviewRequest(BaseModel):
    source_url: str
    source_method: str = "GET"
    source_headers: str = "{}"
    source_body: str = "{}"
    sample_limit: int = 1
    pagination_type: str = "none"
    pagination_param: Optional[str] = None
    pagination_items_path: Optional[str] = None
    auto_parse_items: bool = False



class CreateEntryBody(BaseModel):
    fields: dict


@router.post("/{blueprint_id}/entries", status_code=201)
async def create_manual_entry(
    blueprint_id: str,
    body: CreateEntryBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    field_mappings = json.loads(bp.field_mappings or "[]")
    key_field = next((m["field_name"] for m in field_mappings if m.get("is_key")), None)
    external_id = body.fields.get(key_field) if key_field else None
    if external_id:
        existing = session.exec(
            select(Entry).where(Entry.blueprint_id == blueprint_id, Entry.external_id == str(external_id))
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Entry with key '{external_id}' already exists")
    now = datetime.now(timezone.utc)
    entry = Entry(
        id=str(uuid.uuid4()),
        blueprint_id=blueprint_id,
        external_id=str(external_id) if external_id else None,
        data=json.dumps(body.fields),
        raw_data=json.dumps(body.fields),
        created_at=now,
        updated_at=now,
    )
    session.add(entry)
    session.flush()
    index_entry(session, entry.id, blueprint_id, extract_text_content(body.fields))
    log_activity(session, "entry.created", actor=current_user.username,
                 resource_type="entry", resource_id=entry.id,
                 detail={"blueprint_id": blueprint_id, "via": "manual"})
    session.commit()
    session.refresh(entry)
    ev = EntryEvent(
        id=str(uuid.uuid4()),
        entry_id=entry.id,
        blueprint_id=blueprint_id,
        event_type="created",
        changed_fields=json.dumps(list(body.fields.keys())),
        old_values="{}",
        new_values=json.dumps(body.fields),
        actor=current_user.username,
        created_at=datetime.now(timezone.utc),
    )
    session.add(ev)
    _enforce_entry_retention(session, bp)
    session.commit()
    _fire_blueprint_triggers(bp, [{"entry_id": entry.id, "parsed": body.fields}])
    return entry



class UpdateEntryBody(BaseModel):
    fields: dict


@router.patch("/{blueprint_id}/entries/{entry_id}")
async def update_entry(
    blueprint_id: str,
    entry_id: str,
    body: UpdateEntryBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")

    mutable_mode = getattr(bp, "mutable_mode", "none") or "none"
    if mutable_mode == "none":
        raise HTTPException(status_code=403, detail="This blueprint does not allow entry updates")

    field_mappings = json.loads(bp.field_mappings or "[]")
    if mutable_mode == "per_field":
        mutable_fields = {m["field_name"] for m in field_mappings if m.get("mutable")}
        disallowed = [k for k in body.fields if k not in mutable_fields]
        if disallowed:
            raise HTTPException(status_code=403, detail=f"Fields not mutable: {disallowed}")

    entry = session.exec(
        select(Entry).where(Entry.id == entry_id, Entry.blueprint_id == blueprint_id)
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    old_data = json.loads(entry.data or "{}")
    new_data = {**old_data, **body.fields}
    changed = [k for k in body.fields if old_data.get(k) != body.fields[k]]

    entry.data = json.dumps(new_data)
    entry.updated_at = datetime.now(timezone.utc)
    session.add(entry)

    ev = EntryEvent(
        id=str(uuid.uuid4()),
        entry_id=entry_id,
        blueprint_id=blueprint_id,
        event_type="updated",
        changed_fields=json.dumps(changed),
        old_values=json.dumps({k: old_data.get(k) for k in changed}),
        new_values=json.dumps({k: body.fields[k] for k in changed}),
        actor=current_user.username,
        created_at=datetime.now(timezone.utc),
    )
    session.add(ev)

    index_entry(session, entry.id, blueprint_id, extract_text_content(new_data))
    log_activity(session, "entry.updated", actor=current_user.username,
                 resource_type="entry", resource_id=entry_id,
                 detail={"blueprint_id": blueprint_id, "changed": changed})
    session.commit()
    session.refresh(entry)
    return entry


@router.get("/{blueprint_id}/entries/{entry_id}/history")
async def get_entry_history(
    blueprint_id: str,
    entry_id: str,
    session: Session = Depends(get_session),
):
    entry = session.exec(
        select(Entry).where(Entry.id == entry_id, Entry.blueprint_id == blueprint_id)
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    events = session.exec(
        select(EntryEvent).where(EntryEvent.entry_id == entry_id).order_by(EntryEvent.created_at.desc())
    ).all()
    return events


@router.post("/preview")
async def preview_endpoint(body: PreviewRequest):
    """Fire a URL and return the raw response for JSONPath exploration."""
    _validate_fetch_url(body.source_url)
    try:
        from backend.core.crypto import decrypt, resolve_secret_templates
        from backend.secrets.models import Secret
        from sqlmodel import Session as _Session, select as _select
        from backend.database import engine as _engine
        with _Session(_engine) as _s:
            secrets_map = {s.name: decrypt(s.encrypted_value) for s in _s.exec(_select(Secret)).all()}
        headers_str = resolve_secret_templates(body.source_headers or '{}', secrets_map)
        body_str = resolve_secret_templates(body.source_body or '{}', secrets_map)
        req_headers = json.loads(headers_str)
        req_body = json.loads(body_str)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in headers/body: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Secret resolution failed: {exc}")

    try:
        params = {}
        preview_body = dict(req_body or {})
        ptype = (body.pagination_type or "none").lower()
        if ptype in {"page_number", "offset"} and body.pagination_param:
            value = 1 if ptype == "page_number" else 0
            if body.source_method.upper() == "POST":
                preview_body[body.pagination_param] = value
            else:
                params[body.pagination_param] = value
        async with httpx.AsyncClient(timeout=15) as client:
            if body.source_method.upper() == "POST":
                response = await client.post(body.source_url, headers=req_headers, json=preview_body, params=params or None)
            else:
                response = await client.get(body.source_url, headers=req_headers, params=params or None)
        response.raise_for_status()
        raw = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Request failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    items_path = body.pagination_items_path
    recommended_items_path = _infer_items_path(raw)
    if body.auto_parse_items and not items_path:
        items_path = recommended_items_path

    items = _extract_fetch_items(raw, items_path)
    is_list = len(items) != 1 or isinstance(raw, list) or bool(items_path)
    total = len(items) if is_list else 1
    sample = items[:body.sample_limit] if is_list else (items[0] if items else raw)
    sample_item = items[0] if items else raw

    return {
        "is_list": is_list,
        "total": total,
        "sample": sample,
        "status_code": response.status_code,
        "recommended_items_path": recommended_items_path,
        "auto_mappings": _build_auto_mappings(sample_item) if body.auto_parse_items else [],
    }
