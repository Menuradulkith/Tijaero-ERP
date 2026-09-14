"""Supplier: add contact persons list, drop remaining person-shaped fields

Revision ID: s50_supplier_contact_persons
Revises: s49_supplier_drop_fields
Create Date: 2026-09-13

Supplier now represents the company (company_name, address, contact info,
credit terms). The remaining person-shaped fields (title, full_name,
occupation, gender, birthdate, id_card_number, passport_no) move into a new
supplier_contact_person table, so a company can have multiple contact
persons rather than exactly one baked into the supplier row.

No backfill: every downstream consumer of supplier.full_name (90+ call
sites across purchasing/finance/reporting/chat-agent) is being repointed
to supplier.company_name in this same change, and the other six fields
have zero business-logic dependents (confirmed: no credit-check/KYC logic
reads them anywhere in purchasing).
"""
from alembic import op
import sqlalchemy as sa

revision = 's50_supplier_contact_persons'
down_revision = 's49_supplier_drop_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'supplier_contact_person',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(30), nullable=True),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('occupation', sa.String(255), nullable=True),
        sa.Column('gender', sa.String(30), nullable=True),
        sa.Column('birthdate', sa.Date(), nullable=True),
        sa.Column('id_card_number', sa.String(12), nullable=True),
        sa.Column('passport_no', sa.String(50), nullable=True),
        sa.Column('email', sa.String(75), nullable=True),
        sa.Column('phone', sa.String(12), nullable=True),
        # AuditMixin columns
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_supplier_contact_person_id', 'supplier_contact_person', ['id'], unique=False)
    op.create_index('ix_supplier_contact_person_supplier_id', 'supplier_contact_person', ['supplier_id'], unique=False)

    op.drop_column('supplier', 'title')
    op.drop_column('supplier', 'full_name')
    op.drop_column('supplier', 'occupation')
    op.drop_column('supplier', 'gender')
    op.drop_column('supplier', 'birthdate')
    op.drop_column('supplier', 'id_card_number')
    op.drop_column('supplier', 'passport_no')


def downgrade() -> None:
    op.add_column('supplier', sa.Column('passport_no', sa.String(50), nullable=True))
    op.add_column('supplier', sa.Column('id_card_number', sa.String(12), nullable=True))
    op.add_column('supplier', sa.Column('birthdate', sa.Date(), nullable=True))
    op.add_column('supplier', sa.Column('gender', sa.String(30), nullable=False, server_default='other'))
    op.add_column('supplier', sa.Column('occupation', sa.String(255), nullable=True))
    op.add_column('supplier', sa.Column('full_name', sa.String(255), nullable=False, server_default='Unknown'))
    op.add_column('supplier', sa.Column('title', sa.String(30), nullable=False, server_default='mr'))

    op.drop_index('ix_supplier_contact_person_supplier_id', table_name='supplier_contact_person')
    op.drop_index('ix_supplier_contact_person_id', table_name='supplier_contact_person')
    op.drop_table('supplier_contact_person')
