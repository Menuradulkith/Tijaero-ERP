from app.common.base_models import TimestampMixin, AuditMixin
from app.db.base import Base
from sqlalchemy import Column, ForeignKey, Integer, String


class Attachment(Base, AuditMixin):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String)
    file_size = Column(Integer)
    entity_type = Column(String, nullable=False)
    entity_id = Column(Integer, nullable=False)
    uploaded_by = Column(Integer, ForeignKey("accounts_user.id"))
    uploaded_by = Column(Integer, ForeignKey("accounts_user.id"))
