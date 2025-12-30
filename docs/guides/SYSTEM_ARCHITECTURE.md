# System Architecture - Purchasing & Finance Modules

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                          │
│  (React/Vue/Angular - To be implemented)                        │
│  - Supplier Management UI                                       │
│  - Purchase Order Forms                                         │
│  - Payment Recording Screens                                    │
│  - Expense Tracking Interface                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/REST API
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                          │
│  FastAPI Application (main.py)                                  │
│  - Route Registration                                           │
│  - Middleware (CORS, Auth, Logging)                            │
│  - Error Handling                                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌──────────────────────┐      ┌──────────────────────┐
│  Purchasing Module   │      │   Finance Module     │
│                      │      │                      │
│  ┌────────────────┐ │      │  ┌────────────────┐ │
│  │   API Layer    │ │      │  │   API Layer    │ │
│  │   (api.py)     │ │      │  │   (api.py)     │ │
│  └────────┬───────┘ │      │  └────────┬───────┘ │
│           │         │      │           │         │
│  ┌────────▼───────┐ │      │  ┌────────▼───────┐ │
│  │ Service Layer  │ │      │  │ Service Layer  │ │
│  │  (service.py)  │ │      │  │  (service.py)  │ │
│  └────────┬───────┘ │      │  └────────┬───────┘ │
│           │         │      │           │         │
│  ┌────────▼───────┐ │      │  ┌────────▼───────┐ │
│  │Repository Layer│ │      │  │Repository Layer│ │
│  │(repository.py) │ │      │  │(repository.py) │ │
│  └────────┬───────┘ │      │  └────────┬───────┘ │
│           │         │      │           │         │
│  ┌────────▼───────┐ │      │  ┌────────▼───────┐ │
│  │  Models Layer  │ │      │  │  Models Layer  │ │
│  │  (models.py)   │ │      │  │  (models.py)   │ │
│  └────────┬───────┘ │      │  └────────┬───────┘ │
└───────────┼─────────┘      └───────────┼─────────┘
            │                            │
            └────────────┬───────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Database Layer (PostgreSQL)                  │
│                                                                 │
│  Purchasing Tables:          Finance Tables:                   │
│  - supplier                  - bank_deposits                   │
│  - purchasing_orders         - card_payments                   │
│  - purchasing_order_items    - cheque_payments                 │
│  - purchasing_return         - expenses                        │
│  - purchasing_return_items   - customer_advance_payments       │
│  - good_received_note        - customer_credit_notes           │
│  - good_received_items       - customer_credits_settle         │
│                              - supplier_credits_settle         │
└─────────────────────────────────────────────────────────────────┘
```

## 📊 Data Flow Diagram

### Purchase Order Creation Flow

```
┌──────────┐
│  Client  │
└────┬─────┘
     │ 1. POST /api/purchasing/orders
     ▼
┌────────────────┐
│  API Endpoint  │
│  (api.py)      │
└────┬───────────┘
     │ 2. Validate request (Pydantic)
     ▼
┌────────────────┐
│  Service Layer │
│  (service.py)  │
└────┬───────────┘
     │ 3. Business logic
     │    - Verify suppliers exist
     │    - Calculate totals
     ▼
┌────────────────┐
│  Repository    │
│ (repository.py)│
└────┬───────────┘
     │ 4. Database operations
     │    - Create order
     │    - Create order items
     │    - Commit transaction
     ▼
┌────────────────┐
│   Database     │
│  (PostgreSQL)  │
└────┬───────────┘
     │ 5. Return created record
     ▼
┌────────────────┐
│  Client        │
│  (Response)    │
└────────────────┘
```

### Payment Recording Flow

```
┌──────────┐
│  Client  │
└────┬─────┘
     │ 1. POST /api/finance/bank-deposits
     ▼
┌────────────────┐
│  API Endpoint  │
└────┬───────────┘
     │ 2. Validate payment data
     ▼
┌────────────────┐
│  Service Layer │
└────┬───────────┘
     │ 3. Process payment
     │    - Verify customer/invoice
     │    - Check payment method
     ▼
┌────────────────┐
│  Repository    │
└────┬───────────┘
     │ 4. Record payment
     │    - Insert payment record
     │    - Update related records
     ▼
┌────────────────┐
│   Database     │
└────┬───────────┘
     │ 5. Return payment confirmation
     ▼
┌────────────────┐
│  Client        │
└────────────────┘
```

## 🔄 Module Interactions

```
┌─────────────────────────────────────────────────────────────────┐
│                      TIJAERO ERP System                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Purchasing  │────▶│  Inventory   │────▶│    Sales     │
│   Module     │     │   Module     │     │   Module     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ Suppliers          │ GRN                │ Invoices
       │ PO                 │ Stock              │ Payments
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                            ▼
                   ┌──────────────┐
                   │   Finance    │
                   │   Module     │
                   └──────┬───────┘
                          │
                          │ Payments
                          │ Expenses
                          │ Credits
                          │
                          ▼
                   ┌──────────────┐
                   │   Common     │
                   │   Module     │
                   └──────────────┘
                          │
                          │ Approvals
                          │ Countries
                          │ Locations
```

## 🗂️ Module Structure

### Purchasing Module

```
purchasing/
│
├── models.py
│   ├── Supplier
│   ├── PurchasingOrder
│   ├── PurchasingOrderItems
│   ├── PurchasingReturn
│   └── PurchasingReturnItems
│
├── schemas.py
│   ├── SupplierBase/Create/Update
│   ├── PurchasingOrderBase/Create/Update
│   ├── PurchasingOrderItemBase/Create
│   ├── PurchasingReturnBase/Create
│   └── Filters (SupplierListFilter, PurchaseOrderListFilter)
│
├── repository.py
│   ├── SupplierRepository
│   │   ├── create()
│   │   ├── get_by_id()
│   │   ├── get_all()
│   │   ├── update()
│   │   └── delete()
│   │
│   ├── PurchasingOrderRepository
│   │   ├── create()
│   │   ├── get_by_id()
│   │   ├── get_all()
│   │   └── update()
│   │
│   └── PurchasingReturnRepository
│       ├── create()
│       └── get_by_id()
│
├── service.py
│   ├── SupplierService
│   │   ├── create_supplier()
│   │   ├── get_supplier()
│   │   ├── list_suppliers()
│   │   ├── update_supplier()
│   │   └── delete_supplier()
│   │
│   ├── PurchasingOrderService
│   │   ├── create_order()
│   │   ├── get_order()
│   │   ├── list_orders()
│   │   └── update_order()
│   │
│   └── PurchasingReturnService
│       ├── create_return()
│       └── get_return()
│
└── api.py
    ├── POST   /suppliers
    ├── GET    /suppliers
    ├── GET    /suppliers/{id}
    ├── PATCH  /suppliers/{id}
    ├── DELETE /suppliers/{id}
    ├── POST   /orders
    ├── GET    /orders
    ├── GET    /orders/{id}
    ├── PATCH  /orders/{id}
    ├── GET    /suppliers/{id}/orders
    ├── POST   /returns
    └── GET    /returns/{id}
```

### Finance Module

```
finance/
│
├── models.py
│   ├── BankDeposits
│   ├── CardPayments
│   ├── ChequePayments
│   ├── CreditPayments
│   ├── Vouchers
│   ├── CustomerAdvancePayments
│   ├── CustomerCreditNotes
│   ├── CustomerCreditsSettle
│   ├── CustomerCreditsSettleTransaction
│   ├── SupplierCreditsSettle
│   ├── SupplierCreditsSettleTransaction
│   └── Expenses
│
├── schemas.py
│   ├── BankDepositBase/Create
│   ├── CardPaymentBase/Create
│   ├── ChequePaymentBase/Create
│   ├── ExpenseBase/Create
│   ├── CustomerAdvancePaymentBase/Create
│   ├── CustomerCreditNoteBase/Create
│   └── Filters (ExpenseListFilter, PaymentListFilter)
│
├── repository.py
│   ├── BankDepositRepository
│   ├── CardPaymentRepository
│   ├── ChequePaymentRepository
│   ├── ExpenseRepository
│   ├── CustomerAdvancePaymentRepository
│   └── CustomerCreditNoteRepository
│
├── service.py
│   ├── BankDepositService
│   ├── CardPaymentService
│   ├── ChequePaymentService
│   ├── ExpenseService
│   ├── CustomerAdvancePaymentService
│   └── CustomerCreditNoteService
│
└── api.py
    ├── POST   /bank-deposits
    ├── GET    /bank-deposits
    ├── GET    /bank-deposits/{id}
    ├── PATCH  /bank-deposits/{id}/verify
    ├── POST   /card-payments
    ├── GET    /card-payments
    ├── GET    /card-payments/{id}
    ├── POST   /cheque-payments
    ├── GET    /cheque-payments
    ├── GET    /cheque-payments/{id}
    ├── POST   /expenses
    ├── GET    /expenses
    ├── GET    /expenses/{id}
    ├── POST   /advance-payments
    ├── GET    /advance-payments/{id}
    ├── GET    /customers/{id}/advance-payments
    ├── POST   /credit-notes
    ├── GET    /credit-notes/{id}
    └── GET    /customers/{id}/credit-notes
```

## 🔐 Security Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Security Layers                         │
└──────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Client     │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────────┐
│  API Gateway     │
│  - CORS          │
│  - Rate Limiting │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Authentication  │
│  - JWT Tokens    │
│  - Session Mgmt  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Authorization   │
│  - RBAC          │
│  - Permissions   │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Input Validation│
│  - Pydantic      │
│  - Sanitization  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Business Logic  │
│  - Service Layer │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Data Access     │
│  - ORM (SQLAlch) │
│  - SQL Injection │
│    Prevention    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   Database       │
│  - Encryption    │
│  - Backups       │
└──────────────────┘
```

## 📈 Performance Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   Performance Optimization                   │
└──────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Client     │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  CDN / Cache     │
│  - Static Assets │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Load Balancer   │
│  - Distribution  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  API Server      │
│  - Connection    │
│    Pooling       │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Redis Cache     │
│  - Query Results │
│  - Session Data  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Database        │
│  - Indexes       │
│  - Query Opt     │
│  - Partitioning  │
└──────────────────┘
```

## 🔄 Request/Response Cycle

```
1. Client Request
   ↓
2. API Gateway (FastAPI)
   ↓
3. Middleware (Auth, CORS, Logging)
   ↓
4. Route Handler (api.py)
   ↓
5. Pydantic Validation (schemas.py)
   ↓
6. Service Layer (service.py)
   ├─ Business Logic
   ├─ Validation
   └─ Error Handling
   ↓
7. Repository Layer (repository.py)
   ├─ Query Building
   ├─ Data Access
   └─ Transaction Management
   ↓
8. ORM Layer (models.py)
   ├─ SQL Generation
   └─ Object Mapping
   ↓
9. Database (PostgreSQL)
   ├─ Query Execution
   └─ Data Retrieval
   ↓
10. Response Path (reverse)
    ├─ ORM → Repository
    ├─ Repository → Service
    ├─ Service → API
    └─ API → Client
```

## 🎯 Deployment Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Production Environment                    │
└──────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│  API Server  │────▶│   Database   │
│   (Nginx)    │     │  (Gunicorn)  │     │ (PostgreSQL) │
└──────────────┘     └──────────────┘     └──────────────┘
       │                     │                     │
       │                     │                     │
       ▼                     ▼                     ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CDN        │     │  Redis Cache │     │   Backups    │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

_System Architecture v1.0 - December 28, 2024_
_TIJAERO ERP - Purchasing & Finance Modules_
