from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, timedelta
from app.core import timezone as tz
from app.core.simple_rate_limit import rate_limit
from app.db.session import get_db
from app.auth.dependencies import get_current_active_user, get_user_branch_filter
from app.auth.models import User
from . import schemas, service

# All reporting endpoints require authentication
router = APIRouter(
    prefix="/reporting",
    tags=["reporting"],
    dependencies=[Depends(get_current_active_user)],
)

_limit_30 = rate_limit(30)
_limit_60 = rate_limit(60)


@router.post("/sales", response_model=schemas.SalesReportResponse)
def generate_sales_report(
    body: schemas.SalesReportRequest,
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_sales_report(body)


@router.post("/finance", response_model=schemas.FinanceReportResponse)
def generate_finance_report(
    body: schemas.FinanceReportRequest,
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_finance_report(body)


@router.post("/inventory", response_model=schemas.InventoryReportResponse)
def generate_inventory_report(
    body: schemas.InventoryReportRequest,
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_inventory_report(body)


@router.post("/hr", response_model=schemas.HRReportResponse)
def generate_hr_report(
    body: schemas.HRReportRequest,
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_hr_report(body)


@router.post("/warehouse", response_model=schemas.WarehouseReportResponse)
def generate_warehouse_report(
    body: schemas.WarehouseReportRequest,
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_warehouse_report(body)


@router.post("/support", response_model=schemas.SupportReportResponse)
def generate_support_report(
    body: schemas.SupportReportRequest,
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_30),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_support_report(body)


@router.get("/dashboard", response_model=schemas.DashboardMetrics)
def get_dashboard_metrics(
    db: Session = Depends(get_db),
    _rl: None = Depends(_limit_60),
):
    reporting_service = service.ReportingService(db)
    return reporting_service.get_dashboard_metrics()


@router.get("/quick-stats")
def get_quick_stats(
    period: str = Query("today", regex="^(today|week|month|year)$"),
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
    
    sales_request = schemas.SalesReportRequest(
        start_date=start_date,
        end_date=end_date
    )
    sales_report = reporting_service.get_sales_report(sales_request)
    
    finance_request = schemas.FinanceReportRequest(
        start_date=start_date,
        end_date=end_date,
        report_type="summary"
    )
    finance_report = reporting_service.get_finance_report(finance_request)
    
    return {
        "period": period,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "sales": {
            "total_sales": sales_report.total_sales,
            "total_orders": sales_report.total_orders,
            "average_order_value": sales_report.average_order_value
        },
        "finance": {
            "total_income": finance_report.total_income,
            "total_expenses": finance_report.total_expenses,
            "net_profit": finance_report.net_profit
        }
    }


@router.get("/documents/purchase-order/{po_id}", response_class=HTMLResponse)
def get_purchase_order_report(
    po_id: int,
    db: Session = Depends(get_db)
):

    from app.reporting.document_reports import get_document_report_service
    report_service = get_document_report_service(db)
    return report_service.generate_purchase_order_report(po_id)


@router.get("/documents/grn/{grn_id}", response_class=HTMLResponse)
def get_grn_report(
    grn_id: int,
    db: Session = Depends(get_db)
):

    from app.reporting.document_reports import get_document_report_service
    report_service = get_document_report_service(db)
    return report_service.generate_grn_report(grn_id)


@router.get("/documents/purchase-return/{return_id}", response_class=HTMLResponse)
def get_purchase_return_report(
    return_id: int,
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
):

    from app.reporting.document_reports import get_document_report_service
    report_service = get_document_report_service(db)
    return report_service.generate_quotation_report(
        id, 
        show_header=show_header,
        show_discount=show_discount,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )


@router.get("/documents/credit-note/{sale_return_id}", response_class=HTMLResponse)
def get_credit_note_report(
    sale_return_id: int,
    show_header: bool = Query(True),
    show_signatures: bool = Query(True),
    custom_remarks: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Generate a credit note report for a processed sale return."""
    from app.reporting.document_reports import get_document_report_service
    report_service = get_document_report_service(db)
    return report_service.generate_credit_note_report(
        sale_return_id,
        show_header=show_header,
        show_signatures=show_signatures,
        custom_remarks=custom_remarks
    )
