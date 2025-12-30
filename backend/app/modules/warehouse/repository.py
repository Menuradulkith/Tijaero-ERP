from sqlalchemy.orm import Session
from app.modules.warehouse.models import Warehouse

class WarehouseRepository:
    def get_by_id(self, db: Session, warehouse_id: int):
        return db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()

warehouse_repository = WarehouseRepository()
