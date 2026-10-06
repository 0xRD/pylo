"""add indexes for run listings, retention cleanup and entry ordering

Revision ID: t9u0v1w2x3y4
Revises: s8t9u0v1w2x3
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa

revision = "t9u0v1w2x3y4"
down_revision = "s8t9u0v1w2x3"
branch_labels = None
depends_on = None

INDEXES = [
    ("pybook_run", "status"),
    ("pybook_run", "started_at"),
    ("workflow_run", "started_at"),
    ("workflow_node_run", "pybook_run_id"),
    ("entry", "created_at"),
]


def _index_names(table_name: str) -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return None
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade():
    for table, column in INDEXES:
        existing = _index_names(table)
        name = f"ix_{table}_{column}"
        if existing is not None and name not in existing:
            op.create_index(name, table, [column], unique=False)


def downgrade():
    for table, column in INDEXES:
        existing = _index_names(table)
        name = f"ix_{table}_{column}"
        if existing and name in existing:
            op.drop_index(name, table_name=table)
