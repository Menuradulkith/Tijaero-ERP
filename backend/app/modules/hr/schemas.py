from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema

# Salary Deduction Schemas
class SalaryDeductionBase(BaseModel):
    employee_id: int
    reason: str
    amount: Decimal

class SalaryDeductionCreate(SalaryDeductionBase):
    approval_id: Optional[int] = None
    deduction_period: Optional[str] = None
    epf_employee: Optional[Decimal] = None
    etf_employee: Optional[Decimal] = None
    stamp_duty: Optional[Decimal] = None
    late_deductions: Optional[Decimal] = None
    salary_advance_repayment: Optional[Decimal] = None
    loan_repayment: Optional[Decimal] = None
    other_deductions: Optional[Decimal] = None
    remarks: Optional[str] = None

class SalaryDeduction(SalaryDeductionBase, TijaeroBaseSchema):
    id: int
    approval_id: Optional[int] = None
    deduction_period: Optional[str] = None
    epf_employee: Optional[Decimal] = None
    etf_employee: Optional[Decimal] = None
    stamp_duty: Optional[Decimal] = None
    late_deductions: Optional[Decimal] = None
    salary_advance_repayment: Optional[Decimal] = None
    loan_repayment: Optional[Decimal] = None
    other_deductions: Optional[Decimal] = None
    remarks: Optional[str] = None
    created_by: Optional[int] = None
    created_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# Reimbursement Item Schemas
class ReimbursementItemBase(BaseModel):
    expense_type: str
    item_description: Optional[str] = None
    amount: Decimal
    receipt_date: Optional[date] = None
    receipt_number: Optional[str] = None

class ReimbursementItemCreate(ReimbursementItemBase):
    pass

class ReimbursementItemResponse(ReimbursementItemBase, TijaeroBaseSchema):
    id: int
    reimbursement_id: int

# Reimbursement Schemas
class ReimbursementBase(BaseModel):
    employee_id: str
    branch_code: str
    claim_date: date
    description: Optional[str] = None
    reimbursement_type: str = "general"
    remark: Optional[str] = None

class ReimbursementCreate(ReimbursementBase):
    items: list[ReimbursementItemCreate] = []

class ReimbursementUpdate(BaseModel):
    description: Optional[str] = None
    reimbursement_type: Optional[str] = None
    remark: Optional[str] = None

class ReimbursementApprove(BaseModel):
    approved_amount: Optional[Decimal] = None
    remarks: Optional[str] = None

class ReimbursementReject(BaseModel):
    rejection_reason: str

class ReimbursementVerify(BaseModel):
    remarks: Optional[str] = None

class ReimbursementPayment(BaseModel):
    payment_method: str
    payment_reference: Optional[str] = None
    paid_amount: Decimal
    remarks: Optional[str] = None

class Reimbursement(TijaeroBaseSchema):
    id: int
    reimbursement_no: str
    employee_id: str
    branch_code: str
    claim_date: date
    description: Optional[str] = None
    reimbursement_type: str
    total_amount: Decimal
    approved_amount: Optional[Decimal] = None
    status: str
    approval_id: Optional[int] = None
    approved_date: Optional[str] = None
    rejection_reason: Optional[str] = None
    verified_by: Optional[int] = None
    verified_date: Optional[str] = None
    payment_status: Optional[str] = None
    payment_date: Optional[str] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    paid_amount: Optional[Decimal] = None
    remark: Optional[str] = None
    bill_image_path: Optional[str] = None
    # Resolved fields
    employee_name: Optional[str] = None
    branch_name: Optional[str] = None
    items: list[ReimbursementItemResponse] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class ReimbursementListFilter(BaseModel):
    employee_id: Optional[str] = None
    branch_code: Optional[str] = None
    status: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100

# Employee Payroll Schemas
class EmployeePayrollBase(BaseModel):
    employee_id: str
    basic_salary: Decimal
    add_1_name: Optional[str] = None
    add_1_value: Optional[Decimal] = None
    add_2_name: Optional[str] = None
    add_2_value: Optional[Decimal] = None
    add_sales_commision: Optional[Decimal] = None
    add_salary_advance: Optional[Decimal] = None
    add_reimbursements: Optional[Decimal] = None
    add_bonus: Optional[Decimal] = None
    less_epf_employee: Optional[Decimal] = None
    less_etf_employee: Optional[Decimal] = None
    less_stamp_duty: Optional[Decimal] = None
    less_late_deductions: Optional[Decimal] = None
    less_salary_advance_repayment: Optional[Decimal] = None
    less_loan_repayment: Optional[Decimal] = None
    less_other_deductions: Optional[Decimal] = None
    less_apit: Optional[Decimal] = None
    epf_employer: Optional[Decimal] = None
    etf_employer: Optional[Decimal] = None

class EmployeePayrollCreate(EmployeePayrollBase):
    payroll_month: Optional[int] = None
    payroll_year: Optional[int] = None
    payroll_batch_no: Optional[str] = None

class EmployeePayrollResponse(EmployeePayrollBase, TijaeroBaseSchema):
    id: int
    payroll_month: Optional[int] = None
    payroll_year: Optional[int] = None
    payroll_batch_no: Optional[str] = None
    gross_salary: Optional[Decimal] = None
    total_deductions: Optional[Decimal] = None
    net_salary: Optional[Decimal] = None
    total_employer_cost: Optional[Decimal] = None
    status: Optional[str] = None
    approved_by: Optional[int] = None
    approved_date: Optional[str] = None
    payment_status: Optional[str] = None
    payment_date: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_method: Optional[str] = None
    statutory_payment_status: Optional[str] = None
    statutory_payment_date: Optional[str] = None
    statutory_payment_reference: Optional[str] = None
    created_at: Optional[str] = None
    created_by: Optional[int] = None
    # Resolved fields
    employee_name: Optional[str] = None

# Keep backward compat alias
class EmployeePayroll(EmployeePayrollResponse):
    pass

# Employee Salary Profile Schemas
class EmployeeSalaryProfileBase(BaseModel):
    employee_id: str
    basic_salary: Decimal
    add_1_name: Optional[str] = None
    add_1_value: Optional[Decimal] = None
    add_2_name: Optional[str] = None
    add_2_value: Optional[Decimal] = None

class EmployeeSalaryProfileCreate(EmployeeSalaryProfileBase):
    designation: Optional[str] = None
    department: Optional[str] = None
    effective_from_date: Optional[date] = None
    benefits: Optional[str] = None

class EmployeeSalaryProfile(EmployeeSalaryProfileBase, TijaeroBaseSchema):
    id: int
    designation: Optional[str] = None
    department: Optional[str] = None
    effective_from_date: Optional[date] = None
    benefits: Optional[str] = None
    # Resolved
    employee_name: Optional[str] = None

# Payroll Batch Schemas
class PayrollBatchCreate(BaseModel):
    payroll_month: int
    payroll_year: int
    description: Optional[str] = None

class PayrollBatchResponse(TijaeroBaseSchema):
    id: int
    batch_no: str
    payroll_month: int
    payroll_year: int
    description: Optional[str] = None
    status: str
    total_employees: Optional[int] = None
    total_gross_salary: Optional[Decimal] = None
    total_deductions: Optional[Decimal] = None
    total_net_salary: Optional[Decimal] = None
    total_employer_epf: Optional[Decimal] = None
    total_employer_etf: Optional[Decimal] = None
    total_employer_cost: Optional[Decimal] = None
    total_apit: Optional[Decimal] = None
    created_by: Optional[int] = None
    created_at: Optional[str] = None
    approved_by: Optional[int] = None
    approved_date: Optional[str] = None
    salary_payment_date: Optional[str] = None
    salary_payment_reference: Optional[str] = None
    statutory_payment_date: Optional[str] = None
    statutory_payment_reference: Optional[str] = None
    completed_date: Optional[str] = None
    # Resolved
    created_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    payroll_records: Optional[List["EmployeePayrollResponse"]] = None

# Payroll Run (trigger) Schema
class PayrollRunRequest(BaseModel):
    payroll_month: int
    payroll_year: int
    description: Optional[str] = None

# Payroll Batch Action Schemas
class PayrollBatchApprove(BaseModel):
    remarks: Optional[str] = None

class PayrollBatchReject(BaseModel):
    rejection_reason: str

class PayrollBatchProcessPayment(BaseModel):
    payment_method: str = "bank_transfer"
    payment_reference: Optional[str] = None
    payment_date: Optional[date] = None
    remarks: Optional[str] = None

class PayrollBatchProcessStatutory(BaseModel):
    epf_reference: Optional[str] = None
    etf_reference: Optional[str] = None
    payment_date: Optional[date] = None
    remarks: Optional[str] = None

class PayrollBatchListFilter(BaseModel):
    payroll_month: Optional[int] = None
    payroll_year: Optional[int] = None
    status: Optional[str] = None
    skip: int = 0
    limit: int = 100

# Employee Promotion Schemas
class EmployeePromotionBase(BaseModel):
    employee_id: str
    designation: str
    appointed_date: date
    remark: Optional[str] = None

class EmployeePromotionCreate(EmployeePromotionBase):
    pass

class EmployeePromotion(EmployeePromotionBase, TijaeroBaseSchema):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# Employee Asset Schemas
class EmployeeAssetBase(BaseModel):
    employee_id: str
    asset_id: int
    assign_reason: Optional[str] = None
    revoke_assignment: bool = False

class EmployeeAssetCreate(EmployeeAssetBase):
    pass

class EmployeeAsset(EmployeeAssetBase, TijaeroBaseSchema):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# Filter Schemas
class HRListFilter(BaseModel):
    employee_id: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100


# HR Dashboard Statistics — server-side aggregated counts so KPI cards do not
# depend on client-side counting of capped list responses.
class HRStatistics(BaseModel):
    total_employees: int = 0
    present_today: int = 0
    pending_leaves: int = 0
    total_profiles: int = 0
    pending_batches: int = 0
    total_batches: int = 0
    pending_reimbursements: int = 0
    total_reimbursements: int = 0
    total_deductions: int = 0
    total_promotions: int = 0
    active_assets: int = 0
