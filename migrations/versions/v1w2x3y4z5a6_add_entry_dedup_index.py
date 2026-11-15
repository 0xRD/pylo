"""add (blueprint_id, external_id) index for entry deduplication

Revision ID: v1w2x3y4z5a6
Revises: u0v1w2x3y4z5
"""
import sqlalchemy as sa
from alembic import op

revision = "v1w2x3y4z5a6"
down_revision = "u0v1w2x3y4z5"
branch_labels = None
depends_on = None

INDEX = "ix_entry_blueprint_external"


def _index_names() -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if "entry" not in inspector.get_table_names():
        return None
    return {index["name"] for index in inspector.get_indexes("entry")}


def upgrade():
    existing = _index_names()
    if existing is not None and INDEX not in existing:
        op.create_index(INDEX, "entry", ["blueprint_id", "external_id"], unique=False)


def downgrade():
    existing = _index_names()
    if existing and INDEX in existing:
        op.drop_index(INDEX, table_name="entry")
