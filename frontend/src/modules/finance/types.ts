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
  proforma_invoice_id?: number;
}

export interface CustomerAdvancePaymentCreate {
  advance_payments_no?: string;
  payment_method: string;
  branch_code: string;
  payment_amount: number;
  remarks?: string;
  customer_id: number;
  cheque_date: string;
  active?: boolean;
  proforma_invoice_id?: number;
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

// Credit Payment Types
export interface CreditPayment {
  id: number;
  customer_id?: number;
  customer_name?: string;
  invoice_no?: string;
  amount: number;
  credit_terms?: string;
  due_date?: string;
  status: string;
  created_date?: string;
}

export interface CreditPaymentCreate {
  customer_id: number;
  amount: number;
  credit_terms?: string;
  due_date?: string;
  status?: string;
}

// Cash Payment Types
export interface CashPayment {
  id: number;
  invoice_no: string;
  branch_code: string;
  amount: number;
  customer_id: number;
  customer_name?: string;
  created_date: string;
  created_date_time: string;
  remarks?: string;
  created_by?: number;
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
  supplier_advances_out: number;
  purchase_returns_in: number;
  expenses: number;
  bank_deposits: number;
  // Breakdown by type - counts
  invoice_receipts_count: number;
  customer_credit_settlements_count: number;
  customer_advances_count: number;
  voucher_sales_count: number;
  supplier_payments_count: number;
  supplier_advances_out_count: number;
  purchase_returns_in_count: number;
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
  account_id?: number;
  account_code?: string;
  account_name?: string;
  account_type?: string;
  /** Backend sends debit_amount / credit_amount (NOT debit / credit). */
  debit_amount: number;
  credit_amount: number;
  /** Stored per-row balance — null for auto postings; do not display directly. */
  balance?: number | null;
  /** Running balance — only returned by the per-account ledger endpoint. */
  running_balance?: number;
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
  normal_balance?: string;
  total_debit: number;
  total_credit: number;
  /** Backend sends net_balance (NOT balance). */
  net_balance: number;
}

export interface TrialBalance {
  accounts: GLAccountSummary[];
  total_debit: number;
  total_credit: number;
  as_of_date: string;
  fiscal_year?: number;
  fiscal_period?: number | null;
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

// ─── Financial Report Types ─────────────────────────────────────────────────

export interface IncomeStatementLineItem {
  account_id: number;
  account_code: string;
  account_name: string;
  amount: number;
}

export interface IncomeStatementSection {
  section_name: string;
  items: IncomeStatementLineItem[];
  total: number;
}

export interface IncomeStatementResponse {
  fiscal_year: number;
  fiscal_period?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  revenue: IncomeStatementSection;
  cost_of_sales: IncomeStatementSection;
  gross_profit: number;
  operating_expenses: IncomeStatementSection;
  operating_income: number;
  other_income: IncomeStatementSection;
  other_expenses: IncomeStatementSection;
  net_income: number;
  generated_at?: string | null;
}

export interface BalanceSheetSection {
  section_name: string;
  items: IncomeStatementLineItem[];
  total: number;
}

export interface BalanceSheetResponse {
  as_of_date: string;
  fiscal_year: number;
  current_assets: BalanceSheetSection;
  non_current_assets: BalanceSheetSection;
  total_assets: number;
  current_liabilities: BalanceSheetSection;
  non_current_liabilities: BalanceSheetSection;
  total_liabilities: number;
  equity: BalanceSheetSection;
  total_equity: number;
  total_liabilities_and_equity: number;
  is_balanced: boolean;
  generated_at?: string | null;
}

// ─── GL Posting Failures (Transactional Outbox) ─────────────────────────────

export type GLPostingFailureStatus = "pending" | "resolved" | "ignored";

export interface GLPostingFailure {
  id: number;
  reference_type: string;
  reference_id: number;
  reference_no?: string | null;
  source_module: string;
  transaction_type?: string | null;
  posting_marker?: string | null;
  entry_date?: string | null;
  branch_code?: string | null;
  description?: string | null;
  error_code: string;
  error_message: string;
  status: GLPostingFailureStatus;
  attempts: number;
  last_attempt_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: number | null;
  resolved_je_id?: number | null;
  created_at?: string | null;
}

export interface GLPostingFailureListResponse {
  items: GLPostingFailure[];
  total: number;
  pending_count: number;
}

export interface RetryPostingFailureResponse {
  failure_id: number;
  status: "resolved" | "failed";
  journal_entry_no?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

// ─── Day-End Reconciliation ("Books Balanced") ────────────────────────────

export interface DayEndReconciliation {
  reconciliation_date: string;
  branch_code?: string | null;
  gl_total_debit: number;
  gl_total_credit: number;
  trial_balanced: boolean;
  gl_cash_movement: number;
  gl_bank_movement: number;
  gl_cash_bank_net: number;
  cashbook_money_in: number;
  cashbook_money_out: number;
  cashbook_net: number;
  cashbook_bank_deposits: number;
  cash_reconciled: boolean;
  cash_difference: number;
  posting_failures_pending: number;
  unposted_je_count: number;
  submitted_je_count: number;
  is_balanced: boolean;
  discrepancies: string[];
  warnings: string[];
}

// ─── Petty Cash Types ────────────────────────────────────────────────────

export interface PettyCashFund {
  id: number;
  petty_cash_no: string;
  opening_balance: number;
  current_balance: number;
  closing_balance?: number | null;
  branch_code: string;
  opened_by?: number;
  opened_date: string;
  status: "active" | "closed";
  closed_by?: number;
  closed_date?: string;
  remarks?: string;
  created_date: string;
}

export interface PettyCashFundCreate {
  branch_code: string;
  opening_balance: number;
  opened_date: string;
  remarks?: string;
}

export interface PettyCashTransaction {
  id: number;
  transaction_no: string;
  petty_cash_id: number;
  transaction_type: "expense" | "replenishment";
  amount: number;
  balance_after: number;
  expense_type?: string;
  recipient_name?: string;
  purpose?: string;
  receipt_number?: string;
  approved_by?: number;
  description?: string;
  transaction_date: string;
  recorded_by?: number;
  branch_code: string;
  remarks?: string;
  created_date: string;
}

export interface PettyCashExpenseCreate {
  petty_cash_id: number;
  amount: number;
  expense_type: string;
  recipient_name: string;
  purpose: string;
  receipt_number?: string;
  transaction_date: string;
  description?: string;
}

export interface PettyCashReplenishCreate {
  petty_cash_id: number;
  amount: number;
  transaction_date: string;
  description?: string;
}

export interface PettyCashReconcileRequest {
  closing_balance: number;
  remarks?: string;
}

export interface PettyCashReconcileResponse {
  id: number;
  status: string;
  closing_balance: number;
  variance: number;
  closed_date: string;
  remarks?: string;
}

export interface PettyCashSummary {
  opening_balance: number;
  total_expenses: number;
  total_replenishments: number;
  current_balance: number;
  transaction_count: number;
  last_transaction_date?: string;
}

export interface PettyCashListFilter {
  branch_code?: string;
  status?: "active" | "closed";
  date_from?: string;
  date_to?: string;
  skip?: number;
  limit?: number;
}

export interface PettyCashFundWithTransactions extends PettyCashFund {
  transactions: PettyCashTransaction[];
}

// ─── Payment Voucher Types ────────────────────────────────────────────────────

export interface PaymentVoucher {
  id: number;
  voucher_no: string;
  amount: number;
  status: "pending" | "approved" | "rejected" | "used" | "expired";
  payee_name: string;
  payment_date: string;
  expiry_date?: string;
  description?: string;
  branch_code: string;
  created_by?: number;
  approved_by?: number;
  created_date: string;
}

export interface PaymentVoucherCreate {
  amount: number;
  payee_name: string;
  payment_date: string;
  description?: string;
  branch_code: string;
  expiry_date?: string;
}

export interface PaymentVoucherUpdate {
  amount?: number;
  payee_name?: string;
  payment_date?: string;
  description?: string;
  expiry_date?: string;
}

export interface PaymentVoucherFilter {
  branch_code?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  skip?: number;
  limit?: number;
}
