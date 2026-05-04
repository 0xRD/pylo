import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session, select

from backend.pybooks.models import PyBook, PyBookRun

STORAGE_ROOT = Path(os.environ.get("PYBOOKS_STORAGE_PATH", "/app/pybooks_storage"))


def get_script_path(pybook_id: str) -> Path:
    return STORAGE_ROOT / pybook_id / "main.py"


def ensure_storage_dir(pybook_id: str) -> Path:
    path = STORAGE_ROOT / pybook_id
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
