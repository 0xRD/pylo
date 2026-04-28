"""add blueprint entry retention

Revision ID: m2n3o4p5q6r7
Revises: l1m2n3o4p5q6
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = 'm2n3o4p5q6r7'
down_revision = 'l1m2n3o4p5q6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.add_column(sa.Column('max_entries', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('retention_days', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.drop_column('retention_days')
        batch_op.drop_column('max_entries')
