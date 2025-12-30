from pydantic import BaseModel
from datetime import date
from typing import Optional
from decimal import Decimal

# Salary Deduction Schemas
class SalaryDeductionBase(BaseModel):
    employee_id: int
    reason: str
    amount: Decimal

class SalaryDeductionCreate(SalaryDeductionBase):
    approval_id: Optional[int] = None

class SalaryDeduction(SalaryDeductionBase):
    id: int
    approval_id: Optional[int] = None
    
    class Config:
        from_attributes = True

# Reimbursement Schemas
class ReimbursementBase(BaseModel):
    employee_id: str
    reimbursement_amount: Decimal
    bill_date: date
    remark: str
    bill_image_path: Optional[str] = None

class ReimbursementCreate(ReimbursementBase):
    approval_id: int

class Reimbursement(ReimbursementBase):
    id: int
    approval_id: int
    
    class Config:
        from_attributes = True

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
    less_epf_employee: Optional[Decimal] = None
    less_etf_employee: Optional[Decimal] = None
    less_stamp_duty: Optional[Decimal] = None
    less_late_deductions: Optional[Decimal] = None
    epf_employer: Optional[Decimal] = None
    etf_employer: Optional[Decimal] = None
    less_salary_advance_repayment: Optional[Decimal] = None

class EmployeePayrollCreate(EmployeePayrollBase):
    pass

class EmployeePayroll(EmployeePayrollBase):
    id: int
    
    class Config:
        from_attributes = True

# Employee Salary Profile Schemas
class EmployeeSalaryProfileBase(BaseModel):
    employee_id: str
    basic_salary: Decimal
    add_1_name: Optional[str] = None
    add_1_value: Optional[Decimal] = None
    add_2_name: Optional[str] = None
    add_2_value: Optional[Decimal] = None

class EmployeeSalaryProfileCreate(EmployeeSalaryProfileBase):
    pass

class EmployeeSalaryProfile(EmployeeSalaryProfileBase):
    id: int
    
    class Config:
        from_attributes = True

# Employee Promotion Schemas
class EmployeePromotionBase(BaseModel):
    employee_id: str
    designation: str
    appointed_date: date
    remark: Optional[str] = None

class EmployeePromotionCreate(EmployeePromotionBase):
    pass

class EmployeePromotion(EmployeePromotionBase):
    id: int
    
    class Config:
        from_attributes = True

# Employee Asset Schemas
class EmployeeAssetBase(BaseModel):
    employee_id: str
    asset_id: int
    assign_reason: Optional[str] = None
    revoke_assignment: bool = False

class EmployeeAssetCreate(EmployeeAssetBase):
    pass

class EmployeeAsset(EmployeeAssetBase):
    id: int
    
    class Config:
        from_attributes = True

# Filter Schemas
class HRListFilter(BaseModel):
    employee_id: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100
