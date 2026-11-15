import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session, select

from backend.pybooks.models import PyBook, PyBookRun

STORAGE_ROOT = Path(os.environ.get("PYBOOKS_STORAGE_PATH", "/app/pybooks_storage"))


_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def is_safe_id(value: str) -> bool:
    """Ids are used as directory names and Docker image tags."""
    return isinstance(value, str) and bool(_SAFE_ID_RE.fullmatch(value))


def get_script_path(pybook_id: str) -> Path:
    # Defence in depth: an id such as "../backend" must never resolve outside
    # the storage root (it would let an import overwrite application files).
    if not is_safe_id(pybook_id):
        raise ValueError(f"Unsafe PyBook id: {pybook_id!r}")
    return STORAGE_ROOT / pybook_id / "main.py"


def ensure_storage_dir(pybook_id: str) -> Path:
    path = get_script_path(pybook_id).parent
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_script(pybook_id: str, script: str) -> str:
    path = get_script_path(pybook_id)
    ensure_storage_dir(pybook_id)
    path.write_text(script)
    return str(path)


def read_script(pybook_id: str) -> str:
    path = get_script_path(pybook_id)
    if path.exists():
        return path.read_text()
    return ""
