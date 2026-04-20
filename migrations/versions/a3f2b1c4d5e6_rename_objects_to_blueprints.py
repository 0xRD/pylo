"""rename objects to blueprints and entries

Revision ID: a3f2b1c4d5e6
Revises: 1fd00603a2fc
Create Date: 2026-04-21 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "a3f2b1c4d5e6"
down_revision: Union[str, None] = "1fd00603a2fc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename object_type → blueprint, add is_manual column
    op.rename_table("object_type", "blueprint")
    with op.batch_alter_table("blueprint", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_manual", sa.Boolean(), nullable=False, server_default="0"))

    # Rename object_instance → entry, rename object_type_id → blueprint_id
    with op.batch_alter_table("object_instance", schema=None) as batch_op:
        batch_op.alter_column("object_type_id", new_column_name="blueprint_id")
    op.rename_table("object_instance", "entry")

    # Recreate FTS virtual table (SQLite doesn't support renaming virtual tables)
    conn = op.get_bind()
    conn.execute(text(
        "CREATE VIRTUAL TABLE fts_entries "
        "USING fts5(entry_id UNINDEXED, blueprint_id UNINDEXED, content, tokenize='porter ascii')"
    ))
    conn.execute(text(
        "INSERT INTO fts_entries(entry_id, blueprint_id, content) "
        "SELECT instance_id, object_type_id, content FROM fts_objects"
    ))
    conn.execute(text("DROP TABLE fts_objects"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text(
        "CREATE VIRTUAL TABLE fts_objects "
        "USING fts5(instance_id UNINDEXED, object_type_id UNINDEXED, content, tokenize='porter ascii')"
    ))
    conn.execute(text(
        "INSERT INTO fts_objects(instance_id, object_type_id, content) "
        "SELECT entry_id, blueprint_id, content FROM fts_entries"
    ))
    conn.execute(text("DROP TABLE fts_entries"))

    op.rename_table("entry", "object_instance")
    with op.batch_alter_table("object_instance", schema=None) as batch_op:
        batch_op.alter_column("blueprint_id", new_column_name="object_type_id")

    with op.batch_alter_table("blueprint", schema=None) as batch_op:
        batch_op.drop_column("is_manual")
    op.rename_table("blueprint", "object_type")
