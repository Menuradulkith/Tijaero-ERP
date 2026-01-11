from datetime import datetime

from app.db.base import Base
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship


class Report(Base):
    """Saved reports and report templates"""

    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    report_type = Column(String(50), nullable=False)  # sales, finance, inventory, etc.
    category = Column(String(50))  # summary, detailed, comparison, etc.
    parameters = Column(Text)  # JSON string of report parameters
    created_by = Column(Integer, ForeignKey("accounts_user.id"))
    created_date = Column(DateTime, default=datetime.utcnow)
    is_template = Column(Boolean, default=False)
    is_scheduled = Column(Boolean, default=False)
    schedule_frequency = Column(String(50))  # daily, weekly, monthly
    last_run = Column(DateTime)


class ReportExecution(Base):
    """Track report execution history"""

    __tablename__ = "report_executions"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"))
    executed_by = Column(Integer, ForeignKey("accounts_user.id"))
    execution_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50))  # success, failed, running
    parameters = Column(Text)  # JSON string of parameters used
    result_summary = Column(Text)  # JSON string of summary data
    execution_time = Column(Integer)  # milliseconds
    error_message = Column(Text)

    report = relationship("Report", backref="executions")

    report = relationship("Report", backref="executions")
