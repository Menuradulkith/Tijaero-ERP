from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/hr", tags=["hr"])

# Salary Deductions Endpoints
@router.post("/deductions", response_model=schemas.SalaryDeduction, status_code=status.HTTP_201_CREATED)
def create_salary_deduction(
    deduction: schemas.SalaryDeductionCreate,
    db: Session = Depends(get_db)
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
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all salary deductions with optional filters"""
    deduction_service = service.SalaryDeductionService(db)
    filters = schemas.HRListFilter(
        employee_id=str(employee_id) if employee_id else None,
        skip=skip,
        limit=limit
    )
    return deduction_service.list_deductions(filters)

@router.put("/deductions/{deduction_id}", response_model=schemas.SalaryDeduction)
def update_salary_deduction(
    deduction_id: int,
    deduction: schemas.SalaryDeductionCreate,
    db: Session = Depends(get_db)
):
    """Update a salary deduction"""
    deduction_service = service.SalaryDeductionService(db)
    return deduction_service.update_deduction(deduction_id, deduction)

@router.delete("/deductions/{deduction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_salary_deduction(deduction_id: int, db: Session = Depends(get_db)):
    """Delete a salary deduction"""
    deduction_service = service.SalaryDeductionService(db)
    deduction_service.delete_deduction(deduction_id)

# Reimbursements Endpoints
@router.post("/reimbursements", response_model=schemas.Reimbursement, status_code=status.HTTP_201_CREATED)
def create_reimbursement(
    reimbursement: schemas.ReimbursementCreate,
    db: Session = Depends(get_db)
):
    """Create a new reimbursement"""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.create_reimbursement(reimbursement)

@router.get("/reimbursements/{reimbursement_id}", response_model=schemas.Reimbursement)
def get_reimbursement(reimbursement_id: int, db: Session = Depends(get_db)):
    """Get reimbursement by ID"""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.get_reimbursement(reimbursement_id)

@router.get("/reimbursements", response_model=List[schemas.Reimbursement])
def list_reimbursements(
    employee_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all reimbursements with optional filters"""
    reimbursement_service = service.ReimbursementService(db)
    filters = schemas.HRListFilter(
        employee_id=employee_id,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return reimbursement_service.list_reimbursements(filters)

@router.put("/reimbursements/{reimbursement_id}", response_model=schemas.Reimbursement)
def update_reimbursement(
    reimbursement_id: int,
    reimbursement: schemas.ReimbursementCreate,
    db: Session = Depends(get_db)
):
    """Update a reimbursement"""
    reimbursement_service = service.ReimbursementService(db)
    return reimbursement_service.update_reimbursement(reimbursement_id, reimbursement)

@router.delete("/reimbursements/{reimbursement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reimbursement(reimbursement_id: int, db: Session = Depends(get_db)):
    """Delete a reimbursement"""
    reimbursement_service = service.ReimbursementService(db)
    reimbursement_service.delete_reimbursement(reimbursement_id)

# Payroll Endpoints
@router.post("/payroll", response_model=schemas.EmployeePayroll, status_code=status.HTTP_201_CREATED)
def create_payroll(
    payroll: schemas.EmployeePayrollCreate,
    db: Session = Depends(get_db)
):
    """Create a new payroll record"""
    payroll_service = service.PayrollService(db)
    return payroll_service.create_payroll(payroll)

@router.get("/payroll/{payroll_id}", response_model=schemas.EmployeePayroll)
def get_payroll(payroll_id: int, db: Session = Depends(get_db)):
    """Get payroll by ID"""
    payroll_service = service.PayrollService(db)
    return payroll_service.get_payroll(payroll_id)

@router.get("/payroll", response_model=List[schemas.EmployeePayroll])
def list_payrolls(
    employee_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all payroll records with optional filters"""
    payroll_service = service.PayrollService(db)
    filters = schemas.HRListFilter(
        employee_id=employee_id,
        skip=skip,
        limit=limit
    )
    return payroll_service.list_payrolls(filters)

@router.put("/payroll/{payroll_id}", response_model=schemas.EmployeePayroll)
def update_payroll(
    payroll_id: int,
    payroll: schemas.EmployeePayrollCreate,
    db: Session = Depends(get_db)
):
    """Update a payroll record"""
    payroll_service = service.PayrollService(db)
    return payroll_service.update_payroll(payroll_id, payroll)

@router.delete("/payroll/{payroll_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payroll(payroll_id: int, db: Session = Depends(get_db)):
    """Delete a payroll record"""
    payroll_service = service.PayrollService(db)
    payroll_service.delete_payroll(payroll_id)

# Salary Profile Endpoints
@router.post("/salary-profiles", response_model=schemas.EmployeeSalaryProfile, status_code=status.HTTP_201_CREATED)
def create_salary_profile(
    profile: schemas.EmployeeSalaryProfileCreate,
    db: Session = Depends(get_db)
):
    """Create a new salary profile"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.create_profile(profile)

@router.get("/salary-profiles/{profile_id}", response_model=schemas.EmployeeSalaryProfile)
def get_salary_profile(profile_id: int, db: Session = Depends(get_db)):
    """Get salary profile by ID"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.get_profile(profile_id)

@router.get("/employees/{employee_id}/salary-profile", response_model=schemas.EmployeeSalaryProfile)
def get_employee_salary_profile(employee_id: str, db: Session = Depends(get_db)):
    """Get salary profile by employee ID"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.get_by_employee(employee_id)

@router.put("/salary-profiles/{profile_id}", response_model=schemas.EmployeeSalaryProfile)
def update_salary_profile(
    profile_id: int,
    profile: schemas.EmployeeSalaryProfileCreate,
    db: Session = Depends(get_db)
):
    """Update a salary profile"""
    profile_service = service.SalaryProfileService(db)
    return profile_service.update_profile(profile_id, profile)

@router.delete("/salary-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_salary_profile(profile_id: int, db: Session = Depends(get_db)):
    """Delete a salary profile"""
    profile_service = service.SalaryProfileService(db)
    profile_service.delete_profile(profile_id)

# Promotions Endpoints
@router.post("/promotions", response_model=schemas.EmployeePromotion, status_code=status.HTTP_201_CREATED)
def create_promotion(
    promotion: schemas.EmployeePromotionCreate,
    db: Session = Depends(get_db)
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
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all promotions with optional filters"""
    promotion_service = service.PromotionService(db)
    filters = schemas.HRListFilter(
        employee_id=employee_id,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return promotion_service.list_promotions(filters)

@router.put("/promotions/{promotion_id}", response_model=schemas.EmployeePromotion)
def update_promotion(
    promotion_id: int,
    promotion: schemas.EmployeePromotionCreate,
    db: Session = Depends(get_db)
):
    """Update a promotion record"""
    promotion_service = service.PromotionService(db)
    return promotion_service.update_promotion(promotion_id, promotion)

@router.delete("/promotions/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_promotion(promotion_id: int, db: Session = Depends(get_db)):
    """Delete a promotion record"""
    promotion_service = service.PromotionService(db)
    promotion_service.delete_promotion(promotion_id)

# Employee Assets Endpoints
@router.post("/employee-assets", response_model=schemas.EmployeeAsset, status_code=status.HTTP_201_CREATED)
def create_asset_assignment(
    asset: schemas.EmployeeAssetCreate,
    db: Session = Depends(get_db)
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
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all employee asset assignments with optional filters"""
    asset_service = service.EmployeeAssetService(db)
    filters = schemas.HRListFilter(
        employee_id=employee_id,
        skip=skip,
        limit=limit
    )
    return asset_service.list_asset_assignments(filters)

@router.put("/employee-assets/{assignment_id}", response_model=schemas.EmployeeAsset)
def update_asset_assignment(
    assignment_id: int,
    asset: schemas.EmployeeAssetCreate,
    db: Session = Depends(get_db)
):
    """Update an employee asset assignment"""
    asset_service = service.EmployeeAssetService(db)
    return asset_service.update_asset_assignment(assignment_id, asset)

@router.delete("/employee-assets/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_assignment(assignment_id: int, db: Session = Depends(get_db)):
    """Delete an employee asset assignment"""
    asset_service = service.EmployeeAssetService(db)
    asset_service.delete_asset_assignment(assignment_id)
