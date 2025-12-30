from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Time, SmallInteger, Boolean, TIMESTAMP, Float
from sqlalchemy.orm import relationship
from app.db.base import Base

class Attendance(Base):
    __tablename__ = "attendance"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    branch_code = Column(String(255), nullable=False)
    date = Column(Date, nullable=False)
    weekday = Column(String(12))
    check_in = Column(Time)
    check_out = Column(Time)
    work_mins = Column(Integer, nullable=False, default=0)
    ot_mins = Column(Integer, nullable=False, default=0)
    full_attended_mins = Column(Integer, nullable=False, default=0)
    late_mins = Column(Integer, nullable=False, default=0)
    early_mins = Column(Integer, nullable=False, default=0)
    absent_mins = Column(Integer, nullable=False, default=0)
    leave_mins = Column(Integer, nullable=False, default=0)
    
    # Relationships
    employee = relationship("Employee", back_populates="attendance_records")

class Leaves(Base):
    __tablename__ = "leaves"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), unique=True, nullable=False)
    leave_type = Column(String(255))
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    leave_reason = Column(Text, nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=False)
    leave_duration = Column(Float, nullable=False)
    leave_time = Column(String(10), nullable=False, default="FULL DAY")
    
    # Relationships
    employee = relationship("Employee", back_populates="leaves")
    approval = relationship("Approvals", back_populates="leaves")
