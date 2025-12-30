// Bank Deposit Types
export interface BankDeposit {
  id: number;
  deposits_amount: number;
  remarks?: string;
  created_date: string;
  branch_code: string;
  bank_name?: string;
  payment_for?: string;
  invoice_no?: string;
  verified: boolean;
  returned?: boolean;
}

export interface BankDepositCreate {
  deposits_amount: number;
  remarks?: string;
  branch_code: string;
  bank_name?: string;
  payment_for?: string;
  invoice_no?: string;
}

// Card Payment Types
export interface CardPayment {
  id: number;
  card_type: string;
  amount: number;
  date_time: string;
  remark?: string;
  ref_number?: string;
  invoice_no?: string;
  deposited: boolean;
}

export interface CardPaymentCreate {
  card_type: string;
  amount: number;
  remark?: string;
  ref_number?: string;
  invoice_no?: string;
  deposited?: boolean;
}

// Cheque Payment Types
export interface ChequePayment {
  id: number;
  cheque_number: number;
  branch_code: number;
  from_party: string;
  bank: string;
  amount: number;
  cheque_date: string;
  deposit_date: string;
  remark?: string;
  payment_for?: string;
  invoice_no?: string;
}

export interface ChequePaymentCreate {
  cheque_number: number;
  branch_code: number;
  from_party: string;
  bank: string;
  amount: number;
  cheque_date: string;
  deposit_date: string;
  remark?: string;
  payment_for?: string;
  invoice_no?: string;
}

// Expense Types
export interface Expense {
  id: number;
  expenses_no: string;
  expenses_method: string;
  expense_amount: number;
  remarks?: string;
  created_date: string;
  branch_code: string;
  bill_reference?: string;
}

export interface ExpenseCreate {
  expenses_no: string;
  expenses_method: string;
  expense_amount: number;
  remarks?: string;
  branch_code: string;
  bill_reference?: string;
}

// Customer Advance Payment Types
export interface CustomerAdvancePayment {
  id: number;
  advance_payments_no: string;
  payment_method: string;
  branch_code: string;
  payment_amount: number;
  remarks?: string;
  created_date: string;
  customer_id: number;
  cheque_date: string;
  active: boolean;
}

export interface CustomerAdvancePaymentCreate {
  advance_payments_no: string;
  payment_method: string;
  branch_code: string;
  payment_amount: number;
  remarks?: string;
  customer_id: number;
  cheque_date: string;
  active?: boolean;
}

// Customer Credit Note Types
export interface CustomerCreditNote {
  id: number;
  customer_id: number;
  date: string;
  amount: number;
  remark: string;
  invoice_no?: string;
}

export interface CustomerCreditNoteCreate {
  customer_id: number;
  amount: number;
  remark: string;
  invoice_no?: string;
}
