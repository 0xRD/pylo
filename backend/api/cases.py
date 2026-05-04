import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.activity.logger import log_activity
from backend.cases.models import Case, CaseComment, CaseLink
from backend.core.auth import AuthUser, verify_token
from backend.database import get_session

router = APIRouter(
    prefix="/api/cases",
    tags=["cases"],
    dependencies=[Depends(verify_token)],
)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CaseCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "open"
    severity: str = "medium"
    assignee: Optional[str] = None


class CaseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    severity: Optional[str] = None
    assignee: Optional[str] = None


class CommentCreate(BaseModel):
    body: str


class LinkCreate(BaseModel):
    link_type: str   # "entry" | "pybook_run" | "workflow_run"
    link_id: str
    label: Optional[str] = None


# ── Helper: resolve linked object label ──────────────────────────────────────

def _resolve_label(session: Session, link_type: str, link_id: str) -> str:
    """Return a human-readable label for a linked object."""
    try:
        if link_type == "entry":
            from backend.objects.models import Entry
            obj = session.get(Entry, link_id)
            if obj:
                import json
                data = json.loads(obj.data or "{}")
                # use first string value as title, fallback to id
                title = next((str(v) for v in data.values() if v), None)
                return title[:80] if title else link_id[:16]
        elif link_type == "pybook_run":
            from backend.pybooks.models import PyBookRun, PyBook
            run = session.get(PyBookRun, link_id)
            if run:
                pb = session.get(PyBook, run.pybook_id)
                name = pb.name if pb else run.pybook_id[:8]
                return f"{name} — {run.status}"
        elif link_type == "workflow_run":
            from backend.workflows.models import WorkflowRun, Workflow
            run = session.get(WorkflowRun, link_id)
            if run:
                wf = session.get(Workflow, run.workflow_id)
                name = wf.name if wf else run.workflow_id[:8]
                return f"{name} — {run.status}"
    except Exception:
        pass
    return link_id[:16]


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_cases(
    status: List[str] = Query(default=[]),
    severity: List[str] = Query(default=[]),
    assignee: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    stmt = select(Case).order_by(Case.created_at.desc())
    if status:
        stmt = stmt.where(Case.status.in_(status))
    if severity:
        stmt = stmt.where(Case.severity.in_(severity))
    if assignee:
        stmt = stmt.where(Case.assignee == assignee)
    if q:
        stmt = stmt.where(Case.title.ilike(f"%{q}%"))
    stmt = stmt.offset(offset).limit(limit)
    return session.exec(stmt).all()


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_case(
    body: CaseCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    now = datetime.now(timezone.utc)
    case = Case(
        id=str(uuid.uuid4()),
        **body.model_dump(),
        created_by=current_user.username,
        created_at=now,
        updated_at=now,
    )
    session.add(case)
    log_activity(session, "case.created", actor=current_user.username,
                 resource_type="case", resource_id=case.id, resource_name=case.title)
    session.commit()
    session.refresh(case)
    return case


# ── Get detail ────────────────────────────────────────────────────────────────

@router.get("/{case_id}")
async def get_case(case_id: str, session: Session = Depends(get_session)):
    case = session.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    comments = session.exec(
        select(CaseComment).where(CaseComment.case_id == case_id)
        .order_by(CaseComment.created_at.asc())
    ).all()
    links = session.exec(
        select(CaseLink).where(CaseLink.case_id == case_id)
        .order_by(CaseLink.created_at.asc())
    ).all()
    return {
        "id": case.id,
        "title": case.title,
        "description": case.description,
        "status": case.status,
        "severity": case.severity,
        "assignee": case.assignee,
        "created_by": case.created_by,
        "created_at": case.created_at.isoformat(),
        "updated_at": case.updated_at.isoformat(),
        "comments": [
            {
                "id": c.id,
                "author": c.author,
                "body": c.body,
                "created_at": c.created_at.isoformat(),
            }
            for c in comments
        ],
        "links": [
            {
                "id": lk.id,
                "link_type": lk.link_type,
                "link_id": lk.link_id,
                "label": lk.label,
                "created_at": lk.created_at.isoformat(),
            }
            for lk in links
        ],
    }


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{case_id}")
async def update_case(
    case_id: str,
    body: CaseUpdate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    case = session.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    patch = body.model_dump(exclude_none=True)
    for k, v in patch.items():
        setattr(case, k, v)
    case.updated_at = datetime.now(timezone.utc)
    session.add(case)
    log_activity(session, "case.updated", actor=current_user.username,
                 resource_type="case", resource_id=case_id, resource_name=case.title,
                 detail={"changed_fields": list(patch.keys())})
    session.commit()
    session.refresh(case)
    return case


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{case_id}", status_code=204)
async def delete_case(
    case_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    case = session.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    title = case.title
    # cascade delete comments and links
    for c in session.exec(select(CaseComment).where(CaseComment.case_id == case_id)).all():
        session.delete(c)
    for lk in session.exec(select(CaseLink).where(CaseLink.case_id == case_id)).all():
        session.delete(lk)
    session.delete(case)
    log_activity(session, "case.deleted", actor=current_user.username,
                 resource_type="case", resource_id=case_id, resource_name=title)
    session.commit()


# ── Comments ──────────────────────────────────────────────────────────────────

@router.post("/{case_id}/comments", status_code=201)
async def add_comment(
    case_id: str,
    body: CommentCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    case = session.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    comment = CaseComment(
        id=str(uuid.uuid4()),
        case_id=case_id,
        author=current_user.username,
        body=body.body,
    )
    session.add(comment)
    # bump updated_at on the case
    case.updated_at = datetime.now(timezone.utc)
    session.add(case)
    session.commit()
    session.refresh(comment)
    return comment


@router.delete("/{case_id}/comments/{comment_id}", status_code=204)
async def delete_comment(
    case_id: str,
    comment_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    comment = session.get(CaseComment, comment_id)
    if not comment or comment.case_id != case_id:
        raise HTTPException(status_code=404, detail="Comment not found")
    session.delete(comment)
    session.commit()


# ── Links ─────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/links", status_code=201)
async def add_link(
    case_id: str,
    body: LinkCreate,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    case = session.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if body.link_type not in ("entry", "pybook_run", "workflow_run"):
        raise HTTPException(status_code=422, detail="link_type must be entry, pybook_run, or workflow_run")
    label = body.label or _resolve_label(session, body.link_type, body.link_id)
    link = CaseLink(
        id=str(uuid.uuid4()),
        case_id=case_id,
        link_type=body.link_type,
        link_id=body.link_id,
        label=label,
    )
    session.add(link)
    case.updated_at = datetime.now(timezone.utc)
    session.add(case)
    session.commit()
    session.refresh(link)
    return link


@router.delete("/{case_id}/links/{link_id}", status_code=204)
async def delete_link(
    case_id: str,
    link_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(verify_token),
):
    link = session.get(CaseLink, link_id)
    if not link or link.case_id != case_id:
        raise HTTPException(status_code=404, detail="Link not found")
    session.delete(link)
    session.commit()
