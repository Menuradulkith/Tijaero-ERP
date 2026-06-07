"""merge_adv_return_and_audit_fields

Revision ID: 442c8ace6a27
Revises: 20260607_adv_return, 39c37f33389a
Create Date: 2026-06-07 13:38:58.964644

"""
from alembic import op
import sqlalchemy as sa


revision = '442c8ace6a27'
down_revision = ('20260607_adv_return', '39c37f33389a')
branch_labels = None
depends_on = None

def upgrade() -> None:
    pass

def downgrade() -> None:
    pass
