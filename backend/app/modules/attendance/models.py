from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
)
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.common.base_models import AuditMixin


class Attendance(Base, AuditMixin):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False, index=True)
    branch_code = Column(String(255), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
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

    employee = relationship("Employee", back_populates="attendance_records")


class Leaves(Base, AuditMixin):
    __tablename__ = "leaves"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False, index=True)
    leave_type = Column(String(255))
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    leave_reason = Column(Text, nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)
    leave_duration = Column(Float, nullable=False)
    leave_time = Column(String(10), nullable=False, default="FULL DAY")
    # Workflow fields
    status = Column(String(20), nullable=False, default="pending", index=True)
    approved_by = Column(Integer, nullable=True)
    approved_date = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=True)

    employee = relationship("Employee", back_populates="leaves")
    approval = relationship("Approvals", back_populates="leaves")
