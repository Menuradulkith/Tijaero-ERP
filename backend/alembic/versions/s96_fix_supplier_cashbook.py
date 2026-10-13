"""Fix the supplier cashbook trigger functions (wrong table / column names)

Revision ID: s96_fix_supplier_cashbook
Revises: s95_grn_tolerance_landed_cost
Create Date: 2026-10-12

a1b2c3d4e5f6 created two trigger functions that do not match the schema:

* trg_cashbook_supplier_credit_settle joined "suppliers" (the table is "supplier");
* trg_cashbook_supplier_advance read supplier.full_name (the column is company_name).

On a database built from the migrations every supplier credit settlement and every
supplier advance therefore failed with a 500 ("relation suppliers does not exist" /
"column full_name does not exist") - the trigger runs inside the same INSERT.
"""
from alembic import op

revision = 's96_fix_supplier_cashbook'
down_revision = 's95_grn_tolerance_landed_cost'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_supplier_credit_settle()
        RETURNS TRIGGER AS $$
        DECLARE
            v_supplier_name VARCHAR(200);
            v_branch_code VARCHAR(200);
        BEGIN
            -- Get supplier name and branch through settle -> supplier
            SELECT s.company_name, scs.branch_code
            INTO v_supplier_name, v_branch_code
            FROM supplier_credits_settle scs
            JOIN supplier s ON scs.suppliers_id = s.id
            WHERE scs.id = NEW.supplier_credit_settle_id;
            v_supplier_name := COALESCE(v_supplier_name, 'Unknown Supplier');

            PERFORM fn_insert_cashbook_entry(
                'supplier_payment',
                COALESCE(NEW.created_date::TIMESTAMP, NOW()::TIMESTAMP),
                'supplier_credits_settle_transaction', NEW.id,
                'SCS-' || NEW.supplier_credit_settle_id || '-GRN-' || NEW.good_received_id,
                'Supplier Payment for GRN #' || NEW.good_received_id,
                v_supplier_name, NEW.payment_method,
                0, NEW.payment_amount,
                v_branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_supplier_advance()
        RETURNS TRIGGER AS $$
        DECLARE
            v_supplier_name VARCHAR(200);
        BEGIN
            SELECT company_name INTO v_supplier_name
            FROM supplier WHERE id = NEW.supplier_id;
            v_supplier_name := COALESCE(v_supplier_name, 'Supplier #' || NEW.supplier_id);

            PERFORM fn_insert_cashbook_entry(
                'supplier_payment',
                NEW.payment_date::TIMESTAMP,
                'supplier_advance_payment', NEW.id,
                NEW.advance_no,
                'Supplier Advance Payment ' || NEW.advance_no,
                v_supplier_name, NEW.payment_method,
                0, NEW.original_amount,
                NEW.branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    # The previous definitions were broken; there is nothing worth restoring.
    pass
