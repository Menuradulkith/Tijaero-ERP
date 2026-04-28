"""Create materialized cashbook_entries table with triggers

Revision ID: a1b2c3d4e5f6
Revises: add_voucher_payment_fields
Create Date: 2026-02-08 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a1b2c3d4e5f6'
down_revision = 'add_voucher_payment_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================================
    # STEP 1: Create the cashbook_entries table
    # =========================================================================
    op.create_table(
        'cashbook_entries',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('entry_type', sa.String(50), nullable=False),
        sa.Column('transaction_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now(), nullable=False),
        sa.Column('source_table', sa.String(100), nullable=False),
        sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('reference_no', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('party_name', sa.String(200), nullable=True),
        sa.Column('payment_method', sa.String(50), nullable=True),
        sa.Column('money_in', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('money_out', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('running_balance', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('is_reversal', sa.Boolean(), server_default='false'),
        sa.Column('original_entry_id', sa.Integer(), nullable=True),
    )

    op.create_index('ix_cashbook_entries_id', 'cashbook_entries', ['id'], unique=False)
    op.create_index('idx_cashbook_branch_date', 'cashbook_entries', ['branch_code', 'transaction_date', 'id'])
    op.create_index('idx_cashbook_source', 'cashbook_entries', ['source_table', 'source_id'])
    op.create_index('idx_cashbook_entry_type', 'cashbook_entries', ['entry_type'])
    op.create_index('idx_cashbook_transaction_date', 'cashbook_entries', ['transaction_date'])

    # =========================================================================
    # STEP 2: Create the trigger function for inserting cashbook entries
    # This uses advisory locks per branch to serialize concurrent writes
    # and ensure correct running balance calculation.
    # =========================================================================
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_insert_cashbook_entry(
            p_entry_type VARCHAR(50),
            p_transaction_date TIMESTAMP,
            p_source_table VARCHAR(100),
            p_source_id INTEGER,
            p_reference_no VARCHAR(200),
            p_description TEXT,
            p_party_name VARCHAR(200),
            p_payment_method VARCHAR(50),
            p_money_in NUMERIC(15,2),
            p_money_out NUMERIC(15,2),
            p_branch_code VARCHAR(200)
        ) RETURNS VOID AS $$
        DECLARE
            v_lock_id BIGINT;
            v_last_balance NUMERIC(15,2);
            v_running_balance NUMERIC(15,2);
        BEGIN
            -- Acquire per-branch advisory lock to serialize cashbook writes.
            -- Different branches can write concurrently; same-branch writes
            -- are serialized to ensure correct running balance.
            v_lock_id := hashtext(COALESCE(p_branch_code, '__no_branch__'))::BIGINT;
            PERFORM pg_advisory_xact_lock(v_lock_id);

            -- Get last running balance for this branch
            SELECT COALESCE(
                (SELECT running_balance
                 FROM cashbook_entries
                 WHERE branch_code IS NOT DISTINCT FROM p_branch_code
                 ORDER BY transaction_date DESC, id DESC
                 LIMIT 1),
                0.00
            ) INTO v_last_balance;

            -- Calculate new running balance
            v_running_balance := v_last_balance + p_money_in - p_money_out;

            -- Insert the cashbook entry
            INSERT INTO cashbook_entries (
                entry_type, transaction_date, source_table, source_id,
                reference_no, description, party_name, payment_method,
                money_in, money_out, running_balance, branch_code
            ) VALUES (
                p_entry_type, p_transaction_date, p_source_table, p_source_id,
                p_reference_no, p_description, p_party_name, p_payment_method,
                p_money_in, p_money_out, v_running_balance, p_branch_code
            );
            -- Advisory lock automatically released on transaction COMMIT/ROLLBACK
        END;
        $$ LANGUAGE plpgsql;
    """)

    # =========================================================================
    # STEP 3: Create trigger functions for each source table
    # =========================================================================

    # --- TRIGGER: Invoices (CASH INFLOWS) ---
    # Each invoice can produce up to 6 entries (one per non-zero payment method)
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_invoice()
        RETURNS TRIGGER AS $$
        DECLARE
            v_customer_name VARCHAR(200);
        BEGIN
            -- Get customer name
            SELECT customer_name INTO v_customer_name
            FROM customers WHERE id = NEW.customer_id;
            v_customer_name := COALESCE(v_customer_name, 'Customer #' || NEW.customer_id);

            -- Cash amount
            IF COALESCE(NEW.cash_amount, 0) > 0 THEN
                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt',
                    COALESCE(NEW.created_date_time, NEW.created_date::TIMESTAMP),
                    'invoices', NEW.id,
                    NEW.invoice_no,
                    'Invoice ' || NEW.invoice_no || ' - Cash',
                    v_customer_name, 'Cash',
                    NEW.cash_amount, 0,
                    NEW.branch_code
                );
            END IF;

            -- Visa Card amount
            IF COALESCE(NEW.card_visa_amount, 0) > 0 THEN
                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt',
                    COALESCE(NEW.created_date_time, NEW.created_date::TIMESTAMP),
                    'invoices', NEW.id,
                    NEW.invoice_no,
                    'Invoice ' || NEW.invoice_no || ' - Visa Card',
                    v_customer_name, 'Visa Card',
                    NEW.card_visa_amount, 0,
                    NEW.branch_code
                );
            END IF;

            -- Mastercard amount
            IF COALESCE(NEW.card_mastercard_amount, 0) > 0 THEN
                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt',
                    COALESCE(NEW.created_date_time, NEW.created_date::TIMESTAMP),
                    'invoices', NEW.id,
                    NEW.invoice_no,
                    'Invoice ' || NEW.invoice_no || ' - Mastercard',
                    v_customer_name, 'Mastercard',
                    NEW.card_mastercard_amount, 0,
                    NEW.branch_code
                );
            END IF;

            -- Amex Card amount
            IF COALESCE(NEW.card_amex_amount, 0) > 0 THEN
                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt',
                    COALESCE(NEW.created_date_time, NEW.created_date::TIMESTAMP),
                    'invoices', NEW.id,
                    NEW.invoice_no,
                    'Invoice ' || NEW.invoice_no || ' - Amex Card',
                    v_customer_name, 'Amex Card',
                    NEW.card_amex_amount, 0,
                    NEW.branch_code
                );
            END IF;

            -- Bank Transfer amount
            IF COALESCE(NEW.bank_transfer_amount, 0) > 0 THEN
                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt',
                    COALESCE(NEW.created_date_time, NEW.created_date::TIMESTAMP),
                    'invoices', NEW.id,
                    NEW.invoice_no,
                    'Invoice ' || NEW.invoice_no || ' - Bank Transfer',
                    v_customer_name, 'Bank Transfer',
                    NEW.bank_transfer_amount, 0,
                    NEW.branch_code
                );
            END IF;

            -- Cheque amount
            IF COALESCE(NEW.cheque_amount, 0) > 0 THEN
                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt',
                    COALESCE(NEW.created_date_time, NEW.created_date::TIMESTAMP),
                    'invoices', NEW.id,
                    NEW.invoice_no,
                    'Invoice ' || NEW.invoice_no || ' - Cheque',
                    v_customer_name, 'Cheque',
                    NEW.cheque_amount, 0,
                    NEW.branch_code
                );
            END IF;

            -- NOTE: credit_amount, advance_amount, voucher_amount, credit_note_amount
            -- are NOT included - they are non-cash movements

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # --- TRIGGER: Customer Credit Settlements (CASH INFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_customer_credit_settle()
        RETURNS TRIGGER AS $$
        DECLARE
            v_customer_name VARCHAR(200);
            v_branch_code VARCHAR(200);
            v_settle_id INTEGER;
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

            PERFORM fn_insert_cashbook_entry(
                'customer_credit_settle',
                COALESCE(NEW.created_date::TIMESTAMP, NOW()),
                'customer_credits_settle_transaction', NEW.id,
                'CCS-' || NEW.customer_credit_settle_id || '-INV-' || NEW.invoice_id,
                'Credit Settlement for Invoice #' || NEW.invoice_id,
                v_customer_name, NEW.payment_method,
                NEW.payment_amount, 0,
                v_branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # --- TRIGGER: Customer Advance Payments (CASH INFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_customer_advance()
        RETURNS TRIGGER AS $$
        DECLARE
            v_customer_name VARCHAR(200);
        BEGIN
            -- Only process active advances
            IF NEW.active IS NOT TRUE THEN
                RETURN NEW;
            END IF;

            SELECT customer_name INTO v_customer_name
            FROM customers WHERE id = NEW.customer_id;
            v_customer_name := COALESCE(v_customer_name, 'Customer #' || NEW.customer_id);

            PERFORM fn_insert_cashbook_entry(
                'customer_advance',
                NEW.created_date::TIMESTAMP,
                'customer_advance_payments', NEW.id,
                NEW.advance_payments_no,
                'Advance Payment ' || NEW.advance_payments_no,
                v_customer_name, NEW.payment_method,
                NEW.payment_amount, 0,
                NEW.branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # --- TRIGGER: Gift Voucher Sales (CASH INFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_voucher_sale()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment_label VARCHAR(50);
        BEGIN
            -- Map payment method to display label
            CASE LOWER(COALESCE(NEW.payment_method, 'cash'))
                WHEN 'cash' THEN v_payment_label := 'Cash';
                WHEN 'card' THEN v_payment_label := 'Card';
                WHEN 'bank_transfer' THEN v_payment_label := 'Bank Transfer';
                WHEN 'cheque' THEN v_payment_label := 'Cheque';
                ELSE v_payment_label := COALESCE(NEW.payment_method, 'Cash');
            END CASE;

            PERFORM fn_insert_cashbook_entry(
                'voucher_sale',
                COALESCE(NEW.created_at, NEW.date::TIMESTAMP),
                'customer_gift_voucher', NEW.id,
                NEW.barcode_no,
                'Gift voucher sold - ' || NEW.barcode_no,
                COALESCE(NEW.customer_name, 'Walk-in Customer'), v_payment_label,
                NEW.amount, 0,
                NEW.branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # --- TRIGGER: Supplier Credit Settlements (CASH OUTFLOW) ---
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
            JOIN suppliers s ON scs.suppliers_id = s.id
            WHERE scs.id = NEW.supplier_credit_settle_id;
            v_supplier_name := COALESCE(v_supplier_name, 'Unknown Supplier');

            PERFORM fn_insert_cashbook_entry(
                'supplier_payment',
                COALESCE(NEW.created_date::TIMESTAMP, NOW()),
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

    # --- TRIGGER: Supplier Direct Payments (CASH OUTFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_supplier_direct_payment()
        RETURNS TRIGGER AS $$
        DECLARE
            v_supplier_name VARCHAR(200);
            v_description TEXT;
        BEGIN
            -- Only completed/verified payments
            IF NEW.status NOT IN ('completed', 'verified') THEN
                RETURN NEW;
            END IF;

            SELECT company_name INTO v_supplier_name
            FROM supplier WHERE id = NEW.supplier_id;
            v_supplier_name := COALESCE(v_supplier_name, 'Supplier #' || NEW.supplier_id);

            v_description := 'Direct Payment ' || NEW.payment_no;
            IF NEW.purchasing_order_id IS NOT NULL THEN
                v_description := v_description || ' - PO #' || NEW.purchasing_order_id;
            END IF;
            IF NEW.payment_for IS NOT NULL AND NEW.payment_for != '' THEN
                v_description := v_description || ' (' || NEW.payment_for || ')';
            END IF;

            PERFORM fn_insert_cashbook_entry(
                'supplier_payment',
                NEW.payment_date::TIMESTAMP,
                'supplier_payments', NEW.id,
                NEW.payment_no,
                v_description,
                v_supplier_name, NEW.payment_method,
                0, NEW.payment_amount,
                NEW.branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # --- TRIGGER: Supplier Advance Payments (CASH OUTFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_supplier_advance()
        RETURNS TRIGGER AS $$
        DECLARE
            v_supplier_name VARCHAR(200);
        BEGIN
            SELECT COALESCE(full_name, company_name) INTO v_supplier_name
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

    # --- TRIGGER: Expenses (CASH OUTFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_expense()
        RETURNS TRIGGER AS $$
        BEGIN
            PERFORM fn_insert_cashbook_entry(
                'expense',
                NEW.created_date::TIMESTAMP,
                'expenses', NEW.id,
                NEW.expenses_no,
                COALESCE(NEW.remarks, 'Expense ' || NEW.expenses_no),
                NULL, NEW.expenses_method,
                0, NEW.expense_amount,
                NEW.branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # --- TRIGGER: Bank Deposits (CASH OUTFLOW) ---
    op.execute("""
        CREATE OR REPLACE FUNCTION trg_cashbook_bank_deposit()
        RETURNS TRIGGER AS $$
        DECLARE
            v_reference VARCHAR(200);
            v_bank_info TEXT;
        BEGIN
            v_reference := COALESCE(NEW.invoice_no, 'DEP-' || NEW.id);

            IF NEW.bank_name IS NOT NULL AND NEW.bank_name != '' THEN
                v_bank_info := 'Bank Deposit to ' || NEW.bank_name;
            ELSE
                v_bank_info := 'Bank Deposit';
            END IF;

            PERFORM fn_insert_cashbook_entry(
                'bank_deposit',
                NEW.created_date,
                'bank_deposits', NEW.id,
                v_reference,
                v_bank_info,
                NEW.bank_name, 'Bank Deposit',
                0, NEW.deposits_amount,
                NEW.branch_code
            );

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # =========================================================================
    # STEP 4: Attach triggers to source tables
    # =========================================================================

    # Invoice trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_invoice
        AFTER INSERT ON invoices
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_invoice();
    """)

    # Customer credit settlement transaction trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_customer_credit_settle
        AFTER INSERT ON customer_credits_settle_transaction
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_customer_credit_settle();
    """)

    # Customer advance payment trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_customer_advance
        AFTER INSERT ON customer_advance_payments
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_customer_advance();
    """)

    # Gift voucher sale trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_voucher_sale
        AFTER INSERT ON customer_gift_voucher
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_voucher_sale();
    """)

    # Supplier credit settlement transaction trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_supplier_credit_settle
        AFTER INSERT ON supplier_credits_settle_transaction
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_supplier_credit_settle();
    """)

    # Supplier direct payment trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_supplier_direct_payment
        AFTER INSERT ON supplier_payments
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_supplier_direct_payment();
    """)

    # Supplier advance payment trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_supplier_advance
        AFTER INSERT ON supplier_advance_payment
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_supplier_advance();
    """)

    # Expense trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_expense
        AFTER INSERT ON expenses
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_expense();
    """)

    # Bank deposit trigger
    op.execute("""
        CREATE TRIGGER trg_cashbook_after_bank_deposit
        AFTER INSERT ON bank_deposits
        FOR EACH ROW
        EXECUTE FUNCTION trg_cashbook_bank_deposit();
    """)

    # =========================================================================
    # STEP 5: Backfill existing data from all source tables
    # Uses the same fn_insert_cashbook_entry function (with advisory locks)
    # to ensure correct running balance for historical data.
    # =========================================================================

    # Backfill is done via a PL/pgSQL block that processes all existing
    # records in chronological order across all source tables.
    op.execute("""
        DO $$
        DECLARE
            r RECORD;
            v_customer_name VARCHAR(200);
            v_supplier_name VARCHAR(200);
            v_branch_code VARCHAR(200);
            v_description TEXT;
            v_reference VARCHAR(200);
            v_payment_label VARCHAR(50);
        BEGIN
            -- Process all existing records in chronological order
            -- We use a UNION ALL query sorted by date to interleave all sources
            FOR r IN (
                -- Invoice cash amounts
                SELECT 
                    'invoice_cash' AS src,
                    i.id, i.invoice_no, i.branch_code, 
                    COALESCE(i.created_date_time, i.created_date::TIMESTAMP) AS txn_date,
                    i.customer_id,
                    i.cash_amount AS amount,
                    'Cash' AS pay_method
                FROM invoices i
                WHERE COALESCE(i.cash_amount, 0) > 0

                UNION ALL
                SELECT 
                    'invoice_visa' AS src,
                    i.id, i.invoice_no, i.branch_code,
                    COALESCE(i.created_date_time, i.created_date::TIMESTAMP) AS txn_date,
                    i.customer_id,
                    i.card_visa_amount AS amount,
                    'Visa Card' AS pay_method
                FROM invoices i
                WHERE COALESCE(i.card_visa_amount, 0) > 0

                UNION ALL
                SELECT 
                    'invoice_mc' AS src,
                    i.id, i.invoice_no, i.branch_code,
                    COALESCE(i.created_date_time, i.created_date::TIMESTAMP) AS txn_date,
                    i.customer_id,
                    i.card_mastercard_amount AS amount,
                    'Mastercard' AS pay_method
                FROM invoices i
                WHERE COALESCE(i.card_mastercard_amount, 0) > 0

                UNION ALL
                SELECT 
                    'invoice_amex' AS src,
                    i.id, i.invoice_no, i.branch_code,
                    COALESCE(i.created_date_time, i.created_date::TIMESTAMP) AS txn_date,
                    i.customer_id,
                    i.card_amex_amount AS amount,
                    'Amex Card' AS pay_method
                FROM invoices i
                WHERE COALESCE(i.card_amex_amount, 0) > 0

                UNION ALL
                SELECT 
                    'invoice_bank' AS src,
                    i.id, i.invoice_no, i.branch_code,
                    COALESCE(i.created_date_time, i.created_date::TIMESTAMP) AS txn_date,
                    i.customer_id,
                    i.bank_transfer_amount AS amount,
                    'Bank Transfer' AS pay_method
                FROM invoices i
                WHERE COALESCE(i.bank_transfer_amount, 0) > 0

                UNION ALL
                SELECT 
                    'invoice_cheque' AS src,
                    i.id, i.invoice_no, i.branch_code,
                    COALESCE(i.created_date_time, i.created_date::TIMESTAMP) AS txn_date,
                    i.customer_id,
                    i.cheque_amount AS amount,
                    'Cheque' AS pay_method
                FROM invoices i
                WHERE COALESCE(i.cheque_amount, 0) > 0

                ORDER BY txn_date ASC, id ASC
            )
            LOOP
                SELECT customer_name INTO v_customer_name
                FROM customers WHERE id = r.customer_id;
                v_customer_name := COALESCE(v_customer_name, 'Customer #' || r.customer_id);

                PERFORM fn_insert_cashbook_entry(
                    'invoice_receipt', r.txn_date,
                    'invoices', r.id,
                    r.invoice_no,
                    'Invoice ' || r.invoice_no || ' - ' || r.pay_method,
                    v_customer_name, r.pay_method,
                    r.amount, 0,
                    r.branch_code
                );
            END LOOP;

            -- Backfill customer credit settlements
            FOR r IN (
                SELECT 
                    t.id, t.payment_amount, t.payment_method,
                    t.created_date::TIMESTAMP AS txn_date,
                    t.customer_credit_settle_id, t.invoice_id,
                    cs.branch_code, cs.customer_id
                FROM customer_credits_settle_transaction t
                JOIN customer_credits_settle cs ON t.customer_credit_settle_id = cs.id
                ORDER BY t.created_date ASC, t.id ASC
            )
            LOOP
                SELECT customer_name INTO v_customer_name
                FROM customers WHERE id = r.customer_id;
                v_customer_name := COALESCE(v_customer_name, 'Unknown Customer');

                PERFORM fn_insert_cashbook_entry(
                    'customer_credit_settle', r.txn_date,
                    'customer_credits_settle_transaction', r.id,
                    'CCS-' || r.customer_credit_settle_id || '-INV-' || r.invoice_id,
                    'Credit Settlement for Invoice #' || r.invoice_id,
                    v_customer_name, r.payment_method,
                    r.payment_amount, 0,
                    r.branch_code
                );
            END LOOP;

            -- Backfill customer advance payments (active only)
            FOR r IN (
                SELECT 
                    a.id, a.advance_payments_no, a.payment_amount, a.payment_method,
                    a.created_date::TIMESTAMP AS txn_date,
                    a.branch_code, a.customer_id
                FROM customer_advance_payments a
                WHERE a.active = TRUE
                ORDER BY a.created_date ASC, a.id ASC
            )
            LOOP
                SELECT customer_name INTO v_customer_name
                FROM customers WHERE id = r.customer_id;
                v_customer_name := COALESCE(v_customer_name, 'Customer #' || r.customer_id);

                PERFORM fn_insert_cashbook_entry(
                    'customer_advance', r.txn_date,
                    'customer_advance_payments', r.id,
                    r.advance_payments_no,
                    'Advance Payment ' || r.advance_payments_no,
                    v_customer_name, r.payment_method,
                    r.payment_amount, 0,
                    r.branch_code
                );
            END LOOP;

            -- Backfill gift voucher sales
            FOR r IN (
                SELECT 
                    v.id, v.barcode_no, v.amount, v.payment_method,
                    COALESCE(v.created_at, v.date::TIMESTAMP) AS txn_date,
                    v.branch_code, v.customer_name AS cust_name
                FROM customer_gift_voucher v
                ORDER BY COALESCE(v.created_at, v.date::TIMESTAMP) ASC, v.id ASC
            )
            LOOP
                CASE LOWER(COALESCE(r.payment_method, 'cash'))
                    WHEN 'cash' THEN v_payment_label := 'Cash';
                    WHEN 'card' THEN v_payment_label := 'Card';
                    WHEN 'bank_transfer' THEN v_payment_label := 'Bank Transfer';
                    WHEN 'cheque' THEN v_payment_label := 'Cheque';
                    ELSE v_payment_label := COALESCE(r.payment_method, 'Cash');
                END CASE;

                PERFORM fn_insert_cashbook_entry(
                    'voucher_sale', r.txn_date,
                    'customer_gift_voucher', r.id,
                    r.barcode_no,
                    'Gift voucher sold - ' || r.barcode_no,
                    COALESCE(r.cust_name, 'Walk-in Customer'), v_payment_label,
                    r.amount, 0,
                    r.branch_code
                );
            END LOOP;

            -- Backfill supplier credit settlements
            FOR r IN (
                SELECT 
                    t.id, t.payment_amount, t.payment_method,
                    COALESCE(t.created_date::TIMESTAMP, NOW()) AS txn_date,
                    t.supplier_credit_settle_id, t.good_received_id,
                    scs.branch_code, scs.suppliers_id
                FROM supplier_credits_settle_transaction t
                JOIN supplier_credits_settle scs ON t.supplier_credit_settle_id = scs.id
                ORDER BY t.created_date ASC, t.id ASC
            )
            LOOP
                SELECT company_name INTO v_supplier_name
                FROM supplier WHERE id = r.suppliers_id;
                v_supplier_name := COALESCE(v_supplier_name, 'Unknown Supplier');

                PERFORM fn_insert_cashbook_entry(
                    'supplier_payment', r.txn_date,
                    'supplier_credits_settle_transaction', r.id,
                    'SCS-' || r.supplier_credit_settle_id || '-GRN-' || r.good_received_id,
                    'Supplier Payment for GRN #' || r.good_received_id,
                    v_supplier_name, r.payment_method,
                    0, r.payment_amount,
                    r.branch_code
                );
            END LOOP;

            -- Backfill supplier direct payments (completed/verified only)
            FOR r IN (
                SELECT 
                    sp.id, sp.payment_no, sp.payment_amount, sp.payment_method,
                    sp.payment_date::TIMESTAMP AS txn_date,
                    sp.branch_code, sp.supplier_id,
                    sp.purchasing_order_id, sp.payment_for
                FROM supplier_payments sp
                WHERE sp.status IN ('completed', 'verified')
                ORDER BY sp.payment_date ASC, sp.id ASC
            )
            LOOP
                SELECT company_name INTO v_supplier_name
                FROM supplier WHERE id = r.supplier_id;
                v_supplier_name := COALESCE(v_supplier_name, 'Supplier #' || r.supplier_id);

                v_description := 'Direct Payment ' || r.payment_no;
                IF r.purchasing_order_id IS NOT NULL THEN
                    v_description := v_description || ' - PO #' || r.purchasing_order_id;
                END IF;
                IF r.payment_for IS NOT NULL AND r.payment_for != '' THEN
                    v_description := v_description || ' (' || r.payment_for || ')';
                END IF;

                PERFORM fn_insert_cashbook_entry(
                    'supplier_payment', r.txn_date,
                    'supplier_payments', r.id,
                    r.payment_no,
                    v_description,
                    v_supplier_name, r.payment_method,
                    0, r.payment_amount,
                    r.branch_code
                );
            END LOOP;

            -- Backfill supplier advance payments
            FOR r IN (
                SELECT 
                    sa.id, sa.advance_no, sa.original_amount, sa.payment_method,
                    sa.payment_date::TIMESTAMP AS txn_date,
                    sa.branch_code, sa.supplier_id
                FROM supplier_advance_payment sa
                ORDER BY sa.payment_date ASC, sa.id ASC
            )
            LOOP
                SELECT COALESCE(full_name, company_name) INTO v_supplier_name
                FROM supplier WHERE id = r.supplier_id;
                v_supplier_name := COALESCE(v_supplier_name, 'Supplier #' || r.supplier_id);

                PERFORM fn_insert_cashbook_entry(
                    'supplier_payment', r.txn_date,
                    'supplier_advance_payment', r.id,
                    r.advance_no,
                    'Supplier Advance Payment ' || r.advance_no,
                    v_supplier_name, r.payment_method,
                    0, r.original_amount,
                    r.branch_code
                );
            END LOOP;

            -- Backfill expenses
            FOR r IN (
                SELECT 
                    e.id, e.expenses_no, e.expense_amount, e.expenses_method,
                    e.created_date::TIMESTAMP AS txn_date,
                    e.branch_code, e.remarks
                FROM expenses e
                ORDER BY e.created_date ASC, e.id ASC
            )
            LOOP
                PERFORM fn_insert_cashbook_entry(
                    'expense', r.txn_date,
                    'expenses', r.id,
                    r.expenses_no,
                    COALESCE(r.remarks, 'Expense ' || r.expenses_no),
                    NULL, r.expenses_method,
                    0, r.expense_amount,
                    r.branch_code
                );
            END LOOP;

            -- Backfill bank deposits
            FOR r IN (
                SELECT 
                    bd.id, bd.deposits_amount, bd.created_date,
                    bd.branch_code, bd.bank_name, bd.invoice_no
                FROM bank_deposits bd
                ORDER BY bd.created_date ASC, bd.id ASC
            )
            LOOP
                v_reference := COALESCE(r.invoice_no, 'DEP-' || r.id);
                IF r.bank_name IS NOT NULL AND r.bank_name != '' THEN
                    v_description := 'Bank Deposit to ' || r.bank_name;
                ELSE
                    v_description := 'Bank Deposit';
                END IF;

                PERFORM fn_insert_cashbook_entry(
                    'bank_deposit', r.created_date,
                    'bank_deposits', r.id,
                    v_reference,
                    v_description,
                    r.bank_name, 'Bank Deposit',
                    0, r.deposits_amount,
                    r.branch_code
                );
            END LOOP;

            RAISE NOTICE 'Cashbook backfill complete. Total entries: %', 
                (SELECT COUNT(*) FROM cashbook_entries);
        END;
        $$;
    """)


def downgrade() -> None:
    # Drop triggers
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_invoice ON invoices;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_customer_credit_settle ON customer_credits_settle_transaction;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_customer_advance ON customer_advance_payments;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_voucher_sale ON customer_gift_voucher;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_supplier_credit_settle ON supplier_credits_settle_transaction;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_supplier_direct_payment ON supplier_payments;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_supplier_advance ON supplier_advance_payment;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_expense ON expenses;")
    op.execute("DROP TRIGGER IF EXISTS trg_cashbook_after_bank_deposit ON bank_deposits;")

    # Drop trigger functions
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_invoice() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_customer_credit_settle() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_customer_advance() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_voucher_sale() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_supplier_credit_settle() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_supplier_direct_payment() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_supplier_advance() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_expense() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS trg_cashbook_bank_deposit() CASCADE;")

    # Drop the shared function
    op.execute("DROP FUNCTION IF EXISTS fn_insert_cashbook_entry CASCADE;")

    # Drop indexes
    op.drop_index('idx_cashbook_transaction_date', 'cashbook_entries')
    op.drop_index('idx_cashbook_entry_type', 'cashbook_entries')
    op.drop_index('idx_cashbook_source', 'cashbook_entries')
    op.drop_index('idx_cashbook_branch_date', 'cashbook_entries')
    op.drop_index('ix_cashbook_entries_id', 'cashbook_entries')

    # Drop table
    op.drop_table('cashbook_entries')
