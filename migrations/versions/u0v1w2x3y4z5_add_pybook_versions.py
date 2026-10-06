"""add PyBook script version history

Revision ID: u0v1w2x3y4z5
Revises: t9u0v1w2x3y4
Create Date: 2026-10-06
"""
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "u0v1w2x3y4z5"
down_revision = "t9u0v1w2x3y4"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def upgrade():
    inspector = _inspector()
    tables = inspector.get_table_names()

    if "pybook_version" not in tables:
        op.create_table(
            "pybook_version",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("pybook_id", sa.String(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("script", sa.Text(), nullable=False, server_default=""),
            sa.Column("message", sa.String(), nullable=False, server_default=""),
            sa.Column("author", sa.String(), nullable=False, server_default="system"),
            sa.Column("additions", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("deletions", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_pybook_version_pybook_id", "pybook_version", ["pybook_id"])
        op.create_index("ix_pybook_version_created_at", "pybook_version", ["created_at"])

        # Seed v1 from each existing script so history starts populated.
        if "pybook" in tables:
            bind = op.get_bind()
            now = datetime.now(timezone.utc)
            rows = bind.execute(sa.text("SELECT id, script FROM pybook")).fetchall()
            version_table = sa.table(
                "pybook_version",
                sa.column("id"), sa.column("pybook_id"), sa.column("version"), sa.column("script"),
                sa.column("message"), sa.column("author"), sa.column("additions"),
                sa.column("deletions"), sa.column("created_at"),
            )
            if rows:
                op.bulk_insert(version_table, [{
                    "id": str(uuid.uuid4()), "pybook_id": pb_id, "version": 1, "script": script or "",
                    "message": "Initial version", "author": "system",
                    "additions": len((script or "").splitlines()), "deletions": 0, "created_at": now,
                } for pb_id, script in rows])

    if "pybook_run" in tables and not any(c["name"] == "script_version" for c in inspector.get_columns("pybook_run")):
        op.add_column("pybook_run", sa.Column("script_version", sa.Integer(), nullable=True))


def downgrade():
    inspector = _inspector()
    tables = inspector.get_table_names()
    if "pybook_run" in tables and any(c["name"] == "script_version" for c in inspector.get_columns("pybook_run")):
        op.drop_column("pybook_run", "script_version")
    if "pybook_version" in tables:
        op.drop_index("ix_pybook_version_created_at", table_name="pybook_version")
        op.drop_index("ix_pybook_version_pybook_id", table_name="pybook_version")
        op.drop_table("pybook_version")
