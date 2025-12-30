from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, timedelta
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/reporting", tags=["reporting"])


@router.post("/sales", response_model=schemas.SalesReportResponse)
def generate_sales_report(
    request: schemas.SalesReportRequest,
    db: Session = Depends(get_db)
):
    """Generate comprehensive sales report"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_sales_report(request)


@router.post("/finance", response_model=schemas.FinanceReportResponse)
def generate_finance_report(
    request: schemas.FinanceReportRequest,
    db: Session = Depends(get_db)
):
    """Generate comprehensive finance report"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_finance_report(request)


@router.post("/inventory", response_model=schemas.InventoryReportResponse)
def generate_inventory_report(
    request: schemas.InventoryReportRequest,
    db: Session = Depends(get_db)
):
    """Generate inventory report"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_inventory_report(request)


@router.post("/hr", response_model=schemas.HRReportResponse)
def generate_hr_report(
    request: schemas.HRReportRequest,
    db: Session = Depends(get_db)
):
    """Generate HR report"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_hr_report(request)


@router.post("/warehouse", response_model=schemas.WarehouseReportResponse)
def generate_warehouse_report(
    request: schemas.WarehouseReportRequest,
    db: Session = Depends(get_db)
):
    """Generate warehouse report"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_warehouse_report(request)


@router.post("/support", response_model=schemas.SupportReportResponse)
def generate_support_report(
    request: schemas.SupportReportRequest,
    db: Session = Depends(get_db)
):
    """Generate support report"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_support_report(request)


@router.get("/dashboard", response_model=schemas.DashboardMetrics)
def get_dashboard_metrics(db: Session = Depends(get_db)):
    """Get overall dashboard metrics"""
    reporting_service = service.ReportingService(db)
    return reporting_service.get_dashboard_metrics()


@router.get("/quick-stats")
def get_quick_stats(
    period: str = Query("today", regex="^(today|week|month|year)$"),
    db: Session = Depends(get_db)
):
    """Get quick statistics for different time periods"""
    reporting_service = service.ReportingService(db)
    
    today = date.today()
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
