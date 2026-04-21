"""add tags to pybook

Revision ID: c6d4e3f2a1b0
Revises: b5c3d2e1f0a9
Create Date: 2026-04-21 01:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c6d4e3f2a1b0'
down_revision = 'b5c3d2e1f0a9'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('pybook') as batch_op:
        batch_op.add_column(sa.Column('tags', sa.String(), nullable=False, server_default='[]'))


def downgrade():
    with op.batch_alter_table('pybook') as batch_op:
        batch_op.drop_column('tags')
