import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, require_admin, verify_token
from backend.database import get_session
from backend.objects.models import Blueprint, Entry
from backend.pybooks.models import PyBook
from backend.pybooks.store import write_script
from backend.workflows.models import Workflow

router = APIRouter(prefix="/api", tags=["export_import"], dependencies=[Depends(verify_token)])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _find_by_name(session: Session, model_class, name: str):
    return session.exec(select(model_class).where(model_class.name == name)).first()


def _safe_rename(session: Session, obj, model_class) -> None:
    new_name = f"{obj.name} (pre-import)"
    if _find_by_name(session, model_class, new_name):
        new_name = f"{obj.name} (pre-import {uuid.uuid4().hex[:6]})"
    obj.name = new_name
    session.add(obj)


def _pybook_fields_from_export(data: dict) -> dict:
    return {
        "description": data.get("description"),
        "script": data.get("script", ""),
        "is_sub_pybook": data.get("is_sub_pybook", False),
        "dependencies": data.get("dependencies", "[]"),
        "trigger_type": data.get("trigger_type", "manual"),
        "trigger_config": data.get("trigger_config", "{}"),
        "required_secrets": data.get("required_secrets", "[]"),
        "tags": data.get("tags", "[]"),
    }


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/pybooks/{pybook_id}/export")
async def export_pybook(
    pybook_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    pb = session.get(PyBook, pybook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="PyBook not found")
    data = {
        "pylo_export": "pybook",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "name": pb.name,
        **_pybook_fields_from_export({
            "description": pb.description,
            "script": pb.script,
            "is_sub_pybook": pb.is_sub_pybook,
            "dependencies": pb.dependencies,
            "trigger_type": pb.trigger_type,
            "trigger_config": pb.trigger_config,
            "required_secrets": pb.required_secrets,
            "tags": pb.tags,
        }),
    }
    log_activity(session, "pybook.exported", actor=current_user.username,
                 resource_type="pybook", resource_id=pb.id, resource_name=pb.name)
    session.commit()
    filename = f"pybook_{pb.name.replace(' ', '_')}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/blueprints/{blueprint_id}/export")
async def export_blueprint(
    blueprint_id: str,
    include_entries: bool = False,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    bp = session.get(Blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    data = {
        "pylo_export": "blueprint",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "name": bp.name,
        "description": bp.description,
        "source_url": bp.source_url,
        "source_method": bp.source_method,
        "source_headers": bp.source_headers,
        "source_body": bp.source_body,
        "field_mappings": bp.field_mappings,
        "fetch_cron": bp.fetch_cron,
        "fetch_is_active": bp.fetch_is_active,
        "is_manual": bp.is_manual,
        "pagination_type": bp.pagination_type,
        "pagination_param": bp.pagination_param,
        "pagination_path": bp.pagination_path,
        "pagination_items_path": bp.pagination_items_path,
        "pagination_max_pages": bp.pagination_max_pages,
        "max_entries": bp.max_entries,
        "retention_days": bp.retention_days,
        "retention_minutes": bp.retention_minutes,
        "mutable_mode": bp.mutable_mode,
    }
    if include_entries:
        entries = session.exec(select(Entry).where(Entry.blueprint_id == blueprint_id)).all()
        data["entries"] = [
            {"external_id": e.external_id, "data": e.data, "raw_data": e.raw_data}
            for e in entries
        ]
    log_activity(session, "blueprint.exported", actor=current_user.username,
                 resource_type="blueprint", resource_id=bp.id, resource_name=bp.name,
                 detail={"include_entries": include_entries})
    session.commit()
    filename = f"blueprint_{bp.name.replace(' ', '_')}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/workflows/{workflow_id}/export")
async def export_workflow(
    workflow_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    wf = session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    nodes = json.loads(wf.nodes or "[]")
    pybook_ids = list({n["pybookId"] for n in nodes if n.get("pybookId")})

    embedded_pybooks = []
    for pb_id in pybook_ids:
        pb = session.get(PyBook, pb_id)
        if pb:
            embedded_pybooks.append({
                "original_id": pb.id,
                "name": pb.name,
                **_pybook_fields_from_export({
                    "description": pb.description,
                    "script": pb.script,
                    "is_sub_pybook": pb.is_sub_pybook,
                    "dependencies": pb.dependencies,
                    "trigger_type": pb.trigger_type,
                    "trigger_config": pb.trigger_config,
                    "required_secrets": pb.required_secrets,
                    "tags": pb.tags,
                }),
            })

    data = {
        "pylo_export": "workflow",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "name": wf.name,
        "description": wf.description,
        "is_active": wf.is_active,
        "trigger_type": wf.trigger_type,
        "trigger_config": wf.trigger_config,
        "nodes": wf.nodes,
        "edges": wf.edges,
        "pybooks": embedded_pybooks,
    }
    log_activity(session, "workflow.exported", actor=current_user.username,
                 resource_type="workflow", resource_id=wf.id, resource_name=wf.name,
                 detail={"embedded_pybooks": len(embedded_pybooks)})
    session.commit()
    filename = f"workflow_{wf.name.replace(' ', '_')}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Import ────────────────────────────────────────────────────────────────────

class ImportBody(BaseModel):
    data: dict
    resolution: Optional[str] = None                 # "update" | "rename" for main object
    pybook_resolutions: dict[str, str] = {}           # pybook_name → "update" | "rename"


@router.post("/pybooks/import", status_code=201)
async def import_pybook(
    body: ImportBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    data = body.data
    if data.get("pylo_export") != "pybook":
        raise HTTPException(status_code=400, detail="Invalid export type: expected 'pybook'")

    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Missing name in export data")

    existing = _find_by_name(session, PyBook, name)
    if existing and not body.resolution:
        return JSONResponse(
            status_code=409,
            content={"conflicts": [{"key": "main", "name": name, "existing_id": existing.id, "type": "pybook"}]},
        )

    now = datetime.now(timezone.utc)
    fields = _pybook_fields_from_export(data)

    if existing and body.resolution == "rename":
        _safe_rename(session, existing, PyBook)
        session.commit()
        existing = None

    if existing and body.resolution == "update":
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = now
        write_script(existing.id, existing.script)
        session.add(existing)
        log_activity(session, "pybook.imported", actor=current_user.username,
                     resource_type="pybook", resource_id=existing.id, resource_name=existing.name,
                     detail={"action": "update"})
        session.commit()
        session.refresh(existing)
        return existing

    pb = PyBook(id=str(uuid.uuid4()), name=name, created_at=now, updated_at=now, **fields)
    write_script(pb.id, pb.script)
    session.add(pb)
    log_activity(session, "pybook.imported", actor=current_user.username,
                 resource_type="pybook", resource_id=pb.id, resource_name=pb.name,
                 detail={"action": "create"})
    session.commit()
    session.refresh(pb)
    return pb


@router.post("/blueprints/import", status_code=201)
async def import_blueprint(
    body: ImportBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    data = body.data
    if data.get("pylo_export") != "blueprint":
        raise HTTPException(status_code=400, detail="Invalid export type: expected 'blueprint'")

    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Missing name in export data")

    existing = _find_by_name(session, Blueprint, name)
    if existing and not body.resolution:
        return JSONResponse(
            status_code=409,
            content={"conflicts": [{"key": "main", "name": name, "existing_id": existing.id, "type": "blueprint"}]},
        )

    now = datetime.now(timezone.utc)
    bp_fields = {
        "name": name,
        "description": data.get("description"),
        "source_url": data.get("source_url"),
        "source_method": data.get("source_method", "GET"),
        "source_headers": data.get("source_headers", "{}"),
        "source_body": data.get("source_body", "{}"),
        "field_mappings": data.get("field_mappings", "[]"),
        "fetch_cron": data.get("fetch_cron"),
        "fetch_is_active": data.get("fetch_is_active", False),
        "is_manual": data.get("is_manual", False),
        "pagination_type": data.get("pagination_type", "none"),
        "pagination_param": data.get("pagination_param"),
        "pagination_path": data.get("pagination_path"),
        "pagination_items_path": data.get("pagination_items_path"),
        "pagination_max_pages": data.get("pagination_max_pages", 50),
        "max_entries": data.get("max_entries"),
        "retention_days": data.get("retention_days"),
        "retention_minutes": data.get("retention_minutes"),
        "mutable_mode": data.get("mutable_mode", "none"),
    }

    if existing and body.resolution == "rename":
        _safe_rename(session, existing, Blueprint)
        session.commit()
        existing = None

    if existing and body.resolution == "update":
        for k, v in bp_fields.items():
            if k != "name":
                setattr(existing, k, v)
        session.add(existing)
        if data.get("entries"):
            _import_entries(session, existing.id, data["entries"])
        log_activity(session, "blueprint.imported", actor=current_user.username,
                     resource_type="blueprint", resource_id=existing.id, resource_name=existing.name,
                     detail={"action": "update"})
        session.commit()
        session.refresh(existing)
        return existing

    bp = Blueprint(id=str(uuid.uuid4()), created_at=now, **bp_fields)
    session.add(bp)
    if data.get("entries"):
        _import_entries(session, bp.id, data["entries"])
    log_activity(session, "blueprint.imported", actor=current_user.username,
                 resource_type="blueprint", resource_id=bp.id, resource_name=bp.name,
                 detail={"action": "create"})
    session.commit()
    session.refresh(bp)
    return bp


def _import_entries(session: Session, blueprint_id: str, entries: list) -> None:
    now = datetime.now(timezone.utc)
    for e_data in entries:
        entry = Entry(
            id=str(uuid.uuid4()),
            blueprint_id=blueprint_id,
            external_id=e_data.get("external_id"),
            data=e_data.get("data", "{}"),
            raw_data=e_data.get("raw_data", "{}"),
            created_at=now,
            updated_at=now,
        )
        session.add(entry)


@router.post("/workflows/import", status_code=201)
async def import_workflow(
    body: ImportBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    data = body.data
    if data.get("pylo_export") != "workflow":
        raise HTTPException(status_code=400, detail="Invalid export type: expected 'workflow'")

    wf_name = data.get("name", "").strip()
    if not wf_name:
        raise HTTPException(status_code=400, detail="Missing name in export data")

    embedded_pybooks = data.get("pybooks", [])

    # Collect all conflicts first so the UI can show them all at once
    conflicts = []
    wf_existing = _find_by_name(session, Workflow, wf_name)
    if wf_existing:
        conflicts.append({
            "key": "main",
            "name": wf_name,
            "existing_id": wf_existing.id,
            "type": "workflow",
        })

    pb_existing_map: dict[str, PyBook] = {}
    for epb in embedded_pybooks:
        pb_name = epb.get("name", "")
        pb_existing = _find_by_name(session, PyBook, pb_name)
        if pb_existing:
            pb_existing_map[pb_name] = pb_existing
            conflicts.append({
                "key": f"pybook:{pb_name}",
                "name": pb_name,
                "existing_id": pb_existing.id,
                "type": "pybook",
            })

    # Determine which conflicts still lack a resolution
    unresolved = []
    for c in conflicts:
        if c["type"] == "workflow" and not body.resolution:
            unresolved.append(c)
        elif c["type"] == "pybook" and c["name"] not in body.pybook_resolutions:
            unresolved.append(c)

    if unresolved:
        return JSONResponse(status_code=409, content={"conflicts": unresolved})

    now = datetime.now(timezone.utc)

    # Process embedded PyBooks and build original_id → new_id map for node remapping
    pb_id_map: dict[str, str] = {}
    for epb in embedded_pybooks:
        pb_name = epb["name"]
        original_id = epb.get("original_id", "")
        resolution = body.pybook_resolutions.get(pb_name, "")
        pb_existing = pb_existing_map.get(pb_name)
        fields = _pybook_fields_from_export(epb)

        if pb_existing and resolution == "rename":
            _safe_rename(session, pb_existing, PyBook)
            session.commit()
            pb_existing = None

        if pb_existing and resolution == "update":
            for k, v in fields.items():
                setattr(pb_existing, k, v)
            pb_existing.updated_at = now
            write_script(pb_existing.id, pb_existing.script)
            session.add(pb_existing)
            pb_id_map[original_id] = pb_existing.id
        else:
            new_pb = PyBook(id=str(uuid.uuid4()), name=pb_name, created_at=now, updated_at=now, **fields)
            write_script(new_pb.id, new_pb.script)
            session.add(new_pb)
            pb_id_map[original_id] = new_pb.id

    # Remap pybookId references in nodes to the new IDs
    nodes = json.loads(data.get("nodes", "[]"))
    for n in nodes:
        orig = n.get("pybookId", "")
        if orig in pb_id_map:
            n["pybookId"] = pb_id_map[orig]

    wf_fields = {
        "name": wf_name,
        "description": data.get("description"),
        "is_active": data.get("is_active", True),
        "trigger_type": data.get("trigger_type", "manual"),
        "trigger_config": data.get("trigger_config", "{}"),
        "nodes": json.dumps(nodes),
        "edges": data.get("edges", "[]"),
    }

    if wf_existing and body.resolution == "rename":
        _safe_rename(session, wf_existing, Workflow)
        session.commit()
        wf_existing = None

    if wf_existing and body.resolution == "update":
        for k, v in wf_fields.items():
            if k != "name":
                setattr(wf_existing, k, v)
        wf_existing.updated_at = now
        session.add(wf_existing)
        log_activity(session, "workflow.imported", actor=current_user.username,
                     resource_type="workflow", resource_id=wf_existing.id, resource_name=wf_existing.name,
                     detail={"action": "update"})
        session.commit()
        session.refresh(wf_existing)
        return wf_existing

    new_wf = Workflow(id=str(uuid.uuid4()), created_at=now, updated_at=now, **wf_fields)
    session.add(new_wf)
    log_activity(session, "workflow.imported", actor=current_user.username,
                 resource_type="workflow", resource_id=new_wf.id, resource_name=new_wf.name,
                 detail={"action": "create"})
    session.commit()
    session.refresh(new_wf)
    return new_wf
