"""add blueprint pagination config

Revision ID: l1m2n3o4p5q6
Revises: k0l1m2n3o4p5
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = 'l1m2n3o4p5q6'
down_revision = 'k0l1m2n3o4p5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.add_column(sa.Column('pagination_type', sa.String(), nullable=False, server_default='none'))
        batch_op.add_column(sa.Column('pagination_param', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('pagination_path', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('pagination_items_path', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('pagination_max_pages', sa.Integer(), nullable=False, server_default='50'))


def downgrade():
    with op.batch_alter_table('blueprint') as batch_op:
        batch_op.drop_column('pagination_max_pages')
        batch_op.drop_column('pagination_items_path')
        batch_op.drop_column('pagination_path')
        batch_op.drop_column('pagination_param')
        batch_op.drop_column('pagination_type')
