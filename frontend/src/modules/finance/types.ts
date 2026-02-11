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
  expense_type: string;
  expense_category: string;
  expenses_method: string;
  expense_amount: number;
  expense_date?: string;
  vendor_name?: string;
  description?: string;
  receipt_number?: string;
  receipt_image?: string;
  invoice_attachment?: string;
  remarks?: string;
  bill_reference?: string;
  branch_code: string;
  // Workflow
  status: string;
  submitted_by?: number;
  approved_by?: number;
  approved_date?: string;
  rejection_reason?: string;
  // Payment
  payment_status?: string;
  payment_date?: string;
  payment_method?: string;
  payment_reference?: string;
  // Accounting
  account_code?: string;
  cost_center?: string;
  // Timestamps
  created_date: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExpenseCreate {
  expenses_no?: string;
  expense_type?: string;
  expense_category: string;
  expenses_method: string;
  expense_amount: number;
  expense_date?: string;
  vendor_name?: string;
  description?: string;
  receipt_number?: string;
  receipt_image?: string;
  invoice_attachment?: string;
  remarks?: string;
  bill_reference?: string;
  branch_code: string;
  account_code?: string;
  cost_center?: string;
}

export interface ExpenseUpdate {
  expense_type?: string;
  expense_category?: string;
  expenses_method?: string;
  expense_amount?: number;
  expense_date?: string;
  vendor_name?: string;
  description?: string;
  receipt_number?: string;
  receipt_image?: string;
  invoice_attachment?: string;
  remarks?: string;
  bill_reference?: string;
  account_code?: string;
  cost_center?: string;
}

export interface ExpenseListResponse {
  items: Expense[];
  total: number;
}

export interface ExpensePaymentData {
  payment_method: string;
  payment_reference?: string;
  payment_date?: string;
  remarks?: string;
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

// Cashbook Types
export type CashbookEntryType = 
  | "invoice_receipt"
  | "customer_credit_settle"
  | "customer_advance"
  | "supplier_payment"
  | "expense"
  | "bank_deposit"
  | "voucher_sale"
  | "adjustment";

export interface CashbookEntry {
  id: number;
  entry_type: CashbookEntryType;
  transaction_date: string;
  reference_no: string;
  description: string;
  party_name?: string;
  payment_method?: string;
  money_in: number;
  money_out: number;
  running_balance: number;  // Cumulative balance after this transaction
  branch_code?: string;
  source_table: string;
  source_id: number;
}

export interface CashbookSummary {
  total_money_in: number;
  total_money_out: number;
  net_movement: number;
  opening_balance: number;
  closing_balance: number;
  // Breakdown by type - amounts
  invoice_receipts: number;
  customer_credit_settlements: number;
  customer_advances: number;
  voucher_sales: number;
  supplier_payments: number;
  expenses: number;
  bank_deposits: number;
  // Breakdown by type - counts
  invoice_receipts_count: number;
  customer_credit_settlements_count: number;
  customer_advances_count: number;
  voucher_sales_count: number;
  supplier_payments_count: number;
  expenses_count: number;
  bank_deposits_count: number;
}

export interface CashbookReport {
  entries: CashbookEntry[];
  summary: CashbookSummary;
  date_from?: string;
  date_to?: string;
  branch_code?: string;
  entry_count: number;
}

export interface CashbookFilter {
  date_from?: string;
  date_to?: string;
  branch_code?: string;
  entry_type?: CashbookEntryType;
  payment_method?: string;
}
