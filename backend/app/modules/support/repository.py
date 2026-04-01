from sqlalchemy.orm import Session
from app.common.base_repository import BaseRepository
from app.modules.support.models import SupportTicket


class SupportRepository(BaseRepository[SupportTicket]):
    model = SupportTicket


support_repository = SupportRepository()
