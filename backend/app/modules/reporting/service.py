import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from app.core import timezone as tz

logger = logging.getLogger(__name__)
from app.modules.customers.models import Customer
from app.modules.employees.models import Employee, EmployeePayroll
from app.modules.finance.models import (
    BankDeposits,
    CardPayments,
    ChequePayments,
    Expenses,
)
from app.modules.hr.models import Reimbursements, SalaryDeductions
from app.modules.products.models import Product
from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.support.models import CustomerSupport, WarrantyClaims
from app.modules.warehouse.models import ItemReceiveNote, ItemTransferNote
from sqlalchemy import and_, desc, extract, func, or_
from sqlalchemy.orm import Session

from . import schemas


class ReportingService:
    def __init__(self, db: Session):
        self.db = db

    def get_sales_report(
        self, request: schemas.SalesReportRequest
    ) -> schemas.SalesReportResponse:
        """Generate comprehensive sales report"""
        query = self.db.query(Invoice).filter(
            and_(
                Invoice.created_date >= request.start_date,
                Invoice.created_date <= request.end_date,
            )
        )

        if request.branch_code:
            query = query.filter(Invoice.branch_code == request.branch_code)
        if request.customer_id:
            query = query.filter(Invoice.customer_id == request.customer_id)

        invoices = query.all()

        # Calculate totals
        total_sales = sum(
            [
                inv.cash_amount
                + inv.card_amex_amount
                + inv.card_mastercard_amount
                + inv.card_visa_amount
                + inv.cheque_amount
                + inv.bank_transfer_amount
                + inv.credit_amount
                for inv in invoices
            ]
        )
        total_orders = len(invoices)
        unique_customers = len(set([inv.customer_id for inv in invoices]))
        average_order_value = total_sales / total_orders if total_orders > 0 else 0

        # Top products
        product_sales = (
            self.db.query(
                Product.name,
                func.sum(InvoiceItems.quantity).label("total_quantity"),
                func.sum(InvoiceItems.selling_price * InvoiceItems.quantity).label(
                    "total_revenue"
                ),
            )
            .join(InvoiceItems)
            .join(Invoice)
            .filter(
                and_(
                    Invoice.created_date >= request.start_date,
                    Invoice.created_date <= request.end_date,
                )
            )
            .group_by(Product.id, Product.name)
            .order_by(desc("total_revenue"))
            .limit(10)
            .all()
        )

        top_products = [
            {
                "product_name": p.name,
                "quantity_sold": int(p.total_quantity),
                "revenue": float(p.total_revenue),
            }
            for p in product_sales
        ]

        # Sales by date
        daily_sales = (
            self.db.query(
                Invoice.created_date,
                func.count(Invoice.id).label("order_count"),
                func.sum(
                    Invoice.cash_amount
                    + Invoice.card_amex_amount
                    + Invoice.card_mastercard_amount
                    + Invoice.card_visa_amount
                    + Invoice.cheque_amount
                    + Invoice.bank_transfer_amount
                    + Invoice.credit_amount
                ).label("daily_total"),
            )
            .filter(
                and_(
                    Invoice.created_date >= request.start_date,
                    Invoice.created_date <= request.end_date,
                )
            )
            .group_by(Invoice.created_date)
            .order_by(Invoice.created_date)
            .all()
        )

        sales_by_date = [
            {
                "date": str(d.created_date),
                "orders": d.order_count,
                "revenue": float(d.daily_total or 0),
            }
            for d in daily_sales
        ]

        # Sales by branch
        branch_sales = (
            self.db.query(
                Invoice.branch_code,
                func.count(Invoice.id).label("order_count"),
                func.sum(
                    Invoice.cash_amount
                    + Invoice.card_amex_amount
                    + Invoice.card_mastercard_amount
                    + Invoice.card_visa_amount
                    + Invoice.cheque_amount
                    + Invoice.bank_transfer_amount
                    + Invoice.credit_amount
                ).label("branch_total"),
            )
            .filter(
                and_(
                    Invoice.created_date >= request.start_date,
                    Invoice.created_date <= request.end_date,
                )
            )
            .group_by(Invoice.branch_code)
            .all()
        )

        sales_by_branch = [
            {
                "branch_code": b.branch_code,
                "orders": b.order_count,
                "revenue": float(b.branch_total or 0),
            }
            for b in branch_sales
        ]

        return schemas.SalesReportResponse(
            total_sales=total_sales,
            total_orders=total_orders,
            total_customers=unique_customers,
            average_order_value=average_order_value,
            top_products=top_products,
            sales_by_date=sales_by_date,
            sales_by_branch=sales_by_branch,
        )

    def get_finance_report(
        self, request: schemas.FinanceReportRequest
    ) -> schemas.FinanceReportResponse:
        """Generate comprehensive finance report"""
        # Bank deposits
        bank_deposits = (
            self.db.query(func.sum(BankDeposits.deposits_amount))
            .filter(
                and_(
                    BankDeposits.created_date >= request.start_date,
                    BankDeposits.created_date <= request.end_date,
                )
            )
            .scalar()
            or 0
        )

        # Card payments
        card_payments = (
            self.db.query(func.sum(CardPayments.amount))
            .filter(
                and_(
                    func.date(CardPayments.date_time) >= request.start_date,
                    func.date(CardPayments.date_time) <= request.end_date,
                )
            )
            .scalar()
            or 0
        )

        # Cheque payments
        cheque_payments = (
            self.db.query(func.sum(ChequePayments.amount))
            .filter(
                and_(
                    ChequePayments.cheque_date >= request.start_date,
                    ChequePayments.cheque_date <= request.end_date,
                )
            )
            .scalar()
            or 0
        )

        # Expenses
        total_expenses = (
            self.db.query(func.sum(Expenses.expense_amount))
            .filter(
                and_(
                    Expenses.created_date >= request.start_date,
                    Expenses.created_date <= request.end_date,
                )
            )
            .scalar()
            or 0
        )

        total_income = float(bank_deposits + card_payments + cheque_payments)
        net_profit = total_income - float(total_expenses)

        # Expenses by method
        expenses_by_method = (
            self.db.query(
                Expenses.expenses_method,
                func.sum(Expenses.expense_amount).label("total"),
            )
            .filter(
                and_(
                    Expenses.created_date >= request.start_date,
                    Expenses.created_date <= request.end_date,
                )
            )
            .group_by(Expenses.expenses_method)
            .all()
        )

        expenses_by_category = [
            {"category": e.expenses_method, "amount": float(e.total)}
            for e in expenses_by_method
        ]

        # Monthly summary
        monthly_data = (
            self.db.query(
                extract("month", BankDeposits.created_date).label("month"),
                func.sum(BankDeposits.deposits_amount).label("income"),
            )
            .filter(
                and_(
                    BankDeposits.created_date >= request.start_date,
                    BankDeposits.created_date <= request.end_date,
                )
            )
            .group_by("month")
            .all()
        )

        monthly_summary = [
            {"month": int(m.month), "income": float(m.income or 0)}
            for m in monthly_data
        ]

        return schemas.FinanceReportResponse(
            total_income=total_income,
            total_expenses=float(total_expenses),
            net_profit=net_profit,
            bank_deposits=float(bank_deposits),
            card_payments=float(card_payments),
            cheque_payments=float(cheque_payments),
            expenses_by_category=expenses_by_category,
            monthly_summary=monthly_summary,
        )

    def get_inventory_report(
        self, request: schemas.InventoryReportRequest
    ) -> schemas.InventoryReportResponse:
        """Generate inventory report"""
        query = self.db.query(Product).filter(Product.active == True)

        if request.category:
            query = query.filter(Product.category_id == request.category)

        products = query.all()
        total_products = len(products)
        total_stock_value = sum([float(p.cost_price) for p in products])

        # Low stock items (simplified - would need stock tracking table)
        low_stock_items = [
            {
                "product_name": p.name,
                "item_code": p.item_code,
                "cost_price": float(p.cost_price),
            }
            for p in products[:10]  # Placeholder
        ]

        # Stock by category
        stock_by_category = (
            self.db.query(
                Product.category_id, func.count(Product.id).label("product_count")
            )
            .filter(Product.active == True)
            .group_by(Product.category_id)
            .all()
        )

        stock_by_cat = [
            {"category_id": s.category_id, "count": s.product_count}
            for s in stock_by_category
        ]

        return schemas.InventoryReportResponse(
            total_products=total_products,
            total_stock_value=total_stock_value,
            low_stock_items=low_stock_items,
            stock_by_category=stock_by_cat,
            stock_by_branch=[],
        )

    def get_hr_report(
        self, request: schemas.HRReportRequest
    ) -> schemas.HRReportResponse:
        """Generate HR report"""
        # Total employees
        total_employees = self.db.query(func.count(Employee.id)).scalar() or 0

        # Payroll
        total_payroll = (
            self.db.query(func.sum(EmployeePayroll.basic_salary)).scalar() or 0
        )

        # Reimbursements
        total_reimbursements = (
            self.db.query(func.sum(Reimbursements.total_amount)).scalar() or 0
        )

        # Deductions
        total_deductions = (
            self.db.query(func.sum(SalaryDeductions.amount)).scalar() or 0
        )

        return schemas.HRReportResponse(
            total_employees=total_employees,
            total_payroll=float(total_payroll),
            total_reimbursements=float(total_reimbursements),
            total_deductions=float(total_deductions),
            payroll_by_month=[],
            department_summary=[],
        )

    def get_warehouse_report(
        self, request: schemas.WarehouseReportRequest
    ) -> schemas.WarehouseReportResponse:
        """Generate warehouse report"""
        # Transfer notes
        total_transfers = (
            self.db.query(func.count(ItemTransferNote.id))
            .filter(
                and_(
                    ItemTransferNote.created_date >= request.start_date,
                    ItemTransferNote.created_date <= request.end_date,
                )
            )
            .scalar()
            or 0
        )

        # Receive notes
        total_receives = self.db.query(func.count(ItemReceiveNote.id)).scalar() or 0

        # Pending approvals
        pending_approvals = (
            self.db.query(func.count(ItemTransferNote.id))
            .filter(ItemTransferNote.approval_id == None)
            .scalar()
            or 0
        )

        return schemas.WarehouseReportResponse(
            total_transfers=total_transfers,
            total_receives=total_receives,
            pending_approvals=pending_approvals,
            transfer_by_status=[],
            warehouse_activity=[],
        )

    def get_support_report(
        self, request: schemas.SupportReportRequest
    ) -> schemas.SupportReportResponse:
        """Generate support report"""
        query = self.db.query(CustomerSupport).filter(
            and_(
                CustomerSupport.date >= request.start_date,
                CustomerSupport.date <= request.end_date,
            )
        )

        if request.branch_code:
            query = query.filter(CustomerSupport.branch_code == request.branch_code)
        if request.job_type:
            query = query.filter(CustomerSupport.job_type == request.job_type)

        tickets = query.all()
        total_tickets = len(tickets)

        # Warranty claims
        total_warranty_claims = (
            self.db.query(func.count(WarrantyClaims.id))
            .filter(
                and_(
                    WarrantyClaims.created_date >= request.start_date,
                    WarrantyClaims.created_date <= request.end_date,
                )
            )
            .scalar()
            or 0
        )

        # Tickets by type
        tickets_by_type = (
            self.db.query(
                CustomerSupport.job_type, func.count(CustomerSupport.id).label("count")
            )
            .filter(
                and_(
                    CustomerSupport.date >= request.start_date,
                    CustomerSupport.date <= request.end_date,
                )
            )
            .group_by(CustomerSupport.job_type)
            .all()
        )

        tickets_type = [
            {"job_type": t.job_type, "count": t.count} for t in tickets_by_type
        ]

        return schemas.SupportReportResponse(
            total_tickets=total_tickets,
            open_tickets=total_tickets,  # Placeholder
            closed_tickets=0,  # Placeholder
            total_warranty_claims=total_warranty_claims,
            tickets_by_type=tickets_type,
            tickets_by_status=[],
            average_resolution_time=None,
        )

    def get_dashboard_metrics(self) -> schemas.DashboardMetrics:
        """Get overall dashboard metrics – comprehensive data for the main ERP dashboard."""
        from app.modules.purchasing.models import PurchasingOrder, PurchasingReturn
        from app.modules.sales.models import SaleReturn
        from app.modules.warehouse.models import ItemTransferNote

        today = tz.today()
        month_start = date(today.year, today.month, 1)
        # Last month range
        last_month_end = month_start - timedelta(days=1)
        last_month_start = date(last_month_end.year, last_month_end.month, 1)

        # ── Sales ────────────────────────────────────────────────────────
        _sales_sum_expr = (
            Invoice.cash_amount
            + Invoice.card_amex_amount
            + Invoice.card_mastercard_amount
            + Invoice.card_visa_amount
            + Invoice.cheque_amount
            + Invoice.bank_transfer_amount
            + Invoice.credit_amount
        )

        sales_today = (
            self.db.query(func.coalesce(func.sum(_sales_sum_expr), 0))
            .filter(Invoice.created_date == today)
            .scalar()
        )

        sales_month = (
            self.db.query(func.coalesce(func.sum(_sales_sum_expr), 0))
            .filter(Invoice.created_date >= month_start)
            .scalar()
        )

        sales_last_month = (
            self.db.query(func.coalesce(func.sum(_sales_sum_expr), 0))
            .filter(
                and_(
                    Invoice.created_date >= last_month_start,
                    Invoice.created_date <= last_month_end,
                )
            )
            .scalar()
        )

        # Orders
        orders_today = (
            self.db.query(func.count(Invoice.id))
            .filter(Invoice.created_date == today)
            .scalar()
            or 0
        )

        orders_month = (
            self.db.query(func.count(Invoice.id))
            .filter(Invoice.created_date >= month_start)
            .scalar()
            or 0
        )

        orders_last_month = (
            self.db.query(func.count(Invoice.id))
            .filter(
                and_(
                    Invoice.created_date >= last_month_start,
                    Invoice.created_date <= last_month_end,
                )
            )
            .scalar()
            or 0
        )

        # ── Customers ────────────────────────────────────────────────────
        total_customers = (
            self.db.query(func.count(Customer.id))
            .filter(Customer.active == True)
            .scalar()
            or 0
        )

        new_customers_month = (
            self.db.query(func.count(Customer.id))
            .filter(and_(Customer.active == True, Customer.created_at >= month_start))
            .scalar()
            or 0
        )

        # ── Products ─────────────────────────────────────────────────────
        total_products = (
            self.db.query(func.count(Product.id))
            .filter(Product.active == True)
            .scalar()
            or 0
        )

        # ── Purchasing ───────────────────────────────────────────────────
        try:
            from app.modules.purchasing.models import PurchasingOrderItems

            total_purchases_month = (
                self.db.query(
                    func.coalesce(
                        func.sum(
                            PurchasingOrderItems.unit_price
                            * PurchasingOrderItems.quantity
                        ),
                        0,
                    )
                )
                .join(
                    PurchasingOrder,
                    PurchasingOrder.id == PurchasingOrderItems.purchasingorders_id,
                )
                .filter(
                    and_(
                        PurchasingOrder.created_date >= month_start,
                        PurchasingOrder.status.in_(
                            ["approved", "completed", "partially_completed"]
                        ),
                    )
                )
                .scalar()
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            total_purchases_month = 0

        try:
            pending_po_count = (
                self.db.query(func.count(PurchasingOrder.id))
                .filter(PurchasingOrder.status == "pending")
                .scalar()
                or 0
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pending_po_count = 0

        # ── Receivables / Payables ───────────────────────────────────────
        total_credit_outstanding = (
            self.db.query(func.coalesce(func.sum(Invoice.credit_amount), 0))
            .filter(and_(Invoice.credit_amount > 0, Invoice.payment_status != "paid"))
            .scalar()
        )

        try:
            from app.modules.purchasing.models import Supplier

            total_supplier_credit = (
                self.db.query(func.coalesce(func.sum(Supplier.left_credit_amount), 0))
                .filter(Supplier.active == True)
                .scalar()
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            total_supplier_credit = 0

        # ── Pending Approvals ────────────────────────────────────────────
        try:
            pending_sales = (
                self.db.query(func.count(Invoice.id))
                .filter(Invoice.approval_status == "pending_approval")
                .scalar()
                or 0
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pending_sales = 0

        try:
            pending_purchases = (
                self.db.query(func.count(PurchasingOrder.id))
                .filter(PurchasingOrder.status == "pending")
                .scalar()
                or 0
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pending_purchases = 0

        try:
            pending_sale_returns = (
                self.db.query(func.count(SaleReturn.id))
                .filter(SaleReturn.status == "pending")
                .scalar()
                or 0
            )
            pending_purchase_returns = (
                self.db.query(func.count(PurchasingReturn.id))
                .filter(PurchasingReturn.status == "pending")
                .scalar()
                or 0
            )
            pending_returns = pending_sale_returns + pending_purchase_returns
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pending_returns = 0

        try:
            pending_expenses = (
                self.db.query(func.count(Expenses.id))
                .filter(Expenses.status == "submitted")
                .scalar()
                or 0
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pending_expenses = 0

        try:
            pending_transfers = (
                self.db.query(func.count(ItemTransferNote.id))
                .filter(ItemTransferNote.status == "pending")
                .scalar()
                or 0
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pending_transfers = 0

        total_pending = (
            pending_sales
            + pending_purchases
            + pending_returns
            + pending_expenses
            + pending_transfers
        )

        # ── Support ──────────────────────────────────────────────────────
        open_tickets = self.db.query(func.count(CustomerSupport.id)).scalar() or 0

        # ── Daily sales trend (last 7 days) ──────────────────────────────
        daily_sales = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            day_sales = (
                self.db.query(func.coalesce(func.sum(_sales_sum_expr), 0))
                .filter(Invoice.created_date == d)
                .scalar()
            )
            day_orders = (
                self.db.query(func.count(Invoice.id))
                .filter(Invoice.created_date == d)
                .scalar()
                or 0
            )
            daily_sales.append(
                {
                    "date": d.isoformat(),
                    "sales": float(day_sales),
                    "orders": day_orders,
                }
            )

        # ── Top 5 products this month ────────────────────────────────────
        try:
            top_rows = (
                self.db.query(
                    Product.name,
                    Product.item_code,
                    func.sum(InvoiceItems.quantity).label("total_qty"),
                    func.sum(InvoiceItems.selling_price * InvoiceItems.quantity).label(
                        "revenue"
                    ),
                )
                .join(InvoiceItems, InvoiceItems.product_id == Product.id)
                .join(Invoice, Invoice.id == InvoiceItems.invoice_id)
                .filter(Invoice.created_date >= month_start)
                .group_by(Product.id, Product.name, Product.item_code)
                .order_by(desc("total_qty"))
                .limit(5)
                .all()
            )

            top_products = [
                {
                    "name": row.name,
                    "item_code": row.item_code or "",
                    "quantity": int(row.total_qty or 0),
                    "revenue": float(row.revenue or 0),
                }
                for row in top_rows
            ]
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            top_products = []

        # ── Recent activities (real data) ────────────────────────────────
        recent_activities = []
        try:
            recent_invoices = (
                self.db.query(Invoice)
                .order_by(desc(Invoice.created_date))
                .limit(3)
                .all()
            )
            for inv in recent_invoices:
                recent_activities.append(
                    {
                        "title": f"Sale #{inv.invoice_no} — Rs. {float(inv.grand_total):,.2f}",
                        "time": (
                            inv.created_date.isoformat() if inv.created_date else ""
                        ),
                        "type": "sale",
                    }
                )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pass

        try:
            from app.modules.purchasing.models import GoodReceivedNote

            recent_grns = (
                self.db.query(GoodReceivedNote)
                .order_by(desc(GoodReceivedNote.good_received_date))
                .limit(2)
                .all()
            )
            for grn in recent_grns:
                recent_activities.append(
                    {
                        "title": f"GRN #{grn.good_received_no} received",
                        "time": (
                            grn.good_received_date.isoformat()
                            if grn.good_received_date
                            else ""
                        ),
                        "type": "inventory",
                    }
                )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pass

        try:
            recent_customers = (
                self.db.query(Customer)
                .filter(Customer.active == True)
                .order_by(desc(Customer.created_at))
                .limit(2)
                .all()
            )
            for cust in recent_customers:
                recent_activities.append(
                    {
                        "title": f"New customer: {cust.name}",
                        "time": cust.created_at.isoformat() if cust.created_at else "",
                        "type": "customer",
                    }
                )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            pass

        # Sort by time descending and keep latest 8
        recent_activities.sort(key=lambda a: a.get("time", ""), reverse=True)
        recent_activities = recent_activities[:8]

        return schemas.DashboardMetrics(
            total_sales_today=float(sales_today),
            total_sales_month=float(sales_month),
            total_sales_last_month=float(sales_last_month),
            total_orders_today=orders_today,
            total_orders_month=orders_month,
            total_orders_last_month=orders_last_month,
            total_customers=total_customers,
            new_customers_month=new_customers_month,
            total_products=total_products,
            low_stock_items=0,
            total_purchases_month=float(total_purchases_month),
            pending_po_count=pending_po_count,
            total_credit_outstanding=float(total_credit_outstanding),
            total_supplier_credit=float(total_supplier_credit),
            pending_approvals=total_pending,
            pending_sales_approvals=pending_sales,
            pending_purchase_approvals=pending_purchases,
            pending_return_approvals=pending_returns,
            pending_expense_approvals=pending_expenses,
            pending_transfer_approvals=pending_transfers,
            open_support_tickets=open_tickets,
            daily_sales=daily_sales,
            top_products=top_products,
            recent_activities=recent_activities,
        )
