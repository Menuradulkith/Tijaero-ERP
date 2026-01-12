"""add branch_code to locations

Revision ID: add_branch_locations
Revises: add_selling_price
Create Date: 2026-01-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_branch_locations'
down_revision = 'add_selling_price'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add branch_code column to good_received_locations table
    # First add as nullable to avoid issues with existing data
    op.add_column('good_received_locations', sa.Column('branch_code', sa.String(255), nullable=True))
    
    # Update existing records with a default branch_code (you may need to adjust this)
    # This assumes you have at least one branch in the branches table
    op.execute("""
        UPDATE good_received_locations 
        SET branch_code = (SELECT branch_code FROM branches LIMIT 1)
        WHERE branch_code IS NULL
    """)
    
    # Now make it non-nullable and add foreign key
    op.alter_column('good_received_locations', 'branch_code', nullable=False)
    op.create_foreign_key(
        'fk_locations_branch_code', 
        'good_received_locations', 
        'branches',
        ['branch_code'], 
        ['branch_code']
    )


def downgrade() -> None:
    # Remove foreign key and column
    op.drop_constraint('fk_locations_branch_code', 'good_received_locations', type_='foreignkey')
    op.drop_column('good_received_locations', 'branch_code')
