import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core.auth import verify_token
from backend.database import get_session
from backend.objects.indexer import index_entry, remove_from_index, search_fts
from backend.objects.models import Entry, Blueprint
from backend.objects.parser import extract_text_content, parse_instance

logger = logging.getLogger(__name__)
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


class PreviewRequest(BaseModel):
    source_url: str
    source_method: str = "GET"
    source_headers: str = "{}"
    source_body: str = "{}"
    sample_limit: int = 1


class CreateEntryBody(BaseModel):
    fields: dict


# ── Blueprint CRUD ────────────────────────────────────────────────────────────

@router.get("")
async def list_blueprints(session: Session = Depends(get_session)):
    return session.exec(select(Blueprint)).all()


@router.post("", status_code=201)
async def create_blueprint(
    body: BlueprintCreate,
    session: Session = Depends(get_session),
):
    bp = Blueprint(
        id=str(uuid.uuid4()),
        **body.model_dump(),
        created_at=datetime.now(timezone.utc),
    )
    session.add(bp)
    session.commit()
    session.refresh(bp)
    return bp


@router.get("/entries")
async def list_entries(
    blueprint_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    filter: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    from backend.objects.filter import apply_field_filter, python_field_filter
    if q:
        ids = search_fts(session, q, blueprint_id=blueprint_id, limit=limit, offset=offset)
        if not ids:
            return []
        entries = session.exec(select(Entry).where(Entry.id.in_(ids))).all()
        order = {eid: i for i, eid in enumerate(ids)}
        entries = sorted(entries, key=lambda x: order.get(x.id, 999))
        return python_field_filter(entries, filter) if filter else entries

    stmt = select(Entry)
    if blueprint_id:
        stmt = stmt.where(Entry.blueprint_id == blueprint_id)
    if filter:
        stmt = apply_field_filter(stmt, filter, Entry.data)
    stmt = stmt.order_by(Entry.created_at.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()


@router.get("/entries/{entry_id}")
async def get_entry(entry_id: str, session: Session = Depends(get_session)):
    entry = session.get(Entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: str, session: Session = Depends(get_session)):
    entry = session.get(Entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    remove_from_index(session, entry_id)
    session.delete(entry)
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
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(bp, field, value)
    session.add(bp)
    session.commit()
    session.refresh(bp)
    updated = body.model_dump(exclude_none=True)
    if "fetch_cron" in updated or "fetch_is_active" in updated:
        from backend.core.scheduler import sync_cron_jobs
        sync_cron_jobs()
    return bp


@router.delete("/{blueprint_id}", status_code=204)
async def delete_blueprint(blueprint_id: str, session: Session = Depends(get_session)):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    entries = session.exec(select(Entry).where(Entry.blueprint_id == blueprint_id)).all()
    for entry in entries:
        remove_from_index(session, entry.id)
        session.delete(entry)
    session.delete(bp)
    session.commit()


# ── Auto-fetch helpers ────────────────────────────────────────────────────────

def _load_secrets_map(session: Session) -> dict:
    from backend.core.crypto import decrypt
    from backend.secrets.models import Secret
    from sqlmodel import select as _select
    return {s.name: decrypt(s.encrypted_value) for s in session.exec(_select(Secret)).all()}


def _resolve_request_params(bp: Blueprint, secrets_map: dict) -> tuple[dict, dict]:
    from backend.core.crypto import resolve_secret_templates
    headers = json.loads(resolve_secret_templates(bp.source_headers or "{}", secrets_map))
    body = json.loads(resolve_secret_templates(bp.source_body or "{}", secrets_map))
    return headers, body


async def _fetch_raw_items(bp: Blueprint, headers: dict, body: dict) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        if bp.source_method.upper() == "POST":
            response = await client.post(bp.source_url, headers=headers, json=body)
        else:
            response = await client.get(bp.source_url, headers=headers)
    response.raise_for_status()
    raw = response.json()
    return raw if isinstance(raw, list) else [raw]


def _upsert_entries(bp: Blueprint, items: list, field_mappings: list, session: Session) -> tuple[int, int]:
    key_field = next((m["field_name"] for m in field_mappings if m.get("is_key")), "external_id")
    created, skipped = 0, 0
    for item in items:
        parsed = parse_instance(item, field_mappings)
        external_id = parsed.get(key_field)
        if external_id and session.exec(
            select(Entry).where(
                Entry.blueprint_id == bp.id,
                Entry.external_id == str(external_id),
            )
        ).first():
            skipped += 1
            continue
        now = datetime.now(timezone.utc)
        entry = Entry(
            id=str(uuid.uuid4()),
            blueprint_id=bp.id,
            external_id=str(external_id) if external_id else None,
            data=json.dumps(parsed),
            raw_data=json.dumps(item),
            created_at=now,
            updated_at=now,
        )
        session.add(entry)
        session.flush()
        index_entry(session, entry.id, bp.id, extract_text_content(parsed))
        created += 1
    session.commit()
    return created, skipped


def _fire_pybook_trigger(bp: Blueprint, blueprint_id: str, created_count: int) -> None:
    from backend.core import queue_manager
    from backend.pybooks.models import PyBook, PyBookRun
    from backend.database import engine as _engine
    try:
        with Session(_engine) as _ts:
            _pb = _ts.get(PyBook, bp.trigger_pybook_id)
            if not (_pb and _pb.is_active):
                return
            _now = datetime.now(timezone.utc)
            _run = PyBookRun(
                id=str(uuid.uuid4()),
                pybook_id=bp.trigger_pybook_id,
                status="queued",
                trigger_source="blueprint",
                trigger_payload=json.dumps({"blueprint_id": blueprint_id, "created": created_count}),
                started_at=_now,
            )
            _ts.add(_run)
            _ts.commit()
            queue_manager.enqueue(bp.trigger_pybook_id, _run.id)
    except Exception as exc:
        logger.warning("Failed to trigger PyBook after fetch: %s", exc)


async def _do_fetch(blueprint_id: str, session: Session) -> dict:
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise ValueError(f"Blueprint {blueprint_id} not found")
    if not bp.source_url:
        raise ValueError("Blueprint has no source_url configured")

    field_mappings = json.loads(bp.field_mappings or "[]")

    try:
        secrets_map = _load_secrets_map(session)
        req_headers, req_body = _resolve_request_params(bp, secrets_map)
    except Exception:
        req_headers = json.loads(bp.source_headers or "{}")
        req_body = json.loads(bp.source_body or "{}")

    try:
        items = await _fetch_raw_items(bp, req_headers, req_body)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Upstream fetch failed: {exc}")

    created_count, skipped_count = _upsert_entries(bp, items, field_mappings, session)

    trigger_event = getattr(bp, "trigger_event", "on_create")
    if bp.trigger_pybook_id and created_count > 0 and trigger_event in ("on_create", "on_create_or_update"):
        _fire_pybook_trigger(bp, blueprint_id, created_count)

    return {"created": created_count, "skipped": skipped_count, "total": len(items)}


@router.post("/{blueprint_id}/fetch")
async def fetch_blueprint(blueprint_id: str, session: Session = Depends(get_session)):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    if not bp.source_url:
        raise HTTPException(status_code=400, detail="Blueprint has no source_url configured")
    try:
        return await _do_fetch(blueprint_id, session)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Endpoint preview (no persistence) ────────────────────────────────────────

def _resolve_preview_params(body: PreviewRequest) -> tuple[dict, dict]:
    from backend.core.crypto import decrypt, resolve_secret_templates
    from backend.secrets.models import Secret
    from sqlmodel import Session as _Session, select as _select
    from backend.database import engine as _engine
    with _Session(_engine) as _s:
        secrets_map = {s.name: decrypt(s.encrypted_value) for s in _s.exec(_select(Secret)).all()}
    headers = json.loads(resolve_secret_templates(body.source_headers or "{}", secrets_map))
    req_body = json.loads(resolve_secret_templates(body.source_body or "{}", secrets_map))
    return headers, req_body


@router.post("/preview")
async def preview_endpoint(body: PreviewRequest):
    try:
        req_headers, req_body = _resolve_preview_params(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in headers/body: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Secret resolution failed: {exc}")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if body.source_method.upper() == "POST":
                response = await client.post(body.source_url, headers=req_headers, json=req_body)
            else:
                response = await client.get(body.source_url, headers=req_headers)
        response.raise_for_status()
        raw = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Request failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    is_list = isinstance(raw, list)
    return {
        "is_list": is_list,
        "total": len(raw) if is_list else 1,
        "sample": raw[:body.sample_limit] if is_list else raw,
        "status_code": response.status_code,
    }


# ── Manual entry creation ─────────────────────────────────────────────────────

@router.post("/{blueprint_id}/entries", status_code=201)
async def create_manual_entry(blueprint_id: str, body: CreateEntryBody, session: Session = Depends(get_session)):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    field_mappings = json.loads(bp.field_mappings or "[]")
    key_field = next((m["field_name"] for m in field_mappings if m.get("is_key")), None)
    external_id = body.fields.get(key_field) if key_field else None
    if external_id and session.exec(
        select(Entry).where(Entry.blueprint_id == blueprint_id, Entry.external_id == str(external_id))
    ).first():
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
    session.commit()
    session.refresh(entry)
    return entry
