# Quick Start: Demo Data Setup

## 🚀 Get Started in 3 Steps

### Step 1: Ensure Backend is Running

```bash
cd backend
./start.sh
```

Wait for: `Uvicorn running on http://0.0.0.0:8000`

### Step 2: Create Demo Data

```bash
cd backend/scripts
python create_all_demo_data.py
```

This creates **179 demo records** including:

- ✅ 20 Customers
- ✅ 30 Products
- ✅ 20 Bank Deposits
- ✅ 30 Card Payments
- ✅ 15 Cheque Payments
- ✅ 25 Expenses
- ✅ 15 Advance Payments
- ✅ 12 Credit Notes

### Step 3: View in Frontend

```bash
# In another terminal
cd frontend
npm run dev
```

Then open: http://localhost:3000

**Login:**

- Username: `admin`
- Password: `admin123`

## 📊 Explore the Data

### Finance Module

Navigate to: **Finance** → Choose any module

1. **Bank Deposits** (`/finance/bank-deposits`)

   - View 20 deposits
   - Filter by branch or status
   - Verify pending deposits

2. **Card Payments** (`/finance/card-payments`)

   - View 30 card transactions
   - See Visa, Mastercard, Amex payments
   - Check deposit status

3. **Cheque Payments** (`/finance/cheque-payments`)

   - View 15 cheque payments
   - See cheque and deposit dates
   - Track payment purposes

4. **Expenses** (`/finance/expenses`)

   - View 25 business expenses
   - Filter by branch
   - See different payment methods

5. **Advance Payments** (`/finance/advance-payments`)

   - View 15 customer advances
   - Filter by customer
   - Track active payments

6. **Credit Notes** (`/finance/credit-notes`)
   - View 12 credit notes
   - Filter by customer
   - See credit amounts

### Other Modules

- **Customers** (`/customers`) - 20 demo customers
- **Inventory** (`/inventory`) - 30 demo products

## 🎯 Try These Actions

### Test Bank Deposit Verification

1. Go to Bank Deposits
2. Find a "Pending" deposit
3. Click the ✓ (checkmark) icon
4. Watch it change to "Verified"

### Test Creating New Records

1. Click any "New" or "Record" button
2. Fill in the form
3. Click "Create" or "Record"
4. See it appear in the table

### Test Filtering

1. Use the filter dropdowns
2. Select branch or status
3. Watch the table update

### Test Customer-Specific Views

1. Go to Advance Payments or Credit Notes
2. Select a customer from dropdown
3. View their specific records

## 📈 What You'll See

### Realistic Data Includes:

- ✅ Random amounts ($50 - $15,000)
- ✅ Dates from last 90 days
- ✅ Multiple branches (BR001-BR004)
- ✅ Various payment methods
- ✅ Different statuses
- ✅ Invoice references
- ✅ Detailed remarks

### Data Grid Features:

- ✅ Sortable columns (click headers)
- ✅ Pagination (10, 25, 50, 100 rows)
- ✅ Formatted currency ($1,234.56)
- ✅ Date formatting
- ✅ Status chips with colors
- ✅ Action buttons

## 🔄 Reset Demo Data

To start fresh:

```bash
cd backend/scripts
python create_all_demo_data.py
```

This will add more demo data (doesn't delete existing).

To completely reset:

```bash
cd backend
# WARNING: This deletes ALL data
alembic downgrade base
alembic upgrade head
python scripts/create_demo_users.py
python scripts/create_all_demo_data.py
```

## ⚡ Quick Commands

```bash
# Create all demo data
cd backend/scripts && python create_all_demo_data.py

# Create finance data only (requires existing customers)
cd backend/scripts && python create_finance_demo_data.py

# Start backend
cd backend && ./start.sh

# Start frontend
cd frontend && npm run dev
```

## 🎉 You're Ready!

The system is now populated with realistic demo data. Explore all the features:

- ✅ View and filter data
- ✅ Create new records
- ✅ Verify transactions
- ✅ Test workflows
- ✅ Generate reports (coming soon)

## 📚 More Information

- **Full Demo Data Guide**: `backend/scripts/DEMO_DATA_README.md`
- **Finance Module Guide**: `frontend/FINANCE_MODULE_GUIDE.md`
- **API Documentation**: http://localhost:8000/docs

## 💡 Tips

1. **Use Filters** - Narrow down data quickly
2. **Try Sorting** - Click column headers
3. **Check Actions** - Hover over action buttons
4. **Test Forms** - Create new records
5. **Explore Tabs** - Dashboard has multiple tabs

Enjoy exploring the ERP system! 🚀
