"""add_object_fetch_cron

Revision ID: 1fd00603a2fc
Revises: fc661ed4275a
Create Date: 2026-04-20 22:09:02.506100

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '1fd00603a2fc'
down_revision: Union[str, None] = 'fc661ed4275a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('object_type', schema=None) as batch_op:
        batch_op.add_column(sa.Column('fetch_cron', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('fetch_is_active', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('object_type', schema=None) as batch_op:
        batch_op.drop_column('fetch_is_active')
        batch_op.drop_column('fetch_cron')
