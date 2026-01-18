"""Fix sale_rep_id and SaleReturn FKs manually

Revision ID: 7b9e2be6f9a2
Revises: 51dc1a533aba
Create Date: 2026-01-19 01:05:38.728142

"""
from alembic import op
import sqlalchemy as sa


revision = '7b9e2be6f9a2'
down_revision = '51dc1a533aba'
branch_labels = None
depends_on = None

def upgrade() -> None:
    pass

def downgrade() -> None:
    pass
