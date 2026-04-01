from sqlalchemy.orm import Session
from app.common.base_repository import BaseRepository
from app.modules.hr.models import Employee


class HRRepository(BaseRepository[Employee]):
    model = Employee


hr_repository = HRRepository()
