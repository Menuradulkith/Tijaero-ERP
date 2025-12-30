from typing import List
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.modules.employees import repository, schemas

class EmployeeService:
    def get_employee(self, db: Session, employee_id: int) -> schemas.Employee:
        employee = repository.employee_repository.get_by_id(db, employee_id)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee with id {employee_id} not found"
            )
        return employee
    
    def get_all_employees(self, db: Session, skip: int = 0, limit: int = 100) -> List[schemas.Employee]:
        return repository.employee_repository.get_all(db, skip, limit)
    
    def create_employee(self, db: Session, employee: schemas.EmployeeCreate) -> schemas.Employee:
        # Check if employee_id already exists
        existing = repository.employee_repository.get_by_employee_id(db, employee.employee_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Employee with employee_id {employee.employee_id} already exists"
            )
        return repository.employee_repository.create(db, employee)
    
    def update_employee(self, db: Session, employee_id: int, employee: schemas.EmployeeUpdate) -> schemas.Employee:
        updated_employee = repository.employee_repository.update(db, employee_id, employee)
        if not updated_employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee with id {employee_id} not found"
            )
        return updated_employee
    
    def delete_employee(self, db: Session, employee_id: int) -> dict:
        success = repository.employee_repository.delete(db, employee_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee with id {employee_id} not found"
            )
        return {"message": "Employee deleted successfully"}

employee_service = EmployeeService()
