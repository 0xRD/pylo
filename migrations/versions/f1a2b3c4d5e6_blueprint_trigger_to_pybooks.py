"""migrate blueprint trigger ownership to pybooks

Revision ID: f1a2b3c4d5e6
Revises: e8f6a5b4c3d2
Create Date: 2026-04-21 16:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
import json

revision = 'f1a2b3c4d5e6'
down_revision = 'e8f6a5b4c3d2'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, trigger_pybook_id, trigger_event, trigger_conditions "
        "FROM blueprint WHERE trigger_pybook_id IS NOT NULL"
    )).fetchall()

    for blueprint_id, pybook_id, trigger_event, trigger_conditions in rows:
        try:
            conditions = json.loads(trigger_conditions or "[]")
        except Exception:
            conditions = []
        trigger_config = json.dumps({
            "blueprint_id": blueprint_id,
            "trigger_event": trigger_event or "on_create",
            "trigger_conditions": conditions,
        })
        bind.execute(
            sa.text(
                "UPDATE pybook SET trigger_type = 'blueprint', trigger_config = :config "
                "WHERE id = :id"
            ),
            {"config": trigger_config, "id": pybook_id},
        )


def downgrade():
    pass
