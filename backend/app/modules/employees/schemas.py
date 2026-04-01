from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime

from app.common.base_schemas import TijaeroBaseSchema

class EmployeeBase(BaseModel):
    user_id: int
    employee_id: str = Field(..., max_length=255)

class EmployeeCreate(EmployeeBase):
    pass

class EmployeeUpdate(BaseModel):
    employee_id: Optional[str] = Field(None, max_length=255)

class Employee(EmployeeBase, TijaeroBaseSchema):
    id: int
    created_at: datetime
    updated_at: datetime

class EmployeePayrollBase(BaseModel):
    employee_id: str
    basic_salary: float = Field(..., ge=0)
    add_1_name: Optional[str] = Field(None, max_length=100)
    add_1_value: Optional[float] = Field(None, ge=0)
    add_2_name: Optional[str] = Field(None, max_length=100)
    add_2_value: Optional[float] = Field(None, ge=0)
    add_sales_commision: Optional[float] = Field(None, ge=0)
    add_salary_advance: Optional[float] = Field(None, ge=0)
    add_reimbursements: Optional[float] = Field(None, ge=0)
    less_epf_employee: Optional[float] = Field(None, ge=0)
    less_etf_employee: Optional[float] = Field(None, ge=0)
    less_stamp_duty: Optional[float] = Field(None, ge=0)
    less_late_deductions: Optional[float] = Field(None, ge=0)
    epf_employer: Optional[float] = Field(None, ge=0)
    etf_employer: Optional[float] = Field(None, ge=0)
    less_salary_advance_repayment: Optional[float] = Field(None, ge=0)

class EmployeePayrollCreate(EmployeePayrollBase):
    pass

class EmployeePayroll(EmployeePayrollBase, TijaeroBaseSchema):
    id: int

class EmployeeSalaryProfileBase(BaseModel):
    employee_id: str
    basic_salary: float = Field(..., ge=0)
    add_1_name: Optional[str] = Field(None, max_length=100)
    add_1_value: Optional[float] = Field(None, ge=0)
    add_2_name: Optional[str] = Field(None, max_length=100)
    add_2_value: Optional[float] = Field(None, ge=0)

class EmployeeSalaryProfileCreate(EmployeeSalaryProfileBase):
    pass

class EmployeeSalaryProfile(EmployeeSalaryProfileBase, TijaeroBaseSchema):
    id: int
