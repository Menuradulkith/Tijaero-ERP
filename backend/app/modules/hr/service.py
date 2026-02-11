from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from fastapi import HTTPException, status
from typing import List, Optional, Dict, Any
from datetime import date, datetime
from decimal import Decimal
from . import schemas
from .models import SalaryDeductions, Reimbursements, ReimbursementItem, PayrollBatch
from .sales_commission_models import SalesOfficerMonthlyCommission
from app.modules.employees.models import Employee
from app.modules.employees.models import EmployeePayroll, EmployeeSalaryProfile, EmployeePromotions, EmployeesAssets
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus

# Salary Deductions Service
class SalaryDeductionService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_deduction(self, deduction: schemas.SalaryDeductionCreate) -> SalaryDeductions:
        db_deduction = SalaryDeductions(**deduction.model_dump())
        self.db.add(db_deduction)
        self.db.commit()
        self.db.refresh(db_deduction)
        return db_deduction
    
    def get_deduction(self, deduction_id: int) -> SalaryDeductions:
        deduction = self.db.query(SalaryDeductions).filter(SalaryDeductions.id == deduction_id).first()
        if not deduction:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deduction not found")
        return deduction
    
    def list_deductions(self, filters: schemas.HRListFilter) -> List[SalaryDeductions]:
        query = self.db.query(SalaryDeductions)
        
        if filters.employee_id:
            query = query.filter(SalaryDeductions.employee_id == filters.employee_id)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_deduction(self, deduction_id: int, deduction: schemas.SalaryDeductionCreate) -> SalaryDeductions:
        db_deduction = self.get_deduction(deduction_id)
        for key, value in deduction.model_dump().items():
            setattr(db_deduction, key, value)
        self.db.commit()
        self.db.refresh(db_deduction)
        return db_deduction
    
    def delete_deduction(self, deduction_id: int):
        db_deduction = self.get_deduction(deduction_id)
        self.db.delete(db_deduction)
        self.db.commit()

# Reimbursements Service
class ReimbursementService:
    def __init__(self, db: Session):
        self.db = db

    def _generate_reimbursement_no(self) -> str:
        """Generate unique reimbursement number: RMB-YYYYMMDD-NNN"""
        today = date.today().strftime("%Y%m%d")
        prefix = f"RMB-{today}-"
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

    def create_reimbursement(self, data: schemas.ReimbursementCreate, created_by: int = 1) -> schemas.Reimbursement:
        """Create a reimbursement with line items and auto-create approval request."""
        # Validate employee exists
        employee = self.db.query(Employee).filter(Employee.employee_id == data.employee_id).first()
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{data.employee_id}' not found")

        # Calculate total from items
        total_amount = sum(item.amount for item in data.items) if data.items else Decimal("0")
        if total_amount <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Total amount must be greater than zero. Add at least one line item.")

        reimbursement_no = self._generate_reimbursement_no()

        db_reimbursement = Reimbursements(
            reimbursement_no=reimbursement_no,
            employee_id=data.employee_id,
            branch_code=data.branch_code,
            claim_date=data.claim_date,
            description=data.description,
            reimbursement_type=data.reimbursement_type,
            total_amount=total_amount,
            status="pending",
            remark=data.remark,
        )
        self.db.add(db_reimbursement)
        self.db.flush()

        # Create line items
        for item_data in data.items:
            db_item = ReimbursementItem(
                reimbursement_id=db_reimbursement.id,
                expense_type=item_data.expense_type,
                item_description=item_data.item_description,
                amount=item_data.amount,
                receipt_date=item_data.receipt_date,
                receipt_number=item_data.receipt_number,
            )
            self.db.add(db_item)

        # Create approval request
        approval_record = approval_service.create_approval_request(
            db=self.db,
            approval_type=ApprovalType.REIMBURSEMENT,
            reference_id=db_reimbursement.id,
            reference_no=reimbursement_no,
            branch_code=data.branch_code,
            requested_by=created_by,
            remarks=f"Reimbursement claim pending approval - {reimbursement_no}",
            approval_group="reimbursement_approvers",
        )
        db_reimbursement.approval_id = approval_record.id

        self.db.commit()
        self.db.refresh(db_reimbursement)
        return self._to_response(db_reimbursement)

    def get_reimbursement(self, reimbursement_id: int) -> schemas.Reimbursement:
        reimbursement = self.db.query(Reimbursements).options(
            joinedload(Reimbursements.items),
            joinedload(Reimbursements.branch),
        ).filter(Reimbursements.id == reimbursement_id).first()
        if not reimbursement:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        return self._to_response(reimbursement)

    def list_reimbursements(self, filters: schemas.ReimbursementListFilter) -> List[schemas.Reimbursement]:
        query = self.db.query(Reimbursements).options(
            joinedload(Reimbursements.items),
            joinedload(Reimbursements.branch),
        )

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

    def update_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementUpdate) -> schemas.Reimbursement:
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        if r.status not in ("pending",):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot edit reimbursement with status '{r.status}'")
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(r, key, value)
        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def approve_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementApprove, user_id: int) -> schemas.Reimbursement:
        """Approve or partially approve a reimbursement."""
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        if r.status != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot approve. Current status: {r.status}")

        approved_amount = data.approved_amount if data.approved_amount is not None else r.total_amount
        if approved_amount < r.total_amount:
            r.status = "partial_approved"
        else:
            r.status = "approved"

        r.approved_amount = approved_amount
        r.approved_date = datetime.utcnow()
        if data.remarks:
            r.remark = data.remarks

        # Update approval record
        if r.approval_id:
            from app.modules.common.models import Approvals
            approval = self.db.query(Approvals).filter(Approvals.id == r.approval_id).first()
            if approval and approval.status == "pending":
                approval.status = "approved"
                approval.status_changed_by = user_id
                approval.remark = data.remarks or f"Approved by user {user_id}"

        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def reject_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementReject, user_id: int) -> schemas.Reimbursement:
        """Reject a reimbursement."""
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        if r.status != "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot reject. Current status: {r.status}")

        r.status = "rejected"
        r.rejection_reason = data.rejection_reason

        # Update approval record
        if r.approval_id:
            from app.modules.common.models import Approvals
            approval = self.db.query(Approvals).filter(Approvals.id == r.approval_id).first()
            if approval and approval.status == "pending":
                approval.status = "rejected"
                approval.status_changed_by = user_id
                approval.remark = data.rejection_reason

        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def verify_reimbursement(self, reimbursement_id: int, data: schemas.ReimbursementVerify, user_id: int) -> schemas.Reimbursement:
        """Finance verification of an approved reimbursement."""
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        if r.status not in ("approved", "partial_approved"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot verify. Current status: {r.status}")

        r.status = "verified"
        r.verified_by = user_id
        r.verified_date = datetime.utcnow()
        if data.remarks:
            r.remark = data.remarks

        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def process_payment(self, reimbursement_id: int, data: schemas.ReimbursementPayment, user_id: int) -> schemas.Reimbursement:
        """Process payment for a verified reimbursement."""
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        if r.status != "verified":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot process payment. Current status: {r.status}")

        r.payment_method = data.payment_method
        r.payment_reference = data.payment_reference
        r.paid_amount = data.paid_amount
        r.payment_date = datetime.utcnow()
        r.payment_status = "paid"
        r.status = "completed"
        if data.remarks:
            r.remark = data.remarks

        self.db.commit()
        self.db.refresh(r)
        return self._to_response(r)

    def delete_reimbursement(self, reimbursement_id: int):
        r = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not r:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        if r.status not in ("pending", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot delete reimbursement with status '{r.status}'")
        self.db.delete(r)
        self.db.commit()

# Payroll Service
class PayrollService:
    # Sri Lankan statutory rates
    EPF_EMPLOYEE_RATE = Decimal("0.08")   # 8%
    EPF_EMPLOYER_RATE = Decimal("0.12")   # 12%
    ETF_EMPLOYEE_RATE = Decimal("0.03")   # 3%
    ETF_EMPLOYER_RATE = Decimal("0.03")   # 3%
    STAMP_DUTY = Decimal("100.00")        # Fixed LKR 100

    # Sri Lankan APIT (Advance Personal Income Tax) 2025/2026 brackets
    # Progressive tax: each bracket rate applies only to the portion within that range
    APIT_BRACKETS = [
        (Decimal("150000"), Decimal("0")),       # Up to 150,000: 0%
        (Decimal("83333"),  Decimal("0.06")),    # 150,001 - 233,333: 6%
        (Decimal("41667"),  Decimal("0.18")),    # 233,334 - 275,000: 18%
        (Decimal("41666"),  Decimal("0.24")),    # 275,001 - 316,666: 24%
        (Decimal("41667"),  Decimal("0.30")),    # 316,667 - 358,333: 30%
    ]
    APIT_TOP_RATE = Decimal("0.36")              # Above 358,333: 36%

    def __init__(self, db: Session):
        self.db = db

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
        remaining = gross_salary
        for bracket_size, rate in self.APIT_BRACKETS:
            if remaining <= 0:
                break
            taxable = min(remaining, bracket_size)
            tax += taxable * rate
            remaining -= bracket_size
        if remaining > 0:
            tax += remaining * self.APIT_TOP_RATE
        return tax.quantize(Decimal("0.01"))

    def _payroll_to_response(self, p: EmployeePayroll) -> schemas.EmployeePayrollResponse:
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
            employee_name=self._resolve_employee_name(p.employee_id),
        )

    def _batch_to_response(self, b: PayrollBatch, include_records: bool = False) -> schemas.PayrollBatchResponse:
        records = None
        if include_records:
            payrolls = self.db.query(EmployeePayroll).filter(
                EmployeePayroll.payroll_batch_no == b.batch_no
            ).all()
            records = [self._payroll_to_response(p) for p in payrolls]
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
        profile: EmployeeSalaryProfile, 
        deductions: List[SalaryDeductions],
        sales_commission: Decimal = Decimal("0")
    ) -> Dict[str, Decimal]:
        """Calculate payroll for one employee based on salary profile, deductions, and commissions."""
        basic = profile.basic_salary or Decimal("0")
        add_1 = profile.add_1_value or Decimal("0")
        add_2 = profile.add_2_value or Decimal("0")

        gross_salary = basic + add_1 + add_2 + sales_commission

        # Statutory deductions based on basic salary
        epf_employee = basic * self.EPF_EMPLOYEE_RATE
        etf_employee = basic * self.ETF_EMPLOYEE_RATE
        stamp_duty = self.STAMP_DUTY if basic > Decimal("0") else Decimal("0")

        # APIT (Advance Personal Income Tax) on gross salary
        apit = self._calculate_apit(gross_salary)

        # Employer contributions
        epf_employer = basic * self.EPF_EMPLOYER_RATE
        etf_employer = basic * self.ETF_EMPLOYER_RATE

        # Sum up custom deductions from the deductions table
        late_deductions = Decimal("0")
        salary_advance_repayment = Decimal("0")
        loan_repayment = Decimal("0")
        other_deductions = Decimal("0")
        for d in deductions:
            late_deductions += d.late_deductions or Decimal("0")
            salary_advance_repayment += d.salary_advance_repayment or Decimal("0")
            loan_repayment += d.loan_repayment or Decimal("0")
            other_deductions += d.other_deductions or (d.amount or Decimal("0"))

        total_deductions = (
            epf_employee + etf_employee + stamp_duty + apit +
            late_deductions + salary_advance_repayment +
            loan_repayment + other_deductions
        )

        net_salary = gross_salary - total_deductions
        total_employer_cost = gross_salary + epf_employer + etf_employer

        return {
            "basic_salary": basic,
            "add_1_name": profile.add_1_name,
            "add_1_value": add_1,
            "add_2_name": profile.add_2_name,
            "add_2_value": add_2,
            "add_sales_commision": sales_commission,
            "gross_salary": gross_salary,
            "less_epf_employee": epf_employee,
            "less_etf_employee": etf_employee,
            "less_stamp_duty": stamp_duty,
            "less_late_deductions": late_deductions,
            "less_salary_advance_repayment": salary_advance_repayment,
            "less_loan_repayment": loan_repayment,
            "less_other_deductions": other_deductions,
            "less_apit": apit,
            "total_deductions": total_deductions,
            "net_salary": net_salary,
            "epf_employer": epf_employer,
            "etf_employer": etf_employer,
            "total_employer_cost": total_employer_cost,
        }

    # --- CRUD (backward compatible) ---
    def create_payroll(self, payroll: schemas.EmployeePayrollCreate) -> schemas.EmployeePayrollResponse:
        db_payroll = EmployeePayroll(**payroll.model_dump())
        db_payroll.created_at = datetime.utcnow()
        self.db.add(db_payroll)
        self.db.commit()
        self.db.refresh(db_payroll)
        return self._payroll_to_response(db_payroll)
    
    def get_payroll(self, payroll_id: int) -> schemas.EmployeePayrollResponse:
        payroll = self.db.query(EmployeePayroll).filter(EmployeePayroll.id == payroll_id).first()
        if not payroll:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found")
        return self._payroll_to_response(payroll)
    
    def list_payrolls(self, filters: schemas.HRListFilter) -> List[schemas.EmployeePayrollResponse]:
        query = self.db.query(EmployeePayroll)
        if filters.employee_id:
            query = query.filter(EmployeePayroll.employee_id == filters.employee_id)
        results = query.order_by(EmployeePayroll.id.desc()).offset(filters.skip).limit(filters.limit).all()
        return [self._payroll_to_response(p) for p in results]
    
    def update_payroll(self, payroll_id: int, payroll: schemas.EmployeePayrollCreate) -> schemas.EmployeePayrollResponse:
        db_payroll = self.db.query(EmployeePayroll).filter(EmployeePayroll.id == payroll_id).first()
        if not db_payroll:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found")
        for key, value in payroll.model_dump().items():
            setattr(db_payroll, key, value)
        self.db.commit()
        self.db.refresh(db_payroll)
        return self._payroll_to_response(db_payroll)
    
    def delete_payroll(self, payroll_id: int):
        db_payroll = self.db.query(EmployeePayroll).filter(EmployeePayroll.id == payroll_id).first()
        if not db_payroll:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found")
        self.db.delete(db_payroll)
        self.db.commit()

    # --- Payroll Workflow ---
    def trigger_payroll_run(self, data: schemas.PayrollRunRequest, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 3: Trigger payroll processing - generate payroll records for all employees with salary profiles."""
        month, year = data.payroll_month, data.payroll_year

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

        # Create the batch
        batch_no = self._generate_batch_no(month, year)
        batch = PayrollBatch(
            batch_no=batch_no,
            payroll_month=month,
            payroll_year=year,
            description=data.description or f"Payroll for {year}-{month:02d}",
            status="draft",
            created_by=user_id,
            created_at=datetime.utcnow(),
        )
        self.db.add(batch)
        self.db.flush()

        # Get all salary profiles
        profiles = self.db.query(EmployeeSalaryProfile).all()
        if not profiles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No salary profiles found. Set up employee salary profiles first."
            )

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

        for profile in profiles:
            # Get employee's internal id
            emp_internal_id = self.db.query(Employee.id).filter(
                Employee.employee_id == profile.employee_id
            ).scalar()
            
            # Get deductions for this employee and period
            deductions = self.db.query(SalaryDeductions).filter(
                SalaryDeductions.employee_id == emp_internal_id,
            ).all()
            # Filter period-specific deductions if deduction_period matches
            period_deductions = [d for d in deductions if not d.deduction_period or d.deduction_period == period_str]

            # Get approved sales commission for this employee
            sales_commission = commission_map.get(emp_internal_id, Decimal("0"))

            calc = self._calculate_payroll(profile, period_deductions, sales_commission)

            payroll_record = EmployeePayroll(
                employee_id=profile.employee_id,
                payroll_month=month,
                payroll_year=year,
                payroll_batch_no=batch_no,
                basic_salary=calc["basic_salary"],
                add_1_name=calc["add_1_name"],
                add_1_value=calc["add_1_value"],
                add_2_name=calc["add_2_name"],
                add_2_value=calc["add_2_value"],
                add_sales_commision=calc["add_sales_commision"],
                less_epf_employee=calc["less_epf_employee"],
                less_etf_employee=calc["less_etf_employee"],
                less_stamp_duty=calc["less_stamp_duty"],
                less_late_deductions=calc["less_late_deductions"],
                less_salary_advance_repayment=calc["less_salary_advance_repayment"],
                less_loan_repayment=calc["less_loan_repayment"],
                less_other_deductions=calc["less_other_deductions"],
                less_apit=calc["less_apit"],
                epf_employer=calc["epf_employer"],
                etf_employer=calc["etf_employer"],
                gross_salary=calc["gross_salary"],
                total_deductions=calc["total_deductions"],
                net_salary=calc["net_salary"],
                total_employer_cost=calc["total_employer_cost"],
                status="draft",
                created_at=datetime.utcnow(),
                created_by=user_id,
            )
            self.db.add(payroll_record)

            total_gross += calc["gross_salary"]
            total_deductions += calc["total_deductions"]
            total_net += calc["net_salary"]
            total_employer_epf += calc["epf_employer"]
            total_employer_etf += calc["etf_employer"]
            total_employer_cost += calc["total_employer_cost"]
            total_apit += calc["less_apit"]
            count += 1

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
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit. Current status: {batch.status}"
            )
        batch.status = "pending_approval"
        # Update all payroll records
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "pending_approval"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def approve_batch(self, batch_id: int, data: schemas.PayrollBatchApprove, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 6: Approve payroll batch."""
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "pending_approval":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve. Current status: {batch.status}"
            )
        batch.status = "approved"
        batch.approved_by = user_id
        batch.approved_date = datetime.utcnow()
        # Update all payroll records
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "approved", "approved_by": user_id, "approved_date": datetime.utcnow()})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def reject_batch(self, batch_id: int, data: schemas.PayrollBatchReject, user_id: int) -> schemas.PayrollBatchResponse:
        """Reject payroll batch back to draft."""
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "pending_approval":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject. Current status: {batch.status}"
            )
        batch.status = "draft"
        batch.description = (batch.description or "") + f"\n[Rejected: {data.rejection_reason}]"
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "draft"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def process_salary_payment(self, batch_id: int, data: schemas.PayrollBatchProcessPayment, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 7: Process salary payments for all employees in the batch."""
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "approved":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot process payment. Current status: {batch.status}"
            )
        payment_date = data.payment_date or date.today()
        batch.status = "salary_paid"
        batch.salary_payment_date = payment_date
        batch.salary_payment_reference = data.payment_reference
        
        # Get all payroll records for this batch
        payroll_records = self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).all()
        
        # Update payroll records
        for pr in payroll_records:
            pr.payment_status = "paid"
            pr.payment_date = payment_date
            pr.payment_reference = data.payment_reference
            pr.payment_method = data.payment_method
            pr.status = "salary_paid"
        
        # Mark approved sales commissions as paid for employees in this batch
        employee_ids = [pr.employee_id for pr in payroll_records]
        employee_internal_ids = self.db.query(Employee.id).filter(
            Employee.employee_id.in_(employee_ids)
        ).all()
        employee_internal_ids = [e[0] for e in employee_internal_ids]
        
        # Update commissions to paid status
        self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.fiscal_year == batch.payroll_year,
            SalesOfficerMonthlyCommission.fiscal_month == batch.payroll_month,
            SalesOfficerMonthlyCommission.employee_id.in_(employee_internal_ids),
            SalesOfficerMonthlyCommission.status == "approved",
        ).update({
            "status": "paid",
            "paid_in_payroll_id": batch.id,
            "updated_at": datetime.utcnow(),
        }, synchronize_session=False)
        
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def process_statutory_payment(self, batch_id: int, data: schemas.PayrollBatchProcessStatutory, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 8: Process statutory payments (EPF/ETF) for the batch."""
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "salary_paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot process statutory. Must process salary payments first. Current status: {batch.status}"
            )
        payment_date = data.payment_date or date.today()
        refs = []
        if data.epf_reference:
            refs.append(f"EPF: {data.epf_reference}")
        if data.etf_reference:
            refs.append(f"ETF: {data.etf_reference}")
        statutory_ref = "; ".join(refs) if refs else None

        batch.status = "statutory_paid"
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
        return self._batch_to_response(batch, include_records=True)

    def complete_batch(self, batch_id: int, user_id: int) -> schemas.PayrollBatchResponse:
        """Step 10: Complete the payroll cycle."""
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status != "statutory_paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot complete. Must process statutory payments first. Current status: {batch.status}"
            )
        batch.status = "completed"
        batch.completed_date = datetime.utcnow()
        self.db.query(EmployeePayroll).filter(
            EmployeePayroll.payroll_batch_no == batch.batch_no
        ).update({"status": "completed"})
        self.db.commit()
        self.db.refresh(batch)
        return self._batch_to_response(batch, include_records=True)

    def cancel_batch(self, batch_id: int, user_id: int) -> schemas.PayrollBatchResponse:
        """Cancel a payroll batch (only if not yet paid)."""
        batch = self.db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
        if not batch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
        if batch.status in ("salary_paid", "statutory_paid", "completed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot cancel batch with status '{batch.status}'"
            )
        batch.status = "cancelled"
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

    def _to_response(self, p: EmployeeSalaryProfile) -> schemas.EmployeeSalaryProfile:
        return schemas.EmployeeSalaryProfile(
            id=p.id,
            employee_id=p.employee_id,
            basic_salary=p.basic_salary or Decimal("0"),
            add_1_name=p.add_1_name,
            add_1_value=p.add_1_value,
            add_2_name=p.add_2_name,
            add_2_value=p.add_2_value,
            designation=p.designation,
            department=p.department,
            effective_from_date=p.effective_from_date,
            benefits=p.benefits,
            employee_name=self._resolve_employee_name(p.employee_id),
        )

    def create_profile(self, profile: schemas.EmployeeSalaryProfileCreate) -> schemas.EmployeeSalaryProfile:
        db_profile = EmployeeSalaryProfile(**profile.model_dump())
        self.db.add(db_profile)
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

    def list_profiles(self) -> List[schemas.EmployeeSalaryProfile]:
        profiles = self.db.query(EmployeeSalaryProfile).all()
        return [self._to_response(p) for p in profiles]
    
    def update_profile(self, profile_id: int, profile: schemas.EmployeeSalaryProfileCreate) -> schemas.EmployeeSalaryProfile:
        db_profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.id == profile_id).first()
        if not db_profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        for key, value in profile.model_dump().items():
            setattr(db_profile, key, value)
        self.db.commit()
        self.db.refresh(db_profile)
        return self._to_response(db_profile)
    
    def delete_profile(self, profile_id: int):
        db_profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.id == profile_id).first()
        if not db_profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        self.db.delete(db_profile)
        self.db.commit()

# Promotions Service
class PromotionService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_promotion(self, promotion: schemas.EmployeePromotionCreate) -> EmployeePromotions:
        db_promotion = EmployeePromotions(**promotion.model_dump())
        self.db.add(db_promotion)
        self.db.commit()
        self.db.refresh(db_promotion)
        return db_promotion
    
    def get_promotion(self, promotion_id: int) -> EmployeePromotions:
        promotion = self.db.query(EmployeePromotions).filter(EmployeePromotions.id == promotion_id).first()
        if not promotion:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")
        return promotion
    
    def list_promotions(self, filters: schemas.HRListFilter) -> List[EmployeePromotions]:
        query = self.db.query(EmployeePromotions)
        
        if filters.employee_id:
            query = query.filter(EmployeePromotions.employee_id == filters.employee_id)
        
        if filters.date_from:
            query = query.filter(EmployeePromotions.appointed_date >= filters.date_from)
        
        if filters.date_to:
            query = query.filter(EmployeePromotions.appointed_date <= filters.date_to)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_promotion(self, promotion_id: int, promotion: schemas.EmployeePromotionCreate) -> EmployeePromotions:
        db_promotion = self.get_promotion(promotion_id)
        for key, value in promotion.model_dump().items():
            setattr(db_promotion, key, value)
        self.db.commit()
        self.db.refresh(db_promotion)
        return db_promotion
    
    def delete_promotion(self, promotion_id: int):
        db_promotion = self.get_promotion(promotion_id)
        self.db.delete(db_promotion)
        self.db.commit()

# Employee Assets Service
class EmployeeAssetService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_asset_assignment(self, asset: schemas.EmployeeAssetCreate) -> EmployeesAssets:
        db_asset = EmployeesAssets(**asset.model_dump())
        self.db.add(db_asset)
        self.db.commit()
        self.db.refresh(db_asset)
        return db_asset
    
    def get_asset_assignment(self, assignment_id: int) -> EmployeesAssets:
        asset = self.db.query(EmployeesAssets).filter(EmployeesAssets.id == assignment_id).first()
        if not asset:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset assignment not found")
        return asset
    
    def list_asset_assignments(self, filters: schemas.HRListFilter) -> List[EmployeesAssets]:
        query = self.db.query(EmployeesAssets)
        
        if filters.employee_id:
            query = query.filter(EmployeesAssets.employee_id == filters.employee_id)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_asset_assignment(self, assignment_id: int, asset: schemas.EmployeeAssetCreate) -> EmployeesAssets:
        db_asset = self.get_asset_assignment(assignment_id)
        for key, value in asset.model_dump().items():
            setattr(db_asset, key, value)
        self.db.commit()
        self.db.refresh(db_asset)
        return db_asset
    
    def delete_asset_assignment(self, assignment_id: int):
        db_asset = self.get_asset_assignment(assignment_id)
        self.db.delete(db_asset)
        self.db.commit()
