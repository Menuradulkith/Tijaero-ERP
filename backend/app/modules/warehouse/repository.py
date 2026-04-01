from sqlalchemy.orm import Session
from app.common.base_repository import BaseRepository
from app.modules.warehouse.models import Warehouse


class WarehouseRepository(BaseRepository[Warehouse]):
    model = Warehouse


warehouse_repository = WarehouseRepository()
