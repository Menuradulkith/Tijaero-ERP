"""Add stock transfer tables and columns

Revision ID: 002_add_stock_transfer
Revises: add_ca_return_fields
Create Date: 2026-06-14 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002_add_stock_transfer'
down_revision = 'add_ca_return_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create stock_transfers table
    op.create_table(
        'stock_transfers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('transfer_type', sa.String(50), nullable=False),
        sa.Column('source_table', sa.String(50), nullable=False),
        sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('source_barcode', sa.String(200), nullable=True),
        sa.Column('source_status', sa.String(50), nullable=True),
        sa.Column('destination_table', sa.String(50), nullable=False),
        sa.Column('destination_id', sa.Integer(), nullable=True),
        sa.Column('destination_barcode', sa.String(200), nullable=True),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=False),
        sa.Column('reason', sa.String(500), nullable=True),
        sa.Column('initiated_by', sa.Integer(), nullable=True),
        sa.Column('approved_by', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='completed'),
        sa.Column('initiated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('reversed_at', sa.DateTime(), nullable=True),
        sa.Column('reverse_reason', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ),
        sa.ForeignKeyConstraint(['initiated_by'], ['accounts_user.id'], ),
        sa.ForeignKeyConstraint(['approved_by'], ['accounts_user.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for stock_transfers
    op.create_index(
        'idx_stock_transfers_source',
        'stock_transfers',
        ['source_id'],
        unique=False
    )
    op.create_index(
        'idx_stock_transfers_destination',
        'stock_transfers',
        ['destination_id'],
        unique=False
    )
    op.create_index(
        'idx_stock_transfers_barcode',
        'stock_transfers',
        ['source_barcode'],
        unique=False
    )
    op.create_index(
        'idx_stock_transfers_branch',
        'stock_transfers',
        ['branch_code'],
        unique=False
    )
    op.create_index(
        'idx_stock_transfers_created',
        'stock_transfers',
        ['created_at'],
        unique=False
    )
    op.create_index(
        'idx_stock_transfers_status',
        'stock_transfers',
        ['status'],
        unique=False
    )
    
    # Add columns to sales_stock table
    op.add_column(
        'sales_stock',
        sa.Column('transferred_to_company_asset_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'sales_stock',
        sa.Column('transfer_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'sales_stock',
        sa.Column('transfer_date', sa.DateTime(), nullable=True)
    )
    op.add_column(
        'sales_stock',
        sa.Column('transfer_reason', sa.String(500), nullable=True)
    )
    
    # Add foreign key for sales_stock transfer
    op.create_foreign_key(
        'fk_sales_stock_transfer_id',
        'sales_stock',
        'stock_transfers',
        ['transfer_id'],
        ['id']
    )
    
    # Add columns to company_assets table
    op.add_column(
        'company_assets',
        sa.Column('transferred_from_sales_stock_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'company_assets',
        sa.Column('transfer_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'company_assets',
        sa.Column('transfer_date', sa.DateTime(), nullable=True)
    )
    op.add_column(
        'company_assets',
        sa.Column('transfer_reason', sa.String(500), nullable=True)
    )
    
    # Add foreign key for company_assets transfer
    op.create_foreign_key(
        'fk_company_assets_transfer_id',
        'company_assets',
        'stock_transfers',
        ['transfer_id'],
        ['id']
    )


def downgrade() -> None:
    # Drop foreign keys
    op.drop_constraint(
        'fk_company_assets_transfer_id',
        'company_assets',
        type_='foreignkey'
    )
    op.drop_constraint(
        'fk_sales_stock_transfer_id',
        'sales_stock',
        type_='foreignkey'
    )
    
    # Drop columns from company_assets
    op.drop_column('company_assets', 'transfer_reason')
    op.drop_column('company_assets', 'transfer_date')
    op.drop_column('company_assets', 'transfer_id')
    op.drop_column('company_assets', 'transferred_from_sales_stock_id')
    
    # Drop columns from sales_stock
    op.drop_column('sales_stock', 'transfer_reason')
    op.drop_column('sales_stock', 'transfer_date')
    op.drop_column('sales_stock', 'transfer_id')
    op.drop_column('sales_stock', 'transferred_to_company_asset_id')
    
    # Drop indexes
    op.drop_index('idx_stock_transfers_status', table_name='stock_transfers')
    op.drop_index('idx_stock_transfers_created', table_name='stock_transfers')
    op.drop_index('idx_stock_transfers_branch', table_name='stock_transfers')
    op.drop_index('idx_stock_transfers_barcode', table_name='stock_transfers')
    op.drop_index('idx_stock_transfers_destination', table_name='stock_transfers')
    op.drop_index('idx_stock_transfers_source', table_name='stock_transfers')
    
    # Drop stock_transfers table
    op.drop_table('stock_transfers')
