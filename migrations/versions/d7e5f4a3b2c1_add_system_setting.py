"""add system_setting table

Revision ID: d7e5f4a3b2c1
Revises: c6d4e3f2a1b0
Create Date: 2026-04-21 02:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd7e5f4a3b2c1'
down_revision = 'c6d4e3f2a1b0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'system_setting',
        sa.Column('key', sa.String(), primary_key=True),
        sa.Column('value', sa.String(), nullable=False),
    )


def downgrade():
    op.drop_table('system_setting')
