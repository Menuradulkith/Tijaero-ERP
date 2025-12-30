from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import date
from . import schemas
from .models import SalaryDeductions, Reimbursements
from app.modules.employees.models import EmployeePayroll, EmployeeSalaryProfile, EmployeePromotions, EmployeesAssets

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
    
    def create_reimbursement(self, reimbursement: schemas.ReimbursementCreate) -> Reimbursements:
        db_reimbursement = Reimbursements(**reimbursement.model_dump())
        self.db.add(db_reimbursement)
        self.db.commit()
        self.db.refresh(db_reimbursement)
        return db_reimbursement
    
    def get_reimbursement(self, reimbursement_id: int) -> Reimbursements:
        reimbursement = self.db.query(Reimbursements).filter(Reimbursements.id == reimbursement_id).first()
        if not reimbursement:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reimbursement not found")
        return reimbursement
    
    def list_reimbursements(self, filters: schemas.HRListFilter) -> List[Reimbursements]:
        query = self.db.query(Reimbursements)
        
        if filters.employee_id:
            query = query.filter(Reimbursements.employee_id == filters.employee_id)
        
        if filters.date_from:
            query = query.filter(Reimbursements.bill_date >= filters.date_from)
        
        if filters.date_to:
            query = query.filter(Reimbursements.bill_date <= filters.date_to)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_reimbursement(self, reimbursement_id: int, reimbursement: schemas.ReimbursementCreate) -> Reimbursements:
        db_reimbursement = self.get_reimbursement(reimbursement_id)
        for key, value in reimbursement.model_dump().items():
            setattr(db_reimbursement, key, value)
        self.db.commit()
        self.db.refresh(db_reimbursement)
        return db_reimbursement
    
    def delete_reimbursement(self, reimbursement_id: int):
        db_reimbursement = self.get_reimbursement(reimbursement_id)
        self.db.delete(db_reimbursement)
        self.db.commit()

# Payroll Service
class PayrollService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_payroll(self, payroll: schemas.EmployeePayrollCreate) -> EmployeePayroll:
        db_payroll = EmployeePayroll(**payroll.model_dump())
        self.db.add(db_payroll)
        self.db.commit()
        self.db.refresh(db_payroll)
        return db_payroll
    
    def get_payroll(self, payroll_id: int) -> EmployeePayroll:
        payroll = self.db.query(EmployeePayroll).filter(EmployeePayroll.id == payroll_id).first()
        if not payroll:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found")
        return payroll
    
    def list_payrolls(self, filters: schemas.HRListFilter) -> List[EmployeePayroll]:
        query = self.db.query(EmployeePayroll)
        
        if filters.employee_id:
            query = query.filter(EmployeePayroll.employee_id == filters.employee_id)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_payroll(self, payroll_id: int, payroll: schemas.EmployeePayrollCreate) -> EmployeePayroll:
        db_payroll = self.get_payroll(payroll_id)
        for key, value in payroll.model_dump().items():
            setattr(db_payroll, key, value)
        self.db.commit()
        self.db.refresh(db_payroll)
        return db_payroll
    
    def delete_payroll(self, payroll_id: int):
        db_payroll = self.get_payroll(payroll_id)
        self.db.delete(db_payroll)
        self.db.commit()

# Salary Profile Service
class SalaryProfileService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_profile(self, profile: schemas.EmployeeSalaryProfileCreate) -> EmployeeSalaryProfile:
        db_profile = EmployeeSalaryProfile(**profile.model_dump())
        self.db.add(db_profile)
        self.db.commit()
        self.db.refresh(db_profile)
        return db_profile
    
    def get_profile(self, profile_id: int) -> EmployeeSalaryProfile:
        profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.id == profile_id).first()
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        return profile
    
    def get_by_employee(self, employee_id: str) -> EmployeeSalaryProfile:
        profile = self.db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.employee_id == employee_id).first()
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary profile not found")
        return profile
    
    def update_profile(self, profile_id: int, profile: schemas.EmployeeSalaryProfileCreate) -> EmployeeSalaryProfile:
        db_profile = self.get_profile(profile_id)
        for key, value in profile.model_dump().items():
            setattr(db_profile, key, value)
        self.db.commit()
        self.db.refresh(db_profile)
        return db_profile
    
    def delete_profile(self, profile_id: int):
        db_profile = self.get_profile(profile_id)
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
