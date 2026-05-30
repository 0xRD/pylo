from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Workflow(SQLModel, table=True):
    __tablename__ = "workflow"

    id: str = Field(primary_key=True)
    name: str
    description: Optional[str] = None
    is_active: bool = True
    trigger_type: str = "manual"
    trigger_config: str = "{}"
    nodes: str = "[]"   # JSON array of node objects
    edges: str = "[]"   # JSON array of edge objects
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class WorkflowRun(SQLModel, table=True):
    __tablename__ = "workflow_run"

    id: str = Field(primary_key=True)
    workflow_id: str = Field(index=True)
    status: str = "pending"   # queued | pending | running | success | error | timeout
    trigger_source: str = "manual"
    trigger_payload: str = "{}"
    started_at: datetime = Field(default_factory=_now)
    ended_at: Optional[datetime] = None
    duration_ms: Optional[int] = None


class WorkflowNodeRun(SQLModel, table=True):
    __tablename__ = "workflow_node_run"

    id: str = Field(primary_key=True)
    workflow_run_id: str = Field(index=True)
    node_id: str                        # references node.id in workflow.nodes JSON
    pybook_run_id: Optional[str] = None # references pybook_run.id
    status: str = "pending"
    output_vars: str = "{}"             # JSON dict of vars exported by pylo.set_output()
    started_at: datetime = Field(default_factory=_now)
    ended_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
