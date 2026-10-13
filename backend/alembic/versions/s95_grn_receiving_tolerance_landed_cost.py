"""GRN receiving details, receipt tolerances and landed cost vouchers

Revision ID: s95_grn_tolerance_landed_cost
Revises: s94_grn_status_rejections
Create Date: 2026-10-12

- good_received_note.vehicle_no / received_by: who received the goods, on which vehicle.
- products.over_receipt_tolerance_pct / under_receipt_tolerance_pct (default 0 = exact):
  a PO line may be over-received up to +over% and counts as fully received (PO closes) once
  -under% of the ordered quantity has arrived.
- landed_cost_vouchers / landed_cost_allocations: freight, duty, insurance... allocated
  across the lines of a GRN (by quantity or value) so each line has a landed unit cost.
"""
from alembic import op
import sqlalchemy as sa

revision = 's95_grn_tolerance_landed_cost'
down_revision = 's94_grn_status_rejections'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('good_received_note', sa.Column('vehicle_no', sa.String(50), nullable=True))
    op.add_column('good_received_note', sa.Column('received_by', sa.String(200), nullable=True))

    op.add_column('products', sa.Column('over_receipt_tolerance_pct', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.add_column('products', sa.Column('under_receipt_tolerance_pct', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.create_check_constraint('ck_products_over_tolerance', 'products', 'over_receipt_tolerance_pct >= 0 AND over_receipt_tolerance_pct <= 100')
    op.create_check_constraint('ck_products_under_tolerance', 'products', 'under_receipt_tolerance_pct >= 0 AND under_receipt_tolerance_pct <= 100')

    op.create_table(
        'landed_cost_vouchers',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('voucher_no', sa.String(100), nullable=False, unique=True),
        sa.Column('voucher_date', sa.Date(), nullable=False),
        sa.Column('good_received_note_id', sa.Integer(), sa.ForeignKey('good_received_note.id'), nullable=False, index=True),
        sa.Column('branch_code', sa.String(200), nullable=False),
        sa.Column('supplier_id', sa.Integer(), sa.ForeignKey('supplier.id'), nullable=True),
        sa.Column('charge_type', sa.String(30), nullable=False),
        sa.Column('description', sa.String(200), nullable=True),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('allocation_basis', sa.String(20), nullable=False),
        sa.Column('payment_method', sa.String(20), nullable=False),
        sa.Column('reference_no', sa.String(200), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='posted'),
        sa.Column('cancelled_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('cancelled_by', sa.Integer(), nullable=True),
        sa.Column('cancel_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.CheckConstraint('amount > 0', name='ck_landed_cost_amount_positive'),
        sa.CheckConstraint("status IN ('posted', 'cancelled')", name='ck_landed_cost_status'),
    )
    op.create_table(
        'landed_cost_allocations',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('voucher_id', sa.Integer(), sa.ForeignKey('landed_cost_vouchers.id'), nullable=False, index=True),
        sa.Column('purchasing_order_items_id', sa.Integer(), sa.ForeignKey('purchasing_order_items.id'), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('landed_cost_allocations')
    op.drop_table('landed_cost_vouchers')
    op.drop_constraint('ck_products_under_tolerance', 'products', type_='check')
    op.drop_constraint('ck_products_over_tolerance', 'products', type_='check')
    op.drop_column('products', 'under_receipt_tolerance_pct')
    op.drop_column('products', 'over_receipt_tolerance_pct')
    op.drop_column('good_received_note', 'received_by')
    op.drop_column('good_received_note', 'vehicle_no')
