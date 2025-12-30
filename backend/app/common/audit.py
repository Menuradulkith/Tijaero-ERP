from sqlalchemy import Column, Integer, String, DateTime, JSON
from datetime import datetime
from app.db.base import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False)
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)
    entity_id = Column(Integer, nullable=False)
    changes = Column(JSON)
    timestamp = Column(DateTime, default=datetime.utcnow)

def log_audit(db, user_id: int, action: str, entity_type: str, entity_id: int, changes: dict):
    log = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        changes=changes
    )
    db.add(log)
    db.commit()
