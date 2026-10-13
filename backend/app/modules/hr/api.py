"""HR endpoints: deductions, reimbursements, payroll, salary profiles, promotions, asset assignments.

Every route needs the permission of the data it touches (the router-level hr_dashboard:view only opens
the dashboard); ids and list sizes are bounded; reimbursements are branch-scoped.
"""
from datetime import date
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_user_branch_filter
from app.auth.models import User
from app.auth.rbac import Permissions, require_any_permission, require_permission
from app.db.session import get_db
from app.modules.hr import schemas, service

RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]
EmpCode = Annotated[Optional[str], Query(max_length=50)]
Skip = Annotated[int, Query(ge=0, le=10_000_000)]
Limit = Annotated[int, Query(ge=1, le=5000)]

router = APIRouter(
    prefix="/hr",
    tags=["hr"],
    dependencies=[Depends(require_permission(*Permissions.HR_DASHBOARD_VIEW))],
)

P = Permissions
SEE_DEDUCTIONS = Depends(require_permission(*P.DEDUCTION_VIEW))
SEE_REIMBURSEMENTS = Depends(require_any_permission(P.REIMBURSEMENT_VIEW, P.REIMBURSEMENT_APPROVAL_VIEW))
SEE_PAYROLL = Depends(require_any_permission(P.PAYROLL_VIEW, P.PAYROLL_PROCESSING_VIEW, P.PAYROLL_APPROVAL_VIEW))
SEE_SALARY = Depends(require_any_permission(P.SALARY_PROFILE_VIEW, P.PAYROLL_PROCESSING_VIEW))
SEE_PROMOTIONS = Depends(require_permission(*P.PROMOTION_VIEW))
SEE_ASSETS = Depends(require_permission(*P.HR_ASSET_VIEW))


def _need(perm):
    return Depends(require_permission(*perm))


@router.get("/statistics", response_model=schemas.HRStatistics)
def get_hr_statistics(db: Session = Depends(get_db)):
    """Server-side aggregated KPI counts for the HR dashboard."""
    return service.HRStatisticsService(db).get_statistics()


# ───────────────────────────── deductions ─────────────────────────────
@router.post("/deductions", response_model=schemas.SalaryDeduction, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.DEDUCTION_CREATE)])
def create_salary_deduction(deduction: schemas.SalaryDeductionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.SalaryDeductionService(db).create_deduction(deduction, current_user.id)


@router.get("/deductions/{deduction_id}", response_model=schemas.SalaryDeduction, dependencies=[SEE_DEDUCTIONS])
def get_salary_deduction(deduction_id: RowId, db: Session = Depends(get_db)):
    return service.SalaryDeductionService(db).get_deduction(deduction_id)


@router.get("/deductions", response_model=List[schemas.SalaryDeduction], dependencies=[SEE_DEDUCTIONS])
def list_salary_deductions(
    employee_id: Optional[int] = Query(None, ge=1, le=2_147_483_647), skip: Skip = 0, limit: Limit = 100, db: Session = Depends(get_db),
):
    filters = schemas.HRListFilter(employee_id=str(employee_id) if employee_id else None, skip=skip, limit=limit)
    return service.SalaryDeductionService(db).list_deductions(filters)


@router.put("/deductions/{deduction_id}", response_model=schemas.SalaryDeduction, dependencies=[_need(P.DEDUCTION_UPDATE)])
def update_salary_deduction(deduction_id: RowId, deduction: schemas.SalaryDeductionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.SalaryDeductionService(db).update_deduction(deduction_id, deduction, current_user.id)


@router.delete("/deductions/{deduction_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_need(P.DEDUCTION_DELETE)])
def delete_salary_deduction(deduction_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service.SalaryDeductionService(db).delete_deduction(deduction_id, current_user.id)


# ───────────────────────────── reimbursements ─────────────────────────────
@router.post("/reimbursements", response_model=schemas.Reimbursement, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.REIMBURSEMENT_CREATE)])
def create_reimbursement(reimbursement: schemas.ReimbursementCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create a reimbursement claim with line items (total = sum of the items)."""
    return service.ReimbursementService(db).create_reimbursement(reimbursement, current_user)


@router.get("/reimbursements/{reimbursement_id}", response_model=schemas.Reimbursement, dependencies=[SEE_REIMBURSEMENTS])
def get_reimbursement(reimbursement_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.ReimbursementService(db).get_reimbursement(reimbursement_id, current_user)


@router.get("/reimbursements", response_model=List[schemas.Reimbursement], dependencies=[SEE_REIMBURSEMENTS])
def list_reimbursements(
    employee_id: EmpCode = None,
    branch_code: Optional[str] = Query(None, max_length=20),
    status_filter: Optional[str] = Query(None, alias="status", max_length=30),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: Skip = 0,
    limit: Limit = 100,
    db: Session = Depends(get_db),
    branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    filters = schemas.ReimbursementListFilter(employee_id=employee_id, branch_code=branch_code, status=status_filter, date_from=date_from, date_to=date_to, skip=skip, limit=limit)
    return service.ReimbursementService(db).list_reimbursements(filters, branches)


@router.patch("/reimbursements/{reimbursement_id}", response_model=schemas.Reimbursement, dependencies=[_need(P.REIMBURSEMENT_UPDATE)])
def update_reimbursement(reimbursement_id: RowId, reimbursement: schemas.ReimbursementUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.ReimbursementService(db).update_reimbursement(reimbursement_id, reimbursement, current_user)


@router.post("/reimbursements/{reimbursement_id}/approve", response_model=schemas.Reimbursement, dependencies=[_need(P.REIMBURSEMENT_APPROVAL_APPROVE)])
def approve_reimbursement(reimbursement_id: RowId, data: schemas.ReimbursementApprove, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.ReimbursementService(db).approve_reimbursement(reimbursement_id, data, current_user)


@router.post("/reimbursements/{reimbursement_id}/reject", response_model=schemas.Reimbursement, dependencies=[_need(P.REIMBURSEMENT_APPROVAL_APPROVE)])
def reject_reimbursement(reimbursement_id: RowId, data: schemas.ReimbursementReject, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.ReimbursementService(db).reject_reimbursement(reimbursement_id, data, current_user)


@router.post("/reimbursements/{reimbursement_id}/verify", response_model=schemas.Reimbursement, dependencies=[_need(P.REIMBURSEMENT_APPROVAL_APPROVE)])
def verify_reimbursement(reimbursement_id: RowId, data: schemas.ReimbursementVerify, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.ReimbursementService(db).verify_reimbursement(reimbursement_id, data, current_user)


@router.post("/reimbursements/{reimbursement_id}/pay", response_model=schemas.Reimbursement, dependencies=[_need(P.REIMBURSEMENT_APPROVAL_APPROVE)])
def process_reimbursement_payment(reimbursement_id: RowId, data: schemas.ReimbursementPayment, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.ReimbursementService(db).process_payment(reimbursement_id, data, current_user)


@router.delete("/reimbursements/{reimbursement_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_need(P.REIMBURSEMENT_DELETE)])
def delete_reimbursement(reimbursement_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service.ReimbursementService(db).delete_reimbursement(reimbursement_id, current_user)


# ───────────────────────────── payroll ─────────────────────────────
@router.post("/payroll", response_model=schemas.EmployeePayrollResponse, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.PAYROLL_CREATE)])
def create_payroll(payroll: schemas.EmployeePayrollCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """A manual payroll record (outside a payroll run). Gross / deductions / net are computed by the server."""
    return service.PayrollService(db).create_payroll(payroll, current_user.id)


# NOTE: static /payroll/batches routes MUST be declared before /payroll/{payroll_id}.
@router.get("/payroll/batches", response_model=List[schemas.PayrollBatchResponse], dependencies=[SEE_PAYROLL])
def list_payroll_batches(
    payroll_month: Optional[int] = Query(None, ge=1, le=12),
    payroll_year: Optional[int] = Query(None, ge=2000, le=2100),
    status_filter: Optional[str] = Query(None, alias="status", max_length=30),
    skip: Skip = 0,
    limit: Limit = 100,
    db: Session = Depends(get_db),
):
    filters = schemas.PayrollBatchListFilter(payroll_month=payroll_month, payroll_year=payroll_year, status=status_filter, skip=skip, limit=limit)
    return service.PayrollService(db).list_batches(filters)


@router.get("/payroll/batches/{batch_id}", response_model=schemas.PayrollBatchResponse, dependencies=[SEE_PAYROLL])
def get_payroll_batch(batch_id: RowId, db: Session = Depends(get_db)):
    return service.PayrollService(db).get_batch(batch_id)


@router.get("/payroll/{payroll_id}", response_model=schemas.EmployeePayrollResponse, dependencies=[SEE_PAYROLL])
def get_payroll(payroll_id: RowId, db: Session = Depends(get_db)):
    return service.PayrollService(db).get_payroll(payroll_id)


@router.get("/payroll", response_model=List[schemas.EmployeePayrollResponse], dependencies=[SEE_PAYROLL])
def list_payrolls(employee_id: EmpCode = None, skip: Skip = 0, limit: Limit = 100, db: Session = Depends(get_db)):
    filters = schemas.HRListFilter(employee_id=employee_id, skip=skip, limit=limit)
    return service.PayrollService(db).list_payrolls(filters)


@router.put("/payroll/{payroll_id}", response_model=schemas.EmployeePayrollResponse, dependencies=[_need(P.PAYROLL_UPDATE)])
def update_payroll(payroll_id: RowId, payroll: schemas.EmployeePayrollCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PayrollService(db).update_payroll(payroll_id, payroll, current_user.id)


@router.delete("/payroll/{payroll_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_need(P.PAYROLL_DELETE)])
def delete_payroll(payroll_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service.PayrollService(db).delete_payroll(payroll_id, current_user.id)


@router.post("/payroll/run", response_model=schemas.PayrollBatchResponse, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.PAYROLL_PROCESSING_CREATE)])
def trigger_payroll_run(data: schemas.PayrollRunRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Generate payroll records for every employee in service who has a salary profile."""
    return service.PayrollService(db).trigger_payroll_run(data, current_user.id)


@router.post("/payroll/batches/{batch_id}/submit", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_PROCESSING_CREATE)])
def submit_payroll_batch(batch_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PayrollService(db).submit_batch(batch_id, current_user.id)


@router.post("/payroll/batches/{batch_id}/approve", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_APPROVAL_APPROVE)])
def approve_payroll_batch(batch_id: RowId, data: schemas.PayrollBatchApprove, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = service.PayrollService(db).approve_batch(batch_id, data, current_user)
    from app.modules.notifications import dispatcher as notify
    if result.created_by and result.created_by != current_user.id:
        notify.user(result.created_by, title="Payroll Approved", message=f"Payroll batch {result.batch_no} was approved.",
                    notification_type=notify.SUCCESS, category=notify.HR, action_url="/hr/payroll")
    return result


@router.post("/payroll/batches/{batch_id}/reject", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_APPROVAL_APPROVE)])
def reject_payroll_batch(batch_id: RowId, data: schemas.PayrollBatchReject, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = service.PayrollService(db).reject_batch(batch_id, data, current_user.id)
    from app.modules.notifications import dispatcher as notify
    if result.created_by and result.created_by != current_user.id:
        notify.user(result.created_by, title="Payroll Rejected", message=f"Payroll batch {result.batch_no} was rejected: {data.rejection_reason}",
                    notification_type=notify.WARNING, category=notify.HR, action_url="/hr/payroll")
    return result


@router.post("/payroll/batches/{batch_id}/process-payment", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_PROCESSING_CREATE)])
def process_salary_payment(batch_id: RowId, data: schemas.PayrollBatchProcessPayment, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PayrollService(db).process_salary_payment(batch_id, data, current_user.id)


@router.post("/payroll/batches/{batch_id}/process-statutory", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_PROCESSING_CREATE)])
def process_statutory_payment(batch_id: RowId, data: schemas.PayrollBatchProcessStatutory, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PayrollService(db).process_statutory_payment(batch_id, data, current_user.id)


@router.post("/payroll/batches/{batch_id}/complete", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_PROCESSING_CREATE)])
def complete_payroll_batch(batch_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PayrollService(db).complete_batch(batch_id, current_user.id)


@router.post("/payroll/batches/{batch_id}/cancel", response_model=schemas.PayrollBatchResponse, dependencies=[_need(P.PAYROLL_PROCESSING_CREATE)])
def cancel_payroll_batch(batch_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PayrollService(db).cancel_batch(batch_id, current_user.id)


# ───────────────────────────── salary profiles ─────────────────────────────
@router.post("/salary-profiles", response_model=schemas.EmployeeSalaryProfile, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.SALARY_PROFILE_CREATE)])
def create_salary_profile(profile: schemas.EmployeeSalaryProfileCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.SalaryProfileService(db).create_profile(profile, current_user.id)


@router.get("/salary-profiles", response_model=List[schemas.EmployeeSalaryProfile], dependencies=[SEE_SALARY])
def list_salary_profiles(db: Session = Depends(get_db)):
    return service.SalaryProfileService(db).list_profiles()


@router.get("/salary-profiles/{profile_id}", response_model=schemas.EmployeeSalaryProfile, dependencies=[SEE_SALARY])
def get_salary_profile(profile_id: RowId, db: Session = Depends(get_db)):
    return service.SalaryProfileService(db).get_profile(profile_id)


@router.get("/employees/{employee_id}/salary-profile", response_model=schemas.EmployeeSalaryProfile, dependencies=[SEE_SALARY])
def get_employee_salary_profile(employee_id: Annotated[str, Path(min_length=1, max_length=50)], db: Session = Depends(get_db)):
    return service.SalaryProfileService(db).get_by_employee(employee_id)


@router.put("/salary-profiles/{profile_id}", response_model=schemas.EmployeeSalaryProfile, dependencies=[_need(P.SALARY_PROFILE_UPDATE)])
def update_salary_profile(profile_id: RowId, profile: schemas.EmployeeSalaryProfileCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.SalaryProfileService(db).update_profile(profile_id, profile, current_user.id)


@router.delete("/salary-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_need(P.SALARY_PROFILE_DELETE)])
def delete_salary_profile(profile_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service.SalaryProfileService(db).delete_profile(profile_id, current_user.id)


# ───────────────────────────── promotions ─────────────────────────────
@router.post("/promotions", response_model=schemas.EmployeePromotion, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.PROMOTION_CREATE)])
def create_promotion(promotion: schemas.EmployeePromotionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PromotionService(db).create_promotion(promotion, current_user.id)


@router.get("/promotions/{promotion_id}", response_model=schemas.EmployeePromotion, dependencies=[SEE_PROMOTIONS])
def get_promotion(promotion_id: RowId, db: Session = Depends(get_db)):
    return service.PromotionService(db).get_promotion(promotion_id)


@router.get("/promotions", response_model=List[schemas.EmployeePromotion], dependencies=[SEE_PROMOTIONS])
def list_promotions(employee_id: EmpCode = None, date_from: Optional[date] = None, date_to: Optional[date] = None, skip: Skip = 0, limit: Limit = 100, db: Session = Depends(get_db)):
    filters = schemas.HRListFilter(employee_id=employee_id, date_from=date_from, date_to=date_to, skip=skip, limit=limit)
    return service.PromotionService(db).list_promotions(filters)


@router.put("/promotions/{promotion_id}", response_model=schemas.EmployeePromotion, dependencies=[_need(P.PROMOTION_UPDATE)])
def update_promotion(promotion_id: RowId, promotion: schemas.EmployeePromotionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.PromotionService(db).update_promotion(promotion_id, promotion, current_user.id)


@router.delete("/promotions/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_need(P.PROMOTION_DELETE)])
def delete_promotion(promotion_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service.PromotionService(db).delete_promotion(promotion_id, current_user.id)


# ───────────────────────────── employee assets ─────────────────────────────
@router.post("/employee-assets", response_model=schemas.EmployeeAsset, status_code=status.HTTP_201_CREATED, dependencies=[_need(P.HR_ASSET_CREATE)])
def create_asset_assignment(asset: schemas.EmployeeAssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.EmployeeAssetService(db).create_asset_assignment(asset, current_user.id)


@router.get("/employee-assets/{assignment_id}", response_model=schemas.EmployeeAsset, dependencies=[SEE_ASSETS])
def get_asset_assignment(assignment_id: RowId, db: Session = Depends(get_db)):
    return service.EmployeeAssetService(db).get_asset_assignment(assignment_id)


@router.get("/employee-assets", response_model=List[schemas.EmployeeAsset], dependencies=[SEE_ASSETS])
def list_asset_assignments(employee_id: EmpCode = None, skip: Skip = 0, limit: Limit = 100, db: Session = Depends(get_db)):
    filters = schemas.HRListFilter(employee_id=employee_id, skip=skip, limit=limit)
    return service.EmployeeAssetService(db).list_asset_assignments(filters)


@router.put("/employee-assets/{assignment_id}", response_model=schemas.EmployeeAsset, dependencies=[_need(P.HR_ASSET_UPDATE)])
def update_asset_assignment(assignment_id: RowId, asset: schemas.EmployeeAssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.EmployeeAssetService(db).update_asset_assignment(assignment_id, asset, current_user.id)


@router.delete("/employee-assets/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_need(P.HR_ASSET_DELETE)])
def delete_asset_assignment(assignment_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service.EmployeeAssetService(db).delete_asset_assignment(assignment_id, current_user.id)
