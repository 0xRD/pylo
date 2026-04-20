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
from backend.objects.indexer import index_instance, remove_from_index, search_fts
from backend.objects.models import ObjectInstance, ObjectType
from backend.objects.parser import extract_text_content, parse_instance

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/objects", tags=["objects"], dependencies=[Depends(verify_token)])


# ── Pydantic request/response schemas ────────────────────────────────────────

class ObjectTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_method: str = "GET"
    source_headers: str = "{}"
    source_body: str = "{}"
    field_mappings: str = "[]"
    trigger_pybook_id: Optional[str] = None
    polling_interval_seconds: Optional[int] = None


class ObjectTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_method: Optional[str] = None
    source_headers: Optional[str] = None
    source_body: Optional[str] = None
    field_mappings: Optional[str] = None
    trigger_pybook_id: Optional[str] = None
    polling_interval_seconds: Optional[int] = None


# ── ObjectType CRUD ───────────────────────────────────────────────────────────

@router.get("/types")
async def list_object_types(session: Session = Depends(get_session)):
    return session.exec(select(ObjectType)).all()


@router.post("/types", status_code=201)
async def create_object_type(
    body: ObjectTypeCreate,
    session: Session = Depends(get_session),
):
    obj = ObjectType(
        id=str(uuid.uuid4()),
        **body.model_dump(),
        created_at=datetime.now(timezone.utc),
    )
    session.add(obj)
    session.commit()
    session.refresh(obj)
    return obj


@router.get("/types/{type_id}")
async def get_object_type(type_id: str, session: Session = Depends(get_session)):
    obj = session.get(ObjectType, type_id)
    if not obj:
        raise HTTPException(status_code=404, detail="ObjectType not found")
    return obj


@router.put("/types/{type_id}")
async def update_object_type(
    type_id: str,
    body: ObjectTypeUpdate,
    session: Session = Depends(get_session),
):
    obj = session.get(ObjectType, type_id)
    if not obj:
        raise HTTPException(status_code=404, detail="ObjectType not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(obj, field, value)
    session.add(obj)
    session.commit()
    session.refresh(obj)
    return obj


@router.delete("/types/{type_id}", status_code=204)
async def delete_object_type(type_id: str, session: Session = Depends(get_session)):
    obj = session.get(ObjectType, type_id)
    if not obj:
        raise HTTPException(status_code=404, detail="ObjectType not found")
    # Delete all instances + FTS entries
    instances = session.exec(
        select(ObjectInstance).where(ObjectInstance.object_type_id == type_id)
    ).all()
    for inst in instances:
        remove_from_index(session, inst.id)
        session.delete(inst)
    session.delete(obj)
    session.commit()


# ── Manual fetch ──────────────────────────────────────────────────────────────

@router.post("/types/{type_id}/fetch")
async def fetch_object_type(type_id: str, session: Session = Depends(get_session)):
    obj = session.get(ObjectType, type_id)
    if not obj:
        raise HTTPException(status_code=404, detail="ObjectType not found")
    if not obj.source_url:
        raise HTTPException(status_code=400, detail="ObjectType has no source_url configured")

    headers = json.loads(obj.source_headers or "{}")
    body = json.loads(obj.source_body or "{}")
    field_mappings = json.loads(obj.field_mappings or "[]")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if obj.source_method.upper() == "POST":
                response = await client.post(obj.source_url, headers=headers, json=body)
            else:
                response = await client.get(obj.source_url, headers=headers)
        response.raise_for_status()
        raw_data = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream fetch failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # raw_data may be a list or a single object
    items = raw_data if isinstance(raw_data, list) else [raw_data]
    created_count = 0
    skipped_count = 0

    for item in items:
        parsed = parse_instance(item, field_mappings)
        external_id = parsed.get("external_id") or parsed.get("id")

        # Deduplication
        if external_id:
            existing = session.exec(
                select(ObjectInstance).where(
                    ObjectInstance.object_type_id == type_id,
                    ObjectInstance.external_id == str(external_id),
                )
            ).first()
            if existing:
                skipped_count += 1
                continue

        now = datetime.now(timezone.utc)
        inst = ObjectInstance(
            id=str(uuid.uuid4()),
            object_type_id=type_id,
            external_id=str(external_id) if external_id else None,
            data=json.dumps(parsed),
            raw_data=json.dumps(item),
            created_at=now,
            updated_at=now,
        )
        session.add(inst)
        session.flush()  # get inst.id before indexing
        index_instance(session, inst.id, type_id, extract_text_content(parsed))
        created_count += 1

    session.commit()
    return {"created": created_count, "skipped": skipped_count, "total": len(items)}


# ── ObjectInstance routes ─────────────────────────────────────────────────────

@router.get("/instances")
async def list_instances(
    type_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    if q:
        ids = search_fts(session, q, object_type_id=type_id, limit=limit, offset=offset)
        if not ids:
            return []
        instances = session.exec(
            select(ObjectInstance).where(ObjectInstance.id.in_(ids))
        ).all()
        # Preserve FTS rank order
        order = {iid: i for i, iid in enumerate(ids)}
        return sorted(instances, key=lambda x: order.get(x.id, 999))

    stmt = select(ObjectInstance)
    if type_id:
        stmt = stmt.where(ObjectInstance.object_type_id == type_id)
    stmt = stmt.order_by(ObjectInstance.created_at.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()


@router.get("/instances/{instance_id}")
async def get_instance(instance_id: str, session: Session = Depends(get_session)):
    inst = session.get(ObjectInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="ObjectInstance not found")
    return inst


@router.delete("/instances/{instance_id}", status_code=204)
async def delete_instance(instance_id: str, session: Session = Depends(get_session)):
    inst = session.get(ObjectInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="ObjectInstance not found")
    remove_from_index(session, instance_id)
    session.delete(inst)
    session.commit()
