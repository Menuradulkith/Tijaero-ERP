# Sales Stock Management Improvements

## Overview

This document outlines the improvements made to the sales stock management system to ensure proper tracking of inventory throughout the sales lifecycle.

## Changes Summary

### 1. Invoice Items Model (`backend/app/modules/sales/models.py`)

Added new columns to `InvoiceItems`:
- `barcode` (String): Stores the barcode of the scanned item
- `sales_stock_id` (FK to SalesStock): Direct link to the SalesStock record
- `tax_rate`, `tax_amount`: Item-level tax tracking
- `discount_percent`, `discount_amount`: Item-level discount tracking  
- `line_total`: Pre-calculated line item total

Added relationship:
- `sales_stock`: SQLAlchemy relationship to SalesStock model

### 2. Invoice Model (`backend/app/modules/sales/models.py`)

Added new columns to `Invoice`:
- `tax_rate`, `tax_amount`: Order-level tax
- `discount_percent`, `discount_amount`: Order-level discount
- `subtotal`, `grand_total`: Calculated totals
- `service_charge_rate`, `service_charge_amount`: Service fees
- `paid_amount`, `balance_due`: Payment tracking
- `payment_status`: 'unpaid' | 'partial' | 'paid'

### 3. Sales Service (`backend/app/modules/sales/service.py`)

#### Create Invoice
When creating an invoice with barcode-scanned items:
1. Links each `InvoiceItem` to its `SalesStock` record via `sales_stock_id`
2. Creates `InvoiceItemsBarcode` entries linking to `good_received_items` for audit
3. For completed orders (cash/card/etc): Updates stock status to 'sold' and is_active to False
4. For credit orders: Stock remains 'available' until approval

#### Delete Invoice
When deleting an invoice:
1. Restores all linked SalesStock items to status='available', is_active=True
2. Removes InvoiceItemsBarcode entries (cascade)
3. Returns stock to available inventory

#### Update Invoice
When updating invoice items:
1. Restores old stock items to 'available' status
2. Processes new items with proper stock linking
3. Updates stock status based on approval_status

#### Approve Invoice
When approving a credit invoice:
1. Changes approval_status to 'approved'
2. Updates all linked SalesStock items to status='sold'

#### Complete Invoice
When completing an invoice:
1. Changes approval_status to 'completed'
2. Ensures all stock is marked as 'sold'

#### Cancel Invoice
When cancelling an invoice:
1. Restores all linked SalesStock items to status='available'
2. Sets approval_status to 'cancelled'

### 4. API Endpoints (`backend/app/modules/sales/api.py`)

Added new workflow endpoints:
- `POST /sales/{id}/approve` - Approve pending credit invoice
- `POST /sales/{id}/complete` - Mark invoice as completed
- `POST /sales/{id}/cancel` - Cancel invoice and restore stock

### 5. Frontend API (`frontend/src/modules/sales/api.ts`)

Updated/Added methods:
- `approve(id)` - Now uses POST /sales/{id}/approve
- `complete(id)` - New method for completing invoices
- `cancel(id)` - New method for cancelling invoices

### 6. Sales Page (`frontend/src/modules/sales/pages/SalesPage.tsx`)

Added workflow buttons in the action toolbar:
- **Approve** (green): For pending_approval invoices, requires sales:approve permission
- **Complete** (blue): For approved invoices, marks as completed
- **Cancel** (red): For non-completed invoices, cancels and restores stock

Each action has a confirmation dialog before execution.

### 7. Database Migration (`backend/alembic/versions/add_invoice_improvements.py`)

Migration adds all new columns to:
- `invoices` table: tax, discount, service charge, payment tracking fields
- `invoice_items` table: tax, discount, line_total, barcode, sales_stock_id (with FK)

## Stock Flow Diagram

```
GRN Received → SalesStock (status='available', is_active=true)
                    ↓
          Invoice Created (barcode scan)
                    ↓
        ┌──────────┴──────────┐
        │                     │
   Cash/Card               Credit
   Payment                 Payment
        │                     │
   status='sold'        status='available'
   is_active=false      (pending approval)
                              ↓
                         Approved
                              ↓
                        status='sold'
                        is_active=false
```

## Usage

### Creating a Sale with Barcode
1. Scan product barcodes - system finds SalesStock item
2. Add to line items with sales_stock_id reference
3. Save invoice - stock status updates based on payment type

### Approving Credit Sales
1. View pending approval invoices
2. Click Approve button
3. Confirm in dialog
4. Stock automatically marked as sold

### Cancelling Sales
1. Select non-completed invoice
2. Click Cancel button
3. Confirm in dialog
4. Stock automatically restored to available

## Related Files

- `backend/app/modules/sales/models.py` - Data models
- `backend/app/modules/sales/service.py` - Business logic
- `backend/app/modules/sales/api.py` - REST endpoints
- `backend/app/modules/sales/schemas.py` - Pydantic schemas
- `frontend/src/modules/sales/api.ts` - API client
- `frontend/src/modules/sales/pages/SalesPage.tsx` - UI components
- `frontend/src/modules/sales/types.ts` - TypeScript types
