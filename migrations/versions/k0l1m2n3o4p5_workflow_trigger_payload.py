"""add trigger_payload to workflow_run

Revision ID: k0l1m2n3o4p5
Revises: j9k0l1m2n3o4
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = 'k0l1m2n3o4p5'
down_revision = 'j9k0l1m2n3o4'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('workflow_run') as batch_op:
        batch_op.add_column(sa.Column('trigger_payload', sa.String(), nullable=False, server_default='{}'))


def downgrade():
    with op.batch_alter_table('workflow_run') as batch_op:
        batch_op.drop_column('trigger_payload')
