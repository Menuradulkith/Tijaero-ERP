"""reimbursement_workflow_items

Revision ID: 87d8f595d1c5
Revises: c4d5e6f7g8h9
Create Date: 2026-02-11 17:22:37.942316

"""
from alembic import op
import sqlalchemy as sa


revision = '87d8f595d1c5'
down_revision = 'c4d5e6f7g8h9'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # ── New columns on existing 'reimbursements' table ──
    op.add_column('reimbursements', sa.Column('reimbursement_no', sa.String(50), nullable=True))
    op.add_column('reimbursements', sa.Column('branch_code', sa.Text(), sa.ForeignKey('branches.branch_code'), nullable=True))
    op.add_column('reimbursements', sa.Column('claim_date', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('reimbursements', sa.Column('reimbursement_type', sa.String(50), server_default='general', nullable=True))
    op.add_column('reimbursements', sa.Column('total_amount', sa.Numeric(15, 2), server_default='0', nullable=True))
    op.add_column('reimbursements', sa.Column('approved_amount', sa.Numeric(15, 2), nullable=True))
    op.add_column('reimbursements', sa.Column('status', sa.String(30), server_default='pending', nullable=True))
    op.add_column('reimbursements', sa.Column('approved_date', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('rejection_reason', sa.Text(), nullable=True))
    op.add_column('reimbursements', sa.Column('verified_by', sa.Text(), nullable=True))
    op.add_column('reimbursements', sa.Column('verified_date', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('payment_status', sa.String(30), nullable=True))
    op.add_column('reimbursements', sa.Column('payment_date', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('payment_method', sa.String(50), nullable=True))
    op.add_column('reimbursements', sa.Column('payment_reference', sa.String(100), nullable=True))
    op.add_column('reimbursements', sa.Column('paid_amount', sa.Numeric(15, 2), nullable=True))
    op.add_column('reimbursements', sa.Column('created_at', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('updated_at', sa.DateTime(), nullable=True))

    # Create unique index on reimbursement_no
    op.create_index('ix_reimbursements_reimbursement_no', 'reimbursements', ['reimbursement_no'], unique=True)
    # Create index on status
    op.create_index('ix_reimbursements_status', 'reimbursements', ['status'])

    # Remove unique constraint on employee_id (if exists)
    # Try to drop the constraint only if it exists
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    constraints = inspector.get_unique_constraints('reimbursements')
    
    for constraint in constraints:
        if constraint['name'] == 'uq_reimbursements_employee_id' or 'employee_id' in constraint.get('column_names', []):
            try:
                op.drop_constraint(constraint['name'], 'reimbursements', type_='unique')
            except Exception:
                pass  # Constraint may have been dropped already

    # Make approval_id nullable (it was previously required)
    op.alter_column('reimbursements', 'approval_id', existing_type=sa.Integer(), nullable=True)

    # ── New 'reimbursement_items' table ──
    op.create_table(
        'reimbursement_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('reimbursement_id', sa.Integer(), sa.ForeignKey('reimbursements.id', ondelete='CASCADE'), nullable=False),
        sa.Column('expense_type', sa.String(50), nullable=False),
        sa.Column('item_description', sa.Text(), nullable=True),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('receipt_date', sa.DateTime(), nullable=True),
        sa.Column('receipt_number', sa.String(100), nullable=True),
    )
    op.create_index('ix_reimbursement_items_id', 'reimbursement_items', ['id'])
    op.create_index('ix_reimbursement_items_reimbursement_id', 'reimbursement_items', ['reimbursement_id'])


def downgrade() -> None:
    # Drop reimbursement_items table
    op.drop_index('ix_reimbursement_items_reimbursement_id', 'reimbursement_items')
    op.drop_index('ix_reimbursement_items_id', 'reimbursement_items')
    op.drop_table('reimbursement_items')

    # Drop indexes
    op.drop_index('ix_reimbursements_status', 'reimbursements')
    op.drop_index('ix_reimbursements_reimbursement_no', 'reimbursements')

    # Drop added columns
    columns_to_drop = [
        'reimbursement_no', 'branch_code', 'claim_date', 'description',
        'reimbursement_type', 'total_amount', 'approved_amount', 'status',
        'approved_date', 'rejection_reason', 'verified_by', 'verified_date',
        'payment_status', 'payment_date', 'payment_method', 'payment_reference',
        'paid_amount', 'created_at', 'updated_at',
    ]
    with op.batch_alter_table('reimbursements') as batch_op:
        for col in columns_to_drop:
            batch_op.drop_column(col)
