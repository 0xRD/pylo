"""add mutable_mode and entry_event

Revision ID: j9k0l1m2n3o4
Revises: i8j9k0l1m2n3
Create Date: 2026-04-28

"""
from alembic import op
import sqlalchemy as sa

revision = 'j9k0l1m2n3o4'
down_revision = 'i8j9k0l1m2n3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('blueprint', sa.Column('mutable_mode', sa.String(), nullable=False, server_default='none'))

    op.create_table(
        'entry_event',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('entry_id', sa.String(), nullable=False, index=True),
        sa.Column('blueprint_id', sa.String(), nullable=False, index=True),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('changed_fields', sa.String(), nullable=False, server_default='[]'),
        sa.Column('old_values', sa.String(), nullable=False, server_default='{}'),
        sa.Column('new_values', sa.String(), nullable=False, server_default='{}'),
        sa.Column('actor', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('entry_event')
    op.drop_column('blueprint', 'mutable_mode')
