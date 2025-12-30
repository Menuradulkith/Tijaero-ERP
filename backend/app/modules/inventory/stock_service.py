from sqlalchemy.orm import Session
from app.modules.inventory.models import Product

class StockService:
    def adjust_stock(self, db: Session, product_id: int, quantity: float):
        product = db.query(Product).filter(Product.id == product_id).first()
        if product:
            product.stock_quantity += quantity
            db.commit()
        return product

stock_service = StockService()
