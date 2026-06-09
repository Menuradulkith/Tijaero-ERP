"""fix cashbook credit settlement time and format

Revision ID: 20260607_fix_ccs
Revises: 442c8ace6a27
Create Date: 2026-06-07 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260607_fix_ccs'
down_revision = '442c8ace6a27'
branch_labels = None
depends_on = None


def upgrade():
    # Fix the trigger function to use NOW() for timestamp and format CCS number like invoices
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_customer_credit_settle()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment_method_display VARCHAR(50);
            v_invoice_no VARCHAR(200);
            v_customer_name VARCHAR(200);
            v_branch_code VARCHAR(50);
            v_settle_id INTEGER;
            v_ccs_number VARCHAR(50);
        BEGIN
            -- Get settlement ID and branch
            SELECT cs.id, cs.branch_code
            INTO v_settle_id, v_branch_code
            FROM customer_credits_settle cs
            WHERE cs.id = NEW.customer_credit_settle_id;

            -- Get customer name through settle -> customer
            SELECT c.customer_name INTO v_customer_name
            FROM customer_credits_settle cs
            JOIN customers c ON cs.customer_id = c.id
            WHERE cs.id = NEW.customer_credit_settle_id;
            v_customer_name := COALESCE(v_customer_name, 'Unknown Customer');

            -- Get invoice_no from invoices
            SELECT invoice_no INTO v_invoice_no
            FROM invoices
            WHERE id = NEW.invoice_id;

            -- Format payment method for display
            CASE LOWER(COALESCE(NEW.payment_method, 'cash'))
                WHEN 'cash' THEN v_payment_method_display := 'Cash';
                WHEN 'card' THEN v_payment_method_display := 'Card';
                WHEN 'bank_transfer' THEN v_payment_method_display := 'Bank Transfer';
                WHEN 'cheque' THEN v_payment_method_display := 'Cheque';
                ELSE v_payment_method_display := NEW.payment_method;
            END CASE;

            -- Format CCS number like invoices: CCS-YYYY-NNNNN
            v_ccs_number := 'CCS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
                           LPAD(v_settle_id::TEXT, 5, '0');

            PERFORM fn_insert_cashbook_entry(
                'customer_credit_settle'::VARCHAR(50),
                NOW()::TIMESTAMP,  -- Use current timestamp instead of date
                'customer_credits_settle_transaction'::VARCHAR(100),
                NEW.id::INTEGER,
                v_ccs_number::VARCHAR(200),  -- Use formatted CCS number
                ('Invoice ' || v_invoice_no || ' - ' || v_payment_method_display)::TEXT,
                v_customer_name::VARCHAR(200),
                NEW.payment_method::VARCHAR(50),
                NEW.payment_amount::NUMERIC(60, 2),
                0::NUMERIC(60, 2),
                v_branch_code::VARCHAR(200)
            );
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # Update existing cashbook entries for credit settlements to fix the format
    op.execute("""
        UPDATE cashbook_entries c
        SET 
            reference_no = 'CCS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
                          LPAD(cs.id::TEXT, 5, '0'),
            transaction_date = COALESCE(
                (SELECT created_at FROM customer_credits_settle_transaction WHERE id = c.source_id),
                c.transaction_date
            )
        FROM customer_credits_settle_transaction t
        JOIN customer_credits_settle cs ON t.customer_credit_settle_id = cs.id
        WHERE c.entry_type = 'customer_credit_settle'
          AND c.source_table = 'customer_credits_settle_transaction'
          AND c.source_id = t.id;
    """)


def downgrade():
    # Revert to old format
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_customer_credit_settle()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment_method_display VARCHAR(50);
            v_invoice_no VARCHAR(200);
            v_customer_name VARCHAR(200);
            v_branch_code VARCHAR(50);
            v_settle_id INTEGER;
        BEGIN
            -- Get settlement ID and branch
            SELECT cs.id, cs.branch_code, cs.id
            INTO v_branch_code, v_settle_id, v_settle_id
            FROM customer_credits_settle cs
            WHERE cs.id = NEW.customer_credit_settle_id;

            -- Get customer name through settle -> customer
            SELECT c.customer_name INTO v_customer_name
            FROM customer_credits_settle cs
            JOIN customers c ON cs.customer_id = c.id
            WHERE cs.id = NEW.customer_credit_settle_id;
            v_customer_name := COALESCE(v_customer_name, 'Unknown Customer');

            -- Get branch code
            SELECT cs.branch_code INTO v_branch_code
            FROM customer_credits_settle cs
            WHERE cs.id = NEW.customer_credit_settle_id;

            -- Get invoice_no from invoices
            SELECT invoice_no INTO v_invoice_no
            FROM invoices
            WHERE id = NEW.invoice_id;

            -- Format payment method for display
            CASE LOWER(COALESCE(NEW.payment_method, 'cash'))
                WHEN 'cash' THEN v_payment_method_display := 'Cash';
                WHEN 'card' THEN v_payment_method_display := 'Card';
                WHEN 'bank_transfer' THEN v_payment_method_display := 'Bank Transfer';
                WHEN 'cheque' THEN v_payment_method_display := 'Cheque';
                ELSE v_payment_method_display := NEW.payment_method;
            END CASE;

            PERFORM fn_insert_cashbook_entry(
                'customer_credit_settle'::VARCHAR(50),
                COALESCE(NEW.created_date::TIMESTAMP, NOW()::TIMESTAMP),
                'customer_credits_settle_transaction'::VARCHAR(100),
                NEW.id::INTEGER,
                ('CCS-' || NEW.customer_credit_settle_id || '-INV-' || NEW.invoice_id)::VARCHAR(200),
                ('Invoice ' || v_invoice_no || ' - ' || v_payment_method_display)::TEXT,
                v_customer_name::VARCHAR(200),
                NEW.payment_method::VARCHAR(50),
                NEW.payment_amount::NUMERIC(60, 2),
                0::NUMERIC(60, 2),
                v_branch_code::VARCHAR(200)
            );
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
