"""add trigger_conditions to blueprint

Revision ID: e8f6a5b4c3d2
Revises: d7e5f4a3b2c1
Create Date: 2026-04-21

"""
from alembic import op
import sqlalchemy as sa

revision = 'e8f6a5b4c3d2'
down_revision = 'd7e5f4a3b2c1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'blueprint',
        sa.Column('trigger_conditions', sa.VARCHAR(), nullable=False, server_default='[]'),
    )


def downgrade():
    op.drop_column('blueprint', 'trigger_conditions')
