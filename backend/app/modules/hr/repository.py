from sqlalchemy.orm import Session
from app.modules.hr.models import Employee

class HRRepository:
    def get_by_id(self, db: Session, employee_id: int):
        return db.query(Employee).filter(Employee.id == employee_id).first()

hr_repository = HRRepository()
