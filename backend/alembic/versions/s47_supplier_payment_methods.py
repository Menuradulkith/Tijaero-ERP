"""Add supplier_payment_method table

Revision ID: s47_supplier_payment_methods
Revises: s46_timezone
Create Date: 2026-09-13

Lets a supplier have one or more saved payment methods (bank account details,
cheque, or cash) on their profile, so the Supplier Payments screen can offer
them as a quick pick instead of retyping bank details every time.
"""
from alembic import op
import sqlalchemy as sa

revision = 's47_supplier_payment_methods'
down_revision = 's46_timezone'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'supplier_payment_method',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('method_type', sa.String(30), nullable=False),
        sa.Column('bank_name', sa.String(255), nullable=True),
        sa.Column('account_number', sa.String(100), nullable=True),
        sa.Column('account_holder_name', sa.String(255), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        # AuditMixin columns
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_supplier_payment_method_id', 'supplier_payment_method', ['id'], unique=False)
    op.create_index('ix_supplier_payment_method_supplier_id', 'supplier_payment_method', ['supplier_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_supplier_payment_method_supplier_id', table_name='supplier_payment_method')
    op.drop_index('ix_supplier_payment_method_id', table_name='supplier_payment_method')
    op.drop_table('supplier_payment_method')
