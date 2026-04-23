"""add activity log

Revision ID: g2h3i4j5k6l7
Revises: f1a2b3c4d5e6
Create Date: 2026-04-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'g2h3i4j5k6l7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'activityevent',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('category', sa.String(), nullable=False),
        sa.Column('actor', sa.String(), nullable=False),
        sa.Column('resource_type', sa.String(), nullable=True),
        sa.Column('resource_id', sa.String(), nullable=True),
        sa.Column('resource_name', sa.String(), nullable=True),
        sa.Column('detail', sa.String(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_activityevent_event_type', 'activityevent', ['event_type'])
    op.create_index('ix_activityevent_category', 'activityevent', ['category'])
    op.create_index('ix_activityevent_actor', 'activityevent', ['actor'])
    op.create_index('ix_activityevent_resource_id', 'activityevent', ['resource_id'])
    op.create_index('ix_activityevent_created_at', 'activityevent', ['created_at'])


def downgrade():
    op.drop_table('activityevent')
