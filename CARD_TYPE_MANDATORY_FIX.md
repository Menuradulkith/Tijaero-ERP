# Card Type Mandatory When Card Payment Selected

## Issue Description

When choosing card payment to create a sales order or customer credit settlement, the card type field should be mandatory and users should not be able to continue without selecting a card type.

## Analysis

The ERP has two different payment flows:

### 1. Sales Order Dialog (Invoice Creation)
**File:** `frontend/src/modules/sales/components/SalesOrderDialog.tsx`

**Current Behavior:**
- Payment method dropdown includes specific card options:
  - `card_visa` - "Visa Card"
  - `card_mastercard` - "Mastercard"  
  - `card_amex` - "Amex Card"
- When user selects any of these, the card type is **implicitly selected**

**Status:** ✅ **Already Compliant**
- The card type is embedded in the payment method selection
- No additional validation needed

### 2. Customer Payments Page (Credit Settlements)
**File:** `frontend/src/modules/finance/pages/CustomerPaymentsPage.tsx`

**Current Behavior:**
- Uses split payment system with configurable payment cards from settings
- Payment method dropdown includes generic "Card" option
- When "Card" is selected, a separate "Card Type" dropdown appears
- Card Type field was marked with asterisk (*) but not validated

**Status:** ✅ **FIXED**
- Added validation to prevent proceeding without card type selection
- Added visual error state (red border + helper text)
- Validation happens in `handleProceedToReview()` function

## Changes Made

### File: `frontend/src/modules/finance/pages/CustomerPaymentsPage.tsx`

#### 1. Added Validation Logic (Line ~600)

```typescript
const handleProceedToReview = useCallback(() => {
  if (totalPaymentAmount <= 0) {
    showErrorToast("Total payment amount must be greater than 0");
    return;
  }

  // Validate split payment rows
  for (let i = 0; i < splitPayments.length; i++) {
    const row = splitPayments[i];
    
    if (row.amount <= 0) {
      showErrorToast(`Payment row #${i + 1}: Amount must be greater than 0`);
      return;
    }

    if (row.method === "bank_transfer" && !row.bank_transfer_ref) {
      showErrorToast(`Payment row #${i + 1}: Please enter bank transfer reference number`);
      return;
    }
    
    if (row.method === "cheque" && (!row.cheque_number || !row.cheque_bank)) {
      showErrorToast(`Payment row #${i + 1}: Please enter cheque number and bank name`);
      return;
    }
    
    if (row.method === "card" && !row.card_ref_number) {
      showErrorToast(`Payment row #${i + 1}: Please enter card reference number`);
      return;
    }
    
    // ✅ NEW: Card type validation
    if (row.method === "card" && !row.card_id) {
      showErrorToast(`Payment row #${i + 1}: Please select a card type`);
      return;
    }
  }

  setViewMode("review");
  setActiveStep(2);
}, [totalPaymentAmount, paymentMethod, referenceNumber, bankName, cardRefNumber, splitPayments]);
```

#### 2. Added Visual Error State (Line ~1645)

```tsx
<TextField
  select
  size="small"
  label="Card Type *"
  value={row.card_id || ""}
  onChange={(e) => updateSplitRow(row.id, { card_id: Number(e.target.value) })}
  sx={{ minWidth: 200 }}
  required
  error={!row.card_id}  // ✅ NEW: Shows red border when empty
  helperText={!row.card_id ? "Card type is required" : undefined}  // ✅ NEW: Shows error message
>
  <MenuItem value="" disabled>
    Select card
  </MenuItem>
  {paymentCards.map((card: PaymentCard) => (
    <MenuItem key={card.id} value={card.id}>
      {card.card_name} ({card.card_type})
      {(card.service_charge_percent || 0) > 0 &&
        ` — ${card.service_charge_percent}% fee`}
      </MenuItem>
  ))}
</TextField>
```

## Validation Behavior

### Before Fix:
- User could select "Card" payment method
- Leave "Card Type" dropdown empty
- Click "Review Payment"
- System would proceed without card type ❌

### After Fix:
- User selects "Card" payment method
- Leaves "Card Type" dropdown empty
- Field shows red border with "Card type is required" message
- Clicks "Review Payment"  
- Toast error appears: "Payment row #1: Please select a card type" ✅
- Cannot proceed until card type is selected ✅

## Testing Instructions

### Test Case 1: Customer Payments Page

1. Navigate to Finance → Customer Payment Methods → Credit Settlements
2. Select a customer with outstanding credit invoices
3. Click "Receive Payment"
4. Select invoice(s)
5. Click "Continue to Payment"
6. In payment details:
   - Select "Card" as payment method
   - Enter amount
   - Leave "Card Type" dropdown empty
   - Try to proceed
7. **Expected:** Red border on card type field + error toast
8. Now select a card type (e.g., "Visa Credit Card")
9. **Expected:** Can now proceed to review

### Test Case 2: Sales Order (Already Working)

1. Navigate to Sales → Create Invoice
2. Add customer and items
3. Select payment method "Visa Card" or "Mastercard" or "Amex Card"
4. **Expected:** Card type is already selected (no additional field needed)
5. Can create order successfully ✅

### Test Case 3: Multiple Split Payments

1. In Customer Payments page
2. Add multiple payment methods using "+ Add Payment Method"
3. Set one row to "Card" without selecting card type
4. **Expected:** Error specifically identifies which payment row is missing card type
5. Example: "Payment row #2: Please select a card type"

## Related Files

- ✅ `frontend/src/modules/finance/pages/CustomerPaymentsPage.tsx` - Fixed
- ✅ `frontend/src/modules/sales/components/SalesOrderDialog.tsx` - Already compliant (card type embedded in payment method)

## Impact

**User Experience:**
- Clear visual feedback when card type is missing (red border + message)
- Prevents invalid payments from being submitted
- Consistent with other required field validations (cheque number, bank transfer ref, etc.)

**Backend:**
- No backend changes needed
- Validation ensures `payment_card_id` is always provided when card payment is used
- Service charge calculations work correctly

## Notes

- The SalesOrderDialog uses a different pattern (hardcoded card types) which already satisfies the requirement
- The CustomerPaymentsPage uses configurable payment cards from settings (more flexible)
- Both approaches are valid; validation ensures data integrity in both cases
- Card type field was already marked with asterisk (*), validation now enforces it
