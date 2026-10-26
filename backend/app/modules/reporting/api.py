import os
from datetime import date, timedelta
from typing import Optional

from app.auth.dependencies import (
    get_current_active_user,
    get_current_user_flexible,
    get_user_branch_filter,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.core import timezone as tz
from app.core.simple_rate_limit import rate_limit
from app.core.ttl_cache import TTLCache
from app.db.session import get_db
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from . import schemas, service

router = APIRouter(
    prefix="/reporting",
    tags=["reporting"],
)

# Dashboard aggregates are identical for every user and expensive; share one computed copy
# per worker for a short time (REPORT_CACHE_TTL seconds, 0 = off).
_report_cache = TTLCache(float(os.getenv("REPORT_CACHE_TTL", "30")))

_limit_30 = rate_limit(30, per_user=True)
_limit_60 = rate_limit(60, per_user=True)


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
    return _report_cache.get_or_compute(
        "dashboard", lambda: service.ReportingService(db).get_dashboard_metrics()
    )


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
    return _report_cache.get_or_compute(
        ("quick-stats", period), lambda: _compute_quick_stats(db, period)
    )


def _compute_quick_stats(db: Session, period: str):
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


# ─── Printable documents ──────────────────────────────────────────────────────
# One route set for every document type (see app/reporting/print_templates.py for the
# registry): the HTML view, used by the print-preview iframe, and its PDF.


def _print_document(
    db: Session,
    user: User,
    doc_type: str,
    doc_id: Optional[int],
    *,
    show_header: Optional[bool],
    show_discount: Optional[bool],
    show_signatures: Optional[bool],
    custom_remarks: Optional[str],
    template_id: Optional[int],
    pdf: bool,
    period: Optional[str] = None,
):
    import inspect

    from app.auth.rbac import user_has_permission
    from app.common.document_guard import ensure_document_printable
    from app.reporting import print_templates
    from app.reporting.document_reports import get_document_report_service

    doc = print_templates.DOCUMENT_TYPES.get(doc_type)
    if doc is None or doc.has_id != (doc_id is not None):
        raise HTTPException(status_code=404, detail="Unknown document type")
    if not user_has_permission(user, *doc.permission):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied. Required: {doc.permission[0]}:{doc.permission[1]}",
        )
    if doc.guarded:
        ensure_document_printable(db, doc_type, doc_id, user)

    service = get_document_report_service(db, template_id=template_id)
    generate = getattr(service, doc.method)
    kwargs = dict(
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks,
    )
    if "show_discount" in inspect.signature(generate).parameters:
        kwargs["show_discount"] = show_discount
    if doc.has_id:
        html = generate(doc_id, **kwargs)
    else:
        html = generate(period=period, **kwargs)

    result = service.last_render
    headers = {"Cache-Control": "no-store"}
    if result.template_id is not None:
        headers["X-Print-Template"] = f"{result.template_id}:{result.template_version}"
    if result.fallback_error:
        headers["X-Print-Template-Fallback"] = "1"
    if pdf:
        name = f"{doc_type}-{doc_id}" if doc_id is not None else doc_type
        headers["Content-Disposition"] = f'inline; filename="{name}.pdf"'
        return Response(
            content=print_templates.html_to_pdf(html, doc, result),
            media_type="application/pdf",
            headers=headers,
        )
    if result.custom_html:
        headers["Content-Security-Policy"] = print_templates.CUSTOM_HTML_CSP
    return HTMLResponse(content=html, headers=headers)


@router.get("/documents/payroll", response_class=HTMLResponse)
def get_payroll_report(
    period: Optional[str] = Query(None),
    show_header: Optional[bool] = Query(None),
    show_signatures: Optional[bool] = Query(None),
    custom_remarks: Optional[str] = Query(None),
    template_id: Optional[int] = Query(None, ge=1),
    _user: User = Depends(get_current_user_flexible),
    db: Session = Depends(get_db),
):
    """Generate a payroll summary report."""
    return _print_document(
        db, _user, "payroll", None, show_header=show_header, show_discount=None,
        show_signatures=show_signatures, custom_remarks=custom_remarks,
        template_id=template_id, pdf=False, period=period,
    )


@router.get("/documents/payroll/pdf")
def get_payroll_report_pdf(
    period: Optional[str] = Query(None),
    show_header: Optional[bool] = Query(None),
    show_signatures: Optional[bool] = Query(None),
    custom_remarks: Optional[str] = Query(None),
    template_id: Optional[int] = Query(None, ge=1),
    _user: User = Depends(get_current_user_flexible),
    db: Session = Depends(get_db),
):
    """Payroll summary as PDF."""
    return _print_document(
        db, _user, "payroll", None, show_header=show_header, show_discount=None,
        show_signatures=show_signatures, custom_remarks=custom_remarks,
        template_id=template_id, pdf=True, period=period,
    )


@router.get("/documents/{doc_type}/{doc_id}", response_class=HTMLResponse)
def get_document_report(
    doc_type: str,
    doc_id: int = Path(..., ge=1, le=2_147_483_647),
    show_header: Optional[bool] = Query(None),
    show_discount: Optional[bool] = Query(None),
    show_signatures: Optional[bool] = Query(None),
    custom_remarks: Optional[str] = Query(None),
    template_id: Optional[int] = Query(None, ge=1),
    _user: User = Depends(get_current_user_flexible),
    db: Session = Depends(get_db),
):
    """Printable document (invoice, quotation, purchase order, GRN, ...) as HTML.

    Unset display switches take the print template's values; `template_id` picks a
    template other than the default one.
    """
    return _print_document(
        db, _user, doc_type, doc_id, show_header=show_header, show_discount=show_discount,
        show_signatures=show_signatures, custom_remarks=custom_remarks,
        template_id=template_id, pdf=False,
    )


@router.get("/documents/{doc_type}/{doc_id}/pdf")
def get_document_report_pdf(
    doc_type: str,
    doc_id: int = Path(..., ge=1, le=2_147_483_647),
    show_header: Optional[bool] = Query(None),
    show_discount: Optional[bool] = Query(None),
    show_signatures: Optional[bool] = Query(None),
    custom_remarks: Optional[str] = Query(None),
    template_id: Optional[int] = Query(None, ge=1),
    _user: User = Depends(get_current_user_flexible),
    db: Session = Depends(get_db),
):
    """Printable document as PDF."""
    return _print_document(
        db, _user, doc_type, doc_id, show_header=show_header, show_discount=show_discount,
        show_signatures=show_signatures, custom_remarks=custom_remarks,
        template_id=template_id, pdf=True,
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
