# Demo Data Scripts

This directory contains scripts to populate the ERP system with realistic demo data for testing and demonstration purposes.

## Available Scripts

### 1. `create_all_demo_data.py` (Recommended)

Creates comprehensive demo data across the entire system.

**What it creates:**

- 20 Customers
- 5 Product Categories
- 7 Product Brands
- 30 Products
- 20 Bank Deposits
- 30 Card Payments
- 15 Cheque Payments
- 25 Expenses
- 15 Customer Advance Payments
- 12 Customer Credit Notes

**Total: 179 records**

### 2. `create_finance_demo_data.py`

Creates demo data specifically for the Finance module only.

**What it creates:**

- 20 Bank Deposits
- 30 Card Payments
- 15 Cheque Payments
- 25 Expenses
- 15 Customer Advance Payments (requires existing customers)
- 12 Customer Credit Notes (requires existing customers)

**Total: 117 finance records**

### 3. `create_demo_users.py`

Creates demo users and permissions (already exists).

## How to Run

### Option 1: Create All Demo Data (Recommended for new systems)

```bash
cd backend/scripts
python create_all_demo_data.py
```

This will create all necessary data including customers, products, and finance records.

### Option 2: Create Finance Data Only

If you already have customers in your system:

```bash
cd backend/scripts
python create_finance_demo_data.py
```

**Note:** This requires existing customers. If you don't have customers, use Option 1 instead.

### Option 3: Step by Step

```bash
cd backend/scripts

# 1. Create users and permissions (if not already done)
python create_demo_users.py

# 2. Create all demo data
python create_all_demo_data.py
```

## Prerequisites

1. **Backend server must be running:**

   ```bash
   cd backend
   ./start.sh
   ```

2. **Database must be initialized:**

   - Alembic migrations should be applied
   - Database tables should exist

3. **Python environment:**
   - Virtual environment activated
   - All dependencies installed

## What Happens When You Run the Scripts

### create_all_demo_data.py

```
Creating ERP System Demo Data
======================================================================

Creating 20 demo customers...
✓ Created 20 customers

Creating demo categories...
✓ Created 5 categories

Creating demo brands...
✓ Created 7 brands

Creating 30 demo products...
✓ Created 30 products

Creating Finance demo data...
  • Creating bank deposits...
  • Creating card payments...
  • Creating cheque payments...
  • Creating expenses...
  • Creating advance payments...
  • Creating credit notes...
✓ Finance demo data created

======================================================================
✓ ALL DEMO DATA CREATED SUCCESSFULLY!
======================================================================

Data Summary:
  📊 Master Data:
     • 20 Customers
     • 5 Product Categories
     • 7 Product Brands
     • 30 Products

  💰 Finance Data:
     • 20 Bank Deposits
     • 30 Card Payments
     • 15 Cheque Payments
     • 25 Expenses
     • 15 Advance Payments
     • 12 Credit Notes

  📈 Total Records: 179
======================================================================
```

## Viewing the Demo Data

After running the scripts:

1. **Open the frontend:**

   ```
   http://localhost:3000
   ```

2. **Login:**

   - Username: `admin`
   - Password: `admin123`

3. **Navigate to Finance module:**

   - Click "Finance" in the sidebar
   - Explore each section:
     - Bank Deposits
     - Card Payments
     - Cheque Payments
     - Expenses
     - Advance Payments
     - Credit Notes

4. **View other data:**
   - Customers: `/customers`
   - Products: `/inventory`

## Demo Data Characteristics

### Realistic Data

- Random but realistic amounts
- Varied dates (last 90 days)
- Different payment methods
- Multiple branches
- Various statuses

### Bank Deposits

- Amounts: $100 - $10,000
- 60% verified, 40% pending
- Multiple banks and branches
- Linked to invoices

### Card Payments

- Card types: Visa, Mastercard, Amex
- Amounts: $50 - $5,000
- 70% deposited
- Reference numbers included

### Cheque Payments

- Amounts: $500 - $15,000
- Realistic cheque and deposit dates
- Multiple banks and parties
- Linked to invoices

### Expenses

- Amounts: $50 - $5,000
- Various expense types
- Different payment methods
- Bill references included

### Advance Payments

- Amounts: $500 - $10,000
- 80% active
- Linked to real customers
- Various payment methods

### Credit Notes

- Amounts: $50 - $2,000
- Realistic reasons
- Linked to customers and invoices
- Various dates

## Resetting Demo Data

To clear and recreate demo data:

```bash
# Option 1: Drop and recreate database (WARNING: Deletes ALL data)
cd backend
alembic downgrade base
alembic upgrade head
python scripts/create_demo_users.py
python scripts/create_all_demo_data.py

# Option 2: Manually delete records from specific tables
# Use database management tool or SQL commands
```

## Troubleshooting

### Error: "No customers found"

**Solution:** Run `create_all_demo_data.py` instead of `create_finance_demo_data.py`

### Error: "Database connection failed"

**Solution:** Ensure backend server is running and database is accessible

### Error: "Module not found"

**Solution:** Ensure you're in the correct directory and virtual environment is activated

### Error: "Foreign key constraint failed"

**Solution:** Ensure database tables exist (run migrations first)

## Customization

You can modify the scripts to:

- Change the number of records created
- Adjust date ranges
- Modify amount ranges
- Add custom data fields
- Create specific scenarios

Example:

```python
# In create_all_demo_data.py, change:
customers = create_demo_customers(db, count=20)  # Change to 50
```

## Best Practices

1. **Run on development/staging only** - Never run on production
2. **Backup first** - Always backup your database before running
3. **Check results** - Verify data was created correctly
4. **Clean up** - Remove demo data before going to production

## Support

If you encounter issues:

1. Check the error message
2. Verify prerequisites are met
3. Check database logs
4. Review script output
5. Consult the main documentation

## Files in This Directory

```
backend/scripts/
├── create_demo_users.py           # Create users and permissions
├── create_finance_demo_data.py    # Finance module demo data
├── create_all_demo_data.py        # Complete system demo data
└── DEMO_DATA_README.md            # This file
```

## Next Steps

After creating demo data:

1. Explore the Finance module
2. Test filtering and sorting
3. Try creating new records
4. Test the verification workflow
5. Generate reports (when available)

Enjoy exploring the system with realistic demo data! 🎉
