"""add_approval_status_to_invoices

Revision ID: c4056dbbf1f4
Revises: g1a2b3c4d5e6
Create Date: 2026-01-18 06:22:48.874003

"""
from alembic import op
import sqlalchemy as sa


revision = 'c4056dbbf1f4'
down_revision = 'g1a2b3c4d5e6'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Add approval_status column with default value
    op.add_column('invoices', 
        sa.Column('approval_status', sa.String(30), nullable=False, server_default='pending_approval')
    )
    
    # Update existing records based on approval field and payment method
    op.execute("""
        UPDATE invoices 
        SET approval_status = CASE 
            WHEN approval = true AND payment_method = 'credit' THEN 'approved'
            WHEN approval = true THEN 'completed'
            ELSE 'pending_approval'
        END
    """)


def downgrade() -> None:
    op.drop_column('invoices', 'approval_status')
