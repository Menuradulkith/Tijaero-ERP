/**
 * Debtors Management Types
 * 
 * Types for tracking credit sales, customer debts, and follow-up management
 */

export interface DebtorSummary {
  customer_id: number;
  customer_name: string;
  company_name?: string;
  total_credit_sales: number;      // Total amount of all credit sales
  total_paid: number;              // Total amount paid so far
  outstanding_balance: number;     // Total outstanding (credit_sales - paid)
  credit_limit: number;            // Customer's credit limit
  credit_days: number;             // Customer's credit terms (days)
  last_sale_date?: string;         // Date of last credit sale
  oldest_invoice_date?: string;    // Date of oldest unpaid invoice
  days_overdue: number;            // Days past due date (if overdue)
  status: "current" | "overdue" | "critical"; // Payment status
  contact_number?: string;
  email?: string;
}

export interface InvoiceDetail {
  invoice_id: number;
  invoice_no: string;
  sale_date: string;
  due_date: string;
  invoice_amount: number;
  amount_paid: number;
  outstanding_balance: number;     // invoice_amount - amount_paid
  days_outstanding: number;        // Days since invoice date
  days_overdue: number;            // Days past due date (if applicable)
  status: "paid" | "partial" | "unpaid" | "overdue"; // Payment status
  items_description?: string;      // Brief description of items
  remarks?: string;
}

export interface CustomerDebtDetails {
  customer_id: number;
  customer_name: string;
  company_name?: string;
  phone: string;
  email: string;
  credit_limit: number;
  credit_days: number;
  total_outstanding: number;
  invoices: InvoiceDetail[];
  followup_history?: FollowupRecord[];
}

export interface FollowupRecord {
  id?: number;
  customer_id: number;
  followup_date: string;
  followup_type: "call" | "email" | "sms" | "visit" | "reminder";
  notes: string;
  amount_promised?: number;
  promised_payment_date?: string;
  created_by?: string;
  created_at?: string;
}

export interface DebtorStatement {
  customer_id: number;
  customer_name: string;
  company_name?: string;
  statement_date: string;
  credit_limit: number;
  credit_used: number;
  available_credit: number;
  total_outstanding: number;
  amount_due_this_month: number;
  total_overdue: number;
  oldest_overdue_invoice?: string;
  days_since_oldest_invoice: number;
  payment_history: {
    month: string;
    opening_balance: number;
    sales: number;
    payments: number;
    closing_balance: number;
  }[];
}

export interface DebtorSummaryRequest {
  status_filter?: "current" | "overdue" | "critical" | "all";
  min_outstanding?: number;
  max_outstanding?: number;
  sort_by?: "outstanding_balance" | "days_overdue" | "customer_name";
  sort_order?: "asc" | "desc";
  skip?: number;
  limit?: number;
}

export interface DebtorsReport {
  total_debtors: number;
  total_outstanding: number;
  total_overdue: number;
  critical_count: number;
  overdue_count: number;
  current_count: number;
  debtors: DebtorSummary[];
}

export interface StatementFilters {
  customer_id: number;
  from_date?: string;
  to_date?: string;
  include_payments?: boolean;
}
