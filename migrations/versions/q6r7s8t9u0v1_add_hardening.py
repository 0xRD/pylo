"""add network policy, retry columns, and pybook run hardening

Revision ID: q6r7s8t9u0v1
Revises: p5q6r7s8t9u0
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'q6r7s8t9u0v1'
down_revision = 'p5q6r7s8t9u0'
branch_labels = None
depends_on = None


def _col_exists(table: str, col: str) -> bool:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)]
    return col in cols


def upgrade():
    # PyBook: network_policy and allowed_hosts
    if not _col_exists("pybook", "network_policy"):
        op.add_column("pybook", sa.Column("network_policy", sa.String(), server_default="default", nullable=False))
    if not _col_exists("pybook", "allowed_hosts"):
        op.add_column("pybook", sa.Column("allowed_hosts", sa.String(), server_default="[]", nullable=False))

    # PyBookRun: retry_count, max_retries
    if not _col_exists("pybook_run", "retry_count"):
        op.add_column("pybook_run", sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False))
    if not _col_exists("pybook_run", "max_retries"):
        op.add_column("pybook_run", sa.Column("max_retries", sa.Integer(), server_default="0", nullable=False))


def downgrade():
    op.drop_column("pybook_run", "max_retries")
    op.drop_column("pybook_run", "retry_count")
    op.drop_column("pybook", "allowed_hosts")
    op.drop_column("pybook", "network_policy")
