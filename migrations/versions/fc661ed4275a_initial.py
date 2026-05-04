"""initial baseline

Revision ID: fc661ed4275a
Revises:
Create Date: 2026-04-20 20:26:21.391219

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "fc661ed4275a"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _dialect() -> str:
    return op.get_bind().dialect.name


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # object_type — becomes "blueprint" in migration a3f2b1c4d5e6
    if not _has_table("object_type"):
        op.create_table(
            "object_type",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("source_url", sa.String(), nullable=True),
            sa.Column("source_method", sa.String(), nullable=False, server_default="GET"),
            sa.Column("source_headers", sa.String(), nullable=False, server_default="{}"),
            sa.Column("source_body", sa.String(), nullable=False, server_default="{}"),
            sa.Column("field_mappings", sa.String(), nullable=False, server_default="[]"),
            sa.Column("trigger_pybook_id", sa.String(), nullable=True),
            sa.Column("polling_interval_seconds", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    # object_instance — becomes "entry" in migration a3f2b1c4d5e6
    if not _has_table("object_instance"):
        op.create_table(
            "object_instance",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("object_type_id", sa.String(), nullable=False),
            sa.Column("external_id", sa.String(), nullable=True),
            sa.Column("data", sa.String(), nullable=False, server_default="{}"),
            sa.Column("raw_data", sa.String(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_object_instance_object_type_id", "object_instance", ["object_type_id"], if_not_exists=True)

    # fts virtual table — SQLite only; on Postgres init_search_index handles this via fts_entries
    if _dialect() == "sqlite" and not _has_table("fts_objects"):
        op.execute(text(
            "CREATE VIRTUAL TABLE fts_objects "
            "USING fts5(instance_id UNINDEXED, object_type_id UNINDEXED, content, "
            "tokenize='porter ascii')"
        ))

    # pybook
    if not _has_table("pybook"):
        op.create_table(
            "pybook",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("script", sa.String(), nullable=False, server_default=""),
            sa.Column("is_sub_pybook", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("dependencies", sa.String(), nullable=False, server_default="[]"),
            sa.Column("trigger_type", sa.String(), nullable=False, server_default="manual"),
            sa.Column("trigger_config", sa.String(), nullable=False, server_default="{}"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("docker_image_tag", sa.String(), nullable=True),
            sa.Column("required_secrets", sa.String(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    # pybook_run
    if not _has_table("pybook_run"):
        op.create_table(
            "pybook_run",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("pybook_id", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("trigger_source", sa.String(), nullable=False),
            sa.Column("trigger_payload", sa.String(), nullable=False, server_default="{}"),
            sa.Column("stdout", sa.String(), nullable=False, server_default=""),
            sa.Column("stderr", sa.String(), nullable=False, server_default=""),
            sa.Column("exit_code", sa.Integer(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("ended_at", sa.DateTime(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
        )
        op.create_index("ix_pybook_run_pybook_id", "pybook_run", ["pybook_id"], if_not_exists=True)

    # secret
    if not _has_table("secret"):
        op.create_table(
            "secret",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False, unique=True, index=True),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("encrypted_value", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    # user
    if not _has_table("user"):
        op.create_table(
            "user",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("username", sa.String(), nullable=False, unique=True, index=True),
            sa.Column("hashed_password", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=False, server_default="viewer"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    # invitation
    if not _has_table("invitation"):
        op.create_table(
            "invitation",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("token", sa.String(), nullable=False, unique=True, index=True),
            sa.Column("role", sa.String(), nullable=False, server_default="viewer"),
            sa.Column("created_by", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("used_by", sa.String(), nullable=True),
        )


def downgrade() -> None:
    pass
