"""update location foreign key with cascade delete

Revision ID: update_location_fk_cascade
Revises: add_branch_locations
Create Date: 2026-01-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'update_location_fk_cascade'
down_revision = 'add_branch_locations'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the existing foreign key constraint
    op.drop_constraint('fk_locations_branch_code', 'good_received_locations', type_='foreignkey')
    
    # Recreate it with CASCADE on delete
    op.create_foreign_key(
        'fk_locations_branch_code',
        'good_received_locations',
        'branches',
        ['branch_code'],
        ['branch_code'],
        ondelete='CASCADE'
    )


def downgrade() -> None:
    # Drop the CASCADE foreign key
    op.drop_constraint('fk_locations_branch_code', 'good_received_locations', type_='foreignkey')
    
    # Recreate without CASCADE
    op.create_foreign_key(
        'fk_locations_branch_code',
        'good_received_locations',
        'branches',
        ['branch_code'],
        ['branch_code']
    )
