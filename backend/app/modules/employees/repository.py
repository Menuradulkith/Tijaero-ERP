from typing import List, Optional
from sqlalchemy.orm import Session
from app.modules.employees.models import Employee, EmployeePayroll, EmployeeSalaryProfile
from app.modules.employees.schemas import EmployeeCreate, EmployeeUpdate, EmployeePayrollCreate, EmployeeSalaryProfileCreate

class EmployeeRepository:
    def get_by_id(self, db: Session, employee_id: int) -> Optional[Employee]:
        return db.query(Employee).filter(Employee.id == employee_id).first()
    
    def get_by_employee_id(self, db: Session, employee_id: str) -> Optional[Employee]:
        return db.query(Employee).filter(Employee.employee_id == employee_id).first()
    
    def get_by_user_id(self, db: Session, user_id: int) -> Optional[Employee]:
        return db.query(Employee).filter(Employee.user_id == user_id).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[Employee]:
        return db.query(Employee).offset(skip).limit(limit).all()
    
    def create(self, db: Session, employee: EmployeeCreate) -> Employee:
        db_employee = Employee(**employee.dict())
        db.add(db_employee)
        db.commit()
        db.refresh(db_employee)
        return db_employee
    
    def update(self, db: Session, employee_id: int, employee: EmployeeUpdate) -> Optional[Employee]:
        db_employee = self.get_by_id(db, employee_id)
        if not db_employee:
            return None
        
        update_data = employee.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_employee, field, value)
        
        db.commit()
        db.refresh(db_employee)
        return db_employee
    
    def delete(self, db: Session, employee_id: int) -> bool:
        db_employee = self.get_by_id(db, employee_id)
        if not db_employee:
            return False
        db.delete(db_employee)
        db.commit()
        return True

class EmployeePayrollRepository:
    def get_by_employee_id(self, db: Session, employee_id: str) -> List[EmployeePayroll]:
        return db.query(EmployeePayroll).filter(EmployeePayroll.employee_id == employee_id).all()
    
    def create(self, db: Session, payroll: EmployeePayrollCreate) -> EmployeePayroll:
        db_payroll = EmployeePayroll(**payroll.dict())
        db.add(db_payroll)
        db.commit()
        db.refresh(db_payroll)
        return db_payroll

class EmployeeSalaryProfileRepository:
    def get_by_employee_id(self, db: Session, employee_id: str) -> Optional[EmployeeSalaryProfile]:
        return db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.employee_id == employee_id).first()
    
    def create(self, db: Session, profile: EmployeeSalaryProfileCreate) -> EmployeeSalaryProfile:
        db_profile = EmployeeSalaryProfile(**profile.dict())
        db.add(db_profile)
        db.commit()
        db.refresh(db_profile)
        return db_profile

employee_repository = EmployeeRepository()
employee_payroll_repository = EmployeePayrollRepository()
employee_salary_profile_repository = EmployeeSalaryProfileRepository()
