from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from typing import Literal, Optional
from app.db.session import get_db
from app.reporting import sales_reports, inventory_reports, financial_reports
from app.reporting.document_reports import get_document_report_service

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


# ==================== Document Reports ====================

@router.get("/documents/purchase-order/{po_id}", response_class=HTMLResponse)
def get_purchase_order_report(
    po_id: int,
    db: Session = Depends(get_db)
):
    """
    Generate HTML report for a Purchase Order.
    Returns HTML that can be viewed in browser or printed to PDF.
    """
    service = get_document_report_service(db)
    return service.generate_purchase_order_report(po_id)


@router.get("/documents/grn/{grn_id}", response_class=HTMLResponse)
def get_grn_report(
    grn_id: int,
    db: Session = Depends(get_db)
):
    """
    Generate HTML report for a Good Received Note (GRN).
    Returns HTML that can be viewed in browser or printed to PDF.
    """
    service = get_document_report_service(db)
    return service.generate_grn_report(grn_id)


@router.get("/documents/purchase-return/{return_id}", response_class=HTMLResponse)
def get_purchase_return_report(
    return_id: int,
    db: Session = Depends(get_db)
):
    """
    Generate HTML report for a Purchase Return.
    Returns HTML that can be viewed in browser or printed to PDF.
    """
    service = get_document_report_service(db)
    return service.generate_purchase_return_report(return_id)
