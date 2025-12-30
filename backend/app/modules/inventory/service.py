from sqlalchemy.orm import Session
from app.modules.inventory import repository

class InventoryService:
    def get_product(self, db: Session, product_id: int):
        return repository.inventory_repository.get_by_id(db, product_id)

inventory_service = InventoryService()
