# Setup Guide: Purchasing & Finance Modules

## Overview

This guide will help you integrate the new Purchasing and Finance modules into your existing ERP system.

## Prerequisites

- Python 3.8+
- FastAPI application running
- SQLAlchemy configured
- Existing database with tables

## Step 1: Register API Routers

Add the new routers to your main FastAPI application.

### File: `backend/app/main.py`

```python
from fastapi import FastAPI
from app.modules.purchasing.api import router as purchasing_router
from app.modules.finance.api import router as finance_router

app = FastAPI(title="TIJAERO ERP API")

# Register routers
app.include_router(purchasing_router, prefix="/api")
app.include_router(finance_router, prefix="/api")

# ... your other routers
```

## Step 2: Update Database Models Registration

Ensure all models are imported in your database initialization.

### File: `backend/app/db/base.py`

```python
from app.db.base_class import Base

# Import all models to register them with SQLAlchemy
from app.modules.purchasing.models import (
    Supplier,
    PurchasingOrder,
    PurchasingOrderItems,
    PurchasingReturn,
    PurchasingReturnItems
)

from app.modules.finance.models import (
    BankDeposits,
    CardPayments,
    ChequePayments,
    CreditPayments,
    Vouchers,
    CustomerAdvancePayments,
    CustomerCreditNotes,
    CustomerCreditsSettle,
    CustomerCreditsSettleTransaction,
    SupplierCreditsSettle,
    SupplierCreditsSettleTransaction,
    Expenses
)

# ... other model imports
```

## Step 3: Test the Installation

### Start the server

```bash
cd backend
python -m uvicorn app.main:app --reload
```

### Access API Documentation

Open your browser and navigate to:

```
http://localhost:8000/docs
```

You should see the new endpoints under:

- **purchasing** tag
- **finance** tag

## Step 4: Test API Endpoints

### Test Supplier Creation

```bash
curl -X POST "http://localhost:8000/api/purchasing/suppliers" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Mr",
    "full_name": "Test Supplier",
    "mobile_contact_number": "0771234567",
    "postal_address": "123 Test St",
    "permenent_address": "123 Test St",
    "gender": "Male",
    "civil_status": "Single",
    "no_of_kids": "0",
    "credit_days": 30,
    "max_credit_limit": 50000,
    "active": true
  }'
```

### Test Purchase Order Creation

```bash
curl -X POST "http://localhost:8000/api/purchasing/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "purchasing_order_no": "PO-TEST-001",
    "purchasing_invoice_no": "INV-TEST-001",
    "branch_code": "BR001",
    "payment_method": "credit",
    "purchasing_order_date": "2024-01-15",
    "good_received_note_date": "2024-01-20",
    "first_suppliers_id": 1,
    "second_suppliers_id": 1,
    "items": [
      {
        "product_id": 1,
        "quantity": 10,
        "unit_price": 100.00,
        "warrenty_month": "12"
      }
    ]
  }'
```

### Test Expense Creation

```bash
curl -X POST "http://localhost:8000/api/finance/expenses" \
  -H "Content-Type: application/json" \
  -d '{
    "expenses_no": "EXP-TEST-001",
    "expenses_method": "bank",
    "expense_amount": 5000.00,
    "branch_code": "BR001",
    "remarks": "Office supplies"
  }'
```

### Test Bank Deposit Creation

```bash
curl -X POST "http://localhost:8000/api/finance/bank-deposits" \
  -H "Content-Type: application/json" \
  -d '{
    "deposits_amount": 10000.00,
    "branch_code": "BR001",
    "bank_name": "Test Bank",
    "remarks": "Customer payment"
  }'
```

## Step 5: Verify Database Tables

Check that all required tables exist:

```sql
-- Check supplier table
SELECT * FROM supplier LIMIT 1;

-- Check purchasing_orders table
SELECT * FROM purchasing_orders LIMIT 1;

-- Check expenses table
SELECT * FROM expenses LIMIT 1;

-- Check bank_deposits table
SELECT * FROM bank_deposits LIMIT 1;
```

## Available API Endpoints

### Purchasing Module

#### Suppliers

- `POST /api/purchasing/suppliers` - Create supplier
- `GET /api/purchasing/suppliers` - List suppliers
- `GET /api/purchasing/suppliers/{id}` - Get supplier
- `PATCH /api/purchasing/suppliers/{id}` - Update supplier
- `DELETE /api/purchasing/suppliers/{id}` - Delete supplier

#### Purchase Orders

- `POST /api/purchasing/orders` - Create purchase order
- `GET /api/purchasing/orders` - List purchase orders
- `GET /api/purchasing/orders/{id}` - Get purchase order
- `PATCH /api/purchasing/orders/{id}` - Update purchase order
- `GET /api/purchasing/suppliers/{id}/orders` - Get supplier orders

#### Purchase Returns

- `POST /api/purchasing/returns` - Create purchase return
- `GET /api/purchasing/returns/{id}` - Get purchase return

### Finance Module

#### Bank Deposits

- `POST /api/finance/bank-deposits` - Create bank deposit
- `GET /api/finance/bank-deposits` - List bank deposits
- `GET /api/finance/bank-deposits/{id}` - Get bank deposit
- `PATCH /api/finance/bank-deposits/{id}/verify` - Verify deposit

#### Card Payments

- `POST /api/finance/card-payments` - Create card payment
- `GET /api/finance/card-payments` - List card payments
- `GET /api/finance/card-payments/{id}` - Get card payment

#### Cheque Payments

- `POST /api/finance/cheque-payments` - Create cheque payment
- `GET /api/finance/cheque-payments` - List cheque payments
- `GET /api/finance/cheque-payments/{id}` - Get cheque payment

#### Expenses

- `POST /api/finance/expenses` - Create expense
- `GET /api/finance/expenses` - List expenses
- `GET /api/finance/expenses/{id}` - Get expense

#### Advance Payments

- `POST /api/finance/advance-payments` - Create advance payment
- `GET /api/finance/advance-payments/{id}` - Get advance payment
- `GET /api/finance/customers/{id}/advance-payments` - Get customer advances

#### Credit Notes

- `POST /api/finance/credit-notes` - Create credit note
- `GET /api/finance/credit-notes/{id}` - Get credit note
- `GET /api/finance/customers/{id}/credit-notes` - Get customer credit notes

## Common Query Parameters

### Filtering

- `skip` - Number of records to skip (pagination)
- `limit` - Maximum number of records to return
- `branch_code` - Filter by branch
- `date_from` - Filter by start date (ISO format: YYYY-MM-DD)
- `date_to` - Filter by end date (ISO format: YYYY-MM-DD)

### Examples

```
GET /api/purchasing/suppliers?active=true&skip=0&limit=50
GET /api/finance/expenses?branch_code=BR001&date_from=2024-01-01&date_to=2024-01-31
GET /api/purchasing/orders?supplier_id=1&skip=0&limit=100
```

## Troubleshooting

### Issue: Import Errors

**Solution**: Ensure all model files are properly imported in `app/db/base.py`

### Issue: Foreign Key Errors

**Solution**: Verify that referenced records exist (e.g., supplier must exist before creating purchase order)

### Issue: Validation Errors

**Solution**: Check Pydantic schema requirements in the API documentation

### Issue: Database Connection Errors

**Solution**: Verify database configuration in `.env` file

## Next Steps

1. **Frontend Integration**

   - Create UI components for supplier management
   - Build purchase order forms
   - Implement expense tracking interface
   - Add payment recording screens

2. **Testing**

   - Write unit tests for services
   - Create integration tests for API endpoints
   - Test edge cases and error handling

3. **Security**

   - Add authentication middleware
   - Implement role-based access control
   - Add audit logging for financial transactions

4. **Performance**
   - Add database indexes for frequently queried fields
   - Implement caching for read-heavy operations
   - Optimize complex queries

## Support

For issues or questions:

1. Check the API documentation at `/docs`
2. Review the implementation files
3. Check database schema alignment
4. Verify all dependencies are installed

## Files Structure

```
backend/app/modules/
├── purchasing/
│   ├── __init__.py
│   ├── models.py          # Database models
│   ├── schemas.py         # Pydantic schemas
│   ├── repository.py      # Data access layer
│   ├── service.py         # Business logic
│   └── api.py             # API endpoints
│
└── finance/
    ├── __init__.py
    ├── models.py          # Database models
    ├── schemas.py         # Pydantic schemas
    ├── repository.py      # Data access layer
    ├── service.py         # Business logic
    └── api.py             # API endpoints
```

## Conclusion

Your Purchasing and Finance modules are now ready to use! All endpoints are working with your existing database schema, and no migrations are required since we're using existing tables.

Happy coding! 🚀
