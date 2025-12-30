from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.reporting import sales_reports, inventory_reports, financial_reports

router = APIRouter()

@router.get("/sales/summary")
def sales_summary(db: Session = Depends(get_db)):
    return sales_reports.get_sales_summary(db)

@router.get("/inventory/stock")
def inventory_stock(db: Session = Depends(get_db)):
    return inventory_reports.get_stock_report(db)

@router.get("/financial/balance-sheet")
def balance_sheet(db: Session = Depends(get_db)):
    return financial_reports.get_balance_sheet(db)
