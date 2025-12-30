from sqlalchemy.orm import Session
from app.modules.inventory.models import Product

def get_stock_report(db: Session):
    products = db.query(Product).all()
    return [{"sku": p.sku, "name": p.name, "stock": p.stock_quantity} for p in products]
