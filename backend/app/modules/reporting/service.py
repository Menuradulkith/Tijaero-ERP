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
from app.modules.inventory.models import SalesStock
from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.support.models import CustomerSupport, WarrantyClaims
from app.modules.warehouse.models import ItemReceiveNote, ItemTransferNote
from sqlalchemy import and_, case, desc, extract, func, or_
from sqlalchemy.orm import Session, joinedload

from . import schemas

# Products with this many or fewer available (unsold) stock units are
# considered "low stock" for dashboard/report purposes. There is no per-product
# reorder level in the schema, so a single sensible default threshold is used.
LOW_STOCK_THRESHOLD = 5


class ReportingService:
    def __init__(self, db: Session):
        self.db = db

    def get_sales_report(
        self, request: schemas.SalesReportRequest
    ) -> schemas.SalesReportResponse:
        """Generate comprehensive sales report, on the same basis as the GL.

        * Only real sales count (approved/completed; not cancelled, pending
          approval or pending bank verification).
        * Each sale is valued exactly like its GL revenue posting
          (``post_sale_to_gl`` credits ``invoice.subtotal``): net of line and
          header discounts and coupons, before tax, and GROSS of gift vouchers,
          credit notes and customer advances (those are tenders, not revenue -
          ``grand_total`` is net of them, which made voucher-paid sales 0).
        * Processed sale returns in the period are netted exactly like their
          GL posting (Dr 4030 = total_refund - tax_refund, dated added_date,
          on the return's branch).
        * The branch/customer filters apply to every section; top_products,
          sales_by_date and sales_by_branch use the same basis (returns netted
          per product / date / branch).
        """
        from decimal import Decimal

        from app.modules.sales.models import SaleReturn, SaleReturnItems
        from app.modules.sales.sales_metrics import (
            counted_invoice_filters,
            gl_return_revenue,
            gl_revenue_expr,
        )

        rev_expr = gl_revenue_expr()
        conds = [
            Invoice.created_date >= request.start_date,
            Invoice.created_date <= request.end_date,
            *counted_invoice_filters(),
        ]
        if request.branch_code:
            conds.append(Invoice.branch_code == request.branch_code)
        if request.customer_id:
            conds.append(Invoice.customer_id == request.customer_id)

        gross_sales, total_orders, unique_customers = self.db.query(
            func.coalesce(func.sum(rev_expr), 0),
            func.count(Invoice.id),
            func.count(func.distinct(Invoice.customer_id)),
        ).filter(*conds).one()
        gross_sales = Decimal(str(gross_sales or 0))

        # ── Processed returns in the period (GL basis) ──
        ret_q = (
            self.db.query(SaleReturn)
            .join(Invoice, Invoice.id == SaleReturn.invoice_id)
            .filter(
                SaleReturn.status == "processed",
                SaleReturn.added_date >= request.start_date,
                SaleReturn.added_date <= request.end_date,
            )
        )
        if request.branch_code:
            ret_q = ret_q.filter(SaleReturn.branch_code == request.branch_code)
        if request.customer_id:
            ret_q = ret_q.filter(Invoice.customer_id == request.customer_id)
        returns = ret_q.all()

        returns_total = Decimal("0")
        returns_by_date: Dict[str, Decimal] = {}
        returns_by_branch: Dict[str, Decimal] = {}
        returns_by_product: Dict[int, Dict[str, Decimal]] = {}
        for sr in returns:
            amount = gl_return_revenue(sr)
            if amount <= 0:
                continue
            returns_total += amount
            d = str(sr.added_date)
            returns_by_date[d] = returns_by_date.get(d, Decimal("0")) + amount
            returns_by_branch[sr.branch_code] = returns_by_branch.get(sr.branch_code, Decimal("0")) + amount
            # Allocate the return's revenue reversal over its items by value.
            items = self.db.query(SaleReturnItems).filter(SaleReturnItems.sale_return_id == sr.id).all()
            weights = [
                (it, Decimal(str(it.return_price or 0)) * Decimal(str(it.quantity or 1)))
                for it in items if it.product_id
            ]
            wsum = sum((w for _, w in weights), Decimal("0"))
            allocated = Decimal("0")
            for idx, (it, w) in enumerate(weights):
                if wsum > 0:
                    share = (
                        amount - allocated if idx == len(weights) - 1
                        else (amount * w / wsum).quantize(Decimal("0.01"))
                    )
                else:
                    share = Decimal("0")
                allocated += share
                slot = returns_by_product.setdefault(it.product_id, {"qty": Decimal("0"), "rev": Decimal("0")})
                slot["qty"] += Decimal(str(it.quantity or 1))
                slot["rev"] += share

        total_sales = (gross_sales - returns_total).quantize(Decimal("0.01"))
        average_order_value = total_sales / total_orders if total_orders > 0 else Decimal("0")

        # ── Top products: each invoice's GL revenue allocated over its lines by
        #    line value (line_total, falling back to price x qty for legacy rows)
        line_weight = case(
            (func.coalesce(InvoiceItems.line_total, 0) > 0, InvoiceItems.line_total),
            else_=InvoiceItems.selling_price * InvoiceItems.quantity,
        )
        inv_weight = (
            self.db.query(
                InvoiceItems.invoice_id.label("invoice_id"),
                func.sum(line_weight).label("w"),
            )
            .group_by(InvoiceItems.invoice_id)
            .subquery()
        )
        item_rev = case(
            (inv_weight.c.w > 0, line_weight * rev_expr / inv_weight.c.w),
            else_=0,
        )
        prod_q = (
            self.db.query(
                Product.id,
                Product.name,
                func.sum(InvoiceItems.quantity).label("total_quantity"),
                func.sum(item_rev).label("total_revenue"),
            )
            .join(InvoiceItems, InvoiceItems.product_id == Product.id)
            .join(Invoice, Invoice.id == InvoiceItems.invoice_id)
            .join(inv_weight, inv_weight.c.invoice_id == Invoice.id)
            .filter(*conds)
        )
        if request.product_id:
            prod_q = prod_q.filter(Product.id == request.product_id)
        products: Dict[int, Dict[str, Any]] = {}
        for p in prod_q.group_by(Product.id, Product.name).all():
            products[p.id] = {
                "name": p.name,
                "qty": Decimal(str(p.total_quantity or 0)),
                "rev": Decimal(str(p.total_revenue or 0)),
            }
        missing = [
            pid for pid in returns_by_product
            if pid not in products and (not request.product_id or pid == request.product_id)
        ]
        if missing:
            for p in self.db.query(Product.id, Product.name).filter(Product.id.in_(missing)).all():
                products[p.id] = {"name": p.name, "qty": Decimal("0"), "rev": Decimal("0")}
        for pid, r in returns_by_product.items():
            if pid in products:
                products[pid]["qty"] -= r["qty"]
                products[pid]["rev"] -= r["rev"]
        ranked = sorted(products.values(), key=lambda v: v["rev"], reverse=True)[:10]
        top_products = [
            {
                "product_name": v["name"],
                "quantity_sold": int(v["qty"]),
                "revenue": float(v["rev"].quantize(Decimal("0.01"))),
            }
            for v in ranked
        ]

        # ── By date ──
        by_date: Dict[str, Dict[str, Any]] = {}
        for d in (
            self.db.query(
                Invoice.created_date,
                func.count(Invoice.id).label("order_count"),
                func.sum(rev_expr).label("daily_total"),
            )
            .filter(*conds)
            .group_by(Invoice.created_date)
            .all()
        ):
            by_date[str(d.created_date)] = {
                "orders": d.order_count,
                "rev": Decimal(str(d.daily_total or 0)),
            }
        for d, amt in returns_by_date.items():
            by_date.setdefault(d, {"orders": 0, "rev": Decimal("0")})["rev"] -= amt
        sales_by_date = [
            {"date": d, "orders": v["orders"], "revenue": float(v["rev"].quantize(Decimal("0.01")))}
            for d, v in sorted(by_date.items())
        ]

        # ── By branch ──
        by_branch: Dict[str, Dict[str, Any]] = {}
        for b in (
            self.db.query(
                Invoice.branch_code,
                func.count(Invoice.id).label("order_count"),
                func.sum(rev_expr).label("branch_total"),
            )
            .filter(*conds)
            .group_by(Invoice.branch_code)
            .all()
        ):
            by_branch[b.branch_code] = {
                "orders": b.order_count,
                "rev": Decimal(str(b.branch_total or 0)),
            }
        for bc, amt in returns_by_branch.items():
            by_branch.setdefault(bc, {"orders": 0, "rev": Decimal("0")})["rev"] -= amt
        sales_by_branch = [
            {"branch_code": bc, "orders": v["orders"], "revenue": float(v["rev"].quantize(Decimal("0.01")))}
            for bc, v in by_branch.items()
        ]

        return schemas.SalesReportResponse(
            total_sales=float(total_sales),
            total_orders=total_orders,
            total_customers=unique_customers,
            average_order_value=float(average_order_value),
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
        query = self.db.query(Product).options(joinedload(Product.price_tiers)).filter(Product.active == True)

        if request.category:
            query = query.filter(Product.category_id == request.category)

        products = query.all()
        total_products = len(products)
        
        # Helper to get the correct cost price for a product
        def get_product_cost(p: Product) -> float:
            active_tiers = [t for t in p.price_tiers if t.is_active] if hasattr(p, "price_tiers") else []
            if active_tiers:
                latest_tier = max(active_tiers, key=lambda x: x.created_at or x.id)
                return float(latest_tier.cost_price)
            return float(p.cost_price) if p.cost_price is not None else 0.0

        total_stock_value = sum([get_product_cost(p) for p in products])

        # Low stock items: products whose count of AVAILABLE (unsold) stock units
        # is at or below the low-stock threshold. Driven by real SalesStock data.
        available_counts = dict(
            self.db.query(
                SalesStock.product_id,
                func.coalesce(func.sum(SalesStock.quantity), 0),
            )
            .filter(
                SalesStock.status == "available",
                SalesStock.is_active == True,
            )
            .group_by(SalesStock.product_id)
            .all()
        )
        low_stock_items = [
            {
                "product_name": p.name,
                "item_code": p.item_code,
                "cost_price": get_product_cost(p),
                "available_quantity": int(available_counts.get(p.id, 0)),
            }
            for p in products
            if available_counts.get(p.id, 0) <= LOW_STOCK_THRESHOLD
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

        # Low-stock products: active products whose available (unsold) unit count
        # is at or below the threshold. Products with zero stock rows count as 0.
        try:
            available_subq = (
                self.db.query(
                    SalesStock.product_id.label("product_id"),
                    func.coalesce(func.sum(SalesStock.quantity), 0).label("available_qty"),
                )
                .filter(
                    SalesStock.status == "available",
                    SalesStock.is_active == True,
                )
                .group_by(SalesStock.product_id)
                .subquery()
            )
            low_stock_count = (
                self.db.query(func.count(Product.id))
                .outerjoin(
                    available_subq, available_subq.c.product_id == Product.id
                )
                .filter(
                    Product.active == True,
                    func.coalesce(available_subq.c.available_qty, 0)
                    <= LOW_STOCK_THRESHOLD,
                )
                .scalar()
                or 0
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            low_stock_count = 0

        # ── Purchasing ───────────────────────────────────────────────────
        # Count only goods actually received via GRN this month, not PO approval date
        try:
            from app.modules.purchasing.models import (
                PurchasingOrderItems,
                GoodReceivedNote,
                GoodReceivedItems,
            )

            total_purchases_month = (
                self.db.query(
                    func.coalesce(
                        func.sum(PurchasingOrderItems.unit_price * GoodReceivedItems.quantity),
                        0,
                    )
                )
                .join(
                    GoodReceivedItems,
                    GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id,
                )
                .join(
                    GoodReceivedNote,
                    GoodReceivedNote.good_received_no == GoodReceivedItems.good_received_note,
                )
                .filter(
                    and_(
                        GoodReceivedNote.good_received_date >= month_start,
                        GoodReceivedItems.active == True,
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
        # Net receivables = outstanding balance still owed on credit invoices.
        # balance_due is maintained by credit settlements, so this is net of
        # customer payments (symmetric with the net payables figure below).
        total_credit_outstanding = (
            self.db.query(func.coalesce(func.sum(Invoice.balance_due), 0))
            .filter(and_(Invoice.credit_amount > 0, Invoice.payment_status != "paid"))
            .scalar()
        )

        # Total payables = sum of all unsettled GRN value (credit POs) + unpaid received value
        # (non-credit POs), minus all verified payments and applied advances.
        try:
            from app.modules.purchasing.models import (
                GoodReceivedNote,
                GoodReceivedItems,
                PurchasingOrderItems,
                SupplierCreditsSettleTransaction,
                SupplierCreditsSettle,
                SupplierPayment,
                SupplierAdvanceApplication,
                PurchasingReturn,
                PurchasingReturnItems,
            )

            # Total value of all active GRN items (goods actually received)
            total_grn_value = (
                self.db.query(
                    func.coalesce(func.sum(PurchasingOrderItems.unit_price * GoodReceivedItems.quantity), 0)
                )
                .join(
                    GoodReceivedItems,
                    GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id,
                )
                .filter(GoodReceivedItems.active == True)
                .scalar()
                or 0
            )

            # Total verified credit settlements paid to suppliers
            total_settled = (
                self.db.query(
                    func.coalesce(
                        func.sum(SupplierCreditsSettleTransaction.payment_amount), 0
                    )
                )
                .join(
                    SupplierCreditsSettle,
                    SupplierCreditsSettleTransaction.supplier_credit_settle_id
                    == SupplierCreditsSettle.id,
                )
                .scalar()
                or 0
            )

            # Total verified direct supplier payments (non-credit POs)
            total_direct_paid = (
                self.db.query(
                    func.coalesce(func.sum(SupplierPayment.payment_amount), 0)
                )
                .filter(SupplierPayment.status == "verified")
                .scalar()
                or 0
            )

            # Total advance amounts applied against GRNs
            total_advance_applied = (
                self.db.query(
                    func.coalesce(
                        func.sum(SupplierAdvanceApplication.applied_amount), 0
                    )
                )
                .scalar()
                or 0
            )

            # Total approved purchase return amounts (reduces payable liability)
            total_purchase_returns = (
                self.db.query(
                    func.coalesce(func.sum(PurchasingReturnItems.return_price * PurchasingReturnItems.quantity), 0)
                )
                .join(
                    PurchasingReturn,
                    PurchasingReturnItems.purchasingreturn_id == PurchasingReturn.id,
                )
                .filter(PurchasingReturn.status == "approved")
                .scalar()
                or 0
            )

            total_supplier_credit = max(
                0,
                float(total_grn_value)
                - float(total_settled)
                - float(total_direct_paid)
                - float(total_advance_applied)
                - float(total_purchase_returns),
            )
        except Exception:
            logger.warning("reporting metric failed", exc_info=True)
            total_supplier_credit = 0

        # ── Pending Approvals ────────────────────────────────────────────
        try:
            # Use the same predicate as the Sales dashboard statistics and the
            # pending-approval list (Invoice.approval == False) so all dashboards
            # agree. This counts both credit (pending_approval) and bank-transfer
            # (pending_bank_verification) invoices awaiting approval/verification.
            pending_sales = (
                self.db.query(func.count(Invoice.id))
                .filter(Invoice.approval == False)  # noqa: E712
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
                        "title": f"New customer: {cust.customer_name}",
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
            low_stock_items=low_stock_count,
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
