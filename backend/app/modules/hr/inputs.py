"""Strict input schemas for the HR endpoints (deductions, reimbursements, payroll, salary
profiles, promotions, asset assignments). Responses stay lenient (see schemas.py)."""
import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, field_validator, model_validator

INT4_MAX = 2_147_483_647
MAX_MONEY = Decimal("999999999.99")


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


def OptStr(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none)]


def _money(v):
    if v is None:
        return v
    d = Decimal(str(v)) if not isinstance(v, Decimal) else v
    if not d.is_finite():
        raise ValueError("Enter a valid amount")
    return d.quantize(Decimal("0.01"))


# amounts: non-negative, bounded, two decimals
Money = Annotated[Decimal, BeforeValidator(_money), Field(ge=0, le=MAX_MONEY)]
OptMoney = Annotated[Optional[Decimal], BeforeValidator(_money), Field(default=None, ge=0, le=MAX_MONEY)]
PosMoney = Annotated[Decimal, BeforeValidator(_money), Field(gt=0, le=MAX_MONEY)]

EmpCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
RowRef = Annotated[int, Field(ge=1, le=INT4_MAX)]
Period = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]

PAYMENT_METHODS = ("bank_transfer", "cash", "cheque", "online")
REIMBURSEMENT_TYPES = ("travel", "accommodation", "meals", "medical", "training", "client_entertainment", "communication", "office_supplies", "transport", "general")
EXPENSE_TYPES = ("transport", "accommodation", "meals", "communication", "medical", "training", "supplies", "entertainment", "other")


def _window(v: Optional[date], label: str, back_days: int, fwd_days: int):
    if v is not None:
        today = date.today()
        if v < today - timedelta(days=back_days) or v > today + timedelta(days=fwd_days):
            raise ValueError(f"{label} is out of the allowed range")
    return v


# ─────────────────────────────── deductions ───────────────────────────────
class SalaryDeductionCreate(BaseModel):
    employee_id: RowRef
    reason: ReqStr(500)
    amount: PosMoney
    deduction_period: Optional[Period] = None
    epf_employee: OptMoney = None
    etf_employee: OptMoney = None
    stamp_duty: OptMoney = None
    late_deductions: OptMoney = None
    salary_advance_repayment: OptMoney = None
    loan_repayment: OptMoney = None
    other_deductions: OptMoney = None
    remarks: OptStr(1000) = None

    @model_validator(mode="after")
    def _parts(self):
        parts = [self.late_deductions, self.salary_advance_repayment, self.loan_repayment, self.other_deductions]
        if sum((p or Decimal("0")) for p in parts) > self.amount:
            raise ValueError("The component amounts add up to more than the deduction amount")
        return self


# ───────────────────────────── reimbursements ─────────────────────────────
class ReimbursementItemCreate(BaseModel):
    expense_type: Literal[EXPENSE_TYPES]
    item_description: OptStr(500) = None
    amount: PosMoney
    receipt_date: Optional[date] = None
    receipt_number: OptStr(100) = None

    @field_validator("receipt_date")
    @classmethod
    def _rd(cls, v):
        if v is not None and (v > date.today() or v < date.today() - timedelta(days=800)):
            raise ValueError("Receipt date must be in the past 2 years and not in the future")
        return v


class ReimbursementCreate(BaseModel):
    employee_id: EmpCode
    branch_code: ReqStr(20)
    claim_date: date
    description: OptStr(1000) = None
    reimbursement_type: Literal[REIMBURSEMENT_TYPES] = "general"
    remark: OptStr(1000) = None
    items: List[ReimbursementItemCreate] = Field(..., min_length=1, max_length=50)

    @field_validator("claim_date")
    @classmethod
    def _cd(cls, v):
        if v > date.today() or v < date.today() - timedelta(days=400):
            raise ValueError("Claim date must be within the past 400 days and not in the future")
        return v


class ReimbursementUpdate(BaseModel):
    description: OptStr(1000) = None
    reimbursement_type: Optional[Literal[REIMBURSEMENT_TYPES]] = None
    remark: OptStr(1000) = None


class ReimbursementApprove(BaseModel):
    approved_amount: Optional[PosMoney] = None
    remarks: OptStr(1000) = None


class ReimbursementReject(BaseModel):
    rejection_reason: ReqStr(1000)


class ReimbursementVerify(BaseModel):
    remarks: OptStr(1000) = None


class ReimbursementPayment(BaseModel):
    payment_method: Literal[PAYMENT_METHODS + ("with_salary",)]
    payment_reference: OptStr(100) = None
    paid_amount: PosMoney
    remarks: OptStr(1000) = None


# ─────────────────────────────── payroll ───────────────────────────────
class EmployeePayrollCreate(BaseModel):
    """A manual (ad-hoc) payroll record. Gross, deductions and net are always worked out by the server."""
    employee_id: EmpCode
    payroll_month: int = Field(..., ge=1, le=12)
    payroll_year: int = Field(..., ge=2000, le=2100)
    basic_salary: PosMoney
    add_1_name: OptStr(100) = None
    add_1_value: OptMoney = None
    add_2_name: OptStr(100) = None
    add_2_value: OptMoney = None
    add_sales_commision: OptMoney = None
    add_salary_advance: OptMoney = None
    add_reimbursements: OptMoney = None
    add_bonus: OptMoney = None
    less_epf_employee: OptMoney = None
    less_etf_employee: OptMoney = None
    less_stamp_duty: OptMoney = None
    less_late_deductions: OptMoney = None
    less_salary_advance_repayment: OptMoney = None
    less_loan_repayment: OptMoney = None
    less_other_deductions: OptMoney = None
    less_apit: OptMoney = None
    epf_employer: OptMoney = None
    etf_employer: OptMoney = None

    @model_validator(mode="after")
    def _net(self):
        gross = sum((v or Decimal("0")) for v in (self.basic_salary, self.add_1_value, self.add_2_value, self.add_sales_commision,
                                                  self.add_salary_advance, self.add_reimbursements, self.add_bonus))
        less = sum((v or Decimal("0")) for v in (self.less_epf_employee, self.less_etf_employee, self.less_stamp_duty, self.less_late_deductions,
                                                  self.less_salary_advance_repayment, self.less_loan_repayment, self.less_other_deductions, self.less_apit))
        if less > gross:
            raise ValueError("Deductions cannot be more than the gross pay")
        return self


class PayrollRunRequest(BaseModel):
    payroll_month: int = Field(..., ge=1, le=12)
    payroll_year: int = Field(..., ge=2000, le=2100)
    description: OptStr(500) = None


class PayrollBatchApprove(BaseModel):
    remarks: OptStr(1000) = None


class PayrollBatchReject(BaseModel):
    rejection_reason: ReqStr(1000)


class PayrollBatchProcessPayment(BaseModel):
    payment_method: Literal[PAYMENT_METHODS] = "bank_transfer"
    payment_reference: OptStr(100) = None
    payment_date: Optional[date] = None
    remarks: OptStr(1000) = None

    @field_validator("payment_date")
    @classmethod
    def _pd(cls, v):
        return _window(v, "Payment date", 60, 0)


class PayrollBatchProcessStatutory(BaseModel):
    epf_reference: OptStr(100) = None
    etf_reference: OptStr(100) = None
    payment_date: Optional[date] = None
    remarks: OptStr(1000) = None

    @field_validator("payment_date")
    @classmethod
    def _pd(cls, v):
        return _window(v, "Payment date", 60, 0)


# ───────────────────────────── salary profile ─────────────────────────────
class EmployeeSalaryProfileCreate(BaseModel):
    employee_id: EmpCode
    basic_salary: PosMoney
    add_1_name: OptStr(100) = None
    add_1_value: OptMoney = None
    add_2_name: OptStr(100) = None
    add_2_value: OptMoney = None
    designation: OptStr(200) = None
    department: OptStr(200) = None
    effective_from_date: Optional[date] = None
    benefits: OptStr(2000) = None

    @field_validator("effective_from_date")
    @classmethod
    def _ef(cls, v):
        return _window(v, "Effective date", 3650, 366)

    @model_validator(mode="after")
    def _names(self):
        if self.add_1_value and not self.add_1_name:
            raise ValueError("Name the first allowance")
        if self.add_2_value and not self.add_2_name:
            raise ValueError("Name the second allowance")
        return self


# ───────────────────────────── promotions / assets ─────────────────────────────
class EmployeePromotionCreate(BaseModel):
    employee_id: EmpCode
    designation: ReqStr(200)
    appointed_date: date
    remark: OptStr(1000) = None

    @field_validator("appointed_date")
    @classmethod
    def _ad(cls, v):
        return _window(v, "Appointed date", 18250, 366)


class EmployeeAssetCreate(BaseModel):
    employee_id: EmpCode
    asset_id: RowRef
    assign_reason: OptStr(1000) = None
    revoke_assignment: bool = False
