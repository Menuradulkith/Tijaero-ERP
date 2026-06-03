from enum import Enum

from app.common.base_models import TimestampMixin, AuditMixin
from app.db.base import Base
from sqlalchemy import Column, ForeignKey, Integer, String


class WorkflowStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class WorkflowStep(Base, AuditMixin):
    __tablename__ = "workflow_steps"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String, nullable=False)
    entity_id = Column(Integer, nullable=False)
    step_name = Column(String, nullable=False)
    status = Column(String, default=WorkflowStatus.PENDING)
    approver_id = Column(Integer, ForeignKey("accounts_user.id"))
    comments = Column(String)
