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

// Paginated Response Types
export interface PaginatedJournalEntries {
  items: JournalEntry[];
  total: number;
}

export interface PaginatedGeneralLedger {
  items: GeneralLedgerEntry[];
  total: number;
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

// ─── Chart of Accounts Types ──────────────────────────────────────────────────

export type AccountType = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
export type NormalBalance = "Debit" | "Credit";

export interface ChartOfAccount {
  id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_category: string;
  parent_account_id?: number | null;
  is_active: boolean;
  is_system_account: boolean;
  normal_balance: NormalBalance;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChartOfAccountCreate {
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_category: string;
  parent_account_id?: number | null;
  is_active?: boolean;
  is_system_account?: boolean;
  normal_balance: NormalBalance;
  description?: string;
}

export interface ChartOfAccountUpdate {
  account_name?: string;
  account_category?: string;
  parent_account_id?: number | null;
  is_active?: boolean;
  normal_balance?: NormalBalance;
  description?: string;
}

export interface ChartOfAccountTree extends ChartOfAccount {
  children: ChartOfAccountTree[];
}

// ─── Journal Entry Types ──────────────────────────────────────────────────────

export type JournalEntryStatus = "draft" | "posted" | "reversed";
export type JournalEntryType =
  | "standard"
  | "adjusting"
  | "closing"
  | "reversing"
  | "opening"
  | "recurring";

export interface JournalEntryLine {
  id?: number;
  line_number: number;
  account_id: number;
  account_code?: string;
  account_name?: string;
  debit_amount: number;
  credit_amount: number;
  description?: string;
  reference_type?: string;
  reference_id?: number;
  reference_no?: string;
}

export interface JournalEntryLineCreate {
  line_number: number;
  account_id: number;
  debit_amount: number;
  credit_amount: number;
  description?: string;
  reference_type?: string;
  reference_id?: number;
  reference_no?: string;
}

export interface JournalEntry {
  id: number;
  journal_entry_no: string;
  entry_date: string;
  posting_date?: string;
  description: string;
  entry_type: JournalEntryType;
  total_debit: number;
  total_credit: number;
  status: JournalEntryStatus;
  is_reversed: boolean;
  reversed_by_je_id?: number | null;
  reversed_je_no?: string;
  fiscal_year?: number;
  fiscal_period?: number;
  branch_code?: string;
  lines: JournalEntryLine[];
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface JournalEntryCreate {
  entry_date: string;
  description: string;
  entry_type?: JournalEntryType;
  branch_code?: string;
  lines: JournalEntryLineCreate[];
}

export interface JournalEntryUpdate {
  entry_date?: string;
  description?: string;
  entry_type?: JournalEntryType;
  lines?: JournalEntryLineCreate[];
}

// ─── General Ledger Types ─────────────────────────────────────────────────────

export interface GeneralLedgerEntry {
  id: number;
  transaction_date: string;
  posting_date?: string;
  account_id: number;
  account_code?: string;
  account_name?: string;
  debit: number;
  credit: number;
  balance: number;
  description?: string;
  transaction_type: string;
  reference_type?: string;
  reference_id?: number;
  reference_no?: string;
  journal_entry_id?: number;
  fiscal_year?: number;
  fiscal_period?: number;
  branch_code?: string;
  created_at?: string;
}

export interface GLAccountSummary {
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface TrialBalance {
  accounts: GLAccountSummary[];
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
  as_of_date: string;
}

// ─── Accounting Period Types ──────────────────────────────────────────────────

export type PeriodStatus = "open" | "closed" | "locked";

export interface AccountingPeriod {
  id: number;
  fiscal_year: number;
  period_number: number;
  period_name: string;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  closed_by?: number;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AccountingPeriodCreate {
  fiscal_year: number;
  period_number: number;
  period_name: string;
  start_date: string;
  end_date: string;
  status?: PeriodStatus;
}

export interface GeneratePeriodsRequest {
  fiscal_year: number;
  start_month?: number;
}

// ─── Cash Flow Types ──────────────────────────────────────────────────────────

export type CashFlowSection = "Operating" | "Investing" | "Financing";
export type CashFlowStatementStatus = "draft" | "final" | "approved";

export interface CashFlowCategory {
  id: number;
  category_code: string;
  category_name: string;
  section: CashFlowSection;
  line_item: string;
  display_order: number;
  is_inflow: boolean;
  account_mapping?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string;
}

export interface CashFlowCategoryCreate {
  category_code: string;
  category_name: string;
  section: CashFlowSection;
  line_item: string;
  display_order?: number;
  is_inflow?: boolean;
  account_mapping?: Record<string, unknown>;
  is_active?: boolean;
}

export interface CashFlowCategoryUpdate {
  category_name?: string;
  section?: CashFlowSection;
  line_item?: string;
  display_order?: number;
  is_inflow?: boolean;
  account_mapping?: Record<string, unknown>;
  is_active?: boolean;
}

export interface CashFlowStatementLine {
  id?: number;
  category_id: number;
  category_name?: string;
  section?: CashFlowSection;
  line_number: number;
  line_description: string;
  amount: number;
  is_calculated: boolean;
  calculation_source?: string;
}

export interface CashFlowStatement {
  id: number;
  statement_no: string;
  fiscal_year: number;
  fiscal_period?: number;
  start_date: string;
  end_date: string;
  opening_cash_balance: number;
  closing_cash_balance: number;
  net_cash_from_operating: number;
  net_cash_from_investing: number;
  net_cash_from_financing: number;
  status: CashFlowStatementStatus;
  method: string;
  prepared_by?: number;
  approved_by?: number;
  approved_at?: string;
  lines: CashFlowStatementLine[];
  created_at?: string;
  updated_at?: string;
}

// ─── Accounting Dashboard Types ───────────────────────────────────────────────

export interface AccountingDashboardStats {
  total_accounts: number;
  active_accounts: number;
  total_journal_entries: number;
  draft_journal_entries: number;
  posted_journal_entries: number;
  open_periods: number;
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
}
