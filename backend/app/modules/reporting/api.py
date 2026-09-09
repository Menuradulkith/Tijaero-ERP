from datetime import date, timedelta
from typing import Optional

from app.auth.dependencies import (
    get_current_active_user,
    get_current_user_flexible,
    get_user_branch_filter,
    require_permission_flexible,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.core import timezone as tz
from app.core.simple_rate_limit import rate_limit
from app.db.session import get_db
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from . import schemas, service

router = APIRouter(
    prefix="/reporting",
    tags=["reporting"],
)

_limit_30 = rate_limit(30)
_limit_60 = rate_limit(60)


@router.post(
    "/sales",
    response_model=schemas.SalesReportResponse,
    dependencies=[Depends(require_permission(*Permissions.REPORTING_SALES_VIEW))],
)
def generate_sales_report(
    body: schemas.SalesReportRequest,
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_sales_report(body)


@router.post(
    "/finance",
    response_model=schemas.FinanceReportResponse,
    dependencies=[Depends(require_permission(*Permissions.REPORTING_FINANCE_VIEW))],
)
def generate_finance_report(
    body: schemas.FinanceReportRequest,
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_finance_report(body)


@router.post(
    "/inventory",
    response_model=schemas.InventoryReportResponse,
    dependencies=[Depends(require_permission(*Permissions.REPORTING_INVENTORY_VIEW))],
)
def generate_inventory_report(
    body: schemas.InventoryReportRequest,
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_inventory_report(body)


@router.post(
    "/hr",
    response_model=schemas.HRReportResponse,
    dependencies=[Depends(require_permission(*Permissions.REPORTING_HR_VIEW))],
)
def generate_hr_report(
    body: schemas.HRReportRequest,
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_hr_report(body)


@router.post(
    "/warehouse",
    response_model=schemas.WarehouseReportResponse,
    dependencies=[Depends(require_permission(*Permissions.REPORTING_WAREHOUSE_VIEW))],
)
def generate_warehouse_report(
    body: schemas.WarehouseReportRequest,
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_warehouse_report(body)


@router.post(
    "/support",
    response_model=schemas.SupportReportResponse,
    dependencies=[Depends(require_permission(*Permissions.REPORTING_SUPPORT_VIEW))],
)
def generate_support_report(
    body: schemas.SupportReportRequest,
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_support_report(body)


@router.get(
    "/dashboard",
    response_model=schemas.DashboardMetrics,
    dependencies=[Depends(require_permission(*Permissions.DASHBOARD_VIEW))],
)
def get_dashboard_metrics(
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_60),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_dashboard_metrics()


@router.get(
    "/quick-stats",
    dependencies=[Depends(require_permission(*Permissions.DASHBOARD_VIEW))],
)
def get_quick_stats(
    period: str = Query("today", regex="^(today|week|month|year)$"),
    _user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_60),
):
    reporting_service = service.ReportingService(db)

    today = tz.today()
    if period == "today":
        start_date = today
        end_date = today
    elif period == "week":
        start_date = today - timedelta(days=7)
        end_date = today
    elif period == "month":
        start_date = date(today.year, today.month, 1)
        end_date = today
    else:  # year
        start_date = date(today.year, 1, 1)
        end_date = today

    sales_request = schemas.SalesReportRequest(start_date=start_date, end_date=end_date)
    sales_report = reporting_service.get_sales_report(sales_request)

    finance_request = schemas.FinanceReportRequest(
        start_date=start_date, end_date=end_date, report_type="summary"
    )
    finance_report = reporting_service.get_finance_report(finance_request)

    return {
        "period": period,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "sales": {
            "total_sales": sales_report.total_sales,
            "total_orders": sales_report.total_orders,
            "average_order_value": sales_report.average_order_value,
        },
        "finance": {
            "total_income": finance_report.total_income,
            "total_expenses": finance_report.total_expenses,
            "net_profit": finance_report.net_profit,
        },
    }


@router.get("/documents/purchase-order/{po_id}", response_class=HTMLResponse)
def get_purchase_order_report(
    po_id: int,
    _user: User = Depends(require_permission_flexible(*Permissions.PURCHASE_ORDER_VIEW)),
    db: Session = Depends(get_db),
):

    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_purchase_order_report(po_id)


@router.get("/documents/grn/{grn_id}", response_class=HTMLResponse)
def get_grn_report(
    grn_id: int,
    _user: User = Depends(require_permission_flexible(*Permissions.GRN_VIEW)),
    db: Session = Depends(get_db),
):

    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_grn_report(grn_id)


@router.get("/documents/purchase-return/{return_id}", response_class=HTMLResponse)
def get_purchase_return_report(
    return_id: int,
    _user: User = Depends(require_permission_flexible(*Permissions.PURCHASE_RETURN_VIEW)),
    db: Session = Depends(get_db),
):

    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_purchase_return_report(return_id)


@router.get("/documents/quotation/{id}", response_class=HTMLResponse)
def get_quotation_report(
    id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.QUOTATION_VIEW)),
    db: Session = Depends(get_db),
):

    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_quotation_report(
        id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/credit-note/{sale_return_id}", response_class=HTMLResponse)
def get_credit_note_report(
    sale_return_id: int,
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.SALES_RETURN_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a credit note report for a processed sale return."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_credit_note_report(
        sale_return_id,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/invoice/{invoice_id}", response_class=HTMLResponse)
def get_invoice_report(
    invoice_id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.SALES_ORDER_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a printable invoice report."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_invoice_report(
        invoice_id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/invoice/{invoice_id}/pdf")
def get_invoice_report_pdf(
    invoice_id: int,
    show_header: bool = Query(True),
    show_discount: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.SALES_ORDER_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a PDF invoice report."""
    from app.reporting.document_reports import get_document_report_service

    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail="PDF generation is not available. Install the 'playwright' package.",
        ) from exc

    report_service = get_document_report_service(db)
    html = report_service.generate_invoice_report(
        invoice_id,
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )
    pdf_css = (
        "<style>"
        "@page{size:821px 768px;margin:0;}"
        "html,body{margin:0;padding:0;}"
        ".invoice-bg{margin-bottom:0;}"
        "</style>"
    )
    if "</head>" in html:
        html = html.replace("</head>", f"{pdf_css}</head>", 1)
    else:
        html = pdf_css + html

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 821, "height": 768})
        page.emulate_media(media="screen")
        page.set_content(html, wait_until="load")
        page.wait_for_function(
            """
            () => {
                const el = document.querySelector('#invoice-no');
                return el && el.textContent && el.textContent.trim().length > 0;
            }
            """,
            timeout=3000,
        )
        page.wait_for_timeout(100)
        pdf_bytes = page.pdf(
            print_background=True,
            width="821px",
            height="768px",
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            prefer_css_page_size=True,
        )
        browser.close()
    filename = f"invoice-{invoice_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=\"{filename}\""},
    )


@router.get("/documents/payroll", response_class=HTMLResponse)
def get_payroll_report(
    period: Optional[str] = Query(None),
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.PAYROLL_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a payroll summary report."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_payroll_report(
        period=period,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/expense/{expense_id}", response_class=HTMLResponse)
def get_expense_report(
    expense_id: int,
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.EXPENSE_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a printable expense report."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_expense_report(
        expense_id,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/item-transfer-note/{itn_id}", response_class=HTMLResponse)
def get_itn_report(
    itn_id: int,
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.ITN_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a printable item transfer note report."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_itn_report(
        itn_id,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/voucher/{voucher_id}", response_class=HTMLResponse)
def get_voucher_report(
    voucher_id: int,
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.GIFT_VOUCHER_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a printable gift voucher report."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_voucher_report(
        voucher_id,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


@router.get("/documents/journal-entry/{je_id}", response_class=HTMLResponse)
def get_journal_entry_report(
    je_id: int,
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    _user: User = Depends(require_permission_flexible(*Permissions.JOURNAL_ENTRY_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a printable journal entry report."""
    from app.reporting.document_reports import get_document_report_service

    report_service = get_document_report_service(db)
    return report_service.generate_journal_entry_report(
        je_id,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )


# ─── Branch Daily Summary ─────────────────────────────────────────────────────

@router.get(
    "/branches",
    dependencies=[Depends(require_permission(*Permissions.REPORTING_BRANCH_SUMMARY_VIEW))],
)
def list_branches(db: Session = Depends(get_db)):
    """Return all active branches for the branch-selector dropdown."""
    from app.reporting import branch_summary_reports
    return branch_summary_reports.get_branch_list(db)


@router.get(
    "/branch-summary",
    dependencies=[Depends(require_permission(*Permissions.REPORTING_BRANCH_SUMMARY_GENERATE))],
)
def branch_daily_summary(
    start_date: str = Query(..., description="Start date in YYYY-MM-DD format"),
    end_date: str = Query(..., description="End date in YYYY-MM-DD format"),
    branch_codes: Optional[str] = Query(
        None,
        description="Comma-separated branch codes. Omit for all active branches.",
    ),
    db: Session = Depends(get_db),
):
    """
    Branch Daily Account Summary.
    Returns one object per branch with sales, returns, POs, banking and
    cash-in-hand figures for the specified date range.
    """
    from datetime import date as date_type
    from app.reporting import branch_summary_reports

    try:
        parsed_start = date_type.fromisoformat(start_date)
        parsed_end = date_type.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="Invalid date format. Use YYYY-MM-DD.",
        )

    b_codes = None
    if branch_codes:
        b_codes = [code.strip() for code in branch_codes.split(",") if code.strip()]

    return branch_summary_reports.get_branch_daily_summary(
        db, parsed_start, parsed_end, b_codes
    )
