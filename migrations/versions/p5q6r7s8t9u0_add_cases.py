"""add cases

Revision ID: p5q6r7s8t9u0
Revises: o4p5q6r7s8t9
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa

revision = 'p5q6r7s8t9u0'
down_revision = 'o4p5q6r7s8t9'
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade():
    if not _has_table('cases'):
        op.create_table(
            'cases',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('title', sa.String(), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.String(), nullable=False, server_default='open'),
            sa.Column('severity', sa.String(), nullable=False, server_default='medium'),
            sa.Column('assignee', sa.String(), nullable=True),
            sa.Column('created_by', sa.String(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_cases_status', 'cases', ['status'])
        op.create_index('ix_cases_severity', 'cases', ['severity'])

    if not _has_table('case_comment'):
        op.create_table(
            'case_comment',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('case_id', sa.String(), nullable=False, index=True),
            sa.Column('author', sa.String(), nullable=False),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )

    if not _has_table('case_link'):
        op.create_table(
            'case_link',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('case_id', sa.String(), nullable=False, index=True),
            sa.Column('link_type', sa.String(), nullable=False),
            sa.Column('link_id', sa.String(), nullable=False),
            sa.Column('label', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )


def downgrade():
    for tbl in ('case_link', 'case_comment', 'cases'):
        if _has_table(tbl):
            op.drop_table(tbl)
