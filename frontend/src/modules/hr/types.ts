// Salary Deduction Types
export interface SalaryDeduction {
  id: number;
  employee_id: number;
  reason: string;
  amount: number;
  approval_id?: number;
}

export interface SalaryDeductionCreate {
  employee_id: number;
  reason: string;
  amount: number;
  approval_id?: number;
}

// Reimbursement Types
export interface Reimbursement {
  id: number;
  employee_id: string;
  reimbursement_amount: number;
  bill_date: string;
  remark: string;
  bill_image_path?: string;
  approval_id: number;
}

export interface ReimbursementCreate {
  employee_id: string;
  reimbursement_amount: number;
  bill_date: string;
  remark: string;
  bill_image_path?: string;
  approval_id: number;
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
  less_epf_employee?: number;
  less_etf_employee?: number;
  less_stamp_duty?: number;
  less_late_deductions?: number;
  epf_employer?: number;
  etf_employer?: number;
  less_salary_advance_repayment?: number;
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
  less_epf_employee?: number;
  less_etf_employee?: number;
  less_stamp_duty?: number;
  less_late_deductions?: number;
  epf_employer?: number;
  etf_employer?: number;
  less_salary_advance_repayment?: number;
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
}

export interface EmployeeSalaryProfileCreate {
  employee_id: string;
  basic_salary: number;
  add_1_name?: string;
  add_1_value?: number;
  add_2_name?: string;
  add_2_value?: number;
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
