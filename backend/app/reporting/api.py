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


@router.get("/documents/purchase-order/{po_id}", response_class=HTMLResponse)
def get_purchase_order_report(
    po_id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    service = get_document_report_service(db)
    return service.generate_purchase_order_report(
        po_id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )


@router.get("/documents/grn/{grn_id}", response_class=HTMLResponse)
def get_grn_report(
    grn_id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    service = get_document_report_service(db)
    return service.generate_grn_report(
        grn_id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )


@router.get("/documents/purchase-return/{return_id}", response_class=HTMLResponse)
def get_purchase_return_report(
    return_id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    service = get_document_report_service(db)
    return service.generate_purchase_return_report(
        return_id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )


@router.get("/documents/invoice/{invoice_id}", response_class=HTMLResponse)
def get_invoice_report(
    invoice_id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    service = get_document_report_service(db)
    return service.generate_invoice_report(
        invoice_id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )


@router.get("/documents/payroll/{report_id}", response_class=HTMLResponse)
def get_payroll_report(
    report_id: int,
    period: Optional[str] = Query(None),
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    service = get_document_report_service(db)
    return service.generate_payroll_report(
        period=period,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )

