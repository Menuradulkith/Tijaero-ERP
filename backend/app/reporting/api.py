from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from typing import Literal, Optional, List
from app.db.session import get_db
from app.reporting import sales_reports, inventory_reports, financial_reports
from app.reporting.document_reports import get_document_report_service
from app.reporting import branch_summary_reports
from app.auth.rbac import Permissions, require_permission

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


# ─── Branch Daily Summary ─────────────────────────────────────────────────────

@router.get(
    "/branches",
    dependencies=[Depends(require_permission(*Permissions.REPORTING_BRANCH_SUMMARY_VIEW))],
)
def list_branches(db: Session = Depends(get_db)):
    """Return all active branches for the branch-selector dropdown."""
    return branch_summary_reports.get_branch_list(db)


@router.get(
    "/branch-summary",
    dependencies=[Depends(require_permission(*Permissions.REPORTING_BRANCH_SUMMARY_GENERATE))],
)
def branch_daily_summary(
    report_date: str = Query(..., description="Date in YYYY-MM-DD format"),
    branch_codes: Optional[str] = Query(
        None,
        description="Comma-separated branch codes. Omit for all active branches.",
    ),
    db: Session = Depends(get_db),
):
    """
    Branch Daily Account Summary report.
    Returns one object per branch containing sales, returns, POs, banking and
    cash-in-hand figures for the specified date.
    """
    from datetime import date as date_type
    try:
        parsed_date = date_type.fromisoformat(report_date)
    except ValueError:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid date format '{report_date}'. Use YYYY-MM-DD.",
        )

    codes: Optional[List[str]] = None
    if branch_codes:
        codes = [c.strip() for c in branch_codes.split(",") if c.strip()]

    return branch_summary_reports.get_branch_daily_summary(db, parsed_date, codes)
