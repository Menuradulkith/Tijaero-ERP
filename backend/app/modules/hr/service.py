from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, text
from fastapi import HTTPException, status
from typing import List, Optional, Dict, Any
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from app.core import timezone as tz
from . import schemas
from .models import SalaryDeductions, Reimbursements, ReimbursementItem, PayrollBatch
from .sales_commission_models import SalesOfficerMonthlyCommission
from app.modules.employees.models import Employee
from app.modules.employees.models import EmployeePayroll, EmployeeSalaryProfile, EmployeePromotions, EmployeesAssets
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus
from app.common.enums import DocumentStatus, PaymentStatus
from app.modules.finance.gl_posting_service import record_gl_commit_failure
from app.common.audit import log_audit
from app.auth.models import Branch, User
from app.modules.hr_core.service import LIVE_STATUSES, in_service
from .scope import employee_names, scope

LEFT_STATUSES = ("resigned", "terminated", "retired", "inactive")


def _live_employee(db: Session, employee_code: str) -> Employee:
    """The employee must exist and still be in service (not resigned, terminated, retired or inactive)."""
    emp = db.query(Employee).filter(Employee.employee_id == employee_code).first()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{employee_code}' not found")
    if not in_service(emp):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Employee '{employee_code}' is no longer in service")
    return emp


def _branch_access(actor: User, branch_code: Optional[str]) -> None:
    if actor.is_superuser or not branch_code:
        return
    if branch_code not in [b.branch_code for b in actor.branches]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")


def _audit(db: Session, user_id: int, action: str, entity: str, entity_id: int, **changes) -> None:
    log_audit(db, user_id=user_id, action=action, entity_type=entity, entity_id=entity_id, changes=changes or None)


def _batch_for_period(db: Session, period: str) -> Optional[PayrollBatch]:
    """A non-cancelled payroll batch for 'YYYY-MM', if any."""
    year, month = int(period[:4]), int(period[5:7])
    return db.query(PayrollBatch).filter(
        PayrollBatch.payroll_year == year, PayrollBatch.payroll_month == month, PayrollBatch.status != "cancelled"
    ).first()

# Salary Deductions Service
class SalaryDeductionService:
    def __init__(self, db: Session):
        self.db = db

    def _employee(self, employee_pk: int) -> Employee:
        emp = self.db.query(Employee).filter(Employee.id == employee_pk).first()
        if not emp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee with id {employee_pk} not found")
        if not in_service(emp):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This employee is no longer in service")
        return emp

    def _check_open(self, period: Optional[str]) -> None:
        if period:
            batch = _batch_for_period(self.db, period)
            if batch:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail=f"Payroll {batch.batch_no} already exists for {period}; cancel it before changing deductions for that month")

    def create_deduction(self, deduction: schemas.SalaryDeductionCreate, user_id: int = 0) -> SalaryDeductions:
        self._employee(deduction.employee_id)
        self._check_open(deduction.deduction_period)
        db_deduction = SalaryDeductions(**deduction.model_dump(), created_by=user_id)
        db_deduction.created_date = tz.now()
        self.db.add(db_deduction)
        self.db.flush()
        _audit(self.db, user_id, "create", "salary_deduction", db_deduction.id, employee=deduction.employee_id, amount=str(deduction.amount))
        self.db.commit()
        self.db.refresh(db_deduction)
        return db_deduction

    def get_deduction(self, deduction_id: int) -> SalaryDeductions:
        deduction = self.db.query(SalaryDeductions).filter(SalaryDeductions.id == deduction_id).first()
        if not deduction:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deduction not found")
        return deduction

    def list_deductions(self, filters: schemas.HRListFilter, branches: Optional[List[str]] = None) -> List[SalaryDeductions]:
        query = scope(self.db.query(SalaryDeductions), SalaryDeductions.employee_id, branches, by="pk")
        if filters.employee_id:
            try:
                employee_pk = int(filters.employee_id)
            except (TypeError, ValueError):
                return []
            query = query.filter(SalaryDeductions.employee_id == employee_pk)
        return query.order_by(SalaryDeductions.id.desc()).offset(filters.skip).limit(filters.limit).all()

    def _locked(self, deduction_id: int) -> SalaryDeductions:
        row = self.db.query(SalaryDeductions).filter(SalaryDeductions.id == deduction_id).with_for_update().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deduction not found")
        self._check_open(row.deduction_period)   # already used by a payroll run -> read-only
        return row

    def update_deduction(self, deduction_id: int, deduction: schemas.SalaryDeductionCreate, user_id: int = 0) -> SalaryDeductions:
        db_deduction = self._locked(deduction_id)
        if deduction.employee_id != db_deduction.employee_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A deduction cannot be moved to another employee; delete it and add a new one")
        self._check_open(deduction.deduction_period)
        for key, value in deduction.model_dump().items():
            setattr(db_deduction, key, value)
        db_deduction.updated_by = user_id
        _audit(self.db, user_id, "update", "salary_deduction", db_deduction.id, amount=str(deduction.amount))
        self.db.commit()
        self.db.refresh(db_deduction)
        return db_deduction

    def delete_deduction(self, deduction_id: int, user_id: int = 0):
        db_deduction = self._locked(deduction_id)
        _audit(self.db, user_id, "delete", "salary_deduction", db_deduction.id, employee=db_deduction.employee_id)
        self.db.delete(db_deduction)
        self.db.commit()


# Reimbursements Service
class ReimbursementService:
    def __init__(self, db: Session):
        self.db = db

    def _generate_reimbursement_no(self) -> str:
        """Generate unique reimbursement number: RMB-YYYYMMDD-NNN"""
        today = tz.today().strftime("%Y%m%d")
        prefix = f"RMB-{today}-"
        # Advisory lock to prevent race conditions on sequence generation
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = self.db.query(Reimbursements).filter(
            Reimbursements.reimbursement_no.like(f"{prefix}%")
        ).order_by(Reimbursements.id.desc()).first()
        if last:
            last_seq = int(last.reimbursement_no.split("-")[-1])
            seq = last_seq + 1
        else:
            seq = 1
        return f"{prefix}{seq:03d}"

    def _resolve_names(self, reimbursement: Reimbursements) -> Dict[str, Any]:
        """Resolve employee_name and branch_name for a reimbursement."""
        result: Dict[str, Any] = {}
        # Employee name
        employee = self.db.query(Employee).filter(
            Employee.employee_id == reimbursement.employee_id
        ).first()
        if employee and employee.user:
            result["employee_name"] = f"{employee.user.first_name} {employee.user.last_name}".strip()
        else:
            result["employee_name"] = reimbursement.employee_id
        # Branch name
        if reimbursement.branch:
            result["branch_name"] = getattr(reimbursement.branch, "branch_name", reimbursement.branch_code)
        else:
            result["branch_name"] = reimbursement.branch_code
        return result

    def _to_response(self, r: Reimbursements) -> schemas.Reimbursement:
        """Convert a Reimbursements ORM object to a Reimbursement response schema."""
        names = self._resolve_names(r)
        items = [schemas.ReimbursementItemResponse.model_validate(item) for item in (r.items or [])]
        return schemas.Reimbursement(
            id=r.id,
            reimbursement_no=r.reimbursement_no,
            employee_id=r.employee_id,
            branch_code=r.branch_code,
            claim_date=r.claim_date,
            description=r.description,
            reimbursement_type=r.reimbursement_type or "general",
            total_amount=r.total_amount or Decimal("0"),
            approved_amount=r.approved_amount,
            status=r.status or "pending",
            approval_id=r.approval_id,
            approved_date=str(r.approved_date) if r.approved_date else None,
            rejection_reason=r.rejection_reason,
            verified_by=r.verified_by,
            verified_date=str(r.verified_date) if r.verified_date else None,
            payment_status=r.payment_status,
            payment_date=str(r.payment_date) if r.payment_date else None,
            payment_method=r.payment_method,
            payment_reference=r.payment_reference,
            paid_amount=r.paid_amount,
            remark=r.remark,
            bill_image_path=r.bill_image_path,
            employee_name=names.get("employee_name"),
            branch_name=names.get("branch_name"),
            items=items,
            created_at=str(r.created_at) if r.created_at else None,
            updated_at=str(r.updated_at) if r.updated_at else None,
        )

    def _locked(self, reimbursement_id: int, actor: User) -> Reimbursements:
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).with_for_update().first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        _branch_access(actor, r.branch_code)
        return r

    def _claimant_user_id(self, r: Reimbursements) -> Optional[int]:
        emp = self.db.query(Employee).filter(Employee.employee_id == r.employee_id).first()
        return emp.user_id if emp else None

    def create_reimbursement(self, data: schemas.ReimbursementCreate, actor: User) -> schemas.Reimbursement:
        """Create a reimbursement with line items and auto-create the approval request."""
        employee = _live_employee(self.db, data.employee_id)
        branch = self.db.query(Branch).filter(Branch.branch_code == data.branch_code).first()
        if not branch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Branch '{data.branch_code}' not found")
        if not branch.active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Branch '{data.branch_code}' is inactive")
        _branch_access(actor, data.branch_code)
        _branch_access(actor, employee.branch_code)   # the claimant's own branch too, not just the one on the claim
        if employee.date_of_joining and data.claim_date < employee.date_of_joining:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The claim date is before the employee joined")

        total_amount = sum((item.amount for item in data.items), Decimal("0"))
        reimbursement_no = self._generate_reimbursement_no()

        db_reimbursement = Reimbursements(
            reimbursement_no=reimbursement_no, employee_id=data.employee_id, branch_code=data.branch_code, claim_date=data.claim_date,
            description=data.description, reimbursement_type=data.reimbursement_type, total_amount=total_amount,
            status=DocumentStatus.PENDING, remark=data.remark,
        )
        self.db.add(db_reimbursement)
        self.db.flush()
        for item_data in data.items:
            self.db.add(ReimbursementItem(
                reimbursement_id=db_reimbursement.id, expense_type=item_data.expense_type, item_description=item_data.item_description,
                amount=item_data.amount, receipt_date=item_data.receipt_date, receipt_number=item_data.receipt_number,
            ))
        approval_record = approval_service.create_approval_request(
            db=self.db, approval_type=ApprovalType.REIMBURSEMENT, reference_id=db_reimbursement.id, reference_no=reimbursement_no,
            branch_code=data.branch_code, requested_by=actor.id, remarks=f"Reimbursement claim pending approval - {reimbursement_no}",
            approval_group="reimbursement_approvers",
        )
        db_reimbursement.approval_id = approval_record.id
        _audit(self.db, actor.id, "create", "reimbursement", db_reimbursement.id, no=reimbursement_no, total=str(total_amount))
        self.db.commit()
        self.db.refresh(db_reimbursement)
        return self._to_response(db_reimbursement)

    def get_reimbursement(self, reimbursement_id: int, actor: User) -> schemas.Reimbursement:
        reimbursement = self.db.query(Reimbursements).options(
            joinedload(Reimbursements.items), joinedload(Reimbursements.branch),
        ).filter(Reimbursements.id == reimbursement_id).first()
        if not reimbursement:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        _branch_access(actor, reimbursement.branch_code)
        return self._to_response(reimbursement)

    def list_reimbursements(self, filters: schemas.ReimbursementListFilter, allowed_branches: Optional[List[str]] = None) -> List[schemas.Reimbursement]:
        query = self.db.query(Reimbursements).options(joinedload(Reimbursements.items), joinedload(Reimbursements.branch))
        if allowed_branches is not None:
            if filters.branch_code and filters.branch_code not in allowed_branches:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {filters.branch_code}")
            query = query.filter(Reimbursements.branch_code.in_(allowed_branches))
        if filters.employee_id:
            query = query.filter(Reimbursements.employee_id == filters.employee_id)
        if filters.branch_code:
            query = query.filter(Reimbursements.branch_code == filters.branch_code)
        if filters.status:
            query = query.filter(Reimbursements.status == filters.status)
        if filters.date_from:
            query = query.filter(Reimbursements.claim_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(Reimbursements.claim_date <= filters.date_to)
        results = query.order_by(Reimbursements.id.desc()).offset(filters.skip).limit(filters.limit).all()
        return [self._to_response(r) for r in results]

    def update_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementUpdate, actor: User) -> schemas.Reimbursement:
        r = self._locked(reimbursement_id, actor)
        if r.status not in ("pending",):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot edit reimbursement with status '{r.status}'")
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(r, key, value)
        r.updated_by = actor.id
        _audit(self.db, actor.id, "update", "reimbursement", r.id)
        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def _close_approval(self, r: Reimbursements, new_status, user_id: int, remark: str) -> None:
        if r.approval_id:
            from app.modules.common.models import Approvals
            approval = self.db.query(Approvals).filter(Approvals.id == r.approval_id).with_for_update().first()
            if approval and approval.status == ApprovalStatus.PENDING:
                approval.status = new_status
                approval.status_changed_by = user_id
                approval.remark = remark

    def approve_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementApprove, actor: User) -> schemas.Reimbursement:
        """Approve or partially approve a reimbursement (never above the claimed amount)."""
        r = self._locked(reimbursement_id, actor)
        if r.status != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot approve. Current status: {r.status}")
        if not actor.is_superuser:
            if r.created_by == actor.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot approve a claim you created")
            if self._claimant_user_id(r) == actor.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot approve your own reimbursement claim")
        approved_amount = data.approved_amount if data.approved_amount is not None else r.total_amount
        if approved_amount > r.total_amount:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"The approved amount cannot be more than the claimed {r.total_amount}")
        r.status = "partial_approved" if approved_amount < r.total_amount else "approved"
        r.approved_amount = approved_amount
        r.approved_date = tz.now()
        if data.remarks:
            r.remark = data.remarks
        self._close_approval(r, ApprovalStatus.APPROVED, actor.id, data.remarks or f"Approved by user {actor.id}")
        _audit(self.db, actor.id, "approve", "reimbursement", r.id, approved=str(approved_amount))
        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def reject_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementReject, actor: User) -> schemas.Reimbursement:
        r = self._locked(reimbursement_id, actor)
        if r.status != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot reject. Current status: {r.status}")
        r.status = DocumentStatus.REJECTED
        r.rejection_reason = data.rejection_reason
        self._close_approval(r, ApprovalStatus.REJECTED, actor.id, data.rejection_reason)
        _audit(self.db, actor.id, "reject", "reimbursement", r.id, reason=data.rejection_reason)
        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def verify_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementVerify, actor: User) -> schemas.Reimbursement:
        """Finance verification of an approved reimbursement (by someone other than the approver)."""
        r = self._locked(reimbursement_id, actor)
        if r.status not in ("approved", "partial_approved"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot verify. Current status: {r.status}")
        if not actor.is_superuser and r.approval_id:
            from app.modules.common.models import Approvals
            approver = self.db.query(Approvals.status_changed_by).filter(Approvals.id == r.approval_id).scalar()
            if approver == actor.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The approver cannot also verify the claim")
        r.status = "verified"
        r.verified_by = actor.id
        r.verified_date = tz.now()
        if data.remarks:
            r.remark = data.remarks
        _audit(self.db, actor.id, "verify", "reimbursement", r.id)
        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def process_payment(self, reimbursement_id: int, data: schemas.ReimbursementPayment, actor: User) -> schemas.Reimbursement:
        """Pay a verified reimbursement: the amount must equal the approved amount."""
        r = self._locked(reimbursement_id, actor)
        if r.status != "verified":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot process payment. Current status: {r.status}")
        due = r.approved_amount if r.approved_amount is not None else r.total_amount
        if data.paid_amount != due:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"The payment must be exactly the approved amount {due}")
        if not actor.is_superuser and self._claimant_user_id(r) == actor.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot pay your own reimbursement claim")
        r.payment_method = data.payment_method
        r.payment_reference = data.payment_reference
        r.paid_amount = data.paid_amount
        r.payment_date = tz.now()
        r.payment_status = PaymentStatus.PAID
        r.status = DocumentStatus.COMPLETED
        if data.remarks:
            r.remark = data.remarks
        _audit(self.db, actor.id, "pay", "reimbursement", r.id, amount=str(data.paid_amount), method=data.payment_method)
        self.db.commit()
        self.db.refresh(r)

        # GL auto-posting for the payment (failure is recorded and retried, it does not undo the payment)
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            PurchaseExpensePayrollGL(self.db).post_reimbursement_payment_to_gl(r, user_id=actor.id)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for reimbursement {r.reimbursement_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db, reference_type="Reimbursement", reference_id=r.id, reference_no=r.reimbursement_no, transaction_type="Payment",
                description=f"Reimbursement GL commit failed ({r.reimbursement_no})", error=gl_err, user_id=actor.id,
            )
        return self._to_response(r)

    def delete_reimbursement(self, reimbursement_id: int, actor: User):
        r = self._locked(reimbursement_id, actor)
        if r.status not in ("pending", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot delete reimbursement with status '{r.status}'")
        if r.status == "pending":
            self._close_approval(r, ApprovalStatus.CANCELLED, actor.id, "Claim deleted")
        _audit(self.db, actor.id, "delete", "reimbursement", r.id, no=r.reimbursement_no)
        self.db.delete(r)
        self.db.commit()


# Payroll Service
class PayrollService:
    # Sri Lankan statutory rates
    EPF_EMPLOYEE_RATE = Decimal("0.08")   # 8%
    EPF_EMPLOYER_RATE = Decimal("0.12")   # 12%
    # ETF is an employer-only contribution in Sri Lanka (no employee portion).
    ETF_EMPLOYER_RATE = Decimal("0.03")   # 3%

    # Sri Lankan APIT (Advance Personal Income Tax), IRD Table 01 from 1 Apr 2025.
    # The IRD bands are annual; monthly APIT is the annual tax on 12x the month's
    # pay, divided by 12 (whole-rupee monthly bands drift by cents).
    APIT_BRACKETS = [
        (Decimal("1800000"), Decimal("0")),      # relief: Rs 150,000 a month
        (Decimal("1000000"), Decimal("0.06")),
        (Decimal("500000"),  Decimal("0.18")),
        (Decimal("500000"),  Decimal("0.24")),
        (Decimal("500000"),  Decimal("0.30")),
    ]
    APIT_TOP_RATE = Decimal("0.36")              # above Rs 4.3m a year (358,333.33 a month)

    def __init__(self, db: Session, branches: Optional[List[str]] = None):
        self.db = db
        # Batches are company-wide, but a branch-scoped user only sees the records of their branches' employees.
        self.branches = branches

    def _resolve_employee_name(self, employee_id: str) -> str:
        employee = self.db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if employee and employee.user:
            return f"{employee.user.first_name} {employee.user.last_name}".strip()
        return employee_id

    def _resolve_user_name(self, user_id: Optional[int]) -> Optional[str]:
        if not user_id:
            return None
        from app.auth.models import User
        user = self.db.query(User).filter(User.id == user_id).first()
        if user:
            return f"{user.first_name} {user.last_name}".strip()
        return str(user_id)

    def _calculate_apit(self, gross_salary: Decimal) -> Decimal:
        """Calculate APIT (Advance Personal Income Tax) using Sri Lankan 2025/2026 progressive brackets."""
        tax = Decimal("0")
        remaining = Decimal(str(gross_salary)) * 12
        for bracket_size, rate in self.APIT_BRACKETS:
            if remaining <= 0:
                break
            taxable = min(remaining, bracket_size)
            tax += taxable * rate
            remaining -= bracket_size
        if remaining > 0:
            tax += remaining * self.APIT_TOP_RATE
        return (tax / 12).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def _payroll_to_response(self, p: EmployeePayroll, name: Optional[str] = None) -> schemas.EmployeePayrollResponse:
        return schemas.EmployeePayrollResponse(
            id=p.id,
            employee_id=p.employee_id,
            basic_salary=p.basic_salary or Decimal("0"),
            add_1_name=p.add_1_name,
            add_1_value=p.add_1_value,
            add_2_name=p.add_2_name,
            add_2_value=p.add_2_value,
            add_sales_commision=p.add_sales_commision,
            add_salary_advance=p.add_salary_advance,
            add_reimbursements=p.add_reimbursements,
            add_bonus=p.add_bonus,
            less_epf_employee=p.less_epf_employee,
            less_etf_employee=p.less_etf_employee,
            less_stamp_duty=p.less_stamp_duty,
            less_late_deductions=p.less_late_deductions,
            less_salary_advance_repayment=p.less_salary_advance_repayment,
            less_loan_repayment=p.less_loan_repayment,
            less_other_deductions=p.less_other_deductions,
            less_apit=p.less_apit,
            epf_employer=p.epf_employer,
            etf_employer=p.etf_employer,
            payroll_month=p.payroll_month,
            payroll_year=p.payroll_year,
            payroll_batch_no=p.payroll_batch_no,
            gross_salary=p.gross_salary,
            total_deductions=p.total_deductions,
            net_salary=p.net_salary,
            total_employer_cost=p.total_employer_cost,
            status=p.status,
            approved_by=p.approved_by,
            approved_date=str(p.approved_date) if p.approved_date else None,
            payment_status=p.payment_status,
            payment_date=str(p.payment_date) if p.payment_date else None,
            payment_reference=p.payment_reference,
            payment_method=p.payment_method,
            statutory_payment_status=p.statutory_payment_status,
            statutory_payment_date=str(p.statutory_payment_date) if p.statutory_payment_date else None,
            statutory_payment_reference=p.statutory_payment_reference,
            created_at=str(p.created_at) if p.created_at else None,
            created_by=p.created_by,
            employee_name=name if name is not None else self._resolve_employee_name(p.employee_id),
            allowance_lines=p.allowance_lines,
            allowances_total=sum((Decimal(str(a.get("amount") or 0)) for a in (p.allowance_lines or [])), Decimal("0"))
            + Decimal(p.add_1_value or 0) + Decimal(p.add_2_value or 0),
            ot_hours=p.ot_hours, add_overtime=p.add_overtime, nopay_days=p.nopay_days, less_nopay=p.less_nopay,
            epf_earnings=p.epf_earnings, taxable_income=p.taxable_income,
        )

    def _batch_to_response(self, b: PayrollBatch, include_records: bool = False) -> schemas.PayrollBatchResponse:
        records = None
        if include_records:
            payrolls = scope(self.db.query(EmployeePayroll).filter(
                EmployeePayroll.payroll_batch_no == b.batch_no
            ), EmployeePayroll.employee_id, self.branches).all()
            names = employee_names(self.db, [p.employee_id for p in payrolls])   # one query, not two per record
            records = [self._payroll_to_response(p, names.get(p.employee_id, p.employee_id)) for p in payrolls]
        return schemas.PayrollBatchResponse(
            id=b.id,
            batch_no=b.batch_no,
            payroll_month=b.payroll_month,
            payroll_year=b.payroll_year,
            description=b.description,
            status=b.status,
            total_employees=b.total_employees,
            total_gross_salary=b.total_gross_salary,
            total_deductions=b.total_deductions,
            total_net_salary=b.total_net_salary,
            total_employer_epf=b.total_employer_epf,
            total_employer_etf=b.total_employer_etf,
            total_employer_cost=b.total_employer_cost,
            total_apit=b.total_apit,
            created_by=b.created_by,
            created_at=str(b.created_at) if b.created_at else None,
            approved_by=b.approved_by,
            approved_date=str(b.approved_date) if b.approved_date else None,
            salary_payment_date=str(b.salary_payment_date) if b.salary_payment_date else None,
            salary_payment_reference=b.salary_payment_reference,
            statutory_payment_date=str(b.statutory_payment_date) if b.statutory_payment_date else None,
            statutory_payment_reference=b.statutory_payment_reference,
            completed_date=str(b.completed_date) if b.completed_date else None,
            created_by_name=self._resolve_user_name(b.created_by),
            approved_by_name=self._resolve_user_name(b.approved_by),
            payroll_records=records,
        )

    def _generate_batch_no(self, month: int, year: int) -> str:
        """Generate unique payroll batch number: PAY-YYYY-MM-NNN"""
        prefix = f"PAY-{year}-{month:02d}-"
        # Advisory lock to prevent race conditions on sequence generation
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = self.db.query(PayrollBatch).filter(
            PayrollBatch.batch_no.like(f"{prefix}%")
        ).order_by(PayrollBatch.id.desc()).first()
        if last:
            last_seq = int(last.batch_no.split("-")[-1])
            seq = last_seq + 1
        else:
            seq = 1
        return f"{prefix}{seq:03d}"

    def _calculate_payroll(
        self,
        salary,
        deductions: List[SalaryDeductions],
        sales_commission: Decimal = Decimal("0"),
        factor: Decimal = Decimal("1"),
        nopay_days: Decimal = Decimal("0"),
        days_in_month: int = 30,
        epf_applicable: bool = True,
        settings=None,
        ot_minutes: int = 0,
        late_minutes: int = 0,
        ot_eligible: bool = True,
        loan_recovery: Decimal = Decimal("0"),
    ) -> Dict[str, Any]:
        """Payroll for one employee, Sri Lankan rules:

        - salary (basic + allowance lines) is pro-rated when the employee joined or left during the month;
        - EPF (8% / 12%) and ETF (3%) are on "total earnings" = basic + EPF-liable allowances, less no-pay
          and late cuts; overtime and commission are not EPF earnings;
        - overtime = hours x (basic + EPF-liable allowances) / divisor x multiplier (Shop & Office: 1.5 / 240);
        - APIT is on gross pay less non-taxable allowances, no-pay and late cuts;
        - stamp duty only when the pay is above the threshold.
        Every amount is rounded to cents. Rates come from payroll settings."""
        from .sl_payroll import allowance_list, payroll_settings
        settings = settings or payroll_settings(self.db)
        q2 = lambda v: Decimal(v).quantize(Decimal("0.01"))
        pct = lambda v: Decimal(v) / Decimal("100")
        z = Decimal("0")

        basic_full = Decimal(salary.basic_salary or 0)
        lines_full = allowance_list(salary)
        basic = q2(basic_full * factor)
        lines = [{"name": a["name"], "amount": q2(a["amount"] * factor), "epf_liable": a["epf_liable"], "taxable": a["taxable"]}
                 for a in lines_full]
        allowances = sum((a["amount"] for a in lines), z)
        liable = sum((a["amount"] for a in lines if a["epf_liable"]), z)
        non_taxable = sum((a["amount"] for a in lines if not a["taxable"]), z)
        sales_commission = q2(sales_commission)

        # Monthly earnings for rates: full month, basic + EPF-liable allowances
        rate_base = basic_full + sum((a["amount"] for a in lines_full if a["epf_liable"]), z)
        hourly = rate_base / Decimal(settings.ot_divisor or 240)
        ot_hours = q2(Decimal(ot_minutes) / 60) if (settings.pay_overtime and ot_eligible and ot_minutes > 0) else z
        overtime = q2(hourly * ot_hours * Decimal(settings.ot_multiplier)) if ot_hours else z
        nopay = q2(rate_base / Decimal(days_in_month) * nopay_days) if nopay_days > 0 else z
        late_auto = q2(hourly * Decimal(late_minutes) / 60) if (settings.deduct_late and late_minutes > 0) else z

        gross_salary = basic + allowances + sales_commission + overtime
        epf_earnings = max(z, basic + liable - nopay - late_auto)
        taxable = max(z, gross_salary - non_taxable - nopay - late_auto)

        epf_employee = q2(epf_earnings * pct(settings.epf_employee_rate)) if epf_applicable else z
        etf_employee = z  # ETF is employer-only in Sri Lanka
        epf_employer = q2(epf_earnings * pct(settings.epf_employer_rate)) if epf_applicable else z
        etf_employer = q2(epf_earnings * pct(settings.etf_rate)) if epf_applicable else z
        stamp_duty = q2(settings.stamp_duty_amount) if (gross_salary - nopay) > Decimal(settings.stamp_duty_threshold) else z
        apit = self._calculate_apit(taxable)

        late_deductions = late_auto
        salary_advance_repayment = z
        loan_repayment = q2(loan_recovery)
        other_deductions = z
        for d in deductions:
            late_deductions += d.late_deductions or z
            salary_advance_repayment += d.salary_advance_repayment or z
            loan_repayment += d.loan_repayment or z
            if d.other_deductions is not None:
                other_deductions += d.other_deductions
            elif not any([d.late_deductions, d.salary_advance_repayment, d.loan_repayment]):
                # No component breakdown: the headline amount is a general deduction.
                other_deductions += d.amount or z

        total_deductions = (epf_employee + etf_employee + stamp_duty + apit + late_deductions + salary_advance_repayment
                            + loan_repayment + other_deductions + nopay)
        net_salary = gross_salary - total_deductions
        total_employer_cost = gross_salary - nopay - late_auto + epf_employer + etf_employer

        return {
            "basic_salary": basic, "add_1_name": None, "add_1_value": None, "add_2_name": None, "add_2_value": None,
            "allowance_lines": [{**a, "amount": str(a["amount"])} for a in lines], "add_sales_commision": sales_commission,
            "ot_hours": ot_hours, "add_overtime": overtime, "nopay_days": q2(nopay_days), "less_nopay": nopay,
            "epf_earnings": epf_earnings, "taxable_income": taxable,
            "gross_salary": gross_salary, "less_epf_employee": epf_employee, "less_etf_employee": etf_employee,
            "less_stamp_duty": stamp_duty, "less_late_deductions": late_deductions,
            "less_salary_advance_repayment": salary_advance_repayment, "less_loan_repayment": loan_repayment,
            "less_other_deductions": other_deductions, "less_apit": apit, "total_deductions": total_deductions,
            "net_salary": net_salary, "epf_employer": epf_employer, "etf_employer": etf_employer,
            "total_employer_cost": total_employer_cost,
        }

    def _nopay_days(self, emps: List[Employee], start: date, end: date) -> Dict[str, Decimal]:
        """Approved unpaid leave inside [start, end], in working days, per employee code (one query for all)."""
        from app.modules.attendance.models import Leaves
        from app.modules.hr_core.models import HRLeaveType
        from app.modules.hr_core.service import LeavePolicyService, is_half_day

        unpaid = {t.code.lower(): t for t in self.db.query(HRLeaveType).filter(HRLeaveType.is_paid.is_(False)).all()}
        if not unpaid or not emps:
            return {}
        by_code = {e.employee_id: e for e in emps}
        rows = self.db.query(Leaves).filter(
            Leaves.employee_id.in_(list(by_code)), Leaves.status == "approved", Leaves.from_date <= end, Leaves.to_date >= start,
            func.lower(Leaves.leave_type).in_(list(unpaid)),
        ).all()
        svc, totals = LeavePolicyService(self.db), {}
        for lv in rows:
            a, b = max(lv.from_date, start), min(lv.to_date, end)
            half = is_half_day(lv.leave_time) and lv.from_date == lv.to_date
            days = Decimal(str(svc.count_days(by_code[lv.employee_id], unpaid[(lv.leave_type or "").lower()], a, b, half)))
            totals[lv.employee_id] = totals.get(lv.employee_id, Decimal("0")) + days
        return totals

    # --- Manual (ad-hoc) payroll records ---
    @staticmethod
    def _manual_values(payroll: schemas.EmployeePayrollCreate) -> Dict[str, Any]:
        z = Decimal("0")
        v = lambda x: x or z
        gross = (payroll.basic_salary + v(payroll.add_1_value) + v(payroll.add_2_value) + v(payroll.add_sales_commision)
                 + v(payroll.add_salary_advance) + v(payroll.add_reimbursements) + v(payroll.add_bonus))
        less = (v(payroll.less_epf_employee) + v(payroll.less_etf_employee) + v(payroll.less_stamp_duty) + v(payroll.less_late_deductions)
                + v(payroll.less_salary_advance_repayment) + v(payroll.less_loan_repayment) + v(payroll.less_other_deductions) + v(payroll.less_apit))
        data = payroll.model_dump()
        data.update(gross_salary=gross, total_deductions=less, net_salary=gross - less,
                    total_employer_cost=gross + v(payroll.epf_employer) + v(payroll.etf_employer))
        return data

    def _check_manual_period(self, employee_id: str, month: int, year: int, exclude_id: Optional[int] = None) -> None:
        today = tz.today()
        if (year, month) > (today.year, today.month):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payroll cannot be created for a future month")
        q = self.db.query(EmployeePayroll.id).filter(
            EmployeePayroll.employee_id == employee_id, EmployeePayroll.payroll_month == month, EmployeePayroll.payroll_year == year,
            func.coalesce(EmployeePayroll.status, "draft") != "cancelled",
        )
        if exclude_id:
            q = q.filter(EmployeePayroll.id != exclude_id)
        if q.first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{employee_id} already has a payroll record for {year}-{month:02d}")

    def create_payroll(self, payroll: schemas.EmployeePayrollCreate, user_id: int = 0) -> schemas.EmployeePayrollResponse:
        _live_employee(self.db, payroll.employee_id)
        # The run lock too, so a manual record and a payroll run for the same month cannot both slip in
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"payroll-run-{payroll.payroll_year}-{payroll.payroll_month:02d}"})
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"payroll-{payroll.employee_id}-{payroll.payroll_year}-{payroll.payroll_month}"})
        self._check_manual_period(payroll.employee_id, payroll.payroll_month, payroll.payroll_year)
        db_payroll = EmployeePayroll(**self._manual_values(payroll), status="draft", created_by=user_id)
        db_payroll.created_at = tz.now()
        self.db.add(db_payroll)
        self.db.flush()
        _audit(self.db, user_id, "create", "payroll", db_payroll.id, employee=payroll.employee_id, net=str(db_payroll.net_salary))
        self.db.commit()
        self.db.refresh(db_payroll)
        return self._payroll_to_response(db_payroll)

    def get_payroll(self, payroll_id: int) -> schemas.EmployeePayrollResponse:
        payroll = self.db.query(EmployeePayroll).filter(EmployeePayroll.id == payroll_id).first()
        if not payroll:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found")
        return self._payroll_to_response(payroll)
    
    def list_payrolls(self, filters: schemas.HRListFilter, branches: Optional[List[str]] = None) -> List[schemas.EmployeePayrollResponse]:
        query = scope(self.db.query(EmployeePayroll), EmployeePayroll.employee_id, branches)
        if filters.employee_id:
            query = query.filter(EmployeePayroll.employee_id == filters.employee_id)
        results = query.order_by(EmployeePayroll.id.desc()).offset(filters.skip).limit(filters.limit).all()
        return [self._payroll_to_response(p) for p in results]
    
    def _editable_record(self, payroll_id: int) -> EmployeePayroll:
        row = self.db.query(EmployeePayroll).filter(EmployeePayroll.id == payroll_id).with_for_update().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found")
        if row.payroll_batch_no:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This record belongs to payroll batch {row.payroll_batch_no}; change it through the batch")
        if (row.status or "draft") != "draft":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A {row.status} payroll record cannot be changed")
        return row

    def update_payroll(self, payroll_id: int, payroll: schemas.EmployeePayrollCreate, user_id: int = 0) -> schemas.EmployeePayrollResponse:
        db_payroll = self._editable_record(payroll_id)
        if payroll.employee_id != db_payroll.employee_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A payroll record cannot be moved to another employee")
        self._check_manual_period(payroll.employee_id, payroll.payroll_month, payroll.payroll_year, exclude_id=payroll_id)
        for key, value in self._manual_values(payroll).items():
            setattr(db_payroll, key, value)
        db_payroll.updated_by = user_id
        _audit(self.db, user_id, "update", "payroll", db_payroll.id, net=str(db_payroll.net_salary))
        self.db.commit()
        self.db.refresh(db_payroll)
        return self._payroll_to_response(db_payroll)

    def delete_payroll(self, payroll_id: int, user_id: int = 0):
        db_payroll = self._editable_record(payroll_id)
        _audit(self.db, user_id, "delete", "payroll", db_payroll.id, employee=db_payroll.employee_id)
        self.db.delete(db_payroll)
        self.db.commit()

    # --- Payroll Workflow ---
    def trigger_payroll_run(self, data: schemas.PayrollRunRequest, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 3: Trigger payroll processing - generate payroll records for all employees with salary profiles."""
        month, year = data.payroll_month, data.payroll_year
        today = tz.today()
        if (year, month) > (today.year, today.month):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payroll cannot be run for a future month")
        if (today.year - year) * 12 + (today.month - month) > 24:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payroll can only be run for the last 24 months")

        # Serialise concurrent runs for the same period (lock is released at
        # transaction end) so the duplicate-batch check below is race-free.
        self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"payroll-run-{year}-{month:02d}"},
        )

        # Check if batch already exists for this period
        existing = self.db.query(PayrollBatch).filter(
            PayrollBatch.payroll_month == month,
            PayrollBatch.payroll_year == year,
            PayrollBatch.status.notin_(["cancelled"])
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll batch already exists for {year}-{month:02d}: {existing.batch_no} (status: {existing.status})"
            )

        # Salary profiles of employees who are in service during this month (a joiner or leaver is pro-rated)
        import calendar
        period_start = date(year, month, 1)
        days_in_month = calendar.monthrange(year, month)[1]
        period_end = date(year, month, days_in_month)
        eligible = []
        for profile, emp in (
            self.db.query(EmployeeSalaryProfile, Employee).join(Employee, Employee.employee_id == EmployeeSalaryProfile.employee_id).all()
        ):
            st = emp.status or "active"
            first = max(period_start, emp.date_of_joining) if emp.date_of_joining else period_start
            if st in LEFT_STATUSES:
                last = emp.last_working_date
                if not last:
                    continue                     # left with no last working day: nothing to pay
            else:
                last = emp.last_working_date if (st == "notice_period" and emp.last_working_date) else None
            last = min(period_end, last) if last else period_end
            if last < first:
                continue                         # not employed during this month
            worked = (last - first).days + 1
            eligible.append((profile, emp, Decimal(worked) / Decimal(days_in_month)))
        if not eligible:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="No employee with a salary profile is in service for this month. Set up salary profiles first.")

        # An employee already paid by a manual payroll record for this month is skipped (same rule as _check_manual_period)
        manual = {code for (code,) in self.db.query(EmployeePayroll.employee_id).filter(
            EmployeePayroll.payroll_month == month, EmployeePayroll.payroll_year == year,
            func.coalesce(EmployeePayroll.status, "draft") != "cancelled",
            EmployeePayroll.employee_id.in_([e[0].employee_id for e in eligible]),
        )}
        if manual:
            eligible = [e for e in eligible if e[0].employee_id not in manual]
            if not eligible:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail=f"Every employee in service already has a payroll record for {year}-{month:02d}")
        description = data.description or f"Payroll for {year}-{month:02d}"
        if manual:
            description = f"{description}\n[Skipped - already has a manual payroll record: {', '.join(sorted(manual))}]"[:2000]

        # Create the batch
        batch_no = self._generate_batch_no(month, year)
        batch = PayrollBatch(
            batch_no=batch_no,
            payroll_month=month,
            payroll_year=year,
            description=description,
            status="draft",
            created_by=user_id,
            created_at=tz.now(),
        )
        self.db.add(batch)
        self.db.flush()

        profiles = [e[0] for e in eligible]
        profile_ctx = {e[0].employee_id: (e[1], e[2]) for e in eligible}

        period_str = f"{year}-{month:02d}"
        total_gross = Decimal("0")
        total_deductions = Decimal("0")
        total_net = Decimal("0")
        total_employer_epf = Decimal("0")
        total_employer_etf = Decimal("0")
        total_employer_cost = Decimal("0")
        total_apit = Decimal("0")
        count = 0

        # Get all approved sales commissions for this period (keyed by employee_id)
        approved_commissions = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.fiscal_year == year,
            SalesOfficerMonthlyCommission.fiscal_month == month,
            SalesOfficerMonthlyCommission.status == "approved",
        ).all()
        # Build map: employee_id (int) -> total commission amount
        commission_map: Dict[int, Decimal] = {}
        for comm in approved_commissions:
            if comm.employee_id not in commission_map:
                commission_map[comm.employee_id] = Decimal("0")
            commission_map[comm.employee_id] += comm.individual_commission_amount or Decimal("0")

        # Resolve all employees' internal ids in one query instead of one-per-profile.
        employee_id_map: Dict[str, int] = {
            emp_id: internal_id
            for internal_id, emp_id in self.db.query(Employee.id, Employee.employee_id).filter(
                Employee.employee_id.in_([profile.employee_id for profile in profiles])
            ).all()
        }

        # Load all deductions for those employees in one query instead of one-per-profile.
        all_deductions = self.db.query(SalaryDeductions).filter(
            SalaryDeductions.employee_id.in_(employee_id_map.values())
        ).all()
        deductions_by_employee: Dict[int, list] = {}
        for d in all_deductions:
            deductions_by_employee.setdefault(d.employee_id, []).append(d)

        from .sl_payroll import attendance_minutes, payroll_settings, salaries_for_period
        from . import loans as loan_rules
        from .models import HRLoanRecovery
        from app.modules.hr_core.models import HREmploymentType
        settings = payroll_settings(self.db)
        att = attendance_minutes(self.db, [p.employee_id for p in profiles], period_start, period_end)
        # Everything looked up per employee is loaded up front, so a run costs a fixed number of queries.
        salaries = salaries_for_period(self.db, profiles, period_end)
        nopay = self._nopay_days([e[1] for e in eligible], period_start, period_end)

        def _leaving(emp: Employee) -> bool:
            return bool(emp.last_working_date and emp.last_working_date <= period_end
                        and (emp.status in LEFT_STATUSES or emp.status == "notice_period"))

        dues = loan_rules.dues_for_period(self.db, {e[1].id: _leaving(e[1]) for e in eligible}, period_str)
        pending_recoveries = []   # (payroll record, loan, amount, balance before), written after the loop
        for et in {e[1].employment_type_id for e in eligible} - {None}:
            self.db.get(HREmploymentType, et)   # warm the identity map: emp.employment_type then needs no query

        for profile in profiles:
            # Get employee's internal id
            emp_internal_id = employee_id_map.get(profile.employee_id)

            # Get deductions for this employee and period
            deductions = deductions_by_employee.get(emp_internal_id, [])
            # Filter period-specific deductions if deduction_period matches
            period_deductions = [d for d in deductions if not d.deduction_period or d.deduction_period == period_str]

            # Stamp open-ended deductions with this period so each one is consumed
            # exactly once instead of being re-applied on every future payroll run.
            for d in period_deductions:
                if not d.deduction_period:
                    d.deduction_period = period_str

            # Get approved sales commission for this employee
            sales_commission = commission_map.get(emp_internal_id, Decimal("0"))

            emp_obj, factor = profile_ctx[profile.employee_id]
            et = emp_obj.employment_type
            ot_mins, late_mins = att.get(profile.employee_id, (0, 0))
            args = dict(
                salary=salaries[profile.employee_id], deductions=period_deductions,
                sales_commission=sales_commission, factor=factor,
                nopay_days=nopay.get(profile.employee_id, Decimal("0")), days_in_month=days_in_month,
                epf_applicable=(et.epf_etf_applicable if et is not None else True), settings=settings,
                ot_minutes=ot_mins, late_minutes=late_mins, ot_eligible=emp_obj.overtime_eligible is not False,
            )
            calc = self._calculate_payroll(**args)

            # Loan / advance instalments, never more than the pay left after everything else;
            # a leaver's whole balance is recovered in the last month.
            room = max(Decimal("0"), calc["net_salary"])
            recoveries = []
            for loan, due, balance in dues.get(emp_obj.id, []):
                take = min(due, room)
                if take <= 0:
                    break
                recoveries.append((loan, take, balance))
                room -= take
            if recoveries:
                calc = self._calculate_payroll(**args, loan_recovery=sum((t for _l, t, _b in recoveries), Decimal("0")))

            payroll_record = EmployeePayroll(
                employee_id=profile.employee_id,
                payroll_month=month,
                payroll_year=year,
                payroll_batch_no=batch_no,
                **calc,
                status="draft",
                created_at=tz.now(),
                created_by=user_id,
            )
            self.db.add(payroll_record)
            pending_recoveries += [(payroll_record, loan, take, balance) for loan, take, balance in recoveries]

            total_gross += calc["gross_salary"]
            total_deductions += calc["total_deductions"]
            total_net += calc["net_salary"]
            total_employer_epf += calc["epf_employer"]
            total_employer_etf += calc["etf_employer"]
            total_employer_cost += calc["total_employer_cost"]
            total_apit += calc["less_apit"]
            count += 1

        if pending_recoveries:
            self.db.flush()   # the payroll records get their ids, in one batch
            for record, loan, take, balance in pending_recoveries:
                self.db.add(HRLoanRecovery(loan_id=loan.id, period=period_str, amount=take, payroll_id=record.id,
                                           created_by=user_id, updated_by=user_id))
                loan.status = "settled" if balance - take <= 0 else "active"   # same rule as loans.refresh_status

        # Update batch totals
        batch.total_employees = count
        batch.total_gross_salary = total_gross
        batch.total_deductions = total_deductions
        batch.total_net_salary = total_net
        batch.total_employer_epf = total_employer_epf
        batch.total_employer_etf = total_employer_etf
        batch.total_employer_cost = total_employer_cost
        batch.total_apit = total_apit

        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def get_batch(self, batch_id: int) -> schemas.PayrollBatchResponse:
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        return self._batch_to_response(batch, include_records=True)

    def list_batches(self, filters: schemas.PayrollBatchListFilter) -> List[schemas.PayrollBatchResponse]:
        query = self.db.query(PayrollBatch)
        if filters.payroll_month:
            query = query.filter(PayrollBatch.payroll_month == filters.payroll_month)
        if filters.payroll_year:
            query = query.filter(PayrollBatch.payroll_year == filters.payroll_year)
        if filters.status:
            query = query.filter(PayrollBatch.status == filters.status)
        results = query.order_by(PayrollBatch.id.desc()).offset(filters.skip).limit(filters.limit).all()
        return [self._batch_to_response(b) for b in results]

    def submit_batch(self, batch_id: int, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 5: Submit batch for approval (review & verify done, move to pending_approval)."""
        # Lock the batch row to prevent concurrent state transitions
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit. Current status: {batch.status}"
            )
        batch.status = "pending_approval"
        _audit(self.db, user_id, "submit", "payroll_batch", batch.id, batch=batch.batch_no)
        # Update all payroll records
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "pending_approval"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def approve_batch(self, batch_id: int, data: schemas.PayrollBatchApprove, actor: User) -> schemas.PayrollBatchResponse:
        """Step 6: Approve payroll batch (not by the person who generated it)."""
        user_id = actor.id
        # Lock the batch row to prevent concurrent approve/reject
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "pending_approval":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve. Current status: {batch.status}"
            )
        if batch.created_by == actor.id and not actor.is_superuser:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot approve a payroll batch you generated")
        batch.status = DocumentStatus.APPROVED
        batch.approved_by = user_id
        _audit(self.db, user_id, "approve", "payroll_batch", batch.id, batch=batch.batch_no)
        batch.approved_date = tz.now()
        # Update all payroll records
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "approved", "approved_by": user_id, "approved_date": tz.now()})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def reject_batch(self, batch_id: int, data: schemas.PayrollBatchReject, user_id: int) -> schemas.PayrollBatchResponse:
        """Reject payroll batch back to draft."""
        # Lock the batch row to prevent concurrent approve/reject
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "pending_approval":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject. Current status: {batch.status}"
            )
        batch.status = "draft"
        batch.description = ((batch.description or "") + f"\n[Rejected: {data.rejection_reason}]")[:2000]
        _audit(self.db, user_id, "reject", "payroll_batch", batch.id, reason=data.rejection_reason)
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "draft"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def process_salary_payment(self, batch_id: int, data: schemas.PayrollBatchProcessPayment, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 7: Process salary payments for all employees in the batch."""
        # Lock the batch row to prevent concurrent payment processing
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "approved":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot process payment. Current status: {batch.status}"
            )
        payment_date = data.payment_date or tz.today()
        batch.status = "salary_paid"
        _audit(self.db, user_id, "pay_salary", "payroll_batch", batch.id, batch=batch.batch_no, method=data.payment_method)
        batch.salary_payment_date = payment_date
        batch.salary_payment_reference = data.payment_reference
        
        # Get all payroll records for this batch
        payroll_records = self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).all()
        
        # Update payroll records
        for pr in payroll_records:
            pr.payment_status = PaymentStatus.PAID
            pr.payment_date = payment_date
            pr.payment_reference = data.payment_reference
            pr.payment_method = data.payment_method
            pr.status = "salary_paid"
        
        # Mark approved sales commissions as paid for employees in this batch
        # paid_in_payroll_id points at the employee's own payroll record, not the batch
        for pr in payroll_records:
            internal_id = self.db.query(Employee.id).filter(Employee.employee_id == pr.employee_id).scalar()
            if internal_id is None:
                continue
            self.db.query(SalesOfficerMonthlyCommission).filter(
                SalesOfficerMonthlyCommission.fiscal_year == batch.payroll_year,
                SalesOfficerMonthlyCommission.fiscal_month == batch.payroll_month,
                SalesOfficerMonthlyCommission.employee_id == internal_id,
                SalesOfficerMonthlyCommission.status == "approved",
            ).update({"status": "paid", "paid_in_payroll_id": pr.id, "updated_at": tz.now()}, synchronize_session=False)

        self.db.commit()
        self.db.refresh(batch)
        
        # ── GL Auto-Posting: Scenario 32 – Payroll Salary Payment ─────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_payroll_batch_to_gl(batch, user_id=user_id)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for payroll batch {batch.batch_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="PayrollBatch",
                reference_id=batch.id,
                reference_no=batch.batch_no,
                transaction_type="Payroll",
                description=f"Payroll batch GL commit failed ({batch.batch_no})",
                error=gl_err,
                user_id=user_id,
            )
        # ────────────────────────────────────────────────────────────────
        
        return self._batch_to_response(batch, include_records=True)

    def process_statutory_payment(self, batch_id: int, data: schemas.PayrollBatchProcessStatutory, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 8: Process statutory payments (EPF/ETF) for the batch."""
        # Lock the batch row to prevent concurrent state transitions
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "salary_paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot process statutory. Must process salary payments first. Current status: {batch.status}"
            )
        payment_date = data.payment_date or tz.today()
        refs = []
        if data.epf_reference:
            refs.append(f"EPF: {data.epf_reference}")
        if data.etf_reference:
            refs.append(f"ETF: {data.etf_reference}")
        statutory_ref = "; ".join(refs) if refs else None

        batch.status = "statutory_paid"
        _audit(self.db, user_id, "pay_statutory", "payroll_batch", batch.id, batch=batch.batch_no)
        batch.statutory_payment_date = payment_date
        batch.statutory_payment_reference = statutory_ref
        # Update all payroll records
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({
            "statutory_payment_status": "paid",
            "statutory_payment_date": payment_date,
            "statutory_payment_reference": statutory_ref,
            "status": "statutory_paid",
        })
        self.db.commit()
        self.db.refresh(batch)
        
        # ── GL Auto-Posting: Scenario 32 – Statutory Payment ──────────
        # Statutory payment posts: Dr EPF Payable + ETF Payable / Cr Bank
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            if PurchaseExpensePayrollGL(self.db).post_statutory_payment_to_gl(batch, user_id=user_id):
                self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for statutory payment batch {batch.batch_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="StatutoryPayment",
                reference_id=batch.id,
                reference_no=batch.batch_no,
                transaction_type="Payroll",
                description=f"Statutory payment GL commit failed ({batch.batch_no})",
                error=gl_err,
                user_id=user_id,
            )
        # ────────────────────────────────────────────────────────────────
        
        return self._batch_to_response(batch, include_records=True)

    def complete_batch(self, batch_id: int, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 10: Complete the payroll cycle."""
        # Lock the batch row to prevent concurrent state transitions
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "statutory_paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot complete. Must process statutory payments first. Current status: {batch.status}"
            )
        batch.status = DocumentStatus.COMPLETED
        batch.completed_date = tz.now()
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "completed"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def cancel_batch(self, batch_id: int, user_id: int) -> schemas.PayrollBatchResponse:
        """Cancel a payroll batch (only if not yet paid)."""
        # Lock the batch row to prevent concurrent state transitions
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).with_for_update().first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status in ("salary_paid", "statutory_paid", "completed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot cancel batch with status '{batch.status}'"
            )
        batch.status = DocumentStatus.CANCELLED
        _audit(self.db, user_id, "cancel", "payroll_batch", batch.id, batch=batch.batch_no)
        from . import loans as loan_rules
        loan_rules.release_batch(self.db, [pid for (pid,) in self.db.query(EmployeePayroll.id).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no)])
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "cancelled"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch)

# Salary Profile Service
class SalaryProfileService:
    def __init__(self, db: Session):
        self.db = db

    def _resolve_employee_name(self, employee_id: str) -> Optional[str]:
        employee = self.db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if employee and employee.user:
            return f"{employee.user.first_name} {employee.user.last_name}".strip()
        return employee_id

    def _to_response(self, p: EmployeeSalaryProfile, name: Optional[str] = None) -> schemas.EmployeeSalaryProfile:
        from .sl_payroll import allowance_list
        lines = allowance_list(p)
        return schemas.EmployeeSalaryProfile(
            id=p.id,
            employee_id=p.employee_id,
            basic_salary=p.basic_salary or Decimal("0"),
            add_1_name=p.add_1_name,
            add_1_value=p.add_1_value,
            add_2_name=p.add_2_name,
            add_2_value=p.add_2_value,
            allowances=lines,
            allowances_total=sum((a["amount"] for a in lines), Decimal("0")),
            epf_earnings=(p.basic_salary or Decimal("0")) + sum((a["amount"] for a in lines if a["epf_liable"]), Decimal("0")),
            designation=p.designation,
            department=p.department,
            effective_from_date=p.effective_from_date,
            benefits=p.benefits,
            employee_name=name if name is not None else self._resolve_employee_name(p.employee_id),
        )

    @staticmethod
    def _values(profile: schemas.EmployeeSalaryProfileCreate) -> Dict[str, Any]:
        """Profile columns from the input: allowance lines replace the two legacy slots."""
        from .sl_payroll import allowances_json
        data = profile.model_dump(exclude={"allowances", "revision_reason", "revision_remarks"})
        if profile.allowances is not None:
            data["allowances"] = allowances_json(profile.allowances)
            data.update(add_1_name=None, add_1_value=None, add_2_name=None, add_2_value=None)
        return data

    def _revise(self, p: EmployeeSalaryProfile, profile: schemas.EmployeeSalaryProfileCreate, user_id: int, first: bool) -> None:
        """Keep the salary history: a new revision when pay changes (or on the same start date, a correction)."""
        from .sl_payroll import allowance_list, record_revision
        from app.modules.employees.models import SalaryRevision
        when = p.effective_from_date or tz.today()
        lines = [{"name": a["name"], "amount": str(a["amount"]), "epf_liable": a["epf_liable"], "taxable": a["taxable"]}
                 for a in allowance_list(p)]
        last = (self.db.query(SalaryRevision).filter(SalaryRevision.employee_id == p.employee_id)
                .order_by(SalaryRevision.effective_from.desc()).first())
        if last is not None and last.effective_from != when:
            same = Decimal(last.basic_salary) == Decimal(p.basic_salary) and [
                (a["name"], a["amount"], a["epf_liable"], a["taxable"]) for a in allowance_list(last)] == [
                (a["name"], a["amount"], a["epf_liable"], a["taxable"]) for a in allowance_list(p)]
            if same:
                return
        record_revision(self.db, p.employee_id, when, p.basic_salary, lines, "joining" if first and last is None else profile.revision_reason,
                        profile.revision_remarks, user_id)

    def create_profile(self, profile: schemas.EmployeeSalaryProfileCreate, user_id: int = 0) -> schemas.EmployeeSalaryProfile:
        _live_employee(self.db, profile.employee_id)
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"salary-profile-{profile.employee_id}"})
        if self.db.query(EmployeeSalaryProfile.id).filter(EmployeeSalaryProfile.employee_id == profile.employee_id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Salary profile already exists for employee '{profile.employee_id}'")
        db_profile = EmployeeSalaryProfile(**self._values(profile), created_by=user_id)
        if not db_profile.effective_from_date:
            emp = self.db.query(Employee).filter(Employee.employee_id == profile.employee_id).first()
            db_profile.effective_from_date = (emp.date_of_joining if emp else None) or tz.today()
        self.db.add(db_profile)
        self.db.flush()
        self._revise(db_profile, profile, user_id, first=True)
        _audit(self.db, user_id, "create", "salary_profile", db_profile.id, employee=profile.employee_id, basic=str(profile.basic_salary))
        self.db.commit()
        self.db.refresh(db_profile)
        return self._to_response(db_profile)

    def get_profile(self, profile_id: int) -> schemas.EmployeeSalaryProfile:
        profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.id == profile_id).first()
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        return self._to_response(profile)
    
    def get_by_employee(self, employee_id: str) -> schemas.EmployeeSalaryProfile:
        profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.employee_id == employee_id).first()
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        return self._to_response(profile)

    def list_profiles(self, branches: Optional[List[str]] = None) -> List[schemas.EmployeeSalaryProfile]:
        profiles = (scope(self.db.query(EmployeeSalaryProfile), EmployeeSalaryProfile.employee_id, branches)
                    .order_by(EmployeeSalaryProfile.id.desc()).all())
        names = employee_names(self.db, [p.employee_id for p in profiles])
        return [self._to_response(p, names.get(p.employee_id, p.employee_id)) for p in profiles]
    
    def update_profile(self, profile_id: int, profile: schemas.EmployeeSalaryProfileCreate, user_id: int = 0) -> schemas.EmployeeSalaryProfile:
        db_profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.id == profile_id).with_for_update().first()
        if not db_profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        if profile.employee_id != db_profile.employee_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A salary profile cannot be moved to another employee")
        _live_employee(self.db, db_profile.employee_id)   # a leaver's pay is settled; it no longer changes
        from .sl_payroll import allowance_list
        pay = lambda p: (Decimal(p.basic_salary or 0), [(a["name"], a["amount"], a["epf_liable"], a["taxable"]) for a in allowance_list(p)])
        before_pay = pay(db_profile)
        before = str(db_profile.basic_salary)
        for key, value in self._values(profile).items():
            setattr(db_profile, key, value)
        if pay(db_profile) != before_pay:
            # A pay change may not reach back into a month a payroll run has already used
            when = db_profile.effective_from_date or tz.today()
            used = self.db.query(EmployeePayroll.payroll_year, EmployeePayroll.payroll_month).filter(
                EmployeePayroll.employee_id == db_profile.employee_id, func.coalesce(EmployeePayroll.status, "draft") != "cancelled",
                EmployeePayroll.payroll_batch_no.isnot(None),
                (EmployeePayroll.payroll_year * 100 + EmployeePayroll.payroll_month) >= when.year * 100 + when.month,
            ).order_by(EmployeePayroll.payroll_year.desc(), EmployeePayroll.payroll_month.desc()).first()
            if used:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail=f"Payroll has already been run for {used[0]}-{used[1]:02d}; give the new salary an effective date after that month")
        db_profile.updated_by = user_id
        self.db.flush()
        self._revise(db_profile, profile, user_id, first=False)
        _audit(self.db, user_id, "update", "salary_profile", db_profile.id, basic=[before, str(profile.basic_salary)])
        self.db.commit()
        self.db.refresh(db_profile)
        return self._to_response(db_profile)

    def revisions(self, employee_id: str) -> List[dict]:
        from .sl_payroll import revisions_of
        return revisions_of(self.db, employee_id)

    def delete_revision(self, revision_id: int, user_id: int = 0) -> None:
        """Remove a salary revision entered by mistake (not the only one, and not one a payroll run used)."""
        from app.modules.employees.models import SalaryRevision
        row = self.db.query(SalaryRevision).filter(SalaryRevision.id == revision_id).with_for_update().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary revision not found")
        if self.db.query(SalaryRevision).filter(SalaryRevision.employee_id == row.employee_id).count() <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The only salary revision cannot be removed")
        used = self.db.query(EmployeePayroll.id).filter(
            EmployeePayroll.employee_id == row.employee_id, func.coalesce(EmployeePayroll.status, "draft") != "cancelled",
            EmployeePayroll.payroll_batch_no.isnot(None),
            (EmployeePayroll.payroll_year * 100 + EmployeePayroll.payroll_month) >= row.effective_from.year * 100 + row.effective_from.month,
        ).first()
        if used:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payroll has already been run on this salary; add a new revision instead")
        _audit(self.db, user_id, "delete", "salary_revision", row.id, employee=row.employee_id, effective_from=str(row.effective_from))
        self.db.delete(row)
        self.db.commit()

    def delete_profile(self, profile_id: int, user_id: int = 0):
        db_profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.id == profile_id).with_for_update().first()
        if not db_profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        _audit(self.db, user_id, "delete", "salary_profile", db_profile.id, employee=db_profile.employee_id)
        self.db.delete(db_profile)
        self.db.commit()

# Promotions Service
class PromotionService:
    def __init__(self, db: Session):
        self.db = db

    def _check(self, promotion: schemas.EmployeePromotionCreate) -> Employee:
        emp = _live_employee(self.db, promotion.employee_id)
        if emp.date_of_joining and promotion.appointed_date < emp.date_of_joining:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The appointed date is before the employee joined")
        return emp

    def _sync_designation(self, emp: Employee) -> None:
        """The employee's current designation follows the latest promotion that has taken effect."""
        from app.modules.hr_core.models import HRDesignation

        latest = (self.db.query(EmployeePromotions)
                  .filter(EmployeePromotions.employee_id == emp.employee_id, EmployeePromotions.appointed_date <= tz.today())
                  .order_by(EmployeePromotions.appointed_date.desc(), EmployeePromotions.id.desc()).first())
        if not latest:
            return
        match = self.db.query(HRDesignation).filter(func.lower(func.btrim(HRDesignation.name)) == latest.designation.strip().lower(), HRDesignation.active.is_(True)).first()
        if match:
            emp.designation_id = match.id

    def create_promotion(self, promotion: schemas.EmployeePromotionCreate, user_id: int = 0) -> EmployeePromotions:
        emp = self._check(promotion)
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"promotion-{promotion.employee_id}"})
        if self.db.query(EmployeePromotions.id).filter(
            EmployeePromotions.employee_id == promotion.employee_id, EmployeePromotions.appointed_date == promotion.appointed_date,
            func.lower(EmployeePromotions.designation) == promotion.designation.lower(),
        ).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This promotion is already recorded")
        db_promotion = EmployeePromotions(**promotion.model_dump(), created_by=user_id)
        self.db.add(db_promotion)
        self.db.flush()
        self._sync_designation(emp)
        _audit(self.db, user_id, "create", "promotion", db_promotion.id, employee=promotion.employee_id, designation=promotion.designation)
        self.db.commit()
        self.db.refresh(db_promotion)
        return db_promotion

    def get_promotion(self, promotion_id: int) -> EmployeePromotions:
        promotion = self.db.query(EmployeePromotions).filter(EmployeePromotions.id == promotion_id).first()
        if not promotion:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")
        return promotion

    def list_promotions(self, filters: schemas.HRListFilter, branches: Optional[List[str]] = None) -> List[EmployeePromotions]:
        query = scope(self.db.query(EmployeePromotions), EmployeePromotions.employee_id, branches)
        if filters.employee_id:
            query = query.filter(EmployeePromotions.employee_id == filters.employee_id)
        if filters.date_from:
            query = query.filter(EmployeePromotions.appointed_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(EmployeePromotions.appointed_date <= filters.date_to)
        return query.order_by(EmployeePromotions.appointed_date.desc(), EmployeePromotions.id.desc()).offset(filters.skip).limit(filters.limit).all()

    def update_promotion(self, promotion_id: int, promotion: schemas.EmployeePromotionCreate, user_id: int = 0) -> EmployeePromotions:
        db_promotion = self.db.query(EmployeePromotions).filter(EmployeePromotions.id == promotion_id).with_for_update().first()
        if not db_promotion:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")
        if promotion.employee_id != db_promotion.employee_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A promotion cannot be moved to another employee")
        emp = self._check(promotion)
        for key, value in promotion.model_dump().items():
            setattr(db_promotion, key, value)
        db_promotion.updated_by = user_id
        self.db.flush()
        self._sync_designation(emp)
        _audit(self.db, user_id, "update", "promotion", db_promotion.id, designation=promotion.designation)
        self.db.commit()
        self.db.refresh(db_promotion)
        return db_promotion

    def delete_promotion(self, promotion_id: int, user_id: int = 0):
        db_promotion = self.db.query(EmployeePromotions).filter(EmployeePromotions.id == promotion_id).with_for_update().first()
        if not db_promotion:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")
        _audit(self.db, user_id, "delete", "promotion", db_promotion.id, employee=db_promotion.employee_id)
        self.db.delete(db_promotion)
        self.db.commit()


# Employee Assets Service
class EmployeeAssetService:
    def __init__(self, db: Session):
        self.db = db

    def _validate_refs(self, asset: schemas.EmployeeAssetCreate, own_id: Optional[int] = None) -> None:
        """Employee in service, asset exists and is not already assigned to someone else."""
        from app.modules.inventory.models import CompanyAssets

        if not asset.revoke_assignment:
            _live_employee(self.db, asset.employee_id)
        elif not self.db.query(Employee.id).filter(Employee.employee_id == asset.employee_id).first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{asset.employee_id}' not found")
        row = self.db.query(CompanyAssets).filter(CompanyAssets.id == asset.asset_id).with_for_update().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset with id {asset.asset_id} not found")
        if not asset.revoke_assignment:
            if (row.status or "").lower() in ("sold", "disposed", "retired", "written_off", "scrapped"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This asset is {row.status} and cannot be assigned")
            q = self.db.query(EmployeesAssets).filter(EmployeesAssets.asset_id == asset.asset_id, EmployeesAssets.revoke_assignment == False)  # noqa: E712
            if own_id:
                q = q.filter(EmployeesAssets.id != own_id)
            other = q.first()
            if other:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This asset is already assigned to employee '{other.employee_id}'; revoke that assignment first")

    def _sync_asset(self, asset_id: int) -> None:
        """The company asset follows its assignments: in use (with its holder) while one is active, available again after."""
        from app.modules.inventory.models import CompanyAssets

        row = self.db.query(CompanyAssets).filter(CompanyAssets.id == asset_id).first()
        if not row:
            return
        active = self.db.query(EmployeesAssets).filter(EmployeesAssets.asset_id == asset_id, EmployeesAssets.revoke_assignment == False).order_by(EmployeesAssets.id.desc()).first()  # noqa: E712
        if active:
            holder = self.db.query(Employee.id).filter(Employee.employee_id == active.employee_id).scalar()
            if (row.status or "").lower() in ("available", "returned", "in_use"):
                row.status = "in_use"
            row.asigned_to = holder
        elif (row.status or "").lower() == "in_use":
            row.status = "available"
            row.asigned_to = None

    def create_asset_assignment(self, asset: schemas.EmployeeAssetCreate, user_id: int = 0) -> EmployeesAssets:
        self._validate_refs(asset)
        db_asset = EmployeesAssets(**asset.model_dump(), created_by=user_id)
        self.db.add(db_asset)
        self.db.flush()
        self._sync_asset(asset.asset_id)
        _audit(self.db, user_id, "create", "employee_asset", db_asset.id, employee=asset.employee_id, asset=asset.asset_id)
        self.db.commit()
        self.db.refresh(db_asset)
        return db_asset

    def get_asset_assignment(self, assignment_id: int) -> EmployeesAssets:
        asset = self.db.query(EmployeesAssets).filter(EmployeesAssets.id == assignment_id).first()
        if not asset:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset assignment not found")
        return asset

    def list_asset_assignments(self, filters: schemas.HRListFilter, branches: Optional[List[str]] = None) -> List[EmployeesAssets]:
        query = scope(self.db.query(EmployeesAssets), EmployeesAssets.employee_id, branches)
        if filters.employee_id:
            query = query.filter(EmployeesAssets.employee_id == filters.employee_id)
        return query.order_by(EmployeesAssets.id.desc()).offset(filters.skip).limit(filters.limit).all()

    def update_asset_assignment(self, assignment_id: int, asset: schemas.EmployeeAssetCreate, user_id: int = 0) -> EmployeesAssets:
        db_asset = self.db.query(EmployeesAssets).filter(EmployeesAssets.id == assignment_id).with_for_update().first()
        if not db_asset:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset assignment not found")
        if asset.employee_id != db_asset.employee_id or asset.asset_id != db_asset.asset_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only the reason and the revoked flag can change; create a new assignment for another employee or asset")
        if db_asset.revoke_assignment and not asset.revoke_assignment:
            self._validate_refs(asset, own_id=db_asset.id)    # re-activating needs the same checks as a new assignment
        for key, value in asset.model_dump().items():
            setattr(db_asset, key, value)
        db_asset.updated_by = user_id
        self.db.flush()
        self._sync_asset(db_asset.asset_id)
        _audit(self.db, user_id, "update", "employee_asset", db_asset.id, revoked=asset.revoke_assignment)
        self.db.commit()
        self.db.refresh(db_asset)
        return db_asset

    def delete_asset_assignment(self, assignment_id: int, user_id: int = 0):
        db_asset = self.db.query(EmployeesAssets).filter(EmployeesAssets.id == assignment_id).with_for_update().first()
        if not db_asset:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset assignment not found")
        _audit(self.db, user_id, "delete", "employee_asset", db_asset.id, employee=db_asset.employee_id)
        asset_id = db_asset.asset_id
        self.db.delete(db_asset)
        self.db.flush()
        self._sync_asset(asset_id)
        self.db.commit()


class HRStatisticsService:
    """Server-side aggregation for the HR dashboard KPI cards.

    Every figure is a database COUNT so the dashboard is accurate regardless of
    table size, replacing the previous approach of counting capped list
    responses on the client.
    """

    # Payroll batches awaiting attention (draft or pending approval).
    PENDING_BATCH_STATUSES = ("draft", "pending_approval")
    # Reimbursements not yet actioned.
    PENDING_REIMBURSEMENT_STATUSES = ("pending", "submitted")

    def __init__(self, db: Session):
        self.db = db

    def _claims(self, branches: Optional[List[str]]):
        """Reimbursement count query, scoped like the reimbursement list (by the claim's branch)."""
        q = self.db.query(func.count(Reimbursements.id))
        return q if branches is None else q.filter(Reimbursements.branch_code.in_(branches))

    def get_statistics(self, branches: Optional[List[str]] = None) -> schemas.HRStatistics:
        """Counts limited to `branches` (None = company-wide); payroll batches are always company-wide."""
        from app.modules.attendance.models import Attendance, Leaves
        from sqlalchemy import or_

        today = tz.today()

        emp_q = self.db.query(func.count(Employee.id)).filter(Employee.status.in_(LIVE_STATUSES))
        if branches is not None:
            emp_q = emp_q.filter(Employee.branch_code.in_(branches))
        total_employees = emp_q.scalar() or 0

        # "Present today" mirrors the attendance status derivation
        # (present or late): checked in, not on leave, and worked or was late.
        present_today = (
            scope(self.db.query(func.count(Attendance.id)), Attendance.employee_id, branches)
            .filter(
                Attendance.date == today,
                Attendance.check_in.isnot(None),
                func.coalesce(Attendance.leave_mins, 0) == 0,
                or_(
                    func.coalesce(Attendance.late_mins, 0) > 0,
                    func.coalesce(Attendance.work_mins, 0) > 0,
                ),
            )
            .scalar()
            or 0
        )

        pending_leaves = (
            scope(self.db.query(func.count(Leaves.id)), Leaves.employee_id, branches)
            .filter(Leaves.status == "pending")
            .scalar()
            or 0
        )

        total_profiles = (
            scope(self.db.query(func.count(EmployeeSalaryProfile.id)), EmployeeSalaryProfile.employee_id, branches).scalar() or 0
        )

        pending_batches = (
            self.db.query(func.count(PayrollBatch.id))
            .filter(PayrollBatch.status.in_(self.PENDING_BATCH_STATUSES))
            .scalar()
            or 0
        )
        total_batches = self.db.query(func.count(PayrollBatch.id)).scalar() or 0

        pending_reimbursements = (
            self._claims(branches)
            .filter(Reimbursements.status.in_(self.PENDING_REIMBURSEMENT_STATUSES))
            .scalar()
            or 0
        )
        total_reimbursements = (
            self._claims(branches).scalar() or 0
        )

        total_deductions = (
            scope(self.db.query(func.count(SalaryDeductions.id)), SalaryDeductions.employee_id, branches, by="pk").scalar() or 0
        )

        total_promotions = (
            scope(self.db.query(func.count(EmployeePromotions.id)), EmployeePromotions.employee_id, branches).scalar() or 0
        )

        # Active = currently assigned (not revoked).
        active_assets = (
            scope(self.db.query(func.count(EmployeesAssets.id)), EmployeesAssets.employee_id, branches)
            .filter(EmployeesAssets.revoke_assignment == False)  # noqa: E712
            .scalar()
            or 0
        )

        return schemas.HRStatistics(
            total_employees=total_employees,
            present_today=present_today,
            pending_leaves=pending_leaves,
            total_profiles=total_profiles,
            pending_batches=pending_batches,
            total_batches=total_batches,
            pending_reimbursements=pending_reimbursements,
            total_reimbursements=total_reimbursements,
            total_deductions=total_deductions,
            total_promotions=total_promotions,
            active_assets=active_assets,
        )
