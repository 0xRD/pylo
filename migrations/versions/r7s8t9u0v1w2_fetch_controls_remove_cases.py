"""add blueprint fetch controls and remove cases

Revision ID: r7s8t9u0v1w2
Revises: q6r7s8t9u0v1
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'r7s8t9u0v1w2'
down_revision = 'q6r7s8t9u0v1'
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _col_exists(table: str, col: str) -> bool:
    if not _table_exists(table):
        return False
    return col in [c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)]


def upgrade():
    if not _col_exists('blueprint', 'fetch_entry_limit'):
        op.add_column('blueprint', sa.Column('fetch_entry_limit', sa.Integer(), nullable=True))
    if not _col_exists('blueprint', 'fetch_retry_count'):
        op.add_column('blueprint', sa.Column('fetch_retry_count', sa.Integer(), nullable=False, server_default='0'))
    if not _col_exists('blueprint', 'fetch_retry_delay_seconds'):
        op.add_column('blueprint', sa.Column('fetch_retry_delay_seconds', sa.Integer(), nullable=False, server_default='2'))
    if not _col_exists('blueprint', 'fetch_on_fail_pybook_id'):
        op.add_column('blueprint', sa.Column('fetch_on_fail_pybook_id', sa.String(), nullable=True))

    for table in ('case_link', 'case_comment', 'cases'):
        if _table_exists(table):
            op.drop_table(table)


def downgrade():
    if _col_exists('blueprint', 'fetch_on_fail_pybook_id'):
        op.drop_column('blueprint', 'fetch_on_fail_pybook_id')
    if _col_exists('blueprint', 'fetch_retry_delay_seconds'):
        op.drop_column('blueprint', 'fetch_retry_delay_seconds')
    if _col_exists('blueprint', 'fetch_retry_count'):
        op.drop_column('blueprint', 'fetch_retry_count')
    if _col_exists('blueprint', 'fetch_entry_limit'):
        op.drop_column('blueprint', 'fetch_entry_limit')
