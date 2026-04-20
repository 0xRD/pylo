"""initial baseline

Revision ID: fc661ed4275a
Revises: 
Create Date: 2026-04-20 20:26:21.391219

"""
from typing import Sequence, Union

revision: str = "fc661ed4275a"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline: schema already created by init_db() / SQLModel create_all
    pass


def downgrade() -> None:
    pass
