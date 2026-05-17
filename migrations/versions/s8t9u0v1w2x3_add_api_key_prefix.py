"""add api key prefix

Revision ID: s8t9u0v1w2x3
Revises: r7s8t9u0v1w2
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa

revision = "s8t9u0v1w2x3"
down_revision = "r7s8t9u0v1w2"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade():
    if not _has_table("api_key") or _has_column("api_key", "key_prefix"):
        return
    op.add_column("api_key", sa.Column("key_prefix", sa.String(), nullable=False, server_default=""))
    if not _has_index("api_key", "ix_api_key_key_prefix"):
        op.create_index("ix_api_key_key_prefix", "api_key", ["key_prefix"], unique=False)


def downgrade():
    if not _has_table("api_key") or not _has_column("api_key", "key_prefix"):
        return
    if _has_index("api_key", "ix_api_key_key_prefix"):
        op.drop_index("ix_api_key_key_prefix", table_name="api_key")
    op.drop_column("api_key", "key_prefix")
