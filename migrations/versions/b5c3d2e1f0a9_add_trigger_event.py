"""add trigger_event and manual entry creation

Revision ID: b5c3d2e1f0a9
Revises: a3f2b1c4d5e6
Create Date: 2026-04-21 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b5c3d2e1f0a9'
down_revision = 'a3f2b1c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.add_column(sa.Column('trigger_event', sa.String(), nullable=False, server_default='on_create'))


def downgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.drop_column('trigger_event')
