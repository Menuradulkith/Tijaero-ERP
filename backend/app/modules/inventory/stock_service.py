from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.modules.products.models import Product

class StockService:
    def adjust_stock(self, db: Session, product_id: int, quantity: float):
        """Adjust stock with row-level lock to prevent concurrent overwrites."""
        product = db.query(Product).filter(
            Product.id == product_id
        ).with_for_update().first()
        if product:
            product.stock_quantity += quantity
            db.commit()
        return product

stock_service = StockService()
