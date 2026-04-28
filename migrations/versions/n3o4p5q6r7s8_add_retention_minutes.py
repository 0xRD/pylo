"""add retention_minutes to blueprint

Revision ID: n3o4p5q6r7s8
Revises: m2n3o4p5q6r7
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = 'n3o4p5q6r7s8'
down_revision = 'm2n3o4p5q6r7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.add_column(sa.Column('retention_minutes', sa.Integer(), nullable=True))
    op.execute(
        "UPDATE blueprint SET retention_minutes = retention_days * 1440 WHERE retention_days IS NOT NULL"
    )


def downgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.drop_column('retention_minutes')
