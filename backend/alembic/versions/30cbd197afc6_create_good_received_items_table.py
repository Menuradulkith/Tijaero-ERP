"""create good_received_items table

Revision ID: 30cbd197afc6
Revises: 75c256b017ee
Create Date: 2026-01-29 00:45:07.104885

"""
from alembic import op
import sqlalchemy as sa


revision = '30cbd197afc6'
down_revision = '75c256b017ee'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'good_received_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('good_received_note', sa.String(length=355), nullable=False),
        sa.Column('barcode', sa.Text(), nullable=False),
        sa.Column('branch_code', sa.String(length=200), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('created_date', sa.Date(), nullable=False),
        sa.Column('purchasing_order_items_id', sa.Integer(), nullable=False),
        sa.Column('added_date', sa.TIMESTAMP(), nullable=False),
        sa.ForeignKeyConstraint(['purchasing_order_items_id'], ['purchasing_order_items.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_good_received_items_id'), 'good_received_items', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_good_received_items_id'), table_name='good_received_items')
    op.drop_table('good_received_items')
