// Salary Deduction Types
export interface SalaryDeduction {
  id: number;
  employee_id: number;
  reason: string;
  amount: number;
  approval_id?: number;
  deduction_period?: string;
  epf_employee?: number;
  etf_employee?: number;
  stamp_duty?: number;
  late_deductions?: number;
  salary_advance_repayment?: number;
  loan_repayment?: number;
  other_deductions?: number;
  remarks?: string;
  created_by?: number;
  created_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SalaryDeductionCreate {
  employee_id: number;
  reason: string;
  amount: number;
  approval_id?: number;
  deduction_period?: string;
  epf_employee?: number;
  etf_employee?: number;
  stamp_duty?: number;
  late_deductions?: number;
  salary_advance_repayment?: number;
  loan_repayment?: number;
  other_deductions?: number;
  remarks?: string;
}

// Reimbursement Item Types
export interface ReimbursementItem {
  id: number;
  reimbursement_id: number;
  expense_type: string;
  item_description?: string;
  amount: number;
  receipt_date?: string;
  receipt_number?: string;
}

export interface ReimbursementItemCreate {
  expense_type: string;
  item_description?: string;
  amount: number;
  receipt_date?: string;
  receipt_number?: string;
}

// Reimbursement Types
export interface Reimbursement {
  id: number;
  reimbursement_no: string;
  employee_id: string;
  branch_code: string;
  claim_date: string;
  description?: string;
  reimbursement_type: string;
  total_amount: number;
  approved_amount?: number;
  status: string;
  approval_id?: number;
  approved_date?: string;
  rejection_reason?: string;
  verified_by?: number;
  verified_date?: string;
  payment_status?: string;
  payment_date?: string;
  payment_method?: string;
  payment_reference?: string;
  paid_amount?: number;
  remark?: string;
  bill_image_path?: string;
  employee_name?: string;
  branch_name?: string;
  items: ReimbursementItem[];
  created_at?: string;
  updated_at?: string;
}

export interface ReimbursementCreate {
  employee_id: string;
  branch_code: string;
  claim_date: string;
  description?: string;
  reimbursement_type: string;
  remark?: string;
  items: ReimbursementItemCreate[];
}

export interface ReimbursementApprove {
  approved_amount?: number;
  remarks?: string;
}

export interface ReimbursementReject {
  rejection_reason: string;
}

export interface ReimbursementVerify {
  remarks?: string;
}

export interface ReimbursementPayment {
  payment_method: string;
  payment_reference?: string;
  paid_amount: number;
  remarks?: string;
}

// Employee Payroll Types
export interface EmployeePayroll {
  id: number;
  employee_id: string;
  basic_salary: number;
  add_1_name?: string;
  add_1_value?: number;
  add_2_name?: string;
  add_2_value?: number;
  add_sales_commision?: number;
  add_salary_advance?: number;
  add_reimbursements?: number;
  add_bonus?: number;
  less_epf_employee?: number;
  less_etf_employee?: number;
  less_stamp_duty?: number;
  less_late_deductions?: number;
  less_salary_advance_repayment?: number;
  less_loan_repayment?: number;
  less_other_deductions?: number;
  less_apit?: number;
  epf_employer?: number;
  etf_employer?: number;
  allowance_lines?: AllowanceLine[] | null;
  allowances_total?: number;
  ot_hours?: number | null;
  add_overtime?: number | null;
  nopay_days?: number | null;
  less_nopay?: number | null;
  epf_earnings?: number | null;
  taxable_income?: number | null;
  // Workflow fields
  payroll_month?: number;
  payroll_year?: number;
  payroll_batch_no?: string;
  gross_salary?: number;
  total_deductions?: number;
  net_salary?: number;
  total_employer_cost?: number;
  status?: string;
  approved_by?: number;
  approved_date?: string;
  payment_status?: string;
  payment_date?: string;
  payment_reference?: string;
  payment_method?: string;
  statutory_payment_status?: string;
  statutory_payment_date?: string;
  statutory_payment_reference?: string;
  created_at?: string;
  created_by?: number;
  employee_name?: string;
}

export interface EmployeePayrollCreate {
  employee_id: string;
  basic_salary: number;
  add_1_name?: string;
  add_1_value?: number;
  add_2_name?: string;
  add_2_value?: number;
  add_sales_commision?: number;
  add_salary_advance?: number;
  add_reimbursements?: number;
  add_bonus?: number;
  less_epf_employee?: number;
  less_etf_employee?: number;
  less_stamp_duty?: number;
  less_late_deductions?: number;
  less_salary_advance_repayment?: number;
  less_loan_repayment?: number;
  less_other_deductions?: number;
  less_apit?: number;
  epf_employer?: number;
  etf_employer?: number;
  payroll_month?: number;
  payroll_year?: number;
  payroll_batch_no?: string;
}

// Salary Profile Types
export interface EmployeeSalaryProfile {
  id: number;
  employee_id: string;
  basic_salary: number;
  add_1_name?: string;
  add_1_value?: number;
  add_2_name?: string;
  add_2_value?: number;
  allowances: AllowanceLine[];
  allowances_total?: number;
  epf_earnings?: number;
  designation?: string;
  department?: string;
  effective_from_date?: string;
  benefits?: string;
  employee_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EmployeeSalaryProfileCreate {
  employee_id: string;
  basic_salary: number;
  add_1_name?: string;
  add_1_value?: number;
  add_2_name?: string;
  add_2_value?: number;
  allowances: AllowanceLine[];
  designation?: string;
  department?: string;
  effective_from_date?: string;
  benefits?: string;
  revision_reason?: SalaryRevisionReason;
  revision_remarks?: string;
}

// Payroll Batch Types
export interface PayrollBatch {
  id: number;
  batch_no: string;
  payroll_month: number;
  payroll_year: number;
  description?: string;
  status: string;
  total_employees?: number;
  total_gross_salary?: number;
  total_deductions?: number;
  total_net_salary?: number;
  total_employer_epf?: number;
  total_employer_etf?: number;
  total_employer_cost?: number;
  total_apit?: number;
  created_by?: number;
  created_at?: string;
  approved_by?: number;
  approved_date?: string;
  salary_payment_date?: string;
  salary_payment_reference?: string;
  statutory_payment_date?: string;
  statutory_payment_reference?: string;
  completed_date?: string;
  created_by_name?: string;
  approved_by_name?: string;
  payroll_records?: EmployeePayroll[];
}

export interface PayrollRunRequest {
  payroll_month: number;
  payroll_year: number;
  description?: string;
}

export interface PayrollBatchApprove {
  remarks?: string;
}

export interface PayrollBatchReject {
  rejection_reason: string;
}

export interface PayrollBatchProcessPayment {
  payment_method: string;
  payment_reference?: string;
  payment_date?: string;
  remarks?: string;
}

export interface PayrollBatchProcessStatutory {
  epf_reference?: string;
  etf_reference?: string;
  payment_date?: string;
  remarks?: string;
}

// Promotion Types
export interface EmployeePromotion {
  id: number;
  employee_id: string;
  designation: string;
  appointed_date: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EmployeePromotionCreate {
  employee_id: string;
  designation: string;
  appointed_date: string;
  remark?: string;
}

// Employee Asset Types
export interface EmployeeAsset {
  id: number;
  employee_id: string;
  asset_id: number;
  assign_reason?: string;
  revoke_assignment: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EmployeeAssetCreate {
  employee_id: string;
  asset_id: number;
  assign_reason?: string;
  revoke_assignment: boolean;
}

// =============================================================================
// Sales Commission Types - Scenario 28A
// =============================================================================

// Monthly Branch Sales Summary
export interface MonthlyBranchSalesSummary {
  id: number;
  branch_code: string;
  fiscal_year: number;
  fiscal_month: number;
  month_name: string;
  period_start_date: string;
  period_end_date: string;
  total_sales_revenue: number;
  total_sales_cost: number;
  total_sales_returns: number;
  total_discounts: number;
  net_sales_revenue: number;
  gross_profit: number;
  gross_profit_margin?: number;
  total_invoices?: number;
  status: string;
  finalized_by?: number;
  finalized_at?: string;
  created_at?: string;
  updated_at?: string;
  branch_name?: string;
  finalized_by_name?: string;
}

export interface MonthlyBranchSalesSummaryWithCommissions extends MonthlyBranchSalesSummary {
  commissions: SalesOfficerCommission[];
}

export interface GenerateSalesSummaryRequest {
  fiscal_year: number;
  fiscal_month: number;
  branch_code?: string;
}

export interface FinalizeSummaryRequest {
  remarks?: string;
}

// Sales Officer Monthly Commission
export interface SalesOfficerCommission {
  id: number;
  monthly_sales_summary_id: number;
  employee_id: number;
  branch_code: string;
  fiscal_year: number;
  fiscal_month: number;
  branch_gross_profit: number;
  commission_percentage: number;
  total_commission_pool: number;
  total_branch_employees: number;
  individual_commission_amount: number;
  status: string;
  approved_by?: number;
  approved_at?: string;
  paid_in_payroll_id?: number;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
  employee_name?: string;
  branch_name?: string;
  approved_by_name?: string;
  month_name?: string;
}

export interface ApproveCommissionRequest {
  remarks?: string;
}

export interface RejectCommissionRequest {
  rejection_reason: string;
}

export interface BulkApproveCommissionsRequest {
  commission_ids: number[];
  remarks?: string;
}

// Dashboard Statistics
export interface CommissionDashboardStats {
  total_summaries_pending: number;
  total_summaries_finalized: number;
  total_commissions_pending: number;
  total_commissions_approved: number;
  total_commissions_paid: number;
  total_pending_amount: number;
  total_approved_amount: number;
  total_paid_amount: number;
}

// Filters
export interface SalesSummaryFilter {
  branch_code?: string;
  fiscal_year?: number;
  fiscal_month?: number;
  status?: string;
  skip?: number;
  limit?: number;
}

export interface SalesCommissionFilter {
  employee_id?: number;
  branch_code?: string;
  fiscal_year?: number;
  fiscal_month?: number;
  status?: string;
  monthly_sales_summary_id?: number;
  skip?: number;
  limit?: number;
}

// ─── Attendance ────────────────────────────────────────────────────────────────
export interface Attendance {
  id: number;
  employee_id: string;
  branch_code: string;
  date: string;
  weekday?: string;
  check_in?: string | null;
  check_out?: string | null;
  work_mins: number;
  ot_mins: number;
  full_attended_mins: number;
  late_mins: number;
  early_mins: number;
  absent_mins: number;
  leave_mins: number;
  employee_name?: string;
  branch_name?: string;
  status?: string; // present | late | absent | leave
  employee_branch_code?: string | null;
  other_branch?: boolean; // recorded at a branch other than the employee's own
}

export interface AttendanceCreate {
  employee_id: string;
  branch_code: string;
  date: string;
  weekday?: string;
  check_in?: string | null;
  check_out?: string | null;
  work_mins?: number;
  ot_mins?: number;
  late_mins?: number;
  early_mins?: number;
  absent_mins?: number;
  leave_mins?: number;
}

export interface AttendanceCheckIn {
  employee_id: string;
  branch_code: string;
  check_in?: string | null;
  date?: string | null;
}

export interface AttendanceCheckOut {
  employee_id: string;
  check_out?: string | null;
  date?: string | null;
}

export interface AttendanceSummary {
  period_from: string;
  period_to: string;
  total_records: number;
  total_present: number;
  total_absent: number;
  total_late: number;
  total_leave: number;
  total_work_hours: number;
  total_ot_hours: number;
}

// ─── Leaves ────────────────────────────────────────────────────────────────────
export interface Leave {
  id: number;
  employee_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  leave_reason: string;
  leave_duration: number;
  leave_time: string;
  approval_id?: number | null;
  status: string; // pending | approved | rejected
  approved_by?: number | null;
  approved_date?: string | null;
  rejection_reason?: string | null;
  employee_name?: string;
  created_at?: string;
}

export interface LeaveCreate {
  employee_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  leave_reason: string;
  leave_duration: number;
  leave_time?: string;
}

export interface LeaveApprove {
  remarks?: string;
}

export interface LeaveReject {
  rejection_reason: string;
}

export interface LeaveBalance {
  employee_id: string;
  employee_name?: string;
  annual_total: number;
  annual_used: number;
  annual_remaining: number;
  casual_total: number;
  casual_used: number;
  casual_remaining: number;
  medical_total: number;
  medical_used: number;
  medical_remaining: number;
  year: number;
}

// ─── Employee Master ───────────────────────────────────────────────────────────
export interface Employee {
  id: number;
  user_id: number;
  employee_id: string;
  created_at?: string;
  updated_at?: string;
  // Resolved (frontend joins with users API when needed)
  full_name?: string;
  email?: string;
  occupation?: string;
  status?: string;
  branch_code?: string | null;
}

// Same as the server's LIVE_STATUSES: only these may get new leave, attendance, assets, loans
export const isLiveEmployee = (e: Pick<Employee, "status">) =>
  ["active", "probation", "notice_period"].includes(e.status ?? "active");

export interface EmployeeCreate {
  user_id: number;
  employee_id: string;
}

export interface EmployeeUpdate {
  employee_id?: string;
}

// HR Dashboard Statistics — server-side aggregated counts
export interface HRStatistics {
  total_employees: number;
  present_today: number;
  pending_leaves: number;
  total_profiles: number;
  pending_batches: number;
  total_batches: number;
  pending_reimbursements: number;
  total_reimbursements: number;
  total_deductions: number;
  total_promotions: number;
  active_assets: number;
}

// ─── Sri Lankan payroll ───────────────────────────────────────────────────────
export interface AllowanceLine {
  name: string;
  amount: number;
  /** Counts for EPF / ETF (e.g. Budgetary Relief Allowance) */
  epf_liable: boolean;
  /** Counts for APIT */
  taxable: boolean;
}

export type SalaryRevisionReason = "joining" | "increment" | "promotion" | "adjustment";

export interface SalaryRevision {
  id: number;
  employee_id: string;
  effective_from: string;
  basic_salary: number;
  allowances: AllowanceLine[];
  total: number;
  change?: number | null;
  change_percent?: number | null;
  reason: SalaryRevisionReason;
  remarks?: string | null;
  created_by_name?: string | null;
}

export interface PayrollSettings {
  epf_employee_rate: number;
  epf_employer_rate: number;
  etf_rate: number;
  pay_overtime: boolean;
  ot_multiplier: number;
  ot_divisor: number;
  deduct_late: boolean;
  stamp_duty_amount: number;
  stamp_duty_threshold: number;
  gratuity_enabled: boolean;
  employer_epf_no?: string | null;
  employer_tin?: string | null;
}

export type StatutoryReturnKind = "epf" | "etf" | "apit" | "bank";

export interface StatutoryReturn {
  kind: StatutoryReturnKind;
  title: string;
  batch_no: string;
  period: string;
  employer_epf_no?: string | null;
  employer_tin?: string | null;
  rows: Record<string, string | number>[];
  totals: Record<string, number>;
  count: number;
  warnings: string[];
}

export type LoanType = "loan" | "advance";
export type LoanStatus = "active" | "settled" | "cancelled";

export interface LoanRecovery {
  id: number;
  period: string;
  amount: number;
  payment_date?: string | null;
  source: "payroll" | "cash";
  payroll_batch_no?: string | null;
  cancelled: boolean;
  remarks?: string | null;
}

export interface EmployeeLoan {
  id: number;
  loan_no: string;
  employee_pk: number;
  employee_id?: string;
  employee_name?: string | null;
  loan_type: LoanType;
  issue_date: string;
  amount: number;
  installment_amount: number;
  installments: number;
  start_period: string;
  payment_method: string;
  status: LoanStatus;
  remarks?: string | null;
  recovered: number;
  balance: number;
  created_at?: string;
  recoveries?: LoanRecovery[];
}

export interface LoanCreate {
  employee_pk: number;
  loan_type: LoanType;
  issue_date: string;
  amount: number;
  installments: number;
  installment_amount?: number | null;
  start_period: string;
  payment_method: string;
  remarks?: string;
}

export interface FinalSettlement {
  employee_pk: number;
  employee_id: string;
  name: string;
  status: string;
  date_of_joining?: string | null;
  last_working_date?: string | null;
  exit_type?: string | null;
  completed_years: number;
  monthly_salary: number;
  gratuity_eligible: boolean;
  gratuity: number;
  loans: { loan_no: string; loan_type: LoanType; balance: number }[];
  loans_owed: number;
  unreturned_assets: { id: number; asset: string }[];
  last_month?: { period: string; days: number; days_in_month: number; processed: boolean } | null;
  net_settlement: number;
  notes: string[];
}
