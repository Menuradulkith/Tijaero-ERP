from sqlalchemy.orm import Session
from app.modules.inventory.models import Product

class InventoryRepository:
    def get_by_id(self, db: Session, product_id: int):
        return db.query(Product).filter(Product.id == product_id).first()

inventory_repository = InventoryRepository()
