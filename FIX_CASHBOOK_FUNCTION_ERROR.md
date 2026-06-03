# Fix: Missing Cashbook Function Error

## Error Summary
```
psycopg.errors.UndefinedFunction: function fn_insert_cashbook_entry(...) does not exist
```

This error occurs because the database migration that creates the `fn_insert_cashbook_entry` function hasn't been run yet.

## Solution: Run Alembic Migrations

### Option 1: Run All Pending Migrations (Recommended)

Navigate to the backend directory and run:

```bash
cd backend
alembic upgrade head
```

This will apply all pending migrations including the cashbook function.

### Option 2: Run Specific Migration

If you only want to run the cashbook migration:

```bash
cd backend
alembic upgrade a1b2c3d4e5f6
```

### Option 3: Manual SQL Fix (If Migrations Don't Work)

If Alembic migrations fail, you can manually create the function by connecting to your PostgreSQL database and running this SQL:

```sql
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
    -- Acquire per-branch advisory lock to serialize cashbook writes
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
END;
$$ LANGUAGE plpgsql;
```

## Verify the Fix

After running the migration or SQL, verify the function exists:

```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_type = 'FUNCTION' 
AND routine_name = 'fn_insert_cashbook_entry';
```

You should see one row returned with the function name.

## Why This Happened

The cashbook entry system uses database triggers to automatically log all cash transactions. The trigger `trg_cashbook_customer_credit_settle()` calls the `fn_insert_cashbook_entry()` function, which needs to exist in the database.

## Related Files

- Migration file: `backend/alembic/versions/a1b2c3d4e5f6_create_materialized_cashbook_entries.py`
- Trigger that failed: `trg_cashbook_customer_credit_settle()`
- Source table: `customer_credits_settle_transaction`

## After Fixing

Once the function is created, the customer payment settlement should work correctly and cash transactions will be automatically logged in the `cashbook_entries` table.
