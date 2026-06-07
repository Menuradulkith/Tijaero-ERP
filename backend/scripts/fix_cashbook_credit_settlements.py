"""Update credit settlement descriptions in cashbook and update the trigger function"""
from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv

# Load env variables
load_dotenv()

db_url = os.getenv("DATABASE_URL")
if not db_url:
    raise ValueError("DATABASE_URL environment variable is not set")

# Ensure it uses postgresql driver
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

print(f"Connecting to database: {db_url}")
engine = create_engine(db_url)

with engine.connect() as conn:
    print("Re-creating trigger function: trg_cashbook_customer_credit_settle")
    conn.execute(text("""
        CREATE OR REPLACE FUNCTION trg_cashbook_customer_credit_settle()
        RETURNS TRIGGER AS $$
        DECLARE
            v_customer_name VARCHAR(200);
            v_branch_code VARCHAR(200);
            v_settle_id INTEGER;
            v_invoice_no VARCHAR(200);
            v_payment_method_display VARCHAR(50);
        BEGIN
            -- Get the parent settle record
            SELECT cs.branch_code, cs.customer_id, cs.id
            INTO v_branch_code, v_settle_id, v_settle_id
            FROM customer_credits_settle cs
            WHERE cs.id = NEW.customer_credit_settle_id;

            -- Get customer name through settle -> customer
            SELECT c.customer_name INTO v_customer_name
            FROM customer_credits_settle cs
            JOIN customers c ON cs.customer_id = c.id
            WHERE cs.id = NEW.customer_credit_settle_id;
            v_customer_name := COALESCE(v_customer_name, 'Unknown Customer');

            -- Get branch_code from parent settle
            SELECT cs.branch_code INTO v_branch_code
            FROM customer_credits_settle cs
            WHERE cs.id = NEW.customer_credit_settle_id;

            -- Get invoice_no from invoices
            SELECT invoice_no INTO v_invoice_no
            FROM invoices
            WHERE id = NEW.invoice_id;
            v_invoice_no := COALESCE(v_invoice_no, 'INV-#' || NEW.invoice_id);

            -- Map raw payment method to display name
            v_payment_method_display := CASE LOWER(COALESCE(NEW.payment_method, ''))
                WHEN 'cash' THEN 'Cash'
                WHEN 'card' THEN 'Card'
                WHEN 'card_visa' THEN 'Visa Card'
                WHEN 'card_mastercard' THEN 'Mastercard'
                WHEN 'card_amex' THEN 'Amex Card'
                WHEN 'bank_transfer' THEN 'Bank Transfer'
                WHEN 'bank' THEN 'Bank Transfer'
                WHEN 'cheque' THEN 'Cheque'
                ELSE NEW.payment_method
            END;

            PERFORM fn_insert_cashbook_entry(
                'customer_credit_settle'::VARCHAR(50),
                COALESCE(NEW.created_date::TIMESTAMP, NOW()::TIMESTAMP),
                'customer_credits_settle_transaction'::VARCHAR(100),
                NEW.id::INTEGER,
                ('CCS-' || NEW.customer_credit_settle_id || '-INV-' || NEW.invoice_id)::VARCHAR(200),
                ('Invoice ' || v_invoice_no || ' - ' || v_payment_method_display)::TEXT,
                v_customer_name::VARCHAR(200),
                NEW.payment_method::VARCHAR(50),
                NEW.payment_amount::NUMERIC(15,2),
                0::NUMERIC(15,2),
                v_branch_code::VARCHAR(200)
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """))

    print("Updating existing credit settlement descriptions in cashbook_entries table")
    result = conn.execute(text("""
        UPDATE cashbook_entries c
        SET description = 'Invoice ' || i.invoice_no || ' - ' || (
            CASE LOWER(COALESCE(t.payment_method, ''))
                WHEN 'cash' THEN 'Cash'
                WHEN 'card' THEN 'Card'
                WHEN 'card_visa' THEN 'Visa Card'
                WHEN 'card_mastercard' THEN 'Mastercard'
                WHEN 'card_amex' THEN 'Amex Card'
                WHEN 'bank_transfer' THEN 'Bank Transfer'
                WHEN 'bank' THEN 'Bank Transfer'
                WHEN 'cheque' THEN 'Cheque'
                ELSE t.payment_method
            END
        )
        FROM customer_credits_settle_transaction t
        JOIN invoices i ON t.invoice_id = i.id
        WHERE c.entry_type = 'customer_credit_settle'
          AND c.source_table = 'customer_credits_settle_transaction'
          AND c.source_id = t.id
    """))
    conn.commit()
    print(f"Updated {result.rowcount} cashbook entry descriptions successfully.")
