"""fix credit settlement transaction created_date to timestamp

Revision ID: 20260608_ccs_timestamp
Revises: 20260608_cs_bt
Create Date: 2026-06-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260608_ccs_timestamp'
down_revision = '20260608_cs_bt'
branch_labels = None
depends_on = None


def upgrade():
    """
    Change customer_credits_settle_transaction.created_date from Date to TIMESTAMP
    to store the actual time of credit settlement, not just the date.
    
    This ensures credit settlement timestamps match invoice receipt timestamps.
    """
    # Change column type from Date to TIMESTAMP
    op.execute("""
        ALTER TABLE customer_credits_settle_transaction 
        ALTER COLUMN created_date TYPE TIMESTAMP 
        USING created_date::TIMESTAMP;
    """)
    
    # Update existing rows to use the created_at timestamp (from audit fields) as reference
    # This gives us the actual time the settlement was created
    op.execute("""
        UPDATE customer_credits_settle_transaction
        SET created_date = created_at
        WHERE created_at IS NOT NULL;
    """)


def downgrade():
    """Revert back to Date type"""
    # Change column type from TIMESTAMP back to Date
    op.execute("""
        ALTER TABLE customer_credits_settle_transaction 
        ALTER COLUMN created_date TYPE DATE 
        USING created_date::DATE;
    """)

