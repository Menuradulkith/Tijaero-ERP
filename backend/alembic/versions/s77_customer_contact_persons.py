"""Add customer_contact_person table

Revision ID: s77_customer_contact_persons
Revises: s76_customer_type
Create Date: 2026-10-06

A business customer can have any number of contact persons (buyer,
accountant, ...), one of which may be flagged primary. Mirrors
supplier_contact_person (s50) in a leaner form.
"""
from alembic import op
import sqlalchemy as sa

revision = 's77_customer_contact_persons'
down_revision = 's76_customer_type'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'customer_contact_person',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(30), nullable=True),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('designation', sa.String(255), nullable=True),
        sa.Column('email', sa.String(75), nullable=True),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default=sa.false()),
        # AuditMixin columns
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_customer_contact_person_id', 'customer_contact_person', ['id'], unique=False)
    op.create_index('ix_customer_contact_person_customer_id', 'customer_contact_person', ['customer_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_customer_contact_person_customer_id', table_name='customer_contact_person')
    op.drop_index('ix_customer_contact_person_id', table_name='customer_contact_person')
    op.drop_table('customer_contact_person')
