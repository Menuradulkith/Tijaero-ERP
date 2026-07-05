from datetime import date
from typing import List, Optional

from app.auth.dependencies import (
    get_current_active_user,
    get_current_user,
    get_user_branch_filter,
    validate_branch_access,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from . import schemas, service

# All HR endpoints require view permission as baseline
router = APIRouter(
    prefix="/hr",
    tags=["hr"],
    dependencies=[Depends(require_permission(*Permissions.HR_DASHBOARD_VIEW))],
)


# Salary Deductions Endpoints
@router.post(
    "/deductions",
    response_model=schemas.SalaryDeduction,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.DEDUCTION_CREATE))],
)
def create_salary_deduction(
    deduction: schemas.SalaryDeductionCreate, db: Session = Depends(get_db)
):
    """Create a new salary deduction"""
    deduction_service = service.SalaryDeductionService(db)
    return deduction_service.create_deduction(deduction)


@router.get("/deductions/{deduction_id}", response_model=schemas.SalaryDeduction)
def get_salary_deduction(deduction_id: int, db: Session = Depends(get_db)):
    """Get salary deduction by ID"""
    deduction_service = service.SalaryDeductionService(db)
    return deduction_service.get_deduction(deduction_id)


@router.get("/deductions", response_model=List[schemas.SalaryDeduction])
def list_salary_deductions(
    employee_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    """List all salary deductions with optional filters"""
    deduction_service = service.SalaryDeductionService(db)
    filters = schemas.HRListFilter(
        employee_id=str(employee_id) if employee_id else None, skip=skip, limit=limit
    )
    return deduction_service.list_deductions(filters)


@router.put(
    "/deductions/{deduction_id}",
    response_model=schemas.SalaryDeduction,
    dependencies=[Depends(require_permission(*Permissions.DEDUCTION_UPDATE))],
)
def update_salary_deduction(
    deduction_id: int,
    deduction: schemas.SalaryDeductionCreate,
    db: Session = Depends(get_db),
):
    """Update a salary deduction"""
    deduction_service = service.SalaryDeductionService(db)
    return deduction_service.update_deduction(deduction_id, deduction)


@router.delete(
    "/deductions/{deduction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.DEDUCTION_DELETE))],
)
def delete_salary_deduction(deduction_id: int, db: Session = Depends(get_db)):
    """Delete a salary deduction"""
    deduction_service = service.SalaryDeductionService(db)
    deduction_service.delete_deduction(deduction_id)


# Reimbursements Endpoints
@router.post(
    "/reimbursements",
    response_model=schemas.Reimbursement,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_CREATE))],
)
def create_reimbursement(
    reimbursement: schemas.ReimbursementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new reimbursement claim with line items."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.create_reimbursement(
        reimbursement, created_by=current_user.id
    )


@router.get("/reimbursements/{reimbursement_id}", response_model=schemas.Reimbursement)
def get_reimbursement(
    reimbursement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get reimbursement by ID with items."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.get_reimbursement(reimbursement_id)


@router.get("/reimbursements", response_model=List[schemas.Reimbursement])
def list_reimbursements(
    employee_id: Optional[str] = None,
    branch_code: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all reimbursements with optional filters."""
    reimbursement_service = service.ReimbursementService(db)
    filters = schemas.ReimbursementListFilter(
        employee_id=employee_id,
        branch_code=branch_code,
        status=status_filter,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit,
    )
    return reimbursement_service.list_reimbursements(filters)


@router.patch(
    "/reimbursements/{reimbursement_id}",
    response_model=schemas.Reimbursement,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_UPDATE))],
)
def update_reimbursement(
    reimbursement_id: int,
    reimbursement: schemas.ReimbursementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a pending reimbursement."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.update_reimbursement(reimbursement_id, reimbursement)


@router.post(
    "/reimbursements/{reimbursement_id}/approve",
    response_model=schemas.Reimbursement,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_APPROVAL_APPROVE))],
)
def approve_reimbursement(
    reimbursement_id: int,
    data: schemas.ReimbursementApprove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve or partially approve a reimbursement claim."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.approve_reimbursement(
        reimbursement_id, data, current_user.id
    )


@router.post(
    "/reimbursements/{reimbursement_id}/reject",
    response_model=schemas.Reimbursement,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_APPROVAL_APPROVE))],
)
def reject_reimbursement(
    reimbursement_id: int,
    data: schemas.ReimbursementReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject a reimbursement claim."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.reject_reimbursement(
        reimbursement_id, data, current_user.id
    )


@router.post(
    "/reimbursements/{reimbursement_id}/verify",
    response_model=schemas.Reimbursement,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_APPROVAL_APPROVE))],
)
def verify_reimbursement(
    reimbursement_id: int,
    data: schemas.ReimbursementVerify,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Finance verification of an approved reimbursement."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.verify_reimbursement(
        reimbursement_id, data, current_user.id
    )


@router.post(
    "/reimbursements/{reimbursement_id}/pay",
    response_model=schemas.Reimbursement,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_APPROVAL_APPROVE))],
)
def process_reimbursement_payment(
    reimbursement_id: int,
    data: schemas.ReimbursementPayment,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Process payment for a verified reimbursement."""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.process_payment(
        reimbursement_id, data, current_user.id
    )


@router.delete(
    "/reimbursements/{reimbursement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.REIMBURSEMENT_DELETE))],
)
def delete_reimbursement(
    reimbursement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a pending/rejected reimbursement."""
    reimbursement_service = service.ReimbursementService(db)
    reimbursement_service.delete_reimbursement(reimbursement_id)


# Payroll Endpoints
@router.post(
    "/payroll",
    response_model=schemas.EmployeePayrollResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_CREATE))],
)
def create_payroll(
    payroll: schemas.EmployeePayrollCreate, db: Session = Depends(get_db)
):
    """Create a new payroll record"""
    payroll_service = service.PayrollService(db)
    return payroll_service.create_payroll(payroll)


# NOTE: static /payroll/batches routes MUST be declared before /payroll/{payroll_id};
# otherwise Starlette matches "batches" as payroll_id and returns 422.
@router.get("/payroll/batches", response_model=List[schemas.PayrollBatchResponse])
def list_payroll_batches(
    payroll_month: Optional[int] = None,
    payroll_year: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all payroll batches with optional filters."""
    payroll_service = service.PayrollService(db)
    filters = schemas.PayrollBatchListFilter(
        payroll_month=payroll_month,
        payroll_year=payroll_year,
        status=status_filter,
        skip=skip,
        limit=limit,
    )
    return payroll_service.list_batches(filters)


@router.get("/payroll/batches/{batch_id}", response_model=schemas.PayrollBatchResponse)
def get_payroll_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get payroll batch by ID with all payroll records."""
    payroll_service = service.PayrollService(db)
    return payroll_service.get_batch(batch_id)


@router.get("/payroll/{payroll_id}", response_model=schemas.EmployeePayrollResponse)
def get_payroll(payroll_id: int, db: Session = Depends(get_db)):
    """Get payroll by ID"""
    payroll_service = service.PayrollService(db)
    return payroll_service.get_payroll(payroll_id)


@router.get("/payroll", response_model=List[schemas.EmployeePayrollResponse])
def list_payrolls(
    employee_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    """List all payroll records with optional filters"""
    payroll_service = service.PayrollService(db)
    filters = schemas.HRListFilter(employee_id=employee_id, skip=skip, limit=limit)
    return payroll_service.list_payrolls(filters)


@router.put(
    "/payroll/{payroll_id}",
    response_model=schemas.EmployeePayrollResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_UPDATE))],
)
def update_payroll(
    payroll_id: int,
    payroll: schemas.EmployeePayrollCreate,
    db: Session = Depends(get_db),
):
    """Update a payroll record"""
    payroll_service = service.PayrollService(db)
    return payroll_service.update_payroll(payroll_id, payroll)


@router.delete(
    "/payroll/{payroll_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_DELETE))],
)
def delete_payroll(payroll_id: int, db: Session = Depends(get_db)):
    """Delete a payroll record"""
    payroll_service = service.PayrollService(db)
    payroll_service.delete_payroll(payroll_id)


# --- Payroll Batch / Workflow Endpoints ---


@router.post(
    "/payroll/run",
    response_model=schemas.PayrollBatchResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_PROCESSING_CREATE))],
)
def trigger_payroll_run(
    data: schemas.PayrollRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 3: Trigger payroll processing. Generates payroll records for all employees with salary profiles."""
    payroll_service = service.PayrollService(db)
    return payroll_service.trigger_payroll_run(data, current_user.id)


@router.post(
    "/payroll/batches/{batch_id}/submit",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_PROCESSING_CREATE))],
)
def submit_payroll_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 5: Submit payroll batch for approval after review."""
    payroll_service = service.PayrollService(db)
    return payroll_service.submit_batch(batch_id, current_user.id)


@router.post(
    "/payroll/batches/{batch_id}/approve",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_APPROVAL_APPROVE))],
)
def approve_payroll_batch(
    batch_id: int,
    data: schemas.PayrollBatchApprove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 6: Approve payroll batch."""
    payroll_service = service.PayrollService(db)
    result = payroll_service.approve_batch(batch_id, data, current_user.id)

    # Notify the batch creator that their submission was approved.
    from app.modules.notifications import dispatcher as notify

    if result.created_by and result.created_by != current_user.id:
        notify.user(
            result.created_by,
            title="Payroll Approved",
            message=f"Payroll batch {result.batch_no} was approved.",
            notification_type=notify.SUCCESS,
            category=notify.HR,
            action_url="/hr/payroll",
        )
    return result


@router.post(
    "/payroll/batches/{batch_id}/reject",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_APPROVAL_APPROVE))],
)
def reject_payroll_batch(
    batch_id: int,
    data: schemas.PayrollBatchReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject payroll batch back to draft."""
    payroll_service = service.PayrollService(db)
    result = payroll_service.reject_batch(batch_id, data, current_user.id)

    # Notify the batch creator that their submission was returned to draft.
    from app.modules.notifications import dispatcher as notify

    if result.created_by and result.created_by != current_user.id:
        notify.user(
            result.created_by,
            title="Payroll Rejected",
            message=(
                f"Payroll batch {result.batch_no} was rejected: "
                f"{data.rejection_reason}"
            ),
            notification_type=notify.WARNING,
            category=notify.HR,
            action_url="/hr/payroll",
        )
    return result


@router.post(
    "/payroll/batches/{batch_id}/process-payment",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_PROCESSING_CREATE))],
)
def process_salary_payment(
    batch_id: int,
    data: schemas.PayrollBatchProcessPayment,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 7: Process salary payments for all employees in the batch."""
    payroll_service = service.PayrollService(db)
    return payroll_service.process_salary_payment(batch_id, data, current_user.id)


@router.post(
    "/payroll/batches/{batch_id}/process-statutory",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_PROCESSING_CREATE))],
)
def process_statutory_payment(
    batch_id: int,
    data: schemas.PayrollBatchProcessStatutory,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 8: Process statutory payments (EPF/ETF) for the batch."""
    payroll_service = service.PayrollService(db)
    return payroll_service.process_statutory_payment(batch_id, data, current_user.id)


@router.post(
    "/payroll/batches/{batch_id}/complete",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_PROCESSING_CREATE))],
)
def complete_payroll_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 10: Complete the payroll cycle."""
    payroll_service = service.PayrollService(db)
    return payroll_service.complete_batch(batch_id, current_user.id)


@router.post(
    "/payroll/batches/{batch_id}/cancel",
    response_model=schemas.PayrollBatchResponse,
    dependencies=[Depends(require_permission(*Permissions.PAYROLL_PROCESSING_CREATE))],
)
def cancel_payroll_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel a payroll batch (only if not yet paid)."""
    payroll_service = service.PayrollService(db)
    return payroll_service.cancel_batch(batch_id, current_user.id)


# Salary Profile Endpoints
@router.post(
    "/salary-profiles",
    response_model=schemas.EmployeeSalaryProfile,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.SALARY_PROFILE_CREATE))],
)
def create_salary_profile(
    profile: schemas.EmployeeSalaryProfileCreate, db: Session = Depends(get_db)
):
    """Create a new salary profile"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.create_profile(profile)


@router.get("/salary-profiles", response_model=List[schemas.EmployeeSalaryProfile])
def list_salary_profiles(db: Session = Depends(get_db)):
    """List all salary profiles"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.list_profiles()


@router.get(
    "/salary-profiles/{profile_id}", response_model=schemas.EmployeeSalaryProfile
)
def get_salary_profile(profile_id: int, db: Session = Depends(get_db)):
    """Get salary profile by ID"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.get_profile(profile_id)


@router.get(
    "/employees/{employee_id}/salary-profile",
    response_model=schemas.EmployeeSalaryProfile,
)
def get_employee_salary_profile(employee_id: str, db: Session = Depends(get_db)):
    """Get salary profile by employee ID"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.get_by_employee(employee_id)


@router.put(
    "/salary-profiles/{profile_id}",
    response_model=schemas.EmployeeSalaryProfile,
    dependencies=[Depends(require_permission(*Permissions.SALARY_PROFILE_UPDATE))],
)
def update_salary_profile(
    profile_id: int,
    profile: schemas.EmployeeSalaryProfileCreate,
    db: Session = Depends(get_db),
):
    """Update a salary profile"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.update_profile(profile_id, profile)


@router.delete(
    "/salary-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.SALARY_PROFILE_DELETE))],
)
def delete_salary_profile(profile_id: int, db: Session = Depends(get_db)):
    """Delete a salary profile"""
    profile_service = service.SalaryProfileService(db)
    profile_service.delete_profile(profile_id)


# Promotions Endpoints
@router.post(
    "/promotions",
    response_model=schemas.EmployeePromotion,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.PROMOTION_CREATE))],
)
def create_promotion(
    promotion: schemas.EmployeePromotionCreate, db: Session = Depends(get_db)
):
    """Create a new promotion record"""
    promotion_service = service.PromotionService(db)
    return promotion_service.create_promotion(promotion)


@router.get("/promotions/{promotion_id}", response_model=schemas.EmployeePromotion)
def get_promotion(promotion_id: int, db: Session = Depends(get_db)):
    """Get promotion by ID"""
    promotion_service = service.PromotionService(db)
    return promotion_service.get_promotion(promotion_id)


@router.get("/promotions", response_model=List[schemas.EmployeePromotion])
def list_promotions(
    employee_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    """List all promotions with optional filters"""
    promotion_service = service.PromotionService(db)
    filters = schemas.HRListFilter(
        employee_id=employee_id,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit,
    )
    return promotion_service.list_promotions(filters)


@router.put(
    "/promotions/{promotion_id}",
    response_model=schemas.EmployeePromotion,
    dependencies=[Depends(require_permission(*Permissions.PROMOTION_UPDATE))],
)
def update_promotion(
    promotion_id: int,
    promotion: schemas.EmployeePromotionCreate,
    db: Session = Depends(get_db),
):
    """Update a promotion record"""
    promotion_service = service.PromotionService(db)
    return promotion_service.update_promotion(promotion_id, promotion)


@router.delete(
    "/promotions/{promotion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.PROMOTION_DELETE))],
)
def delete_promotion(promotion_id: int, db: Session = Depends(get_db)):
    """Delete a promotion record"""
    promotion_service = service.PromotionService(db)
    promotion_service.delete_promotion(promotion_id)


# Employee Assets Endpoints
@router.post(
    "/employee-assets",
    response_model=schemas.EmployeeAsset,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.HR_ASSET_CREATE))],
)
def create_asset_assignment(
    asset: schemas.EmployeeAssetCreate, db: Session = Depends(get_db)
):
    """Create a new employee asset assignment"""
    asset_service = service.EmployeeAssetService(db)
    return asset_service.create_asset_assignment(asset)


@router.get("/employee-assets/{assignment_id}", response_model=schemas.EmployeeAsset)
def get_asset_assignment(assignment_id: int, db: Session = Depends(get_db)):
    """Get asset assignment by ID"""
    asset_service = service.EmployeeAssetService(db)
    return asset_service.get_asset_assignment(assignment_id)


@router.get("/employee-assets", response_model=List[schemas.EmployeeAsset])
def list_asset_assignments(
    employee_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    """List all employee asset assignments with optional filters"""
    asset_service = service.EmployeeAssetService(db)
    filters = schemas.HRListFilter(employee_id=employee_id, skip=skip, limit=limit)
    return asset_service.list_asset_assignments(filters)


@router.put(
    "/employee-assets/{assignment_id}",
    response_model=schemas.EmployeeAsset,
    dependencies=[Depends(require_permission(*Permissions.HR_ASSET_UPDATE))],
)
def update_asset_assignment(
    assignment_id: int,
    asset: schemas.EmployeeAssetCreate,
    db: Session = Depends(get_db),
):
    """Update an employee asset assignment"""
    asset_service = service.EmployeeAssetService(db)
    return asset_service.update_asset_assignment(assignment_id, asset)


@router.delete(
    "/employee-assets/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.HR_ASSET_DELETE))],
)
def delete_asset_assignment(assignment_id: int, db: Session = Depends(get_db)):
    """Delete an employee asset assignment"""
    asset_service = service.EmployeeAssetService(db)
    asset_service.delete_asset_assignment(assignment_id)
