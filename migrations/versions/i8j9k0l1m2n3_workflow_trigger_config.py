"""add trigger_config to workflow

Revision ID: i8j9k0l1m2n3
Revises: h7i8j9k0l1m2
Create Date: 2026-04-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "i8j9k0l1m2n3"
down_revision = "h7i8j9k0l1m2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "workflow",
        sa.Column("trigger_config", sa.String(), nullable=False, server_default="{}"),
    )


def downgrade():
    with op.batch_alter_table("workflow") as batch_op:
        batch_op.drop_column("trigger_config")
