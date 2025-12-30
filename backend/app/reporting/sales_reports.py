from sqlalchemy.orm import Session
from sqlalchemy import func
from app.modules.sales.models import SalesOrder

def get_sales_summary(db: Session):
    total_sales = db.query(func.sum(SalesOrder.total_amount)).scalar() or 0
    order_count = db.query(func.count(SalesOrder.id)).scalar() or 0
    return {"total_sales": total_sales, "order_count": order_count}
