from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base

class SalaryDeductions(Base):
    __tablename__ = "salary_deductions"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    reason = Column(Text, nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    
    # Relationships
    employee = relationship("Employee", back_populates="salary_deductions")
    approval = relationship("Approvals", back_populates="salary_deductions")

class Reimbursements(Base):
    __tablename__ = "reimbursements"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), unique=True, nullable=False)
    reimbursement_amount = Column(Numeric(60, 2), nullable=False, default=0)
    bill_date = Column(Date, nullable=False)
    remark = Column(Text, nullable=False)
    bill_image_path = Column(Text)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=False)
    
    # Relationships
    employee = relationship("Employee", back_populates="reimbursements")
    approval = relationship("Approvals", back_populates="reimbursements")
