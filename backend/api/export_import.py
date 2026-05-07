import base64
import io
import json
import logging
import os
import pathlib
import re
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Optional

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.core.auth import AuthUser, require_admin, verify_token
from backend.core.settings_model import SystemSetting
from backend.database import get_session
from backend.objects.models import Blueprint, Entry
from backend.pybooks.models import PyBook
from backend.pybooks.store import write_script
from backend.workflows.models import Workflow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["export_import"], dependencies=[Depends(verify_token)])

BACKUPS_DIR = pathlib.Path("/app/objects_storage/backups")


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


def _safe_filename(value: str, fallback: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", (value or "").strip()).strip("_")
    return slug or fallback


def _blueprint_fields_from_export(data: dict) -> dict:
    return {
        "name": data.get("name", "").strip(),
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
        "fetch_entry_limit": data.get("fetch_entry_limit"),
        "fetch_retry_count": data.get("fetch_retry_count", 0),
        "fetch_retry_delay_seconds": data.get("fetch_retry_delay_seconds", 2),
        "fetch_on_fail_pybook_id": data.get("fetch_on_fail_pybook_id"),
        "max_entries": data.get("max_entries"),
        "retention_days": data.get("retention_days"),
        "retention_minutes": data.get("retention_minutes"),
        "mutable_mode": data.get("mutable_mode", "none"),
    }


def _blueprint_export_data(session: Session, bp: Blueprint, include_entries: bool = False) -> dict:
    data = {
        "pylo_export": "blueprint",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "id": bp.id,
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
        "fetch_entry_limit": bp.fetch_entry_limit,
        "fetch_retry_count": bp.fetch_retry_count,
        "fetch_retry_delay_seconds": bp.fetch_retry_delay_seconds,
        "fetch_on_fail_pybook_id": bp.fetch_on_fail_pybook_id,
        "max_entries": bp.max_entries,
        "retention_days": bp.retention_days,
        "retention_minutes": bp.retention_minutes,
        "mutable_mode": bp.mutable_mode,
    }
    if include_entries:
        entries = session.exec(select(Entry).where(Entry.blueprint_id == bp.id)).all()
        data["entries"] = [
            {"external_id": e.external_id, "data": e.data, "raw_data": e.raw_data}
            for e in entries
        ]
    return data


def _pybook_export_data(pb: PyBook) -> dict:
    return {
        "pylo_export": "pybook",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "id": pb.id,
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


def _workflow_export_data(session: Session, wf: Workflow, embed_pybooks: bool = True) -> dict:
    embedded_pybooks = []
    if embed_pybooks:
        nodes = json.loads(wf.nodes or "[]")
        pybook_ids = list({n["pybookId"] for n in nodes if n.get("pybookId")})
        for pb_id in pybook_ids:
            pb = session.get(PyBook, pb_id)
            if pb:
                embedded_pybooks.append({"original_id": pb.id, **_pybook_export_data(pb)})

    return {
        "pylo_export": "workflow",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "id": wf.id,
        "name": wf.name,
        "description": wf.description,
        "is_active": wf.is_active,
        "trigger_type": wf.trigger_type,
        "trigger_config": wf.trigger_config,
        "nodes": wf.nodes,
        "edges": wf.edges,
        "pybooks": embedded_pybooks,
    }


def _get_by_id_or_name(session: Session, model_class, object_id: str | None, name: str | None):
    existing = session.get(model_class, object_id) if object_id else None
    return existing or (_find_by_name(session, model_class, name) if name else None)


def _upsert_pybook(session: Session, data: dict, now: datetime) -> tuple[str | None, str | None]:
    name = data.get("name", "").strip()
    if not name:
        return data.get("id"), None
    fields = _pybook_fields_from_export(data)
    original_id = data.get("id") or data.get("original_id")
    existing = _get_by_id_or_name(session, PyBook, original_id, name)
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.name = name
        existing.updated_at = now
        session.add(existing)
        write_script(existing.id, existing.script)
        return original_id, existing.id

    new_id = original_id if original_id and not session.get(PyBook, original_id) else str(uuid.uuid4())
    pb = PyBook(id=new_id, name=name, created_at=now, updated_at=now, **fields)
    session.add(pb)
    write_script(pb.id, pb.script)
    return original_id, pb.id


def _upsert_blueprint(session: Session, data: dict, now: datetime) -> tuple[str | None, str | None]:
    fields = _blueprint_fields_from_export(data)
    name = fields.get("name")
    if not name:
        return data.get("id"), None
    original_id = data.get("id")
    existing = _get_by_id_or_name(session, Blueprint, original_id, name)
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        session.add(existing)
        if data.get("entries"):
            _import_entries(session, existing.id, data["entries"])
        return original_id, existing.id

    new_id = original_id if original_id and not session.get(Blueprint, original_id) else str(uuid.uuid4())
    bp = Blueprint(id=new_id, created_at=now, **fields)
    session.add(bp)
    if data.get("entries"):
        _import_entries(session, bp.id, data["entries"])
    return original_id, bp.id


def _upsert_workflow(session: Session, data: dict, pybook_id_map: dict[str, str], now: datetime) -> tuple[str | None, str | None]:
    name = data.get("name", "").strip()
    if not name:
        return data.get("id"), None
    nodes = json.loads(data.get("nodes", "[]"))
    for node in nodes:
        old_id = node.get("pybookId")
        if old_id in pybook_id_map:
            node["pybookId"] = pybook_id_map[old_id]
    fields = {
        "name": name,
        "description": data.get("description"),
        "is_active": data.get("is_active", True),
        "trigger_type": data.get("trigger_type", "manual"),
        "trigger_config": data.get("trigger_config", "{}"),
        "nodes": json.dumps(nodes),
        "edges": data.get("edges", "[]"),
    }
    original_id = data.get("id")
    existing = _get_by_id_or_name(session, Workflow, original_id, name)
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = now
        session.add(existing)
        return original_id, existing.id

    new_id = original_id if original_id and not session.get(Workflow, original_id) else str(uuid.uuid4())
    wf = Workflow(id=new_id, created_at=now, updated_at=now, **fields)
    session.add(wf)
    return original_id, wf.id


# ── Backup helpers ─────────────────────────────────────────────────────────────

def _derive_fernet_key(passphrase: str, salt: bytes) -> bytes:
    """Derive a Fernet-compatible key from a passphrase using PBKDF2-SHA256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))


def _build_full_zip(
    session: Session,
    include_secrets: bool = False,
    passphrase: str | None = None,
) -> tuple[bytes, dict]:
    """Build the full backup ZIP. Returns (zip_bytes, manifest)."""
    from backend.core.crypto import decrypt as _crypto_decrypt

    exported_at = datetime.now(timezone.utc)
    blueprints = session.exec(select(Blueprint)).all()
    pybooks = session.exec(select(PyBook)).all()
    workflows = session.exec(select(Workflow)).all()
    settings_rows = session.exec(select(SystemSetting)).all()

    manifest = {
        "pylo_export": "full_backup",
        "version": 1,
        "exported_at": exported_at.isoformat(),
        "include_secrets": include_secrets and bool(passphrase),
        "counts": {
            "blueprints": len(blueprints),
            "pybooks": len(pybooks),
            "workflows": len(workflows),
            "settings": len(settings_rows),
        },
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr("settings.json", json.dumps({r.key: r.value for r in settings_rows}, indent=2))

        if include_secrets and passphrase:
            from backend.secrets.models import Secret as SecretModel
            secrets = session.exec(select(SecretModel)).all()
            salt = os.urandom(16)
            fernet_key = _derive_fernet_key(passphrase, salt)
            f = Fernet(fernet_key)
            encrypted_secrets: dict[str, str] = {}
            for s in secrets:
                try:
                    plain = _crypto_decrypt(s.encrypted_value)
                    encrypted_secrets[s.name] = f.encrypt(plain.encode()).decode()
                except Exception:
                    pass  # skip secrets that cannot be decrypted
            secrets_payload = {
                "algorithm": "PBKDF2HMAC-SHA256",
                "iterations": 100_000,
                "salt": salt.hex(),
                "secrets": encrypted_secrets,
            }
            zf.writestr("secrets/encrypted.json", json.dumps(secrets_payload, indent=2))
        else:
            zf.writestr("secrets/README.txt", "Secrets are intentionally excluded from this backup.\n")

        def _unique_name(used: set, slug: str, fallback_id: str) -> str:
            """Return a unique filename within the ZIP (dedup by appending the ID)."""
            candidate = slug
            if candidate in used:
                candidate = f"{slug}_{fallback_id[:8]}"
            used.add(candidate)
            return candidate

        bp_used: set = set()
        for bp in blueprints:
            slug = _unique_name(bp_used, _safe_filename(bp.name, bp.id), bp.id)
            zf.writestr(f"blueprints/{slug}.json", json.dumps(_blueprint_export_data(session, bp), indent=2))
        pb_used: set = set()
        for pb in pybooks:
            slug = _unique_name(pb_used, _safe_filename(pb.name, pb.id), pb.id)
            zf.writestr(f"pybooks/{slug}.json", json.dumps(_pybook_export_data(pb), indent=2))
        wf_used: set = set()
        for wf in workflows:
            slug = _unique_name(wf_used, _safe_filename(wf.name, wf.id), wf.id)
            zf.writestr(f"workflows/{slug}.json", json.dumps(_workflow_export_data(session, wf, embed_pybooks=False), indent=2))

    buffer.seek(0)
    return buffer.getvalue(), manifest


def save_backup_to_disk(session: Session) -> str:
    """Generate a full backup ZIP (no secrets) and save it to BACKUPS_DIR. Returns filename."""
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    zip_bytes, _ = _build_full_zip(session)
    now = datetime.now(timezone.utc)
    filename = f"pylo_backup_{now.strftime('%Y%m%d_%H%M%S')}.zip"
    (BACKUPS_DIR / filename).write_bytes(zip_bytes)
    return filename


def prune_old_backups(retention: int) -> None:
    """Delete the oldest backup files beyond the retention count."""
    if not BACKUPS_DIR.exists() or retention <= 0:
        return
    files = sorted(BACKUPS_DIR.glob("pylo_backup_*.zip"), key=lambda p: p.stat().st_mtime)
    for f in files[:-retention]:
        try:
            f.unlink()
            logger.info("Pruned old backup: %s", f.name)
        except OSError as exc:
            logger.warning("Could not prune backup %s: %s", f.name, exc)


# ── Granular export ───────────────────────────────────────────────────────────

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
        "fetch_entry_limit": bp.fetch_entry_limit,
        "fetch_retry_count": bp.fetch_retry_count,
        "fetch_retry_delay_seconds": bp.fetch_retry_delay_seconds,
        "fetch_on_fail_pybook_id": bp.fetch_on_fail_pybook_id,
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


# ── Full backup export ────────────────────────────────────────────────────────

@router.get("/export/full")
async def export_full_backup(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    """Download full backup ZIP (secrets excluded)."""
    zip_bytes, manifest = _build_full_zip(session, include_secrets=False)
    log_activity(session, "backup.exported", actor=current_user.username,
                 detail={"counts": manifest["counts"], "include_secrets": False})
    session.commit()
    exported_at = datetime.fromisoformat(manifest["exported_at"])
    filename = f"pylo_backup_{exported_at.strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class SecretBackupBody(BaseModel):
    passphrase: str


@router.post("/export/full/secrets")
async def export_full_backup_with_secrets(
    body: SecretBackupBody,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    """Download full backup ZIP with encrypted secrets."""
    if not body.passphrase or len(body.passphrase) < 8:
        raise HTTPException(status_code=400, detail="Passphrase must be at least 8 characters")

    zip_bytes, manifest = _build_full_zip(session, include_secrets=True, passphrase=body.passphrase)
    log_activity(session, "backup.exported", actor=current_user.username,
                 detail={"counts": manifest["counts"], "include_secrets": True})
    session.commit()
    exported_at = datetime.fromisoformat(manifest["exported_at"])
    filename = f"pylo_backup_with_secrets_{exported_at.strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Saved backup management ───────────────────────────────────────────────────

@router.get("/backup/history")
async def list_backup_history(
    current_user: AuthUser = Depends(require_admin),
):
    """List auto-saved backup files on disk."""
    if not BACKUPS_DIR.exists():
        return []
    files = sorted(BACKUPS_DIR.glob("pylo_backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    result = []
    for f in files:
        stat = f.stat()
        result.append({
            "filename": f.name,
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return result


@router.get("/backup/history/{filename}")
async def download_saved_backup(
    filename: str,
    current_user: AuthUser = Depends(require_admin),
):
    """Download a specific auto-saved backup file."""
    # Sanitize: only allow simple filenames, no path traversal
    if not re.match(r"^pylo_backup_[\w.-]+\.zip$", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = BACKUPS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    def _iter_file():
        with open(path, "rb") as fh:
            while chunk := fh.read(65536):
                yield chunk

    return StreamingResponse(
        _iter_file(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/backup/history/{filename}", status_code=204)
async def delete_saved_backup(
    filename: str,
    current_user: AuthUser = Depends(require_admin),
):
    """Delete a specific auto-saved backup file."""
    if not re.match(r"^pylo_backup_[\w.-]+\.zip$", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = BACKUPS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")
    path.unlink()


@router.post("/backup/now", status_code=201)
async def trigger_backup_now(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    """Trigger an immediate backup to disk."""
    from backend.api.settings import get_setting
    try:
        filename = save_backup_to_disk(session)
        retention = int(get_setting(session, "backup_retention") or 7)
        prune_old_backups(retention)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}")
    log_activity(session, "backup.saved", actor=current_user.username,
                 detail={"filename": filename, "trigger": "manual"})
    session.commit()
    return {"filename": filename}


# ── Full backup restore ───────────────────────────────────────────────────────

@router.post("/import/full")
async def import_full_backup(
    confirm: str,
    request: Request,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
):
    if confirm != "RESTORE":
        raise HTTPException(status_code=400, detail="Type RESTORE to import a full backup")

    passphrase = request.headers.get("X-Backup-Passphrase", "")

    blob = await request.body()
    if not blob:
        raise HTTPException(status_code=400, detail="Missing backup ZIP body")

    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid backup ZIP")

    with zf:
        try:
            manifest = json.loads(zf.read("manifest.json"))
        except (KeyError, json.JSONDecodeError):
            raise HTTPException(status_code=400, detail="Backup manifest is missing or invalid")

        if manifest.get("pylo_export") != "full_backup" or manifest.get("version") != 1:
            raise HTTPException(status_code=400, detail="Unsupported backup manifest")

        if manifest.get("include_secrets") and not passphrase:
            raise HTTPException(
                status_code=400,
                detail="This backup contains encrypted secrets. Provide the passphrase via the X-Backup-Passphrase header.",
            )

        def read_folder(folder: str) -> list[dict]:
            items = []
            for name in sorted(zf.namelist()):
                if not name.startswith(f"{folder}/") or not name.endswith(".json"):
                    continue
                try:
                    items.append(json.loads(zf.read(name)))
                except json.JSONDecodeError:
                    raise HTTPException(status_code=400, detail=f"Invalid JSON in {name}")
            return items

        blueprints = read_folder("blueprints")
        pybooks = read_folder("pybooks")
        workflows = read_folder("workflows")
        try:
            imported_settings = json.loads(zf.read("settings.json"))
        except KeyError:
            imported_settings = {}
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid settings.json")

        # Decrypt secrets if included
        restored_secrets: list[dict] = []
        if manifest.get("include_secrets") and passphrase:
            try:
                secrets_raw = json.loads(zf.read("secrets/encrypted.json"))
            except (KeyError, json.JSONDecodeError):
                raise HTTPException(status_code=400, detail="Backup claims to include secrets but secrets/encrypted.json is missing or invalid")

            try:
                salt = bytes.fromhex(secrets_raw["salt"])
                fernet_key = _derive_fernet_key(passphrase, salt)
                f = Fernet(fernet_key)
                for name, token in secrets_raw.get("secrets", {}).items():
                    try:
                        plain = f.decrypt(token.encode()).decode()
                        restored_secrets.append({"name": name, "value": plain})
                    except Exception:
                        pass  # skip secrets that fail to decrypt
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Could not decrypt secrets: {exc}")

    now = datetime.now(timezone.utc)
    pybook_id_map: dict[str, str] = {}
    for data in blueprints:
        _upsert_blueprint(session, data, now)
    for data in pybooks:
        old_id, new_id = _upsert_pybook(session, data, now)
        if old_id and new_id:
            pybook_id_map[old_id] = new_id
    for data in workflows:
        _upsert_workflow(session, data, pybook_id_map, now)

    # Restore settings (excluding backup_cron / backup_retention to avoid overwriting schedule)
    skip_keys = {"backup_cron", "backup_retention"}
    for key, value in imported_settings.items():
        if not isinstance(key, str) or key in skip_keys:
            continue
        row = session.get(SystemSetting, key)
        if row:
            row.value = str(value)
        else:
            row = SystemSetting(key=key, value=str(value))
        session.add(row)

    session.commit()

    if "max_concurrent_runs" in imported_settings:
        from backend.core import queue_manager
        try:
            queue_manager.update_limit(int(imported_settings["max_concurrent_runs"]))
        except (TypeError, ValueError):
            pass

    # Restore secrets
    secrets_restored = 0
    if restored_secrets:
        from backend.secrets.models import Secret as SecretModel
        from backend.core.crypto import encrypt as _crypto_encrypt
        from sqlmodel import select as _select
        for s_data in restored_secrets:
            name = s_data["name"]
            existing_secret = session.exec(_select(SecretModel).where(SecretModel.name == name)).first()
            if existing_secret:
                existing_secret.encrypted_value = _crypto_encrypt(s_data["value"])
                existing_secret.updated_at = now
                session.add(existing_secret)
            else:
                new_secret = SecretModel(
                    id=str(uuid.uuid4()),
                    name=name,
                    description=None,
                    encrypted_value=_crypto_encrypt(s_data["value"]),
                    created_at=now,
                    updated_at=now,
                )
                session.add(new_secret)
            secrets_restored += 1
        session.commit()

    result = {
        "ok": True,
        "imported": {
            "blueprints": len(blueprints),
            "pybooks": len(pybooks),
            "workflows": len(workflows),
            "settings": len(imported_settings),
            "secrets": secrets_restored,
        },
    }
    log_activity(session, "backup.imported", actor=current_user.username, detail=result["imported"])
    session.commit()
    return result


# ── Granular import ───────────────────────────────────────────────────────────

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
        "fetch_entry_limit": data.get("fetch_entry_limit"),
        "fetch_retry_count": data.get("fetch_retry_count", 0),
        "fetch_retry_delay_seconds": data.get("fetch_retry_delay_seconds", 2),
        "fetch_on_fail_pybook_id": data.get("fetch_on_fail_pybook_id"),
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
