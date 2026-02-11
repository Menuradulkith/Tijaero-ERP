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
  designation?: string;
  department?: string;
  effective_from_date?: string;
  benefits?: string;
  employee_name?: string;
}

export interface EmployeeSalaryProfileCreate {
  employee_id: string;
  basic_salary: number;
  add_1_name?: string;
  add_1_value?: number;
  add_2_name?: string;
  add_2_value?: number;
  designation?: string;
  department?: string;
  effective_from_date?: string;
  benefits?: string;
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
}

export interface EmployeeAssetCreate {
  employee_id: string;
  asset_id: number;
  assign_reason?: string;
  revoke_assignment: boolean;
}
