# Agent Commission Flow Analysis

## Overview
The agent commission system tracks and manages commissions earned by customer agents when they facilitate sales. The system follows a complete lifecycle from commission generation through approval and payment.

---

## 1. Commission Creation (Sales Order)

### When Commissions Are Created
Commissions are **automatically created** when a sales order (invoice) is created with a customer agent assigned.

### Location
- **Frontend**: `frontend/src/modules/sales/pages/SalesPage.tsx`
- **Backend**: `backend/app/modules/sales/service.py` (lines 1350-1379)

### Process Flow

#### Step 1: Sales Order Creation
When creating a sales order, users can:
1. Select a **Customer Agent** from the customer agents list
2. View the agent's default **commission rate** (e.g., 5%)
3. **Override** the commission rate or amount manually if needed
4. Choose to **"Pay Commission Now"** or **"Pay Later"**

#### Step 2: Automatic Commission Record Creation (Backend)
```python
# backend/app/modules/sales/service.py (lines 1350-1379)
if customer_agent_id:
    agent = db.query(Customer).filter(Customer.id == customer_agent_id).first()
    
    if agent and agent.commission_rate:
        commission_rate = Decimal(str(agent.commission_rate))
        commission_amount = gross_total * (commission_rate / Decimal("100"))
        
        commission = CustomerAgentCommission(
            invoice_id=invoice.id,
            customer_agent_id=customer_agent_id,
            represented_customer_id=invoice_data.customer_id,
            invoice_amount=gross_total,
            commission_type="PERCENT",
            commission_rate=commission_rate,
            commission_amount=commission_amount,
            status="pending"  # Initially set to PENDING
        )
        db.add(commission)
```

**Key Points:**
- Commission is calculated on the **gross_total** (before discounts)
- Status is set to **"pending"** initially
- The system stores both the rate and calculated amount

#### Step 3: Immediate Payment (Optional)
If "Pay Commission Now" toggle is enabled:
```typescript
// frontend/src/modules/sales/pages/SalesPage.tsx (lines 829-860)
if (payCommissionNow && createdInvoice?.id && state.formData.customer_agent_id) {
    // Fetch the commission record that was just created
    const commissionsResult = await commissionsApi.getAll({ 
        agent_id: state.formData.customer_agent_id, 
        limit: 5 
    });
    const invoiceCommission = commissionsResult.items.find(
        (c) => c.invoice_id === createdInvoice.id
    );
    
    if (invoiceCommission) {
        // Use manual override if set, otherwise use recorded amount
        const finalAmount = manualCommissionAmount !== null
            ? manualCommissionAmount
            : invoiceCommission.commission_amount;
        
        // Create payment immediately
        await commissionPaymentsApi.create({
            customer_agent_id: state.formData.customer_agent_id,
            payment_date: new Date().toISOString().split("T")[0],
            payment_method: commissionPaymentMethod,
            payment_amount: finalAmount,
            branch_code: state.formData.branch_code || "MAIN",
            remarks: `Commission paid at time of SO ${createdInvoice.invoice_no}`,
            items: [{ 
                commission_id: invoiceCommission.id, 
                paid_amount: finalAmount 
            }],
        });
    }
}
```

### Commission Data Structure
```typescript
interface CustomerAgentCommission {
  id: number;
  invoice_id: number;
  customer_agent_id: number;
  represented_customer_id: number;
  invoice_amount: number;
  commission_type: 'PERCENT' | 'AMOUNT';
  commission_rate?: number;
  commission_amount: number;
  status: 'pending' | 'approved' | 'paid';
  approved_by?: number;
  approved_date?: string;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
}
```

---

## 2. Commission Approval Workflow

### Location
**Page**: `frontend/src/modules/sales/pages/CommissionApprovalsPage.tsx`

### Purpose
Commissions must be approved before they can be paid. This provides a control mechanism to verify commission calculations.

### Features

#### List View
- Shows all **pending commissions** by default
- Can filter by:
  - Status (pending, approved, paid)
  - Agent
  - Date range
- Displays:
  - Invoice number
  - Agent name
  - Customer name
  - Invoice amount
  - Commission rate
  - Commission amount
  - Status

#### Detail View
Shows complete commission details:
- Agent & Customer Information
- Invoice Information
- Commission Details (type, rate, amount)
- Status & Dates
- Calculation Breakdown (for percentage commissions)

#### Approval Actions
1. **Approve**: Changes status from "pending" to "approved"
   - API: `POST /customers/commissions/{id}/approve`
   - After-hours warning (after 6 PM)
   
2. **Reject/Delete**: Removes the commission record
   - API: `DELETE /customers/commissions/{id}`
   - Cannot be undone

### Status Flow
```
pending → [Approve] → approved → [Payment Created] → paid
       ↓
    [Reject/Delete] → (deleted)
```

---

## 3. Commission Management (Agent Commissions Page)

### Location
**Page**: `frontend/src/modules/sales/pages/AgentCommissionsPage.tsx`

### Purpose
View all commission records and create ad-hoc payments for pending commissions.

### Features

#### Summary Cards
- **Unpaid**: Total pending commissions amount
- **Paid**: Total paid commissions amount

#### Filters
- Filter by Agent
- Filter by Status (All, Unpaid, Paid)

#### Commission List
Table showing:
- Invoice number
- Agent name
- Customer name
- Invoice amount
- Commission rate
- Commission amount
- Date created
- Status badge (Unpaid/Paid)
- Pay button (for unpaid commissions)

#### Pay Action
Direct payment creation:
1. Click "Pay" button on an unpaid commission
2. Dialog opens with:
   - Agent and invoice details
   - Editable payment amount (default: commission amount)
   - Payment method selector (Cash, Bank Transfer, Cheque)
   - Reference/Note field
3. Confirm payment
4. Creates a payment record and marks commission as paid

---

## 4. Commission Payments (Finance Module)

### Location
**Page**: `frontend/src/modules/finance/pages/CommissionPaymentsPage.tsx`

### Purpose
Centralized payment management for agent commissions. Allows batch payment of multiple commissions.

### Features

#### Summary Statistics (using TStatCard)
- Total Payments
- Pending Amount
- Verified Amount
- Total Count

#### Payment Creation
1. Select agent
2. System loads all unpaid/approved commissions for that agent
3. Select commissions to include in payment (checkbox selection)
4. Enter payment details:
   - Payment date
   - Payment method (Cash, Bank Transfer, Cheque)
   - Reference number (for Bank Transfer/Cheque)
   - Bank name (for Cheque/Bank Transfer)
   - Branch code
   - Remarks
5. System calculates total payment amount
6. Create payment

#### Payment Details View
Shows:
- Payment number (auto-generated: CP-YYYY-####)
- Agent information
- Payment details (method, amount, date)
- Status
- Line items (individual commissions included)
- For each line item:
  - Invoice number
  - Commission amount
  - Paid amount

#### Payment Status
- **pending**: Payment created but not verified
- **verified**: Payment verified by authorized user
- **cancelled**: Payment cancelled

#### Actions
- **Verify Payment**: Mark payment as verified (requires permission)
- **Cancel Payment**: Cancel a payment (returns commissions to unpaid status)

---

## 5. Commission Payment Approvals

### Location
**Page**: `frontend/src/modules/finance/pages/CommissionPaymentApprovalsPage.tsx`

### Purpose
Approve/verify commission payments before final processing.

### Features
- Similar to Commission Approvals page
- Shows pending payment records
- Approve/reject workflow
- Payment details view

---

## 6. Database Schema

### CustomerAgentCommission Table
```sql
CREATE TABLE customer_agent_commissions (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    customer_agent_id INTEGER NOT NULL REFERENCES customers(id),
    represented_customer_id INTEGER NOT NULL REFERENCES customers(id),
    invoice_amount DECIMAL(10,2) NOT NULL,
    commission_type VARCHAR(20) NOT NULL, -- 'PERCENT' or 'AMOUNT'
    commission_rate DECIMAL(5,2),
    commission_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending/approved/paid
    approved_by INTEGER REFERENCES users(id),
    approved_date TIMESTAMP,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### CustomerAgentCommissionPayment Table
```sql
CREATE TABLE customer_agent_commission_payments (
    id SERIAL PRIMARY KEY,
    payment_no VARCHAR(50) UNIQUE NOT NULL, -- CP-YYYY-####
    customer_agent_id INTEGER NOT NULL REFERENCES customers(id),
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_amount DECIMAL(10,2) NOT NULL,
    reference_number VARCHAR(100),
    bank_name VARCHAR(100),
    branch_code VARCHAR(20) NOT NULL,
    remarks TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending/verified/cancelled
    verified_by INTEGER REFERENCES users(id),
    verified_date TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### CustomerAgentCommissionPaymentItem Table
```sql
CREATE TABLE customer_agent_commission_payment_items (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER NOT NULL REFERENCES customer_agent_commission_payments(id),
    commission_id INTEGER NOT NULL REFERENCES customer_agent_commissions(id),
    paid_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. Complete Workflow Example

### Scenario: Agent John facilitates a sale

1. **Sales Order Creation** (Sales Module)
   - User creates invoice for Rs. 100,000
   - Selects Agent: John (5% commission rate)
   - System calculates: Rs. 5,000 commission
   - User chooses "Pay Later"
   - Commission record created with status: "pending"

2. **Commission Approval** (Sales → Commission Approvals)
   - Manager reviews pending commission
   - Verifies: Invoice Rs. 100,000 × 5% = Rs. 5,000
   - Clicks "Approve"
   - Status changes to: "approved"

3. **Payment Creation** (Finance → Commission Payments)
   - Finance team creates payment for John
   - Selects multiple approved commissions:
     - Invoice INV-2026-00123: Rs. 5,000
     - Invoice INV-2026-00145: Rs. 3,000
     - Invoice INV-2026-00167: Rs. 4,500
   - Total payment: Rs. 12,500
   - Payment method: Bank Transfer
   - Creates payment (status: "pending")
   - Payment number: CP-2026-0001

4. **Payment Verification** (Finance → Commission Payment Approvals)
   - Senior finance approves payment CP-2026-0001
   - Status changes to: "verified"
   - All associated commissions status: "paid"

5. **Alternative: Immediate Payment** (At Step 1)
   - If user toggles "Pay Commission Now"
   - Commission created and immediately marked as paid
   - Payment record auto-created
   - Skips approval steps

---

## 8. Permissions

### Commission Management
- `AGENT_COMMISSIONS_VIEW`: View commission records
- `AGENT_COMMISSIONS_CREATE`: Create commissions (system auto-creates)
- `AGENT_COMMISSIONS_UPDATE`: Edit commission records
- `AGENT_COMMISSIONS_DELETE`: Delete commissions

### Commission Approvals
- `commission_approvals:approve`: Approve pending commissions
- `commission_approvals:delete`: Reject/delete commissions

### Commission Payments
- `commission_payments:create`: Create commission payments
- `commission_payments:update`: Edit payment records
- `commission_payments:view`: View payment records

### Payment Approvals
- `commission_payment_approvals:approve`: Verify/approve payments

---

## 9. API Endpoints

### Commissions
- `GET /customers/commissions/` - List all commissions
- `GET /customers/commissions/{id}` - Get commission details
- `POST /customers/commissions/` - Create commission (manual)
- `PUT /customers/commissions/{id}` - Update commission
- `POST /customers/commissions/{id}/approve` - Approve commission
- `DELETE /customers/commissions/{id}` - Delete commission
- `GET /customers/commissions/agent/{agent_id}/pending` - Get agent's pending commissions
- `GET /customers/commissions/agent/{agent_id}/summary` - Get agent summary

### Commission Payments
- `GET /customers/commissions/payments/` - List all payments
- `GET /customers/commissions/payments/{id}` - Get payment with items
- `POST /customers/commissions/payments/` - Create payment
- `POST /customers/commissions/payments/{id}/verify` - Verify payment
- `POST /customers/commissions/payments/{id}/cancel` - Cancel payment

---

## 10. Key Features

### Manual Override
- Commission rate can be overridden when creating sales order
- Commission amount can be manually edited
- Payment amount can differ from commission amount (partial/full payment)

### After-Hours Warning
- System warns when approving commissions after 6 PM
- Helps maintain proper business hours controls

### Batch Processing
- Multiple commissions can be paid in a single payment
- Efficient bulk payment processing

### Audit Trail
- All approvals tracked with user and timestamp
- Payment verification tracked
- Complete history of commission lifecycle

### Status Tracking
Clear status progression:
- Commission: pending → approved → paid
- Payment: pending → verified → (or cancelled)

---

## 11. Potential Issues & Recommendations

### Current Issues Found

#### Issue 1: Missing Approval Step in Auto-Pay
When "Pay Commission Now" is enabled during sales order creation, the commission is created and paid immediately **without going through the approval workflow**. This bypasses the control mechanism.

**Recommendation**: 
- Require commissions to be approved before payment, even for immediate payments
- OR: Create immediate payments with "pending_approval" status that requires finance approval

#### Issue 2: Commission Calculation Base
Commission is calculated on `gross_total` before discounts. This might not align with business requirements if commissions should be based on net amount after discounts.

**Recommendation**:
- Clarify business rule: Should commission be on gross or net amount?
- Make it configurable per agent or system-wide setting

#### Issue 3: No Commission Adjustment After Invoice Changes
If an invoice is edited/cancelled after commission is created, the commission record is not automatically adjusted.

**Recommendation**:
- Add workflow to handle invoice cancellations
- Automatically void/adjust commissions when invoice is cancelled
- Prevent invoice edits if commission is already paid

#### Issue 4: Payment Verification Not Mandatory
Payments can exist in "pending" status indefinitely. No forced verification workflow.

**Recommendation**:
- Add required verification before marking commissions as "paid"
- Send reminders for unverified payments
- Add aging reports for pending payments

---

## 12. Summary

The agent commission system is well-structured with clear separation of concerns:

1. **Sales Module**: Commission creation and immediate payment option
2. **Approval Workflow**: Commission approval process
3. **Finance Module**: Payment processing and verification

The system supports both immediate and deferred payment models, with proper status tracking and audit trails. However, there are opportunities to strengthen controls around immediate payments and post-invoice adjustments.

---

**Document Created**: June 2, 2026
**System Version**: TijaeroERP v1.0
**Last Updated**: June 2, 2026
