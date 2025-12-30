# Quick API Reference - Purchasing & Finance Modules

## 🚀 Base URL

```
http://localhost:8000/api
```

## 📦 Purchasing Module

### Suppliers

```http
# Create Supplier
POST /purchasing/suppliers
{
  "title": "Mr",
  "full_name": "John Supplier",
  "mobile_contact_number": "0771234567",
  "postal_address": "123 Main St",
  "permenent_address": "123 Main St",
  "gender": "Male",
  "civil_status": "Single",
  "no_of_kids": "0",
  "credit_days": 30,
  "max_credit_limit": 100000,
  "active": true
}

# List Suppliers
GET /purchasing/suppliers?active=true&skip=0&limit=100

# Get Supplier
GET /purchasing/suppliers/{id}

# Update Supplier
PATCH /purchasing/suppliers/{id}
{
  "full_name": "Updated Name",
  "active": false
}

# Delete Supplier
DELETE /purchasing/suppliers/{id}
```

### Purchase Orders

```http
# Create Purchase Order
POST /purchasing/orders
{
  "purchasing_order_no": "PO-2024-001",
  "purchasing_invoice_no": "INV-001",
  "branch_code": "BR001",
  "payment_method": "credit",
  "purchasing_order_date": "2024-01-15",
  "good_received_note_date": "2024-01-20",
  "first_suppliers_id": 1,
  "second_suppliers_id": 1,
  "items": [
    {
      "product_id": 10,
      "quantity": 100,
      "unit_price": 50.00,
      "warrenty_month": "12"
    }
  ]
}

# List Purchase Orders
GET /purchasing/orders?supplier_id=1&branch_code=BR001&skip=0&limit=100

# Get Purchase Order
GET /purchasing/orders/{id}

# Update Purchase Order
PATCH /purchasing/orders/{id}
{
  "remarks": "Updated remarks"
}

# Get Supplier Orders
GET /purchasing/suppliers/{id}/orders
```

### Purchase Returns

```http
# Create Purchase Return
POST /purchasing/returns
{
  "purchasing_return_no": "PR-2024-001",
  "branch_code": "BR001",
  "goodreceivednote_id": 1,
  "remark": "Defective items",
  "items": [
    {
      "product_id": 10,
      "purchasing_price": 50.00,
      "return_price": 50.00,
      "barcode": "123456789"
    }
  ]
}

# Get Purchase Return
GET /purchasing/returns/{id}
```

---

## 💰 Finance Module

### Bank Deposits

```http
# Create Bank Deposit
POST /finance/bank-deposits
{
  "deposits_amount": 10000.00,
  "branch_code": "BR001",
  "bank_name": "Commercial Bank",
  "remarks": "Customer payment",
  "payment_for": "Invoice payment",
  "invoice_no": "INV-001"
}

# List Bank Deposits
GET /finance/bank-deposits?branch_code=BR001&verified=false&skip=0&limit=100

# Get Bank Deposit
GET /finance/bank-deposits/{id}

# Verify Bank Deposit
PATCH /finance/bank-deposits/{id}/verify
```

### Card Payments

```http
# Create Card Payment
POST /finance/card-payments
{
  "card_type": "visa",
  "amount": 5000.00,
  "remark": "Customer payment",
  "ref_number": "REF123456",
  "invoice_no": "INV-001",
  "deposited": true
}

# List Card Payments
GET /finance/card-payments?date_from=2024-01-01&date_to=2024-01-31&skip=0&limit=100

# Get Card Payment
GET /finance/card-payments/{id}
```

### Cheque Payments

```http
# Create Cheque Payment
POST /finance/cheque-payments
{
  "cheque_number": 123456,
  "branch_code": 1,
  "from": "John Customer",
  "bank": "Commercial Bank",
  "amount": 15000.00,
  "cheque_date": "2024-01-15",
  "deposit_date": "2024-01-16",
  "remark": "Payment for invoice",
  "payment_for": "Invoice payment",
  "invoice_no": "INV-001"
}

# List Cheque Payments
GET /finance/cheque-payments?date_from=2024-01-01&skip=0&limit=100

# Get Cheque Payment
GET /finance/cheque-payments/{id}
```

### Expenses

```http
# Create Expense
POST /finance/expenses
{
  "expenses_no": "EXP-2024-001",
  "expenses_method": "bank",
  "expense_amount": 5000.00,
  "branch_code": "BR001",
  "remarks": "Office supplies",
  "bill_reference": "BILL-001"
}

# List Expenses
GET /finance/expenses?branch_code=BR001&date_from=2024-01-01&date_to=2024-01-31&skip=0&limit=100

# Get Expense
GET /finance/expenses/{id}
```

### Customer Advance Payments

```http
# Create Advance Payment
POST /finance/advance-payments
{
  "customer_id": 1,
  "payment_method": "bank",
  "branch_code": "BR001",
  "payment_amount": 20000.00,
  "remarks": "Advance for future orders",
  "cheque_date": "2024-01-15"
}

# Get Advance Payment
GET /finance/advance-payments/{id}

# Get Customer Advances
GET /finance/customers/{customer_id}/advance-payments
```

### Customer Credit Notes

```http
# Create Credit Note
POST /finance/credit-notes
{
  "customer_id": 1,
  "amount": 5000.00,
  "remark": "Return credit",
  "invoice_no": "INV-001"
}

# Get Credit Note
GET /finance/credit-notes/{id}

# Get Customer Credit Notes
GET /finance/customers/{customer_id}/credit-notes
```

---

## 🔍 Common Query Parameters

### Pagination

```
?skip=0&limit=100
```

### Date Filtering

```
?date_from=2024-01-01&date_to=2024-01-31
```

### Branch Filtering

```
?branch_code=BR001
```

### Status Filtering

```
?active=true
?verified=false
```

### Supplier Filtering

```
?supplier_id=1
```

### Search

```
?search=john
```

---

## 📊 Response Formats

### Success Response (200/201)

```json
{
  "id": 1,
  "field1": "value1",
  "field2": "value2",
  "created_at": "2024-01-15T10:30:00",
  "updated_at": "2024-01-15T10:30:00"
}
```

### List Response (200)

```json
[
  {
    "id": 1,
    "field1": "value1"
  },
  {
    "id": 2,
    "field1": "value2"
  }
]
```

### Error Response (4xx/5xx)

```json
{
  "detail": "Error message here"
}
```

---

## 🎯 Quick Examples

### Complete Purchase Workflow

```bash
# 1. Create Supplier
curl -X POST http://localhost:8000/api/purchasing/suppliers \
  -H "Content-Type: application/json" \
  -d '{"title":"Mr","full_name":"Test Supplier",...}'

# 2. Create Purchase Order
curl -X POST http://localhost:8000/api/purchasing/orders \
  -H "Content-Type: application/json" \
  -d '{"purchasing_order_no":"PO-001",...}'

# 3. List Orders
curl http://localhost:8000/api/purchasing/orders?supplier_id=1
```

### Complete Payment Workflow

```bash
# 1. Record Bank Deposit
curl -X POST http://localhost:8000/api/finance/bank-deposits \
  -H "Content-Type: application/json" \
  -d '{"deposits_amount":10000,"branch_code":"BR001",...}'

# 2. Verify Deposit
curl -X PATCH http://localhost:8000/api/finance/bank-deposits/1/verify

# 3. List Verified Deposits
curl http://localhost:8000/api/finance/bank-deposits?verified=true
```

---

## 🔐 Authentication (To be implemented)

```http
# Add to all requests
Authorization: Bearer <your_jwt_token>
```

---

## 📱 Status Codes

| Code | Meaning             |
| ---- | ------------------- |
| 200  | Success             |
| 201  | Created             |
| 204  | No Content (Delete) |
| 400  | Bad Request         |
| 404  | Not Found           |
| 422  | Validation Error    |
| 500  | Server Error        |

---

## 🛠️ Testing with cURL

### Create Supplier

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

### List Suppliers

```bash
curl "http://localhost:8000/api/purchasing/suppliers?active=true&limit=10"
```

### Create Expense

```bash
curl -X POST "http://localhost:8000/api/finance/expenses" \
  -H "Content-Type: application/json" \
  -d '{
    "expenses_no": "EXP-001",
    "expenses_method": "bank",
    "expense_amount": 5000.00,
    "branch_code": "BR001",
    "remarks": "Office supplies"
  }'
```

---

## 📖 Full Documentation

For complete documentation, visit:

- Interactive API Docs: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Setup Guide: `SETUP_PURCHASING_FINANCE.md`
- Implementation Details: `SUPPLIERS_PURCHASING_FINANCE_IMPLEMENTATION.md`

---

_Quick Reference v1.0 - December 28, 2024_
