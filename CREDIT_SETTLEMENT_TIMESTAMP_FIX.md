# Credit Settlement Timestamp Fix

## Issue Description

When creating a credit settlement after an invoice receipt, the credit settlement time was showing as **6:31 PM** instead of the actual time it was created (which should match or be close to the invoice receipt time like **10:47 PM**).

### Root Cause

The `CustomerCreditsSettleTransaction.created_date` field had **two issues**:

1. **Python Code Issue:** Used `tz.today()` (returns date only, time defaults to 00:00:00)
2. **Database Schema Issue:** Column type was `Date` instead of `TIMESTAMP`

## Screenshot Evidence

```
Ledger Entries
┌─────────────────────┬───────────────────┬─────────────────┬──────────────────────────────────┐
│ Date                │ Type              │ Reference       │ Description                      │
├─────────────────────┼───────────────────┼─────────────────┼──────────────────────────────────┤
│ 6/7/2026, 10:47:51 PM│ Invoice Receipts │ INV-2026-00028  │ Invoice INV-2026-00028 - Cash   │
│ 6/7/2026, 6:31:21 PM │ Credit Settlements│ CCS-2026-00014  │ Invoice INV-2026-00028 - Bank... │ ❌ WRONG TIME
└─────────────────────┴───────────────────┴─────────────────┴──────────────────────────────────┘
```

The credit settlement was created **after** the invoice (10:47 PM) but showed an **earlier time** (6:31 PM).

## Changes Made

### 1. Python Code Fix

**File:** `backend/app/modules/customers/credit_service.py`

**Line 445 - Changed:**
```python
# BEFORE (WRONG)
created_date=tz.today()  # Returns date only, no time component

# AFTER (CORRECT)
created_date=tz.now()    # Returns current datetime with time
```

**Context:**
```python
transaction = CustomerCreditsSettleTransaction(
    payment_method=trans.payment_method,
    cheque_date=trans.cheque_date,
    payment_amount=trans.payment_amount,
    payment_method_number=trans.payment_method_number,
    remarks=trans.remarks,
    customer_credit_settle_id=settlement.id,
    invoice_id=trans.invoice_id,
    created_date=tz.now()  # ✅ Fixed
)
```

**Note:** The `CustomerCreditsSettle` (parent) was already correct using `tz.now()` on line 430. Only the transaction records had the issue.

---

### 2. Database Model Update

**File:** `backend/app/modules/customers/models.py`

**Line 133 - Changed column type:**
```python
# BEFORE (WRONG)
created_date = Column(Date, nullable=False)

# AFTER (CORRECT)
created_date = Column(TIMESTAMP, nullable=False)
```

---

### 3. Schema Updates

**File:** `backend/app/modules/customers/schemas.py`

**Line 131 - Changed type:**
```python
# BEFORE
class CustomerCreditsSettleTransaction(CustomerCreditsSettleTransactionBase, TijaeroBaseSchema):
    id: int
    customer_credit_settle_id: int
    created_date: date  # ❌ Wrong

# AFTER
class CustomerCreditsSettleTransaction(CustomerCreditsSettleTransactionBase, TijaeroBaseSchema):
    id: int
    customer_credit_settle_id: int
    created_date: datetime  # ✅ Correct
```

**File:** `backend/app/modules/finance/schemas.py` (same change)

---

### 4. Database Migration

**File:** `backend/alembic/versions/20260608_credit_settle_timestamp_fix.py`

**Created new migration to:**
1. Change column type from `Date` to `TIMESTAMP`
2. Update existing records using `created_at` (audit field) as reference

```python
def upgrade():
    # Change column type from Date to TIMESTAMP
    op.execute("""
        ALTER TABLE customer_credits_settle_transaction 
        ALTER COLUMN created_date TYPE TIMESTAMP 
        USING created_date::TIMESTAMP;
    """)
    
    # Update existing rows to use the created_at timestamp
    op.execute("""
        UPDATE customer_credits_settle_transaction
        SET created_date = created_at
        WHERE created_at IS NOT NULL;
    """)
```

---

## Comparison with Invoice

**Invoice creation** (for reference):
```python
# From sales/service.py line 867-868
invoice_dict['created_date'] = tz.today()         # Date field (for filtering)
invoice_dict['created_date_time'] = tz.now()      # Datetime field (for display)
```

Invoices have **two fields**:
- `created_date` (Date) - for date-based filtering
- `created_date_time` (TIMESTAMP) - for actual timestamp display

Credit settlements now correctly use a single `TIMESTAMP` field.

---

## Supplier Credit Settlements

**Status:** ✅ Already correct

**File:** `backend/app/modules/purchasing/credit_service.py` (Line 1060)

```python
transaction = SupplierCreditsSettleTransaction(
    ...
    created_date=tz.now()  # ✅ Already correct
)
```

Supplier credit settlements were already using `tz.now()` and did not have this issue.

---

## Testing Instructions

### 1. Run Migration

```bash
cd backend
alembic upgrade head
```

### 2. Test Credit Settlement

1. Create an invoice with credit payment
2. Note the invoice creation time
3. Immediately create a credit settlement
4. Check ledger entries - times should now be consistent

### 3. Verify Database

```sql
-- Check column type
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customer_credits_settle_transaction' 
  AND column_name = 'created_date';

-- Expected: data_type = 'timestamp without time zone'

-- Check actual data
SELECT id, created_date, created_at 
FROM customer_credits_settle_transaction 
ORDER BY id DESC 
LIMIT 5;
```

---

## Timeline Context

This fix was identified on **June 8, 2026** (today).

**Previous related fix** (June 7, 2026):
- Migration `20260607_fix_cashbook_credit_settlement_time_and_format.py`
- Fixed the **database trigger** to use `NOW()` for cashbook entries
- Did NOT fix the actual transaction table column type

**This fix completes the solution** by:
- Fixing the Python code
- Fixing the database column type
- Ensuring consistency between all components

---

## Files Changed

1. ✅ `backend/app/modules/customers/credit_service.py` - Code fix
2. ✅ `backend/app/modules/customers/models.py` - Model definition
3. ✅ `backend/app/modules/customers/schemas.py` - Schema definition
4. ✅ `backend/app/modules/finance/schemas.py` - Finance schema
5. ✅ `backend/alembic/versions/20260608_credit_settle_timestamp_fix.py` - Migration

---

## Expected Result

**After the fix:**
```
Ledger Entries
┌─────────────────────┬───────────────────┬─────────────────┬──────────────────────────────────┐
│ Date                │ Type              │ Reference       │ Description                      │
├─────────────────────┼───────────────────┼─────────────────┼──────────────────────────────────┤
│ 6/8/2026, 10:47:51 PM│ Invoice Receipts │ INV-2026-00029  │ Invoice INV-2026-00029 - Cash   │
│ 6/8/2026, 10:48:15 PM│ Credit Settlements│ CCS-2026-00015  │ Invoice INV-2026-00029 - Bank... │ ✅ CORRECT
└─────────────────────┴───────────────────┴─────────────────┴──────────────────────────────────┘
```

The credit settlement timestamp will now correctly show when it was actually created, typically a few seconds after the invoice.

---

## Notes

- The `CustomerCreditsSettle` (parent record) was already correct
- Only the `CustomerCreditsSettleTransaction` (child records) had the issue
- Supplier credit settlements did not have this issue
- Existing data will be updated by the migration using the `created_at` audit field
