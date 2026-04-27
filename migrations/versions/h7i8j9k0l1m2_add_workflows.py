"""add workflows tables and output_vars column

Revision ID: h7i8j9k0l1m2
Revises: g2h3i4j5k6l7
Create Date: 2026-04-24 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "h7i8j9k0l1m2"
down_revision = "g2h3i4j5k6l7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "pybook_run",
        sa.Column("output_vars", sa.String(), nullable=False, server_default="{}"),
    )

    op.create_table(
        "workflow",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("trigger_type", sa.String(), nullable=False, server_default="manual"),
        sa.Column("nodes", sa.String(), nullable=False, server_default="[]"),
        sa.Column("edges", sa.String(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "workflow_run",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workflow_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("trigger_source", sa.String(), nullable=False, server_default="manual"),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
    )
    op.create_index("ix_workflow_run_workflow_id", "workflow_run", ["workflow_id"])

    op.create_table(
        "workflow_node_run",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workflow_run_id", sa.String(), nullable=False),
        sa.Column("node_id", sa.String(), nullable=False),
        sa.Column("pybook_run_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("output_vars", sa.String(), nullable=False, server_default="{}"),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_workflow_node_run_workflow_run_id",
        "workflow_node_run",
        ["workflow_run_id"],
    )


def downgrade():
    op.drop_table("workflow_node_run")
    op.drop_table("workflow_run")
    op.drop_table("workflow")
    op.drop_column("pybook_run", "output_vars")
