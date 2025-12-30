from sqlalchemy.orm import Session
from app.modules.support.models import SupportTicket

class SupportRepository:
    def get_by_id(self, db: Session, ticket_id: int):
        return db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()

support_repository = SupportRepository()
