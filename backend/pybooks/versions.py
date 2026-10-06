"""Script version history for PyBooks (a lightweight, per-PyBook commit log)."""
import difflib
import uuid
from typing import Optional

from sqlmodel import Session, func, select

from backend.pybooks.models import PyBook, PyBookVersion


def latest_version(session: Session, pybook_id: str) -> Optional[PyBookVersion]:
    return session.exec(
        select(PyBookVersion)
        .where(PyBookVersion.pybook_id == pybook_id)
        .order_by(PyBookVersion.version.desc())
        .limit(1)
    ).first()


def line_stats(old: str, new: str) -> tuple[int, int]:
    """(added, removed) line counts between two scripts."""
    added = removed = 0
    for line in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0):
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed


def record_version(session: Session, pybook_id: str, script: str, author: str, message: str = "") -> Optional[PyBookVersion]:
    """Append a version if ``script`` differs from the latest one. Caller commits."""
    previous = latest_version(session, pybook_id)
    if previous and previous.script == script:
        return None
    added, removed = line_stats(previous.script if previous else "", script)
    number = (previous.version if previous else 0) + 1
    version = PyBookVersion(
        id=str(uuid.uuid4()),
        pybook_id=pybook_id,
        version=number,
        script=script,
        message=message.strip() or ("Initial version" if number == 1 else f"Update script (v{number})"),
        author=author,
        additions=added,
        deletions=removed,
    )
    session.add(version)
    session.flush()
    return version


def sync_version(session: Session, pb: PyBook) -> Optional[PyBookVersion]:
    """Capture script changes made outside the editor (imports, GitOps sync)."""
    message = "External update (import or sync)" if latest_version(session, pb.id) else ""
    return record_version(session, pb.id, pb.script or "", author="system", message=message)


def current_version_number(session: Session, pybook_id: str) -> Optional[int]:
    return session.exec(
        select(func.max(PyBookVersion.version)).where(PyBookVersion.pybook_id == pybook_id)
    ).one()
