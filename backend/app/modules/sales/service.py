from sqlalchemy.orm import Session
from sqlalchemy import func, text
from fastapi import HTTPException, status
import logging
from app.modules.sales import repository, schemas
from app.modules.sales.models import Invoice, InvoiceItems, InvoiceItemsBarcode, SaleReturn, SaleReturnItems
from app.modules.inventory.models import SalesStock
from app.modules.finance.models import ChequePayments, CardPayments, BankDeposits
from app.modules.finance.gl_posting_service import record_gl_commit_failure
from app.modules.customers.credit_service import CustomerCreditService
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus
from app.core import timezone as tz
from app.common.audit import log_audit
from app.common.enums import DocumentStatus, PaymentStatus, StockStatus
from decimal import Decimal
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta
from typing import List, Optional

logger = logging.getLogger(__name__)

# Initialize credit service
customer_credit_service = CustomerCreditService()

class SalesService:
    def _get_next_invoice_number(self, db: Session, branch_code: str = None) -> str:
        """Generate next Invoice number: INV-BranchCode-YYXXXXXX with advisory lock"""
        year_yy = str(tz.year())[-2:]
        branch_code = branch_code or "HQ"
        prefix = f"INV-{branch_code}-{year_yy}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            db.query(Invoice)
            .filter(Invoice.invoice_no.like(f"{prefix}%"))
            .order_by(Invoice.id.desc())
            .first()
        )
        if last:
            try:
                last_part = last.invoice_no.split("-")[-1]
                last_seq = int(last_part[2:])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}{next_seq:06d}"
    
    def _get_next_sale_return_number(self, db: Session, branch_code: str = None) -> str:
        """Generate next Sale Return number: SRN-BranchCode-YYXXXXXX with advisory lock"""
        year_yy = str(tz.year())[-2:]
        
        # Extract branch code with default
        branch_code = branch_code or "HQ"
        
        prefix = f"SRN-{branch_code}-{year_yy}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            db.query(SaleReturn)
            .filter(SaleReturn.sale_return_no.like(f"{prefix}%"))
            .order_by(SaleReturn.id.desc())
            .first()
        )
        if last:
            try:
                last_part = last.sale_return_no.split("-")[-1]
                last_seq = int(last_part[2:])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}{next_seq:06d}"
    
    def get_all_invoices(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        return repository.sales_repository.get_all(db, skip, limit, branch_codes)
    
    def get_all_invoices_with_items(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get invoices with items eagerly loaded"""
        return repository.sales_repository.get_all_with_items(db, skip, limit, branch_codes)
    
    def search_invoices(self, db: Session, query: str, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        return repository.sales_repository.search(db, query, skip, limit, branch_codes)
    
    def get_invoice(self, db: Session, invoice_id: int):
        invoice = repository.sales_repository.get_by_id(db, invoice_id)
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found"
            )
        return invoice
    
    def get_pending_approval(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get invoices pending approval - server-side filtered"""
        return repository.sales_repository.get_pending_approval(db, skip, limit, branch_codes)
    
    def get_by_customer(self, db: Session, customer_id: int, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get invoices for a specific customer"""
        return repository.sales_repository.get_by_customer(db, customer_id, skip, limit, branch_codes)
    
    def get_recent_by_customer(self, db: Session, customer_id: int, limit: int = 5, branch_codes: Optional[List[str]] = None):
        """Get most recent invoices for a customer from allowed branches"""
        return repository.sales_repository.get_recent_by_customer(db, customer_id, limit, branch_codes)
    
    def get_returns_by_invoice(self, db: Session, invoice_id: int, skip: int = 0, limit: int = 100):
        """Get sale returns for a specific invoice"""
        return repository.sales_repository.get_returns_by_invoice(db, invoice_id, skip, limit)
    
    def get_all_sale_returns(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get all sale returns with invoice_no populated"""
        returns = repository.sales_repository.get_all_sale_returns(db, skip, limit, branch_codes)
        for ret in returns:
            if ret.invoice and hasattr(ret.invoice, 'invoice_no'):
                ret.invoice_no = ret.invoice.invoice_no
        return returns
    
    def get_paginated_invoices(
        self, 
        db: Session, 
        page: int = 1, 
        page_size: int = 50,
        search: Optional[str] = None,
        branch_code: Optional[str] = None,
        status: Optional[str] = None,
        sort_by: str = "created_date",
        sort_desc: bool = True,
        user_branches: Optional[List[str]] = None
    ):
        """
        Get paginated invoices with server-side filtering and sorting.
        Optimized for load balancing - avoids fetching all data.
        """
        from sqlalchemy import or_, desc, asc
        
        # Base query with eager loading for creator and approvals
        query = db.query(Invoice).options(*repository._invoice_eager_options())
        
        # Apply branch access filter
        if user_branches:
            query = query.filter(Invoice.branch_code.in_(user_branches))
        
        # Apply additional branch filter
        if branch_code:
            query = query.filter(Invoice.branch_code == branch_code)
        
        # Apply status filter
        if status:
            if status == "pending":
                query = query.filter(Invoice.approval == False, Invoice.approval_status.in_([DocumentStatus.PENDING, None]))
            elif status == "approved":
                query = query.filter(Invoice.approval == True)
            elif status == "completed":
                query = query.filter(Invoice.approval_status == DocumentStatus.COMPLETED)
            elif status == "cancelled":
                query = query.filter(Invoice.approval_status == DocumentStatus.CANCELLED)
        
        # Apply search filter
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    Invoice.invoice_no.ilike(search_term),
                    # Invoice.payment_reference.ilike(search_term), # Field does not exist
                    # Invoice.customer_code.ilike(search_term), # Field does not exist
                )
            )
        
        # Get total count efficiently (subquery instead of full table scan)
        from app.common.pagination import fast_count
        total = fast_count(query)
        
        # Apply sorting
        sort_column = getattr(Invoice, sort_by, Invoice.created_date)
        if sort_desc:
            query = query.order_by(desc(sort_column), desc(Invoice.id))
        else:
            query = query.order_by(asc(sort_column), asc(Invoice.id))
        
        # Apply pagination
        offset = (page - 1) * page_size
        items = query.offset(offset).limit(page_size).all()
        
        # Calculate total pages
        total_pages = (total + page_size - 1) // page_size
        
        # Convert SQLAlchemy models to Pydantic schemas
        from . import schemas
        items_schemas = [schemas.Invoice.model_validate(item) for item in items]
        
        return {
            "items": items_schemas,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
    
    def get_paginated_sale_returns(
        self, 
        db: Session, 
        page: int = 1, 
        page_size: int = 50,
        search: Optional[str] = None,
        branch_code: Optional[str] = None,
        status: Optional[str] = None,
        sort_by: str = "added_date",
        sort_desc: bool = True,
        user_branches: Optional[List[str]] = None
    ):
        """
        Get paginated sale returns with server-side filtering and sorting.
        Optimized for load balancing - avoids fetching all data.
        """
        from sqlalchemy import or_, desc, asc
        
        # Base query
        query = db.query(SaleReturn)
        
        # Apply branch access filter
        if user_branches:
            query = query.filter(SaleReturn.branch_code.in_(user_branches))
        
        # Apply additional branch filter
        if branch_code:
            query = query.filter(SaleReturn.branch_code == branch_code)
        
        # Apply status filter
        if status:
            query = query.filter(SaleReturn.status == status)
        
        # Apply search filter
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    SaleReturn.sale_return_no.ilike(search_term),
                    SaleReturn.invoice_no.ilike(search_term),
                )
            )
        
        # Get total count efficiently (subquery instead of full table scan)
        from app.common.pagination import fast_count
        total = fast_count(query)
        
        # Apply sorting
        sort_column = getattr(SaleReturn, sort_by, SaleReturn.added_date)
        if sort_desc:
            query = query.order_by(desc(sort_column))
        else:
            query = query.order_by(asc(sort_column))
        
        # Apply pagination
        offset = (page - 1) * page_size
        items = query.offset(offset).limit(page_size).all()
        
        # Calculate total pages
        total_pages = (total + page_size - 1) // page_size
        
        # Convert SQLAlchemy models to Pydantic schemas
        from . import schemas
        items_schemas = [schemas.SaleReturn.model_validate(item) for item in items]
        
        return {
            "items": items_schemas,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
    
    def get_sales_statistics(self, db: Session, branch_codes: Optional[List[str]] = None):
        """Get sales statistics for dashboard — enhanced with daily trends, customer insights & status breakdown"""
        today = tz.today()
        current_month_start = today.replace(day=1)
        last_month_start = (today - relativedelta(months=1)).replace(day=1)
        last_month_end = current_month_start - relativedelta(days=1)
        
        # Base query with branch filtering
        def base_query():
            q = db.query(Invoice)
            if branch_codes:
                q = q.filter(Invoice.branch_code.in_(branch_codes))
            return q
        
        # Revenue expression helper
        invoice_total_expr = (
            Invoice.cash_amount + Invoice.card_visa_amount + Invoice.card_mastercard_amount +
            Invoice.card_amex_amount + Invoice.cheque_amount + Invoice.bank_transfer_amount + Invoice.credit_amount
        )
        
        def calc_revenue(query):
            return query.with_entities(
                func.coalesce(func.sum(Invoice.cash_amount), 0) +
                func.coalesce(func.sum(Invoice.card_visa_amount), 0) +
                func.coalesce(func.sum(Invoice.card_mastercard_amount), 0) +
                func.coalesce(func.sum(Invoice.card_amex_amount), 0) +
                func.coalesce(func.sum(Invoice.cheque_amount), 0) +
                func.coalesce(func.sum(Invoice.bank_transfer_amount), 0) +
                func.coalesce(func.sum(Invoice.credit_amount), 0)
            ).scalar() or 0
        
        # ── Core counts ───────────────────────────────────────────────
        total_invoices = base_query().with_entities(func.count(Invoice.id)).scalar() or 0
        current_month_invoices = base_query().filter(
            Invoice.created_date >= current_month_start
        ).with_entities(func.count(Invoice.id)).scalar() or 0
        last_month_invoices = base_query().filter(
            Invoice.created_date >= last_month_start,
            Invoice.created_date <= last_month_end
        ).with_entities(func.count(Invoice.id)).scalar() or 0
        
        total_revenue = calc_revenue(base_query())
        current_month_revenue = calc_revenue(
            base_query().filter(Invoice.created_date >= current_month_start)
        )
        last_month_revenue = calc_revenue(
            base_query().filter(
                Invoice.created_date >= last_month_start,
                Invoice.created_date <= last_month_end,
            )
        )
        
        # Today's sales
        today_revenue = calc_revenue(base_query().filter(Invoice.created_date == today))
        today_orders = base_query().filter(Invoice.created_date == today).with_entities(func.count(Invoice.id)).scalar() or 0
        
        pending_approval = base_query().filter(Invoice.approval == False).with_entities(func.count(Invoice.id)).scalar() or 0
        approved = base_query().filter(Invoice.approval == True).with_entities(func.count(Invoice.id)).scalar() or 0
        
        # Sale returns (with branch filtering)
        returns_query = db.query(SaleReturn)
        if branch_codes:
            returns_query = returns_query.filter(SaleReturn.branch_code.in_(branch_codes))
        sale_returns_count = returns_query.with_entities(func.count(SaleReturn.id)).scalar() or 0
        
        # ── Average order value ───────────────────────────────────────
        avg_order_value = float(total_revenue) / total_invoices if total_invoices > 0 else 0
        
        # ── Payment breakdown ─────────────────────────────────────────
        payment_breakdown = base_query().with_entities(
            func.coalesce(func.sum(Invoice.cash_amount), 0).label('cash'),
            func.coalesce(func.sum(Invoice.card_visa_amount + Invoice.card_mastercard_amount + Invoice.card_amex_amount), 0).label('card'),
            func.coalesce(func.sum(Invoice.cheque_amount), 0).label('cheque'),
            func.coalesce(func.sum(Invoice.bank_transfer_amount), 0).label('bank_transfer'),
            func.coalesce(func.sum(Invoice.credit_amount), 0).label('credit'),
        ).first()
        
        # ── Daily sales – last 7 days ────────────────────────────────
        daily_sales = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            day_rev = calc_revenue(base_query().filter(Invoice.created_date == d))
            day_cnt = base_query().filter(Invoice.created_date == d).with_entities(func.count(Invoice.id)).scalar() or 0
            daily_sales.append({
                "date": d.strftime("%b %d"),
                "revenue": float(day_rev),
                "orders": day_cnt,
            })
        
        # ── Monthly sales – last 6 months ────────────────────────────
        monthly_sales = []
        for i in range(5, -1, -1):
            m_start = (today - relativedelta(months=i)).replace(day=1)
            if i == 0:
                m_end = today
            else:
                m_end = (today - relativedelta(months=i - 1)).replace(day=1) - timedelta(days=1)
            m_rev = calc_revenue(
                base_query().filter(Invoice.created_date >= m_start, Invoice.created_date <= m_end)
            )
            m_cnt = base_query().filter(
                Invoice.created_date >= m_start, Invoice.created_date <= m_end
            ).with_entities(func.count(Invoice.id)).scalar() or 0
            monthly_sales.append({
                "month": m_start.strftime("%b"),
                "revenue": float(m_rev),
                "orders": m_cnt,
            })
        
        # ── Top 5 customers by revenue ────────────────────────────────
        from app.modules.customers.models import Customer
        top_customers_raw = (
            base_query()
            .join(Customer, Invoice.customer_id == Customer.id)
            .with_entities(
                Customer.customer_name,
                func.count(Invoice.id).label("order_count"),
                func.sum(invoice_total_expr).label("total_spent"),
            )
            .group_by(Customer.id, Customer.customer_name)
            .order_by(func.sum(invoice_total_expr).desc())
            .limit(5)
            .all()
        )
        top_customers = [
            {
                "name": c.customer_name or "Unknown",
                "orders": c.order_count,
                "revenue": float(c.total_spent or 0),
            }
            for c in top_customers_raw
        ]
        
        # ── Order status breakdown ────────────────────────────────────
        status_breakdown = {
            "approved": approved,
            "pending": pending_approval,
            "total": total_invoices,
        }
        
        # ── Top 5 & Recent 5 invoices ─────────────────────────────────
        top_invoices_raw = base_query().order_by(invoice_total_expr.desc()).limit(5).all()
        recent_invoices_raw = base_query().order_by(Invoice.created_date.desc()).limit(5).all()
        
        def invoice_to_dict(inv):
            total = (inv.cash_amount + inv.card_visa_amount + inv.card_mastercard_amount +
                     inv.card_amex_amount + inv.cheque_amount + inv.bank_transfer_amount + inv.credit_amount)
            return {
                "id": inv.id,
                "invoice_no": inv.invoice_no,
                "created_date": inv.created_date.isoformat() if inv.created_date else None,
                "total": float(total),
                "approval": inv.approval,
            }
        
        return {
            "total_orders": total_invoices,
            "current_month_orders": current_month_invoices,
            "last_month_orders": last_month_invoices,
            "total_revenue": float(total_revenue),
            "current_month_revenue": float(current_month_revenue),
            "last_month_revenue": float(last_month_revenue),
            "today_revenue": float(today_revenue),
            "today_orders": today_orders,
            "avg_order_value": round(avg_order_value, 2),
            "pending_approval": pending_approval,
            "approved": approved,
            "sale_returns_count": sale_returns_count,
            "payment_breakdown": {
                "cash": float(payment_breakdown.cash) if payment_breakdown else 0,
                "card": float(payment_breakdown.card) if payment_breakdown else 0,
                "cheque": float(payment_breakdown.cheque) if payment_breakdown else 0,
                "bank_transfer": float(payment_breakdown.bank_transfer) if payment_breakdown else 0,
                "credit": float(payment_breakdown.credit) if payment_breakdown else 0,
            },
            "daily_sales": daily_sales,
            "monthly_sales": monthly_sales,
            "top_customers": top_customers,
            "status_breakdown": status_breakdown,
            "top_invoices": [invoice_to_dict(inv) for inv in top_invoices_raw],
            "recent_invoices": [invoice_to_dict(inv) for inv in recent_invoices_raw],
        }
    
    def get_available_products_from_stock(self, db: Session):
        """
        Get all products that have available items in sales stock.
        
        Returns:
            List of products with their available quantity in sales stock
        """
        from app.modules.products.models import Product
        from sqlalchemy import distinct
        
        # Query to get products with available stock and their quantities
        products_with_stock = db.query(
            Product.id,
            Product.product_code,
            Product.product_name,
            Product.description,
            Product.category_id,
            Product.brand_id,
            Product.unit_of_measure,
            Product.reorder_level,
            Product.status,
            func.count(SalesStock.id).label('available_quantity')
        ).join(
            SalesStock, SalesStock.product_id == Product.id
        ).filter(
            SalesStock.status == StockStatus.AVAILABLE,
            SalesStock.is_active == True,
            Product.status == True
        ).group_by(
            Product.id,
            Product.product_code,
            Product.product_name,
            Product.description,
            Product.category_id,
            Product.brand_id,
            Product.unit_of_measure,
            Product.reorder_level,
            Product.status
        ).all()
        
        # Convert to list of dictionaries
        result = []
        for row in products_with_stock:
            result.append({
                "id": row.id,
                "product_code": row.product_code,
                "product_name": row.product_name,
                "description": row.description,
                "category_id": row.category_id,
                "brand_id": row.brand_id,
                "unit_of_measure": row.unit_of_measure,
                "reorder_level": row.reorder_level,
                "status": row.status,
                "available_quantity": row.available_quantity
            })
        
        return result
    
    def validate_product_availability(self, db: Session, product_id: int, requested_quantity: int):
        """
        Validate if a product is available in sales stock with sufficient quantity.
        
        Args:
            db: Database session
            product_id: ID of the product to check
            requested_quantity: Quantity requested for the invoice
            
        Raises:
            HTTPException: If product is not available or insufficient quantity
        """
        # Count available stock items for this product
        available_count = db.query(func.count(SalesStock.id)).filter(
            SalesStock.product_id == product_id,
            SalesStock.status == StockStatus.AVAILABLE,
            SalesStock.is_active == True
        ).scalar() or 0
        
        if available_count == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product ID {product_id} is not available in sales stock"
            )
        
        if available_count < requested_quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock for product ID {product_id}. Requested: {requested_quantity}, Available: {available_count}"
            )
    
    def create_invoice(self, db: Session, invoice_data: schemas.InvoiceCreate, user_id: int):
        # ── Validate branch is active ──
        from app.common.branch_validation import validate_branch_is_active
        validate_branch_is_active(db, invoice_data.branch_code)

        # ── Validate customer is active ──
        from app.modules.customers.models import Customer
        customer = db.query(Customer).filter(Customer.id == invoice_data.customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {invoice_data.customer_id} not found"
            )
        if not customer.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{customer.customer_name}' is inactive. Please reactivate the customer before creating an invoice."
            )

        # ── Validate customer agent is active (if provided) ──
        customer_agent_id = getattr(invoice_data, 'customer_agent_id', None)
        if customer_agent_id:
            agent = db.query(Customer).filter(Customer.id == customer_agent_id).first()
            if agent and not agent.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer agent '{agent.customer_name}' is inactive. Please reactivate the agent before creating an invoice."
                )

        # ── Validate all products are active ──
        from app.modules.products.models import Product
        product_ids = [item_data.product_id for item_data in invoice_data.items]
        inactive_products = db.query(Product).filter(
            Product.id.in_(product_ids), Product.active == False
        ).all()
        if inactive_products:
            product = inactive_products[0]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product '{product.name}' (ID: {product.id}) is inactive. Please reactivate the product before adding it to an invoice."
            )

        # ── Validate coupon is still active (if provided) ──
        coupon_id = getattr(invoice_data, 'cupon_id', None)
        if coupon_id:
            from app.modules.customers.models import CustomerCuponCodes
            coupon = db.query(CustomerCuponCodes).filter(CustomerCuponCodes.id == coupon_id).first()
            if coupon and not coupon.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="The coupon is no longer active. Please remove it and try again."
                )

        # ── CRITICAL: Lock and validate all barcodes are still available ──
        # This must happen BEFORE any invoice/item creation to prevent two concurrent
        # requests from selling the same physical stock item across two browser tabs.
        # Using SELECT ... FOR UPDATE serialises concurrent transactions at DB level.
        barcodes_in_order = [
            item.barcode for item in invoice_data.items if getattr(item, 'barcode', None)
        ]
        if barcodes_in_order:
            # Detect duplicate barcodes within the same order
            seen_barcodes: set = set()
            for bc in barcodes_in_order:
                if bc in seen_barcodes:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Barcode '{bc}' appears more than once in this order."
                    )
                seen_barcodes.add(bc)

            # Lock all stock rows for this order in a single query to avoid deadlocks
            locked_items = (
                db.query(SalesStock)
                .filter(
                    SalesStock.barcode.in_(barcodes_in_order),
                    SalesStock.status == StockStatus.AVAILABLE,
                )
                .with_for_update()
                .all()
            )
            locked_barcodes = {item.barcode for item in locked_items}
            unavailable = [bc for bc in barcodes_in_order if bc not in locked_barcodes]
            if unavailable:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"The following item(s) are no longer available in stock and "
                        f"may have been sold in another transaction: "
                        f"{', '.join(unavailable)}. Please remove them and try again."
                    ),
                )

        # Calculate subtotal and gross_total from items (after item-level discounts)
        subtotal = Decimal("0")
        gross_total = Decimal("0")
        is_tax_invoice = getattr(invoice_data, 'is_tax_invoice', False)
        tax_rate = Decimal(str(getattr(invoice_data, 'tax_rate', 0) or 0))
        for item in invoice_data.items:
            item_gross = Decimal(str(item.quantity)) * Decimal(str(item.selling_price))
            gross_total += item_gross
            item_discount_percent = Decimal(str(getattr(item, 'discount_percent', 0) or 0))
            item_discount = item_gross * (item_discount_percent / 100)
            subtotal += (item_gross - item_discount)
        
        # Get discount parameters for combined validation
        # Flow: Normalize → Item Discount → Coupon → Invoice Discount → Tax
        coupon_amount = Decimal(str(getattr(invoice_data, 'cupon_amount', 0) or 0))
        discount_percent = Decimal(str(getattr(invoice_data, 'discount_percent', 0) or 0))
        discount_amount_input = Decimal(str(getattr(invoice_data, 'discount_amount', 0) or 0))
        
        # For inclusive pricing, normalize subtotal to net
        net_subtotal = subtotal / (Decimal('1') + tax_rate / Decimal('100')) if is_tax_invoice and tax_rate > 0 else subtotal
        
        # ── Server-side coupon validation — never trust the client-sent amount ──
        coupon_id_input = getattr(invoice_data, 'cupon_id', None)
        if coupon_amount > 0 and not coupon_id_input:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A coupon discount was sent without a coupon. Please re-apply the coupon.",
            )
        if coupon_id_input and coupon_amount > 0:
            from app.modules.customers.models import CustomerCuponCodes
            from app.modules.customers.service import coupon_service
            from app.modules.customers import schemas as customer_schemas

            coupon_row = db.query(CustomerCuponCodes).filter(
                CustomerCuponCodes.id == coupon_id_input
            ).first()
            if not coupon_row:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Coupon not found",
                )
            coupon_validation = coupon_service.validate_coupon(
                db,
                customer_schemas.CouponValidationRequest(
                    coupon_code=coupon_row.cupon_code,
                    customer_id=invoice_data.customer_id,
                    invoice_subtotal=net_subtotal,
                    line_items=[
                        customer_schemas.LineItemForCoupon(
                            product_id=i.product_id,
                            quantity=i.quantity,
                            selling_price=Decimal(str(i.selling_price)),
                        )
                        for i in invoice_data.items
                    ],
                ),
            )
            if not coupon_validation.valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Coupon cannot be applied: {coupon_validation.message}",
                )
            max_coupon_discount = Decimal(str(coupon_validation.calculated_discount or 0))
            if coupon_amount > max_coupon_discount + Decimal("0.01"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Coupon discount (Rs. {coupon_amount:,.2f}) exceeds the allowed "
                        f"discount for this coupon (Rs. {max_coupon_discount:,.2f})"
                    ),
                )
        
        # Calculate coupon discount percentage (applied first on net subtotal)
        coupon_discount_percent = (coupon_amount / net_subtotal * 100) if net_subtotal > 0 else Decimal("0")
        # Calculate amount after coupon for invoice discount percentage
        after_coupon = net_subtotal - coupon_amount
        # Calculate invoice discount percentage (applied after coupon)
        invoice_discount_percent = Decimal("0")
        if discount_percent > 0:
            invoice_discount_percent = discount_percent
        elif discount_amount_input > 0 and after_coupon > 0:
            invoice_discount_percent = (discount_amount_input / after_coupon * 100)
        
        # Validate all products are available in sales stock before creating invoice
        from app.modules.products.repository import minimum_price_repository
        for item_data in invoice_data.items:
            self.validate_product_availability(db, item_data.product_id, item_data.quantity)

            # Server-authoritative minimum price. NEVER trust the client-supplied
            # item_data.minimum_selling_price — look the floor up from the
            # MinimumPrice table so a tampered payload (e.g. min=0) cannot sell
            # below the configured floor. No configured floor => no lower bound.
            _min_row = minimum_price_repository.get_current_for_product(db, item_data.product_id)
            min_price = Decimal(str(_min_row.minimum_price)) if _min_row else Decimal("0")
            # Reflect the true floor on the item so downstream storage/display
            # records the authoritative value rather than the client's.
            item_data.minimum_selling_price = float(min_price)

            # Validate selling price is not below minimum price
            if Decimal(str(item_data.selling_price)) < min_price:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Selling price ({item_data.selling_price}) cannot be less than minimum price ({min_price}) for product ID {item_data.product_id}"
                )

            # Validate effective price after ALL discounts (item + coupon + invoice) is not below minimum price
            item_discount_percent = Decimal(str(getattr(item_data, 'discount_percent', 0) or 0))
            
            # Step 1: Apply item discount
            price_after_item_discount = Decimal(str(item_data.selling_price)) * (Decimal('1') - item_discount_percent / Decimal('100'))
            
            # For inclusive, normalize to net
            if is_tax_invoice and tax_rate > 0:
                price_after_item_discount = price_after_item_discount / (Decimal('1') + tax_rate / Decimal('100'))
            
            # Step 2: Apply coupon discount (proportionally)
            price_after_coupon = price_after_item_discount * (Decimal('1') - coupon_discount_percent / Decimal('100'))
            
            # Step 3: Apply invoice discount (proportionally)
            effective_price = price_after_coupon * (Decimal('1') - invoice_discount_percent / Decimal('100'))
            
            if effective_price < min_price:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Effective price after all discounts ({float(effective_price):.2f}) cannot be less than minimum price ({min_price}) for product ID {item_data.product_id}"
                )
        
        # Extract payment details before creating invoice dict
        cheque_number = getattr(invoice_data, 'cheque_number', None)
        cheque_bank = getattr(invoice_data, 'cheque_bank', None)
        cheque_date_str = getattr(invoice_data, 'cheque_date', None)
        card_ref_number = getattr(invoice_data, 'card_ref_number', None)
        card_holder_name = getattr(invoice_data, 'card_holder_name', None)
        bank_transfer_ref = getattr(invoice_data, 'bank_transfer_ref', None)
        bank_name = getattr(invoice_data, 'bank_name', None)
        
        # Get payment method
        payment_method = invoice_data.payment_method.lower() if invoice_data.payment_method else ""
        is_credit_payment = payment_method == "credit" or (getattr(invoice_data, 'credit_amount', 0) or 0) > 0
        credit_validation = None
        
        # Calculate tax rate (discount values already calculated above)
        tax_rate = Decimal(str(getattr(invoice_data, 'tax_rate', 0) or 0))
        
        # Get coupon ID for storage
        coupon_id = getattr(invoice_data, 'cupon_id', None)
        
        # Calculation Order:
        # 1. Subtotal (after item discounts)
        # 2. Normalize (convert to net for inclusive)
        # 3. Coupon Discount (-)
        # 4. Invoice Discount (-)
        # 5. Tax (recalculate on final net)
        # 6. Grand Total = Net + Tax
        # 7. Voucher / Credit Note / Service Charge
        
        # Step 2: Normalize to net for inclusive
        if is_tax_invoice and tax_rate > 0:
            net_subtotal_calc = (subtotal / (Decimal('1') + tax_rate / Decimal('100'))).quantize(Decimal('0.01'))
        else:
            net_subtotal_calc = subtotal.quantize(Decimal('0.01'))
        
        # Step 3: Coupon (on net subtotal)
        after_coupon_calc = (net_subtotal_calc - coupon_amount).quantize(Decimal('0.01'))
        
        # Step 4: Invoice discount (after coupon)
        calculated_discount = Decimal("0")
        if discount_percent > 0:
            calculated_discount = (after_coupon_calc * (discount_percent / Decimal('100'))).quantize(Decimal('0.01'))
        elif discount_amount_input > 0:
            calculated_discount = discount_amount_input.quantize(Decimal('0.01'))
        final_net = (after_coupon_calc - calculated_discount).quantize(Decimal('0.01'))
        
        # Step 5: Tax - recalculate on final net (same formula for both inclusive & exclusive)
        tax_amount = (final_net * (tax_rate / Decimal('100'))).quantize(Decimal('0.01')) if tax_rate > 0 else Decimal("0.00")
        
        # Step 6: Grand total = Net + Tax
        subtotal_final = final_net
        grand_total = (final_net + tax_amount).quantize(Decimal('0.01'))
        after_tax = grand_total
        
        # Get voucher payment amount
        gift_voucher_id = getattr(invoice_data, 'gift_voucher_id', None)
        gift_voucher_amount = Decimal(str(getattr(invoice_data, 'gift_voucher_amount', 0) or 0))
        
        # Check for multiple voucher redemptions
        voucher_redemptions = getattr(invoice_data, 'voucher_redemptions', []) or []
        total_voucher_amount = Decimal("0")
        if voucher_redemptions:
            # Use total from multiple vouchers
            total_voucher_amount = sum(Decimal(str(r.amount_to_redeem)) for r in voucher_redemptions)
        elif gift_voucher_amount > 0:
            # Use legacy single voucher
            total_voucher_amount = gift_voucher_amount
        
        # Step 5: After voucher
        after_voucher = after_tax - total_voucher_amount
        
        # Step 6: Credit note redemption
        credit_note_amount = Decimal(str(getattr(invoice_data, 'credit_note_amount', 0) or 0))
        if credit_note_amount > 0:
            # Validate customer has sufficient credit balance
            from app.modules.finance.service import CustomerCreditNoteService
            credit_service = CustomerCreditNoteService(db)
            available_balance = Decimal(str(credit_service.get_customer_credit_balance(invoice_data.customer_id)))
            
            if credit_note_amount > available_balance:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient credit balance. Available: Rs. {available_balance:.2f}, Requested: Rs. {credit_note_amount:.2f}"
                )
            
            # Credit note cannot exceed amount due
            if credit_note_amount > after_voucher:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Credit note amount (Rs. {credit_note_amount:.2f}) cannot exceed invoice amount (Rs. {after_voucher:.2f})"
                )
        
        after_credit_note = after_voucher - credit_note_amount
        
        # Step 7: Calculate service charges for card payments (on remaining amount after credit note)
        # Use the service charge from payment_adjustments (sent by frontend from PaymentCard table)
        service_charge_rate = Decimal("0")
        service_charge_amount = Decimal("0")
        payment_adjustments = Decimal(str(getattr(invoice_data, 'payment_adjustments', 0) or 0))
        if payment_method == "card" and payment_adjustments > 0:
            # Frontend calculated service charge from PaymentCard.service_charge_percent
            service_charge_amount = payment_adjustments
            if after_credit_note > 0:
                service_charge_rate = service_charge_amount / after_credit_note
        elif payment_method == "card_amex":
            service_charge_rate = Decimal("0.03")  # 3% for Amex (legacy fallback)
            service_charge_amount = after_credit_note * service_charge_rate
        elif payment_method in ["card_visa", "card_mastercard"]:
            service_charge_rate = Decimal("0.027")  # 2.7% for Visa/Mastercard (legacy fallback)
            service_charge_amount = after_credit_note * service_charge_rate
        
        # Step 8: Calculate grand total (remaining amount to pay)
        grand_total = after_credit_note + service_charge_amount

        # Define immediate_payment and total_prepaid
        immediate_payment = (
            Decimal(str(invoice_data.cash_amount or 0)) +
            Decimal(str(invoice_data.card_visa_amount or 0)) +
            Decimal(str(invoice_data.card_mastercard_amount or 0)) +
            Decimal(str(invoice_data.card_amex_amount or 0)) +
            Decimal(str(invoice_data.cheque_amount or 0))
        )
        total_prepaid = total_voucher_amount + credit_note_amount

        # Comprehensive credit sale validation (BLOCKING validations)
        if is_credit_payment and not getattr(invoice_data, 'override_credit_validation', False):
            # Lock the customer row to serialise concurrent credit-sale requests
            # for the same customer — prevents two requests from both reading the
            # same available-credit and exceeding the limit.
            db.query(Customer).filter(
                Customer.id == invoice_data.customer_id
            ).with_for_update().first()

            # Calculate credit amount portion for validation
            calculated_credit = getattr(invoice_data, 'credit_amount', 0) or 0
            if calculated_credit <= 0:
                calculated_credit = grand_total - total_prepaid - immediate_payment
            if calculated_credit < 0:
                calculated_credit = Decimal("0")
                
            # Use comprehensive validation - blocking by default
            credit_validation = customer_credit_service.validate_credit_sale_comprehensive(
                db,
                invoice_data.customer_id,
                Decimal(str(calculated_credit)),
                skip_time_check=False,  # Enforce time restriction
                allow_over_limit=False  # Block if credit limit exceeded
            )
            
            # BLOCK if validation fails
            if not credit_validation.get("allowed", True):
                errors = credit_validation.get("errors", [])
                error_message = "; ".join(errors) if errors else "Credit sale validation failed"
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=error_message
                )
        
        # Create invoice dict
        invoice_dict = invoice_data.model_dump(exclude={
            'items', 'cheque_number', 'cheque_bank', 'cheque_date', 
            'card_ref_number', 'card_holder_name', 'bank_transfer_ref', 
            'bank_name', 'tax_rate', 'discount_percent', 'discount_amount',
            'cupon_id', 'cupon_amount',  # We'll set these explicitly below
            'gift_voucher_id', 'gift_voucher_amount',  # We'll handle voucher separately
            'voucher_redemptions',  # Array field - not stored in Invoice table
            'agent_commission_rate', 'agent_commission_amount',  # Drive the commission entry, not Invoice columns
            'credit_terms', 'override_credit_validation'
        })
        
        # Override sale_rep_id with the logged-in user
        invoice_dict['sale_rep_id'] = user_id
        invoice_dict['created_by'] = user_id
        
        # Server-side sequential invoice number generation
        invoice_dict['invoice_no'] = self._get_next_invoice_number(db, invoice_data.branch_code)
        # Back-fill the request object so downstream payment/voucher records
        # (built from invoice_data.invoice_no) reference the real number instead
        # of the None the client sent.
        invoice_data.invoice_no = invoice_dict['invoice_no']
        
        invoice_dict['created_date'] = tz.today()
        invoice_dict['created_date_time'] = tz.now()
        invoice_dict['status'] = True
        
        # Set calculated totals
        invoice_dict['is_tax_invoice'] = bool(is_tax_invoice)
        invoice_dict['subtotal'] = float(subtotal_final)
        invoice_dict['tax_rate'] = float(tax_rate)
        invoice_dict['tax_amount'] = float(tax_amount)
        invoice_dict['discount_percent'] = float(discount_percent)
        invoice_dict['discount_amount'] = float(calculated_discount)
        invoice_dict['service_charge_rate'] = float(service_charge_rate)
        invoice_dict['service_charge_amount'] = float(service_charge_amount)
        invoice_dict['grand_total'] = float(grand_total)
        
        # Calculate final credit amount for the DB field
        if is_credit_payment:
            calculated_credit = getattr(invoice_data, 'credit_amount', 0) or 0
            if calculated_credit <= 0:
                calculated_credit = grand_total - total_prepaid - immediate_payment
            if calculated_credit < 0:
                calculated_credit = Decimal("0")
            invoice_dict['credit_amount'] = float(calculated_credit)
        else:
            invoice_dict['credit_amount'] = 0
        
        # Set voucher fields (already calculated above)
        invoice_dict['gift_voucher_id'] = gift_voucher_id
        invoice_dict['gift_voucher_amount'] = float(total_voucher_amount)
        
        # Set credit note amount
        invoice_dict['credit_note_amount'] = float(credit_note_amount)
        
        # Amount after voucher and credit note is in grand_total
        amount_after_voucher = grand_total

        if amount_after_voucher < 0:
            amount_after_voucher = Decimal("0")
        
        # Total amount prepaid (voucher + credit note)
        total_prepaid = total_voucher_amount + credit_note_amount
        
        # ═══════════════════════════════════════════════════════════════
        # Gap 4: Auto-deduct customer advance payment balance
        # If invoice has a customer_advance_payments_id, deduct from
        # the advance remaining_amount and track as prepaid
        # ═══════════════════════════════════════════════════════════════
        advance_payment_id = getattr(invoice_data, 'customer_advance_payments_id', None)
        advance_deducted = Decimal("0")
        advance_for_gl = None  # Store for GL posting later
        if advance_payment_id:
            from app.modules.customers.models import CustomerAdvancePayments
            # Lock the advance payment row to prevent race condition
            advance = db.query(CustomerAdvancePayments).filter(
                CustomerAdvancePayments.id == advance_payment_id,
                CustomerAdvancePayments.active == True
            ).with_for_update().first()
            if advance:
                available = Decimal(str(advance.remaining_amount or advance.payment_amount))
                # Deduct up to the remaining invoice amount
                advance_deducted = min(available, amount_after_voucher)
                if advance_deducted > 0:
                    advance.applied_amount = Decimal(str(advance.applied_amount or 0)) + advance_deducted
                    advance.remaining_amount = Decimal(str(advance.payment_amount)) - Decimal(str(advance.applied_amount))
                    if advance.remaining_amount <= 0:
                        advance.remaining_amount = Decimal("0")
                        advance.is_fully_applied = True
                    amount_after_voucher -= advance_deducted
                    grand_total -= advance_deducted
                    total_prepaid += advance_deducted
                    invoice_dict['grand_total'] = float(grand_total)
                    advance_for_gl = advance  # Save for GL posting
        
        # Set payment tracking fields
        immediate_payment = (
            Decimal(str(invoice_data.cash_amount or 0)) +
            Decimal(str(invoice_data.card_visa_amount or 0)) +
            Decimal(str(invoice_data.card_mastercard_amount or 0)) +
            Decimal(str(invoice_data.card_amex_amount or 0)) +
            Decimal(str(invoice_data.cheque_amount or 0))
        )
        if is_credit_payment:
            # Credit payment - needs approval, unpaid until settled
            invoice_dict['approval'] = False
            invoice_dict['approval_status'] = "pending_approval"
            invoice_dict['paid_amount'] = float(total_prepaid + immediate_payment)  # Voucher + credit note + immediate paid
            invoice_dict['balance_due'] = float(amount_after_voucher - immediate_payment)
            invoice_dict['payment_status'] = "unpaid" if (amount_after_voucher - immediate_payment) > 0 else "paid"
        elif payment_method == "bank_transfer":
            # Bank transfer - needs verification by finance manager
            invoice_dict['approval'] = False
            invoice_dict['approval_status'] = "pending_bank_verification"
            invoice_dict['bank_transfer_status'] = "pending_verification"
            invoice_dict['paid_amount'] = float(total_prepaid)  # Voucher + credit note paid
            invoice_dict['balance_due'] = float(amount_after_voucher)
            invoice_dict['payment_status'] = PaymentStatus.UNPAID
        else:
            # Cash/Card/Cheque - auto-approved and fully paid.
            # Reconcile the tendered amount against the net grand total before
            # marking PAID. `grand_total` here is already net of voucher/credit
            # note/advance, so cash+card+cheque tendered must cover it (cash may
            # exceed it → change). Without this a client could post e.g.
            # cash_amount=10 on a 1000 invoice and have it recorded fully paid.
            payment_tolerance = Decimal("0.05")
            if immediate_payment + payment_tolerance < grand_total:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Insufficient payment: tendered amount "
                        f"({float(immediate_payment):.2f}) does not cover the invoice "
                        f"total ({float(grand_total):.2f})."
                    ),
                )
            invoice_dict['approval'] = True
            invoice_dict['approval_status'] = DocumentStatus.COMPLETED
            invoice_dict['paid_amount'] = float(grand_total)  # Full grand total is paid (voucher + payment method)
            invoice_dict['balance_due'] = 0
            invoice_dict['payment_status'] = PaymentStatus.PAID
        
        # Handle coupon/discount code
        coupon_id = getattr(invoice_data, 'cupon_id', None)
        coupon_amount = getattr(invoice_data, 'cupon_amount', 0) or 0
        invoice_dict['cupon_id'] = coupon_id
        invoice_dict['cupon_amount'] = float(coupon_amount)
        
        # Handle cheque date
        if cheque_date_str:
            try:
                invoice_dict['cheque_date'] = datetime.strptime(cheque_date_str, '%Y-%m-%d').date()
            except (ValueError, TypeError):
                logger.warning("Invalid cheque_date %r, defaulting to today", cheque_date_str)
                invoice_dict['cheque_date'] = tz.today()
        else:
            invoice_dict['cheque_date'] = tz.today()
        
        # Create payment records based on payment method
        cheque_payment_id = None
        card_payment_id = None
        bank_transfer_id = None
        
        # Handle cheque payment
        if payment_method == "cheque" and cheque_number:
            from app.modules.customers.models import Customer as _Customer
            _cheque_customer = db.query(_Customer).filter(
                _Customer.id == invoice_data.customer_id
            ).first()
            cheque_payment = ChequePayments(
                cheque_number=str(cheque_number).strip(),
                branch_code=invoice_data.branch_code,
                from_party=((_cheque_customer.customer_name if _cheque_customer else None)
                            or card_holder_name or "Customer")[:50],
                bank=cheque_bank or "",
                amount=invoice_data.cheque_amount or 0,
                cheque_date=invoice_dict['cheque_date'],
                deposit_date=tz.today(),
                remark=invoice_data.remarks or "",
                payment_for="Sales Invoice",
                invoice_no=invoice_dict['invoice_no']
            )
            db.add(cheque_payment)
            db.flush()
            cheque_payment_id = cheque_payment.id
            
            # Gap 5: Auto-create bank deposit record for cheque payment
            # Cheque needs to be deposited to bank; create a pending bank deposit record
            cheque_bank_deposit = BankDeposits(
                deposits_amount=invoice_data.cheque_amount or 0,
                remarks=f"Cheque deposit - Cheque No: {cheque_number}, Bank: {cheque_bank or 'N/A'}",
                created_date=tz.now(),
                branch_code=invoice_data.branch_code,
                bank_name=cheque_bank or "",
                user_id=user_id,
                payment_for="Cheque Deposit - Sales Invoice",
                invoice_no=invoice_data.invoice_no,
                verified=False,
                returned=False,
                status=DocumentStatus.PENDING
            )
            db.add(cheque_bank_deposit)
            db.flush()
        
        # Handle card payment
        if payment_method in ["card_visa", "card_mastercard", "card_amex"] or payment_method == "card":
            card_type_map = {
                "card_visa": "VISA",
                "card_mastercard": "MASTER",
                "card_amex": "AMEX"
            }
            card_amount = (
                invoice_data.card_visa_amount or 
                invoice_data.card_mastercard_amount or 
                invoice_data.card_amex_amount or 0
            )
            card_payment = CardPayments(
                card_type=card_type_map.get(payment_method, "VISA"),
                amount=card_amount,
                date_time=tz.now(),
                remark=card_holder_name or "",
                ref_number=card_ref_number or "",
                invoice_no=invoice_data.invoice_no,
                deposited=False  # Starts as not deposited; confirmed when batch-deposited to bank
            )
            db.add(card_payment)
            db.flush()
            card_payment_id = card_payment.id
        
        # Handle bank transfer
        if payment_method == "bank_transfer":
            bank_deposit = BankDeposits(
                deposits_amount=invoice_data.bank_transfer_amount or 0,
                remarks=f"Ref: {bank_transfer_ref}" if bank_transfer_ref else "",
                created_date=tz.now(),
                branch_code=invoice_data.branch_code,
                bank_name=bank_name or "",
                user_id=user_id,
                payment_for="Sales Invoice",
                invoice_no=invoice_data.invoice_no,
                verified=False,
                returned=False
            )
            db.add(bank_deposit)
            db.flush()
            bank_transfer_id = bank_deposit.id
        
        # Handle credit payment - create CreditPayments record
        credit_payment_id = None
        if is_credit_payment:
            from app.modules.finance.models import CreditPayments
            from app.modules.customers.models import Customer
            
            # Get customer for credit terms
            customer = db.query(Customer).filter(Customer.id == invoice_data.customer_id).first()
            credit_days = customer.credit_days if customer else 30
            due_date = tz.today() + timedelta(days=credit_days)
            
            credit_payment = CreditPayments(
                customer_id=invoice_data.customer_id,
                amount=invoice_dict['credit_amount'],
                credit_terms=getattr(invoice_data, 'credit_terms', None) or f"{credit_days} days",
                due_date=due_date,
                status=DocumentStatus.PENDING,  # Will be updated when approved
                created_date=tz.now()
            )
            db.add(credit_payment)
            db.flush()
            credit_payment_id = credit_payment.id
        
        # Set payment record IDs
        invoice_dict['cheque_payment_id'] = cheque_payment_id
        invoice_dict['card_payment_id'] = card_payment_id
        invoice_dict['bank_transfer_id'] = bank_transfer_id
        invoice_dict['credit_payment_id'] = credit_payment_id
        
        invoice = Invoice(**invoice_dict)
        db.add(invoice)
        db.flush()
        
        # Create invoice items and handle sales stock
        for item_data in invoice_data.items:
            item_dict = item_data.model_dump()
            item_dict['invoice_id'] = invoice.id
            item_dict['created_date'] = tz.now()
            
            # Get barcode from item_dict (keep it for reference)
            barcode = item_dict.get('barcode', None)
            quantity_req = int(item_dict.get('quantity') or 1)
            
            # Resolve the physical stock units this line consumes.
            allocated_units: list = []
            if barcode:
                # Lock the stock row to prevent two invoices reserving the same item
                stock_item = db.query(SalesStock).filter(
                    SalesStock.barcode == barcode,
                    SalesStock.status == StockStatus.AVAILABLE
                ).with_for_update().first()
                if stock_item:
                    allocated_units = [stock_item]
            else:
                # No barcode scanned: auto-allocate real units. Without this,
                # nothing ever marked stock sold for barcode-less lines, so the
                # same unit could be sold forever (sequentially AND in races).
                # SKIP LOCKED makes two concurrent sales of the last unit
                # serialise: the loser sees fewer rows and gets a clean 409.
                allocated_units = (
                    db.query(SalesStock)
                    .filter(
                        SalesStock.product_id == item_dict['product_id'],
                        SalesStock.status == StockStatus.AVAILABLE,
                        SalesStock.is_active == True,
                    )
                    .order_by(SalesStock.id)
                    .with_for_update(skip_locked=True)
                    .limit(quantity_req)
                    .all()
                )
                if len(allocated_units) < quantity_req:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"Only {len(allocated_units)} unit(s) of product ID "
                            f"{item_dict['product_id']} are available right now "
                            f"({quantity_req} requested). Another sale may have just "
                            f"taken the remaining stock."
                        ),
                    )
            
            # Update each allocated unit's status based on approval status
            for unit in allocated_units:
                if invoice_dict['approval_status'] == DocumentStatus.COMPLETED:
                    # Cash/Card/Cheque orders - mark as sold immediately
                    unit.status = StockStatus.SOLD
                    unit.is_active = False
                elif invoice_dict['approval_status'] in [DocumentStatus.PENDING_APPROVAL, 'pending_bank_verification']:
                    # Credit orders or bank transfers - reserve stock until approved/verified
                    unit.status = StockStatus.RESERVED
            
            # Calculate line total with item discount
            gross_line_total = Decimal(str(item_dict['quantity'])) * Decimal(str(item_dict['selling_price']))
            item_discount_percent = Decimal(str(item_dict.get('discount_percent', 0) or 0))
            item_discount_amount = gross_line_total * (item_discount_percent / Decimal('100'))
            item_dict['discount_percent'] = float(item_discount_percent)
            item_dict['discount_amount'] = float(item_discount_amount)
            line_total = gross_line_total - item_discount_amount
            item_dict['line_total'] = float(line_total)
            
            # Persist rows. Barcode lines keep their single row; barcode-less
            # lines store one row per allocated unit so every unit is
            # traceable and restorable on approve/cancel/delete/return.
            created_rows: list = []  # (InvoiceItems, SalesStock | None)
            if barcode or not allocated_units:
                item_dict['sales_stock_id'] = allocated_units[0].id if allocated_units else None
                item = InvoiceItems(**item_dict)
                db.add(item)
                db.flush()
                created_rows.append((item, allocated_units[0] if allocated_units else None))
            else:
                unit_gross = Decimal(str(item_dict['selling_price']))
                unit_discount = unit_gross * (item_discount_percent / Decimal('100'))
                for unit in allocated_units:
                    row = dict(item_dict)
                    row['quantity'] = 1
                    row['barcode'] = unit.barcode
                    row['sales_stock_id'] = unit.id
                    row['discount_amount'] = float(unit_discount)
                    row['line_total'] = float(unit_gross - unit_discount)
                    item = InvoiceItems(**row)
                    db.add(item)
                    db.flush()
                    created_rows.append((item, unit))
            
            # Create InvoiceItemsBarcode links for every row backed by a unit
            for item, unit in created_rows:
                if unit is None or not unit.good_received_note_id:
                    continue
                # Get the GRN note number
                from app.modules.purchasing.models import GoodReceivedItems, GoodReceivedNote
                grn = db.query(GoodReceivedNote).filter(
                    GoodReceivedNote.id == unit.good_received_note_id
                ).first()
                
                if grn:
                    # Find the GRN item for this barcode using the note number
                    grn_item = db.query(GoodReceivedItems).filter(
                        GoodReceivedItems.good_received_note == grn.good_received_no,
                        GoodReceivedItems.barcode == unit.barcode
                    ).first()
                    
                    if grn_item:
                        barcode_link = InvoiceItemsBarcode(
                            created_date=tz.now(),
                            good_received_items_id=grn_item.id,
                            invoice_items_id=item.id
                        )
                        db.add(barcode_link)
        
        # Create approval record for credit sales orders
        if is_credit_payment:
            approval_remarks = f"Credit sales order pending approval. Amount: Rs. {grand_total:,.2f}"
            if credit_validation:
                warnings = []
                if credit_validation.get("will_exceed_limit"):
                    warnings.append(
                        f"Credit limit exceeded by Rs. {credit_validation.get('excess_amount', 0):,.2f}"
                    )
                if credit_validation.get("overdue_count", 0) > 0:
                    warnings.append(
                        f"{credit_validation.get('overdue_count')} overdue invoice(s)"
                    )
                if warnings:
                    approval_remarks = f"{approval_remarks} | Warning: " + "; ".join(warnings)
            approval_record = approval_service.create_approval_request(
                db=db,
                approval_type=ApprovalType.SALES_ORDER,
                reference_id=invoice.id,
                reference_no=invoice.invoice_no,
                branch_code=invoice.branch_code,
                requested_by=user_id,
                remarks=approval_remarks,
                approval_group="sales_approvers"
            )
            invoice.approval_id = approval_record.id
        
        # Record coupon usage if coupon was applied
        if coupon_id and coupon_amount > 0:
            from app.modules.customers.models import CouponUsage, CustomerCuponCodes

            # Lock the coupon row BEFORE re-validating the usage limits so two
            # concurrent invoices for the same coupon can't both pass a limit
            # check that was read before either committed (the earlier
            # validate_coupon() check is only a pre-flight UX check and isn't
            # itself race-safe).
            coupon = db.query(CustomerCuponCodes).filter(
                CustomerCuponCodes.id == coupon_id
            ).with_for_update().first()
            if not coupon:
                raise HTTPException(status_code=400, detail="Coupon not found")

            total_usage = db.query(func.count(CouponUsage.id)).filter(
                CouponUsage.coupon_id == coupon_id
            ).scalar() or 0
            if total_usage >= coupon.limit_by_usage:
                raise HTTPException(status_code=400, detail="Coupon usage limit exceeded")

            customer_usage = db.query(func.count(CouponUsage.id)).filter(
                CouponUsage.coupon_id == coupon_id,
                CouponUsage.customer_id == invoice_data.customer_id,
            ).scalar() or 0
            if customer_usage >= coupon.limit_for_customer:
                raise HTTPException(
                    status_code=400,
                    detail="Coupon usage limit for this customer exceeded",
                )

            # Create usage record
            coupon_usage = CouponUsage(
                coupon_id=coupon_id,
                invoice_id=invoice.id,
                customer_id=invoice_data.customer_id,
                discount_amount=coupon_amount,
                used_date=tz.now()
            )
            db.add(coupon_usage)

            coupon.usage_count = (coupon.usage_count or 0) + 1
            # Auto-deactivate coupon when global usage limit is reached
            if coupon.usage_count >= coupon.limit_by_usage:
                coupon.active = False
        
        # Record voucher redemptions - prioritize multiple vouchers over legacy single voucher
        voucher_redemptions = getattr(invoice_data, 'voucher_redemptions', []) or []
        
        if voucher_redemptions:
            # Multiple vouchers - create usage record for each
            # NOTE: Each voucher is ONE-TIME USE ONLY - always mark as fully_claimed
            from app.modules.customers.models import CustomerGiftVoucher, VoucherUsage
            
            for redemption in voucher_redemptions:
                # Lock the voucher row to prevent race condition
                voucher = db.query(CustomerGiftVoucher).filter(
                    CustomerGiftVoucher.id == redemption.voucher_id
                ).with_for_update().first()
                if not voucher:
                    # The redeemed amount was already subtracted from the
                    # invoice total — silently skipping would record a payment
                    # that never happened.
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Gift voucher {redemption.voucher_id} not found",
                    )
                    
                # Verify voucher hasn't been used already
                if voucher.status != "active":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Voucher {voucher.barcode_no} has already been used"
                    )
                
                # Verify the voucher has not silently expired (status is only
                # flipped to 'expired' when somebody validates it)
                from dateutil.relativedelta import relativedelta
                voucher_expiry = voucher.date + relativedelta(months=voucher.valid_period_in_months or 12)
                if tz.today() > voucher_expiry:
                    voucher.status = "expired"
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Voucher {voucher.barcode_no} expired on {voucher_expiry}",
                    )
                
                # The redeemed amount can never exceed what the voucher holds
                amount_requested = Decimal(str(redemption.amount_to_redeem))
                if amount_requested > Decimal(str(voucher.balance)) + Decimal("0.01"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Voucher {voucher.barcode_no} balance is Rs. {voucher.balance:,.2f}; "
                            f"cannot redeem Rs. {amount_requested:,.2f}"
                        ),
                    )
                
                # Create voucher usage record
                voucher_usage = VoucherUsage(
                    voucher_id=redemption.voucher_id,
                    invoice_id=invoice.id,
                    amount_used=Decimal(str(redemption.amount_to_redeem)),
                    used_date=tz.now()
                )
                db.add(voucher_usage)
                
                # ONE-TIME USE: Always mark as fully_claimed regardless of amount used
                # Any remaining balance is forfeited
                voucher.balance = Decimal("0")  # Zero out balance
                voucher.status = "fully_claimed"
                voucher.claimed_date = tz.now()
                voucher.claimed_invoice_no = invoice_data.invoice_no
        
        elif gift_voucher_id and gift_voucher_amount > 0:
            # Legacy single voucher (backwards compatibility)
            # NOTE: ONE-TIME USE ONLY - always mark as fully_claimed
            from app.modules.customers.models import CustomerGiftVoucher, VoucherUsage
            
            # Lock the voucher row to prevent race condition
            voucher = db.query(CustomerGiftVoucher).filter(
                CustomerGiftVoucher.id == gift_voucher_id
            ).with_for_update().first()
            if voucher:
                # Verify voucher hasn't been used already
                if voucher.status != "active":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Voucher {voucher.barcode_no} has already been used"
                    )
                
                # Verify the voucher has not silently expired
                from dateutil.relativedelta import relativedelta
                voucher_expiry = voucher.date + relativedelta(months=voucher.valid_period_in_months or 12)
                if tz.today() > voucher_expiry:
                    voucher.status = "expired"
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Voucher {voucher.barcode_no} expired on {voucher_expiry}",
                    )
                
                # The redeemed amount can never exceed what the voucher holds
                if gift_voucher_amount > Decimal(str(voucher.balance)) + Decimal("0.01"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Voucher {voucher.barcode_no} balance is Rs. {voucher.balance:,.2f}; "
                            f"cannot redeem Rs. {gift_voucher_amount:,.2f}"
                        ),
                    )
                
                # Create voucher usage record
                voucher_usage = VoucherUsage(
                    voucher_id=gift_voucher_id,
                    invoice_id=invoice.id,
                    amount_used=gift_voucher_amount,
                    used_date=tz.now()
                )
                db.add(voucher_usage)
                
                # ONE-TIME USE: Always mark as fully_claimed regardless of amount used
                voucher.balance = Decimal("0")  # Zero out balance
                voucher.status = "fully_claimed"
                voucher.claimed_date = tz.now()
                voucher.claimed_invoice_no = invoice_data.invoice_no
        
        # =================================================================
        # Auto-create commission from the sales order (Scenario 17)
        #
        # The agent commission entry is owned by the sales order: the agent is
        # assigned here, so the commission is generated here too. The rate/amount
        # assigned on the order win; otherwise we fall back to the agent's default
        # profile rate. The entry is created whenever an agent is assigned and a
        # positive commission results, and always starts 'pending' (approval gate).
        # =================================================================
        customer_agent_id = getattr(invoice_data, 'customer_agent_id', None)
        if customer_agent_id:
            from app.modules.customers.models import Customer as CustomerModel
            agent = db.query(CustomerModel).filter(
                CustomerModel.id == customer_agent_id,
                CustomerModel.is_customer_agent == True
            ).first()

            if agent:
                from app.modules.customers.commission_models import CustomerAgentCommission as CommissionModel

                order_rate = getattr(invoice_data, 'agent_commission_rate', None)
                order_amount = getattr(invoice_data, 'agent_commission_amount', None)

                # Effective rate: order-assigned rate wins, else agent default.
                effective_rate = None
                if order_rate is not None:
                    effective_rate = Decimal(str(order_rate))
                elif agent.commission_rate:
                    effective_rate = Decimal(str(agent.commission_rate))

                # Resolve the commission amount + type from the order assignment.
                if order_amount is not None and Decimal(str(order_amount)) > 0:
                    commission_type = "AMOUNT"
                    commission_amount = Decimal(str(order_amount))
                    commission_rate = effective_rate  # informational, may be None
                elif effective_rate is not None and effective_rate > 0:
                    commission_type = "PERCENT"
                    commission_rate = effective_rate
                    commission_amount = Decimal(str(grand_total)) * (commission_rate / Decimal("100"))
                else:
                    commission_type = None
                    commission_rate = None
                    commission_amount = Decimal("0")

                if commission_amount > 0:
                    commission = CommissionModel(
                        invoice_id=invoice.id,
                        customer_agent_id=customer_agent_id,
                        represented_customer_id=invoice_data.customer_id,
                        invoice_amount=grand_total,
                        commission_type=commission_type,
                        commission_rate=commission_rate,
                        commission_amount=commission_amount,
                        status=DocumentStatus.PENDING,
                    )
                    db.add(commission)

        
        # =================================================================
        # Scenario 30: Auto-post to General Ledger for paid invoices
        # Cash/Card/Cheque invoices are auto-approved → post immediately
        # Credit/Bank Transfer invoices → post on approval/verification
        # =================================================================
        if invoice_dict.get('approval_status') == DocumentStatus.COMPLETED:
            try:
                from app.modules.sales.accounting_integration import SalesAccountingIntegration
                gl_integration = SalesAccountingIntegration(db)
                gl_integration.post_all_for_invoice(invoice, user_id)
            except Exception as e:
                # GL posting failure should not block the sale
                import logging
                logging.getLogger(__name__).error(
                    f"GL posting failed for invoice {invoice.invoice_no}: {e}"
                )
                record_gl_commit_failure(
                    db,
                    reference_type="Invoice",
                    reference_id=invoice.id,
                    reference_no=invoice.invoice_no,
                    branch_code=invoice.branch_code,
                    transaction_type="Sale",
                    description=f"Sale GL posting failed ({invoice.invoice_no})",
                    error=e,
                    user_id=user_id,
                )
        
        # =================================================================
        # Gap B4: Post customer advance application to GL
        # When an advance is applied, transfer from liability to receivables
        # =================================================================
        if advance_for_gl and advance_deducted > 0:
            try:
                from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                gl_service = PurchaseExpensePayrollGL(db)
                gl_service.post_customer_advance_application_to_gl(
                    invoice, advance_for_gl, advance_deducted, user_id
                )
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(
                    f"GL posting for advance application failed for invoice {invoice.invoice_no}: {e}"
                )
        
        # Update linked proforma/quotation status to so_created when SO is created from proforma
        source_quote_id = getattr(invoice_data, 'source_quote_id', None)
        if source_quote_id:
            try:
                from app.modules.sales.quotation_models import SalesQuote, QuoteStatus as QStatus
                linked_quote = db.query(SalesQuote).filter(SalesQuote.id == source_quote_id).first()
                if linked_quote and linked_quote.status not in [
                    QStatus.SO_CREATED.value,
                    QStatus.CONVERTED_TO_INVOICE.value,
                    QStatus.CANCELLED.value,
                ]:
                    linked_quote.status = QStatus.SO_CREATED.value
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Failed to update linked proforma status: {e}")
        
        db.commit()
        return repository.sales_repository.get_by_id(db, invoice.id)
    
    def _assert_branch_access(self, db: Session, user_id: Optional[int], branch_code: Optional[str]) -> None:
        """Block an operational mutation when the acting user has no access to
        the target branch. Superusers (and unresolved/system callers) pass.
        Mirrors the API-layer ``validate_branch_access`` so the same rule
        applies to REST and chat-agent callers alike."""
        if not user_id or not branch_code:
            return
        from app.auth.models import User
        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.is_superuser:
            return
        allowed = {b.branch_code for b in user.branches}
        if branch_code not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )

    def _recompute_invoice_totals(self, db: Session, invoice) -> None:
        """Recompute subtotal / tax / grand_total / balance_due from the
        invoice's current line items, mirroring the create_invoice pricing
        pipeline but reusing the header's existing tax rate, coupon, discount,
        voucher, credit-note and service-charge amounts (InvoiceUpdate never
        changes those). Runs in the caller's transaction (no commit)."""
        rows = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice.id).all()
        # line_total is already net of each line's own item discount.
        gross_subtotal = sum((Decimal(str(r.line_total or 0)) for r in rows), Decimal("0"))

        tax_rate = Decimal(str(invoice.tax_rate or 0))
        if invoice.is_tax_invoice and tax_rate > 0:
            net_subtotal = (gross_subtotal / (Decimal("1") + tax_rate / Decimal("100"))).quantize(Decimal("0.01"))
        else:
            net_subtotal = gross_subtotal.quantize(Decimal("0.01"))

        coupon_amount = Decimal(str(getattr(invoice, "cupon_amount", 0) or 0))
        after_coupon = (net_subtotal - coupon_amount).quantize(Decimal("0.01"))

        discount_percent = Decimal(str(invoice.discount_percent or 0))
        if discount_percent > 0:
            calculated_discount = (after_coupon * discount_percent / Decimal("100")).quantize(Decimal("0.01"))
        else:
            calculated_discount = Decimal(str(invoice.discount_amount or 0)).quantize(Decimal("0.01"))
        final_net = (after_coupon - calculated_discount).quantize(Decimal("0.01"))
        if final_net < 0:
            final_net = Decimal("0.00")

        tax_amount = (final_net * tax_rate / Decimal("100")).quantize(Decimal("0.01")) if tax_rate > 0 else Decimal("0.00")
        after_tax = (final_net + tax_amount).quantize(Decimal("0.01"))

        voucher_amount = Decimal(str(invoice.gift_voucher_amount or 0))
        credit_note_amount = Decimal(str(invoice.credit_note_amount or 0))
        service_charge_amount = Decimal(str(invoice.service_charge_amount or 0))
        grand_total = (after_tax - voucher_amount - credit_note_amount + service_charge_amount).quantize(Decimal("0.01"))
        if grand_total < 0:
            grand_total = Decimal("0.00")

        invoice.subtotal = float(final_net)
        invoice.discount_amount = float(calculated_discount)
        invoice.tax_amount = float(tax_amount)
        invoice.grand_total = float(grand_total)
        paid = Decimal(str(invoice.paid_amount or 0))
        invoice.balance_due = float((grand_total - paid).quantize(Decimal("0.01")))

    def update_invoice(self, db: Session, invoice_id: int, invoice_data: schemas.InvoiceUpdate, user_id: int):
        # Lock the invoice row to prevent concurrent edits / double-approval
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
        if not invoice:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
        
        # Branch isolation: a user may only edit invoices in their own branch(es).
        self._assert_branch_access(db, user_id, invoice.branch_code)
        
        # ── Validate customer is active (if customer is being changed) ──
        update_data_raw = invoice_data.model_dump(exclude_unset=True, exclude={'items'})
        if 'customer_id' in update_data_raw:
            from app.modules.customers.models import Customer
            customer = db.query(Customer).filter(Customer.id == update_data_raw['customer_id']).first()
            if customer and not customer.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer '{customer.customer_name}' is inactive. Please reactivate the customer before updating the invoice."
                )

        # ── Validate customer agent is active (if agent is being changed) ──
        if 'customer_agent_id' in update_data_raw and update_data_raw['customer_agent_id']:
            from app.modules.customers.models import Customer as CustomerModel
            agent = db.query(CustomerModel).filter(CustomerModel.id == update_data_raw['customer_agent_id']).first()
            if agent and not agent.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer agent '{agent.customer_name}' is inactive. Please reactivate the agent before updating the invoice."
                )

        # ── Validate products are active (if items are being changed) ──
        if invoice_data.items is not None:
            from app.modules.products.models import Product
            product_ids = [
                item_data.product_id for item_data in invoice_data.items
                if hasattr(item_data, 'product_id') and item_data.product_id
            ]
            if product_ids:
                inactive_products = db.query(Product).filter(
                    Product.id.in_(product_ids), Product.active == False
                ).all()
                if inactive_products:
                    product = inactive_products[0]
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Product '{product.name}' (ID: {product.id}) is inactive. Please reactivate the product before adding it to an invoice."
                    )

        # Track original status for re-approval logic
        was_completed = invoice.approval_status == DocumentStatus.COMPLETED
        
        # Block manual approval via update_invoice - must use Approval Dashboard
        update_data = invoice_data.model_dump(exclude_unset=True, exclude={'items'})
        if update_data.get('approval_status') == DocumentStatus.COMPLETED and invoice.approval_status == DocumentStatus.PENDING_APPROVAL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sales orders cannot be manually approved. Please use the Approval Dashboard."
            )
        
        # Handle items update if provided
        if invoice_data.items is not None:
            # A completed/approved invoice has posted GL entries, recorded
            # payments and possibly sale returns tied to its current lines.
            # Silently swapping items would desync the GL and inventory, so
            # editing items is blocked once posted — cancel the order or raise
            # a sale return instead.
            if invoice.approval_status in [DocumentStatus.COMPLETED, DocumentStatus.APPROVED]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Items cannot be changed on a completed or approved invoice. "
                        "Cancel the order or create a sale return instead."
                    ),
                )
            # First, restore stock for existing items (lock rows to prevent concurrent modification)
            existing_items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
            for item in existing_items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).with_for_update().first()
                    if stock_item and stock_item.status in [StockStatus.SOLD, StockStatus.RESERVED]:
                        stock_item.status = StockStatus.AVAILABLE
                        stock_item.is_active = True
            
            # Delete existing items and barcode links
            db.query(InvoiceItemsBarcode).filter(
                InvoiceItemsBarcode.invoice_items_id.in_(
                    [item.id for item in existing_items]
                )
            ).delete(synchronize_session=False)
            db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).delete()
            
            # Validate product availability for all new items
            for item_data in invoice_data.items:
                if item_data.barcode:
                    # Check if this barcode is still available
                    stock = db.query(SalesStock).filter(
                        SalesStock.barcode == item_data.barcode,
                        SalesStock.status == StockStatus.AVAILABLE
                    ).first()
                    if not stock:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Barcode {item_data.barcode} is no longer available"
                        )
                else:
                    self.validate_product_availability(db, item_data.product_id, item_data.quantity)
            
            # Create new items
            for item_data in invoice_data.items:
                item_dict = item_data.model_dump()
                item_dict['invoice_id'] = invoice_id
                item_dict['created_date'] = tz.now()
                
                barcode = item_dict.get('barcode', None)
                sales_stock_id = None
                
                if barcode:
                    # Lock the stock row to prevent concurrent reservation
                    stock_item = db.query(SalesStock).filter(
                        SalesStock.barcode == barcode,
                        SalesStock.status == StockStatus.AVAILABLE
                    ).with_for_update().first()
                    
                    if stock_item:
                        sales_stock_id = stock_item.id
                        item_dict['sales_stock_id'] = sales_stock_id
                        
                        # Reserve/sell stock based on approval status
                        if invoice.approval_status == DocumentStatus.COMPLETED:
                            stock_item.status = StockStatus.SOLD
                            stock_item.is_active = False
                        else:
                            stock_item.status = StockStatus.RESERVED
                
                # Calculate line total
                line_total = item_dict['quantity'] * item_dict['selling_price']
                item_dict['line_total'] = line_total
                
                item = InvoiceItems(**item_dict)
                db.add(item)
        
        # Check if payment method is being updated to credit - if so, reset approval
        if 'payment_method' in update_data:
            payment_method = update_data['payment_method'].lower()
            is_credit_payment = payment_method == "credit"
            
            if is_credit_payment:
                # Credit payment - requires approval
                update_data['approval'] = False
                update_data['approval_status'] = DocumentStatus.PENDING_APPROVAL
            else:
                # Cash/Card/Cheque/Bank - auto-approved and completed
                update_data['approval'] = True
                update_data['approval_status'] = DocumentStatus.COMPLETED
        
        for field, value in update_data.items():
            setattr(invoice, field, value)
        
        # Items changed → keep the header (subtotal/tax/grand_total/balance_due)
        # in lock-step with the new lines so it never drifts from their sum.
        if invoice_data.items is not None:
            db.flush()
            self._recompute_invoice_totals(db, invoice)
        
        db.commit()
        db.refresh(invoice)
        
        # If a completed/approved sales order was edited, reset to pending_approval
        if was_completed and ((invoice.payment_method or '').lower() == 'credit' or (invoice.credit_amount or 0) > 0):
            from app.modules.common.models import Approvals
            
            invoice.approval = False
            invoice.approval_status = DocumentStatus.PENDING_APPROVAL
            
            # Reset the existing approval record back to pending
            if invoice.approval_id:
                approval_record = db.query(Approvals).filter(Approvals.id == invoice.approval_id).first()
                if approval_record:
                    approval_record.status = ApprovalStatus.PENDING
                    approval_record.status_changed_by = None
                    approval_record.remark = "Re-approval required: Sales order was edited after approval."
            else:
                # Create a new approval record if one doesn't exist
                approval_record = approval_service.create_approval_request(
                    db=db,
                    approval_type=ApprovalType.SALES_ORDER,
                    reference_id=invoice.id,
                    reference_no=invoice.invoice_no,
                    branch_code=invoice.branch_code,
                    requested_by=user_id,
                    remarks="Re-approval required: Sales order was edited after approval.",
                    approval_group="sales_approvers"
                )
                invoice.approval_id = approval_record.id
            
            # Restore stock to reserved state (lock rows to prevent concurrent modification)
            items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
            for item in items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).with_for_update().first()
                    if stock_item and stock_item.status == StockStatus.SOLD:
                        stock_item.status = StockStatus.RESERVED
                        stock_item.is_active = True
            
            db.commit()
        
        return repository.sales_repository.get_by_id(db, invoice.id)
    
    def _release_invoice_instruments(self, db: Session, invoice, user_id: int = 0, for_delete: bool = False):
        """Give back every payment instrument an invoice consumed at creation.

        Called when an invoice is cancelled or deleted so the customer does
        not permanently lose gift-voucher money, coupon allowance or applied
        advance balance — and so no agent commission stays payable for a sale
        that never happened. Runs inside the caller's transaction (no commit).
        """
        from dateutil.relativedelta import relativedelta
        from app.modules.customers.models import (
            CustomerGiftVoucher,
            VoucherUsage,
            CustomerCuponCodes,
            CouponUsage,
            CustomerAdvancePayments,
        )
        from app.modules.customers.commission_models import CustomerAgentCommission

        # ── 1. Gift vouchers: restore balance, re-activate, drop usage rows ──
        voucher_usages = db.query(VoucherUsage).filter(
            VoucherUsage.invoice_id == invoice.id
        ).all()
        for usage in voucher_usages:
            voucher = db.query(CustomerGiftVoucher).filter(
                CustomerGiftVoucher.id == usage.voucher_id
            ).with_for_update().first()
            if voucher:
                restored = Decimal(str(voucher.balance or 0)) + Decimal(str(usage.amount_used or 0))
                voucher.balance = min(restored, Decimal(str(voucher.amount)))
                expiry = voucher.date + relativedelta(months=voucher.valid_period_in_months or 12)
                voucher.status = "active" if tz.today() <= expiry else "expired"
                voucher.claimed_date = None
                voucher.claimed_invoice_no = None
            db.delete(usage)

        # ── 2. Coupons: free the usage slots ──
        coupon_usages = db.query(CouponUsage).filter(
            CouponUsage.invoice_id == invoice.id
        ).all()
        if coupon_usages:
            for coupon_id in {u.coupon_id for u in coupon_usages}:
                coupon = db.query(CustomerCuponCodes).filter(
                    CustomerCuponCodes.id == coupon_id
                ).with_for_update().first()
                if coupon:
                    rows = sum(1 for u in coupon_usages if u.coupon_id == coupon_id)
                    was_at_limit = (coupon.usage_count or 0) >= (coupon.limit_by_usage or 0)
                    coupon.usage_count = max(0, (coupon.usage_count or 0) - rows)
                    # Re-activate only when the deactivation was certainly the
                    # automatic usage-limit one and the coupon is still in date.
                    if (
                        was_at_limit
                        and not coupon.active
                        and coupon.usage_count < (coupon.limit_by_usage or 0)
                        and coupon.valid_until_date >= tz.today()
                    ):
                        coupon.active = True
            for usage in coupon_usages:
                db.delete(usage)

        # ── 3. Customer advance: restore balance + reverse the GL application ──
        if invoice.customer_advance_payments_id:
            from app.modules.finance.accounting_models import JournalEntry

            appl_je = db.query(JournalEntry).filter(
                JournalEntry.reference_type == "CustomerAdvanceApplication",
                JournalEntry.reference_id == invoice.id,
            ).first()
            if appl_je:
                applied = Decimal(str(appl_je.total_debit or 0))
                if applied > 0:
                    advance = db.query(CustomerAdvancePayments).filter(
                        CustomerAdvancePayments.id == invoice.customer_advance_payments_id
                    ).with_for_update().first()
                    if advance:
                        advance.applied_amount = max(
                            Decimal("0"),
                            Decimal(str(advance.applied_amount or 0)) - applied,
                        )
                        advance.remaining_amount = (
                            Decimal(str(advance.payment_amount))
                            - Decimal(str(advance.applied_amount))
                        )
                        advance.is_fully_applied = advance.remaining_amount <= 0
                        try:
                            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                            PurchaseExpensePayrollGL(db).post_customer_advance_application_reversal_to_gl(
                                invoice, advance, applied, user_id
                            )
                        except Exception as gl_err:
                            logger.warning(
                                "Advance application GL reversal failed for invoice %s: %s",
                                invoice.invoice_no, gl_err,
                            )
            else:
                logger.warning(
                    "Invoice %s has an advance link but no application JE; "
                    "cannot determine the applied amount to restore.",
                    invoice.invoice_no,
                )

        # ── 4. Agent commissions: never leave one payable for a dead sale ──
        commissions = db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.invoice_id == invoice.id
        ).all()
        for commission in commissions:
            if commission.status == "paid":
                if for_delete:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            "This invoice has a PAID agent commission and cannot be "
                            "deleted. Recover the commission first."
                        ),
                    )
                logger.warning(
                    "Invoice %s cancelled but its agent commission %s is already paid; "
                    "manual recovery required.",
                    invoice.invoice_no, commission.id,
                )
            elif for_delete:
                db.delete(commission)
            else:
                commission.status = "cancelled"

    def delete_invoice(self, db: Session, invoice_id: int, user_id: Optional[int] = None):
        invoice = self.get_invoice(db, invoice_id)
        
        # Branch isolation: only delete invoices in the user's own branch(es).
        self._assert_branch_access(db, user_id, invoice.branch_code)
        
        # Completed/approved invoices have payments, GL postings and possibly
        # sale returns hanging off them — they must never be hard-deleted.
        if invoice.approval_status in [DocumentStatus.COMPLETED, DocumentStatus.APPROVED]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Completed or approved invoices cannot be deleted. "
                    "Cancel the order or create a sale return instead."
                ),
            )
        
        # Give back everything the order consumed (vouchers, coupon allowance,
        # advance balance) and drop its pending commissions before deleting.
        self._release_invoice_instruments(db, invoice, for_delete=True)
        
        # Restore sales stock for items that were sold (lock rows to prevent concurrent modification)
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).with_for_update().first()
                if stock_item and stock_item.status in (StockStatus.SOLD, StockStatus.RESERVED):
                    # Restore the stock item to available
                    stock_item.status = StockStatus.AVAILABLE
                    stock_item.is_active = True
        
        db.delete(invoice)
        db.commit()
        return {"message": "Invoice deleted successfully and stock restored"}
    
    def approve_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Approve a pending credit invoice through the centralized approval system.
        Updates the approval record and changes invoice status to completed.
        """
        # Lock the invoice row to prevent concurrent approval
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Invoice with id {invoice_id} not found"
            )
        
        if invoice.approval_status != DocumentStatus.PENDING_APPROVAL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invoice is already {invoice.approval_status}"
            )
        
        # Verify and update approval record
        if invoice.approval_id:
            from app.modules.common.models import Approvals
            approval_record = db.query(Approvals).filter(Approvals.id == invoice.approval_id).first()
            if approval_record:
                if approval_record.status != ApprovalStatus.PENDING:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                # Update approval record
                approval_record.status = ApprovalStatus.APPROVED
                approval_record.status_changed_by = user_id
                approval_record.remark = f"Approved by user {user_id} on {tz.now().strftime('%Y-%m-%d %H:%M')}"
        else:
            # Create approval record if missing (for backward compatibility)
            approval_record = approval_service.create_approval_request(
                db=db,
                approval_type=ApprovalType.SALES_ORDER,
                reference_id=invoice.id,
                reference_no=invoice.invoice_no,
                branch_code=invoice.branch_code,
                requested_by=user_id,
                remarks=f"Credit sales order approved. Amount: Rs. {invoice.grand_total:,.2f}",
                approval_group="sales_approvers"
            )
            approval_record.status = ApprovalStatus.APPROVED
            approval_record.status_changed_by = user_id
            invoice.approval_id = approval_record.id
        
        # Update invoice approval status
        invoice.approval = True
        is_credit = (invoice.payment_method or '').lower() == 'credit' or (invoice.credit_amount or 0) > 0
        if is_credit and invoice.balance_due > 0:
            invoice.approval_status = DocumentStatus.APPROVED
        else:
            invoice.approval_status = DocumentStatus.COMPLETED
        
        # Update sales stock status to 'sold' for all items with barcodes
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                # Lock the stock item row before updating
                stock_item = db.query(SalesStock).filter(
                    SalesStock.id == item.sales_stock_id
                ).with_for_update().first()
                if stock_item and stock_item.status == StockStatus.RESERVED:
                    stock_item.status = StockStatus.SOLD
                    stock_item.is_active = False
        
        # Update credit payment status to 'approved' and customer credit balance
        if invoice.credit_payment_id:
            from app.modules.finance.models import CreditPayments
            credit_payment = db.query(CreditPayments).filter(CreditPayments.id == invoice.credit_payment_id).first()
            if credit_payment:
                credit_payment.status = ApprovalStatus.APPROVED
        
        # Update customer's left_credit_amount for credit sales
        if invoice.credit_amount and invoice.credit_amount > 0:
            customer_credit_service.update_customer_credit_balance(db, invoice.customer_id)
        
        # For credit orders that are approved, automatically mark as completed only if fully settled
        if is_credit and invoice.balance_due > 0:
            invoice.approval_status = DocumentStatus.APPROVED
        else:
            invoice.approval_status = DocumentStatus.COMPLETED
        
        # =================================================================
        # Scenario 30: Auto-post to General Ledger on credit sale approval
        # =================================================================
        try:
            from app.modules.sales.accounting_integration import SalesAccountingIntegration
            gl_integration = SalesAccountingIntegration(db)
            gl_integration.post_all_for_invoice(invoice, user_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(
                f"GL posting failed for approved credit invoice {invoice.invoice_no}: {e}"
            )
            record_gl_commit_failure(
                db,
                reference_type="Invoice",
                reference_id=invoice.id,
                reference_no=invoice.invoice_no,
                branch_code=invoice.branch_code,
                transaction_type="Sale",
                description=f"Credit-sale GL posting failed on approval ({invoice.invoice_no})",
                error=e,
                user_id=user_id,
            )
        
        db.commit()
        return repository.sales_repository.get_by_id(db, invoice.id)
    
    def complete_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Mark an approved invoice as completed (e.g., when delivered/paid).
        """
        # Lock the invoice row to prevent concurrent complete/cancel
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
        if not invoice:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

        if invoice.approval_status not in ['approved', 'pending_approval']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invoice cannot be completed from status: {invoice.approval_status}"
            )
        
        invoice.approval = True
        invoice.approval_status = DocumentStatus.COMPLETED
        
        # Ensure all stock items are marked as sold (lock rows to prevent concurrent modification)
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).with_for_update().first()
                if stock_item:
                    stock_item.status = StockStatus.SOLD
                    stock_item.is_active = False
        
        # Scenario 30: Auto-post to GL on invoice completion
        try:
            from app.modules.sales.accounting_integration import SalesAccountingIntegration
            gl_integration = SalesAccountingIntegration(db)
            gl_integration.post_all_for_invoice(invoice, user_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(
                f"GL posting failed for completed invoice {invoice.invoice_no}: {e}"
            )
            record_gl_commit_failure(
                db,
                reference_type="Invoice",
                reference_id=invoice.id,
                reference_no=invoice.invoice_no,
                branch_code=invoice.branch_code,
                transaction_type="Sale",
                description=f"Sale GL posting failed on completion ({invoice.invoice_no})",
                error=e,
                user_id=user_id,
            )
        
        db.commit()
        return repository.sales_repository.get_by_id(db, invoice.id)
    
    def cancel_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Cancel an invoice and restore stock to available.
        """
        # Lock the invoice row to prevent concurrent cancel / approve race
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
        if not invoice:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

        # Branch isolation: only act on invoices in the user's own branch(es).
        self._assert_branch_access(db, user_id, invoice.branch_code)

        if invoice.approval_status == DocumentStatus.COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot cancel a completed invoice. Please create a sale return instead."
            )
        
        # Restore sales stock for all items (lock rows to prevent concurrent modification)
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).with_for_update().first()
                if stock_item:
                    stock_item.status = StockStatus.AVAILABLE
                    stock_item.is_active = True
        
        # Cancel/void the credit payment record if exists
        if invoice.credit_payment_id:
            from app.modules.finance.models import CreditPayments
            credit_payment = db.query(CreditPayments).filter(CreditPayments.id == invoice.credit_payment_id).first()
            if credit_payment:
                credit_payment.status = DocumentStatus.CANCELLED
        
        # Give back everything the order consumed: gift vouchers, coupon
        # allowance and applied advance balance — and cancel its pending
        # agent commissions so nothing stays payable for a dead sale.
        self._release_invoice_instruments(db, invoice, user_id=user_id)
        
        invoice.status = False
        invoice.approval_status = DocumentStatus.CANCELLED
        
        db.commit()
        
        # Restore customer credit balance (recalculate left_credit_amount)
        if invoice.credit_amount and invoice.credit_amount > 0:
            customer_credit_service.update_customer_credit_balance(db, invoice.customer_id)
        
        return repository.sales_repository.get_by_id(db, invoice.id)
    
    def get_sale_return(self, db: Session, return_id: int):
        sale_return = db.query(SaleReturn).filter(SaleReturn.id == return_id).first()
        if not sale_return:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sale return not found"
            )
        return sale_return
    
    def get_sale_return_with_items(self, db: Session, return_id: int):
        """Get sale return with items and all related data"""
        sale_return = db.query(SaleReturn).filter(SaleReturn.id == return_id).first()
        if not sale_return:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sale return not found"
            )
        return sale_return
    
    def create_sale_return(self, db: Session, sale_return_data: schemas.SaleReturnCreate, user_id: int = None):
        """
        Create a new sale return with full validation and processing.
        
        Process:
        1. Validate invoice exists and is completed
        2. Validate items match invoice items (barcode/product)
        3. Calculate return totals
        4. Create sale return record
        5. Create sale return items
        """
        # ── Validate branch is active ──
        from app.common.branch_validation import validate_branch_is_active
        validate_branch_is_active(db, sale_return_data.branch_code)

        # Branch isolation: only create returns in the user's own branch(es).
        self._assert_branch_access(db, user_id, sale_return_data.branch_code)

        # Get and validate the original invoice
        invoice = db.query(Invoice).filter(Invoice.id == sale_return_data.invoice_id).first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Original invoice not found"
            )
        
        if invoice.approval_status not in ['completed', 'approved']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create return for invoice with status: {invoice.approval_status}"
            )
        
        # ── Over-return guards: what has already been returned on this invoice? ──
        active_return_filter = SaleReturn.status.notin_(
            [DocumentStatus.REJECTED, DocumentStatus.CANCELLED]
        )
        prior_refunds = db.query(
            func.coalesce(func.sum(SaleReturn.total_refund), 0)
        ).filter(
            SaleReturn.invoice_id == invoice.id,
            active_return_filter,
        ).scalar() or 0

        prior_item_rows = (
            db.query(
                SaleReturnItems.invoice_item_id,
                func.coalesce(func.sum(SaleReturnItems.quantity), 0),
            )
            .join(SaleReturn, SaleReturn.id == SaleReturnItems.sale_return_id)
            .filter(
                SaleReturn.invoice_id == invoice.id,
                active_return_filter,
                SaleReturnItems.invoice_item_id.isnot(None),
            )
            .group_by(SaleReturnItems.invoice_item_id)
            .all()
        )
        already_returned_qty = {row[0]: int(row[1]) for row in prior_item_rows}

        prior_barcodes = {
            bc
            for (bc,) in db.query(SaleReturnItems.barcode)
            .join(SaleReturn, SaleReturn.id == SaleReturnItems.sale_return_id)
            .filter(
                SaleReturn.invoice_id == invoice.id,
                active_return_filter,
                SaleReturnItems.barcode.isnot(None),
            )
            .all()
        }

        # Validate each return item
        subtotal = Decimal("0")
        validated_items = []
        requested_qty_by_item: dict = {}
        seen_request_barcodes: set = set()
        
        for item_data in sale_return_data.items:
            # Find the original invoice item
            invoice_item = None
            sales_stock = None
            
            if item_data.barcode:
                # Find by barcode - look up in sales stock
                sales_stock = db.query(SalesStock).filter(
                    SalesStock.barcode == item_data.barcode
                ).first()
                
                if sales_stock:
                    # Find the invoice item that sold this stock
                    invoice_item = db.query(InvoiceItems).filter(
                        InvoiceItems.invoice_id == invoice.id,
                        InvoiceItems.sales_stock_id == sales_stock.id
                    ).first()
                    
                    if not invoice_item:
                        # Try to find by barcode string match
                        invoice_item = db.query(InvoiceItems).filter(
                            InvoiceItems.invoice_id == invoice.id,
                            InvoiceItems.barcode == item_data.barcode
                        ).first()
            
            if item_data.invoice_item_id:
                invoice_item = db.query(InvoiceItems).filter(
                    InvoiceItems.id == item_data.invoice_item_id,
                    InvoiceItems.invoice_id == invoice.id
                ).first()
                
                if invoice_item and invoice_item.sales_stock_id:
                    sales_stock = db.query(SalesStock).filter(
                        SalesStock.id == invoice_item.sales_stock_id
                    ).first()
            
            # ── The item must actually belong to the invoice being returned ──
            identifier = item_data.barcode or f"invoice item #{item_data.invoice_item_id}"
            if invoice_item is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Item '{identifier}' was not sold on invoice "
                        f"{invoice.invoice_no} and cannot be returned against it."
                    ),
                )

            # ── Barcode-tracked units are one-of-a-kind: no duplicates, no re-returns ──
            if item_data.barcode:
                if item_data.barcode in seen_request_barcodes:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Barcode '{item_data.barcode}' appears more than once in this return.",
                    )
                seen_request_barcodes.add(item_data.barcode)
                if item_data.barcode in prior_barcodes:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Barcode '{item_data.barcode}' has already been returned for this invoice.",
                    )

            # Calculate return price (use sold price if not specified)
            return_price = Decimal(str(item_data.return_price or item_data.sold_price))
            quantity = item_data.quantity

            # ── Refund price can never exceed what the customer actually paid ──
            sold_unit_price = Decimal(str(invoice_item.selling_price))
            if return_price > sold_unit_price + Decimal("0.01"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Return price (Rs. {return_price:,.2f}) for '{identifier}' exceeds "
                        f"its sold price (Rs. {sold_unit_price:,.2f})."
                    ),
                )

            # ── Quantity cap: sold − already returned − already in this request ──
            prior_qty = already_returned_qty.get(invoice_item.id, 0)
            pending_qty = requested_qty_by_item.get(invoice_item.id, 0)
            if prior_qty + pending_qty + quantity > (invoice_item.quantity or 0):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Cannot return {quantity} of '{identifier}': sold {invoice_item.quantity}, "
                        f"already returned {prior_qty + pending_qty}."
                    ),
                )
            requested_qty_by_item[invoice_item.id] = pending_qty + quantity
            
            validated_items.append({
                'item_data': item_data,
                'invoice_item': invoice_item,
                'sales_stock': sales_stock,
                'return_price': return_price,
                'quantity': quantity,
                'product_id': invoice_item.product_id if invoice_item else (sales_stock.product_id if sales_stock else None)
            })
            
            subtotal += return_price * quantity
        
        # Calculate tax refund based on original invoice tax rate
        tax_rate = Decimal(str(invoice.tax_rate or 0))
        tax_refund = subtotal * (tax_rate / 100) if tax_rate > 0 else Decimal("0")
        total_refund = subtotal + tax_refund
        
        # ── Cumulative refunds may never exceed the invoice's goods value ──
        # (subtotal + tax — independent of HOW it was paid: cash, voucher,
        #  credit note or advance)
        invoice_goods_value = Decimal(str(invoice.subtotal or 0)) + Decimal(str(invoice.tax_amount or 0))
        if Decimal(str(prior_refunds)) + total_refund > invoice_goods_value + Decimal("0.01"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Total refunds (Rs. {Decimal(str(prior_refunds)) + total_refund:,.2f}) would exceed "
                    f"the invoice value (Rs. {invoice_goods_value:,.2f}). "
                    f"Already refunded: Rs. {Decimal(str(prior_refunds)):,.2f}."
                ),
            )
        
        # Create sale return record
        return_dict = sale_return_data.model_dump(exclude={'items'})
        branch_code = sale_return_data.branch_code or invoice.branch_code or "HQ"
        return_dict['sale_return_no'] = self._get_next_sale_return_number(db, branch_code)
        return_dict['added_date'] = tz.today()
        return_dict['cheque_date'] = tz.today()
        return_dict['status'] = DocumentStatus.PENDING
        return_dict['subtotal'] = float(subtotal)
        return_dict['tax_refund'] = float(tax_refund)
        return_dict['total_refund'] = float(total_refund)
        return_dict['refund_status'] = DocumentStatus.PENDING
        return_dict['refund_amount'] = 0
        return_dict['created_by'] = user_id
        
        sale_return = SaleReturn(**return_dict)
        db.add(sale_return)
        db.flush()
        
        # Create sale return items
        for validated in validated_items:
            item_data = validated['item_data']
            item_dict = {
                'barcode': item_data.barcode,
                'return_price': float(validated['return_price']),
                'sold_price': item_data.sold_price,
                'branch_code': item_data.branch_code or sale_return_data.branch_code,
                'sale_return_id': sale_return.id,
                'added_date': tz.now(),
                'invoice_item_id': item_data.invoice_item_id or (validated['invoice_item'].id if validated['invoice_item'] else None),
                'sales_stock_id': validated['sales_stock'].id if validated['sales_stock'] else None,
                'product_id': validated['product_id'],
                'quantity': validated['quantity'],
                'condition': item_data.condition,
                'restockable': item_data.restockable,
                'restocked': False
            }
            item = SaleReturnItems(**item_dict)
            db.add(item)
        
        # Create approval record for sale return
        approval_record = approval_service.create_approval_request(
            db=db,
            approval_type=ApprovalType.SALE_RETURN,
            reference_id=sale_return.id,
            reference_no=sale_return.sale_return_no,
            branch_code=sale_return.branch_code,
            requested_by=user_id,
            remarks=f"Sale return pending approval. Refund amount: Rs. {total_refund:,.2f}",
            approval_group="sales_approvers"
        )
        sale_return.approval_id = approval_record.id
        
        db.commit()
        db.refresh(sale_return)
        return sale_return
    
    def create_full_invoice_return(
        self,
        db: Session,
        invoice_id: int,
        payment_method: str,
        return_reason: str = None,
        remark: str = None,
        good_received_locations_id: int = None,
        user_id: int = None,
    ):
        """Create a sale return covering every not-yet-returned unit on an invoice.

        One-click "Return Invoice" / cancel-entire-invoice convenience. It assembles
        a full-quantity ``SaleReturnCreate`` for all remaining items and runs it
        through the standard ``create_sale_return`` path, so the same over-return
        guards, maker-checker approval and reversing GL/cashbook postings apply on
        processing. Returns the pending ``SaleReturn``.
        """
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found",
            )

        if invoice.approval_status not in ['completed', 'approved']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot return an invoice with status '{invoice.approval_status}'. "
                    f"Pending/unapproved orders should be cancelled instead."
                ),
            )

        # How much of each line has already been returned (ignore rejected/cancelled)?
        active_return_filter = SaleReturn.status.notin_(
            [DocumentStatus.REJECTED, DocumentStatus.CANCELLED]
        )
        prior_rows = (
            db.query(
                SaleReturnItems.invoice_item_id,
                func.coalesce(func.sum(SaleReturnItems.quantity), 0),
            )
            .join(SaleReturn, SaleReturn.id == SaleReturnItems.sale_return_id)
            .filter(
                SaleReturn.invoice_id == invoice.id,
                active_return_filter,
                SaleReturnItems.invoice_item_id.isnot(None),
            )
            .group_by(SaleReturnItems.invoice_item_id)
            .all()
        )
        already_returned = {row[0]: int(row[1]) for row in prior_rows}

        items = db.query(InvoiceItems).filter(
            InvoiceItems.invoice_id == invoice.id
        ).all()

        return_items = []
        resolved_location = good_received_locations_id
        for inv_item in items:
            remaining = (inv_item.quantity or 0) - already_returned.get(inv_item.id, 0)
            if remaining <= 0:
                continue

            barcode = inv_item.barcode
            if (not barcode or resolved_location is None) and inv_item.sales_stock_id:
                stock = db.query(SalesStock).filter(
                    SalesStock.id == inv_item.sales_stock_id
                ).first()
                if stock:
                    if not barcode:
                        barcode = stock.barcode
                    if resolved_location is None and getattr(stock, "location_id", None):
                        resolved_location = stock.location_id

            return_items.append(
                schemas.SaleReturnItemCreate(
                    barcode=barcode or "",
                    return_price=float(inv_item.selling_price or 0),
                    sold_price=float(inv_item.selling_price or 0),
                    branch_code=invoice.branch_code,
                    invoice_item_id=inv_item.id,
                    product_id=inv_item.product_id,
                    quantity=remaining,
                    condition="good",
                    restockable=True,
                )
            )

        if not return_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This invoice has already been fully returned.",
            )

        sale_return_data = schemas.SaleReturnCreate(
            branch_code=invoice.branch_code,
            invoice_id=invoice.id,
            good_received_locations_id=resolved_location or 1,
            payment_method=payment_method,
            remark=remark or f"Full invoice return for {invoice.invoice_no}",
            return_reason=return_reason or "customer_changed_mind",
            items=return_items,
        )
        return self.create_sale_return(db, sale_return_data, user_id=user_id)
    
    def approve_sale_return(self, db: Session, return_id: int, user_id: int):
        """
        Approve a pending sale return through the centralized approval system.
        """
        # Lock the sale_return row to prevent concurrent double-approval
        sale_return = db.query(SaleReturn).filter(SaleReturn.id == return_id).with_for_update().first()
        if not sale_return:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sale return not found")

        if sale_return.status != DocumentStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sale return is already {sale_return.status}"
            )
        
        # Update approval record
        if sale_return.approval_id:
            from app.modules.common.models import Approvals
            approval_record = db.query(Approvals).filter(Approvals.id == sale_return.approval_id).first()
            if approval_record:
                if approval_record.status != ApprovalStatus.PENDING:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                approval_record.status = ApprovalStatus.APPROVED
                approval_record.status_changed_by = user_id
                approval_record.remark = f"Approved by user {user_id} on {tz.now().strftime('%Y-%m-%d %H:%M')}"
        else:
            # Create approval record if missing (backward compatibility)
            approval_record = approval_service.create_approval_request(
                db=db,
                approval_type=ApprovalType.SALE_RETURN,
                reference_id=sale_return.id,
                reference_no=sale_return.sale_return_no,
                branch_code=sale_return.branch_code,
                requested_by=user_id,
                remarks=f"Sale return approved.",
                approval_group="sales_approvers"
            )
            approval_record.status = ApprovalStatus.APPROVED
            approval_record.status_changed_by = user_id
            sale_return.approval_id = approval_record.id
        
        sale_return.status = DocumentStatus.APPROVED
        sale_return.approved_by = user_id
        
        db.commit()
        db.refresh(sale_return)
        return sale_return
    
    def reject_sale_return(self, db: Session, return_id: int, user_id: int, reason: str = None):
        """
        Reject a pending sale return through the centralized approval system.
        """
        # Lock the sale_return row to prevent concurrent approve/reject race
        sale_return = db.query(SaleReturn).filter(SaleReturn.id == return_id).with_for_update().first()
        if not sale_return:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sale return not found")

        if sale_return.status not in ['pending', 'approved']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject sale return with status: {sale_return.status}"
            )
        
        # Update approval record
        if sale_return.approval_id:
            from app.modules.common.models import Approvals
            approval_record = db.query(Approvals).filter(Approvals.id == sale_return.approval_id).first()
            if approval_record:
                approval_record.status = ApprovalStatus.REJECTED
                approval_record.status_changed_by = user_id
                approval_record.remark = reason or f"Rejected by user {user_id}"
        
        sale_return.status = DocumentStatus.REJECTED
        if reason:
            sale_return.remark = f"{sale_return.remark or ''} | Rejected: {reason}".strip(' |')
        
        db.commit()
        db.refresh(sale_return)
        return sale_return
    
    def process_sale_return(self, db: Session, return_id: int, user_id: int):
        """
        Process an approved sale return:
        1. Restore stock for restockable items
        2. Create credit note or process refund
        3. Update invoice payment status if needed
        4. Mark return as processed
        """
        # Lock the sale_return row first to prevent double-processing
        sale_return = db.query(SaleReturn).filter(SaleReturn.id == return_id).with_for_update().first()
        if not sale_return:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sale return not found")

        if sale_return.status != DocumentStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Only approved sale returns can be processed (current status: {sale_return.status}). "
                    f"Approve it via the Approvals dashboard first."
                ),
            )

        # Lock the original invoice to prevent concurrent payment updates
        invoice = db.query(Invoice).filter(Invoice.id == sale_return.invoice_id).with_for_update().first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Original invoice not found"
            )
        
        items_restocked = 0
        items_to_company_assets = 0
        
        # Process each return item
        for item in sale_return.items:
            if item.restockable and item.condition == 'good':
                # Restore the physical unit to AVAILABLE. Prefer the linked
                # stock id, then fall back to the barcode, so a restockable
                # item is never silently left un-restocked.
                stock = None
                if item.sales_stock_id:
                    stock = db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                if (stock is None or stock.status != StockStatus.SOLD) and item.barcode:
                    stock = db.query(SalesStock).filter(
                        SalesStock.barcode == item.barcode
                    ).with_for_update().first()
                if stock and stock.status == StockStatus.SOLD:
                    stock.status = StockStatus.AVAILABLE
                    stock.is_active = True
                    stock.returned_date = tz.now()
                    item.restocked = True
                    items_restocked += item.quantity
                else:
                    logger.warning(
                        "Sale return %s: restockable item %s (barcode=%s, stock_id=%s) "
                        "could not be matched to a SOLD stock unit; not restocked.",
                        sale_return.sale_return_no, item.id, item.barcode, item.sales_stock_id,
                    )
            else:
                # Non-restockable items → save to company assets
                from app.modules.inventory.models import CompanyAssets
                from app.modules.products.models import Product
                
                # Determine product info
                product = None
                product_id = item.product_id
                if product_id:
                    product = db.query(Product).filter(Product.id == product_id).first()
                elif item.barcode:
                    # Try to find product from sales stock
                    stock = db.query(SalesStock).filter(SalesStock.barcode == item.barcode).first()
                    if stock:
                        product_id = stock.product_id
                        product = db.query(Product).filter(Product.id == stock.product_id).first()
                
                # Build return reason description
                condition_label = item.condition or "unknown"
                return_reason = sale_return.return_reason or "Not specified"
                reason_desc = f"{return_reason} - Condition: {condition_label}"
                
                # Generate inventory number
                inv_no = f"CA-SR-{sale_return.sale_return_no}-{item.id}"
                item_name = product.name if product else f"Returned Item ({item.barcode})"
                
                # Check if barcode already exists in company assets
                existing_asset = db.query(CompanyAssets).filter(
                    CompanyAssets.barcode == item.barcode
                ).first() if item.barcode else None
                
                if not existing_asset:
                    asset = CompanyAssets(
                        product_id=product_id,
                        inventory_no=inv_no,
                        item=item_name,
                        description=reason_desc,
                        branch_code=item.branch_code or sale_return.branch_code,
                        barcode=item.barcode,
                        status="returned",
                        return_reason=reason_desc,
                        sale_return_id=sale_return.id,
                        source="sale_return",
                        added_date=tz.now(),
                    )
                    db.add(asset)
                    items_to_company_assets += 1
                    
                    # Mark the sales stock item as no longer active
                    if item.barcode:
                        stock = db.query(SalesStock).filter(
                            SalesStock.barcode == item.barcode
                        ).with_for_update().first()
                        if stock:
                            stock.status = StockStatus.RETURNED
                            stock.is_active = False
                            stock.returned_date = tz.now()
        
        # Handle refund based on payment method
        refund_reference = None
        credit_note_id = None
        
        if sale_return.payment_method == 'credit_note':
            # Create a credit note for the customer
            from app.modules.customers.models import CustomerCreditNotes
            
            # Get customer from invoice
            customer_id = invoice.customer_id
            
            credit_note = CustomerCreditNotes(
                customer_id=customer_id,
                date=tz.now(),
                amount=sale_return.total_refund,
                remark=f"Sale Return: {sale_return.sale_return_no}",
                invoice_no=invoice.invoice_no
            )
            db.add(credit_note)
            db.flush()
            
            credit_note_id = credit_note.id
            sale_return.credit_note_id = credit_note_id
            refund_reference = f"CN-{credit_note.id}"
            
        elif sale_return.payment_method == 'cash':
            # Cash refund - record as processed
            refund_reference = f"CASH-{sale_return.sale_return_no}"
            
        elif sale_return.payment_method == 'bank_transfer':
            # Bank transfer refund - would need bank details
            refund_reference = f"BT-{sale_return.sale_return_no}"
            
        elif sale_return.payment_method == 'cheque':
            # Cheque refund
            refund_reference = f"CHQ-{sale_return.sale_return_no}"
        
        # Update sale return status
        sale_return.status = 'processed'
        sale_return.refund_status = 'processed'
        sale_return.refund_amount = sale_return.total_refund
        sale_return.refund_date = tz.today()
        sale_return.refund_reference = refund_reference
        sale_return.processed_by = user_id
        
        # Update invoice totals based on refund method
        refund_total = float(sale_return.total_refund)

        if sale_return.payment_method == 'credit_note':
            # Credit note: track via credit_note_amount, adjust balance_due for credit sales
            invoice.credit_note_amount = float(invoice.credit_note_amount or 0) + refund_total
            # For credit sales, reduce balance_due
            if (invoice.payment_method or '').lower() == 'credit' or (invoice.credit_amount or 0) > 0:
                invoice.balance_due = max(0, float(invoice.balance_due or 0) - refund_total)
        else:
            # Cash/bank/cheque refund: reduce paid_amount (money going out)
            new_paid_amount = float(invoice.paid_amount or 0) - refund_total
            if new_paid_amount < 0:
                new_paid_amount = 0
            invoice.paid_amount = new_paid_amount
            invoice.balance_due = max(0, float(invoice.grand_total or 0) - new_paid_amount)
        
        # Recalculate payment status
        grand = float(invoice.grand_total or 0)
        paid = float(invoice.paid_amount or 0)
        balance = float(invoice.balance_due or 0)

        if grand > 0 and balance <= 0 and paid >= grand:
            invoice.payment_status = PaymentStatus.PAID
            if (invoice.payment_method or '').lower() == 'credit' or (invoice.credit_amount or 0) > 0:
                invoice.approval_status = DocumentStatus.COMPLETED
        elif paid > 0:
            invoice.payment_status = PaymentStatus.PARTIAL
        else:
            invoice.payment_status = PaymentStatus.UNPAID
        
        # Scenario 30: Auto-post sale return reversal to GL
        try:
            from app.modules.sales.accounting_integration import SalesAccountingIntegration
            gl_integration = SalesAccountingIntegration(db)
            gl_integration.post_sale_return_to_gl(sale_return, user_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(
                f"GL posting failed for sale return {sale_return.sale_return_no}: {e}"
            )
            record_gl_commit_failure(
                db,
                reference_type="SaleReturn",
                reference_id=sale_return.id,
                reference_no=sale_return.sale_return_no,
                branch_code=sale_return.branch_code,
                transaction_type="Sale",
                description=f"Sale return GL posting failed ({sale_return.sale_return_no})",
                error=e,
                user_id=user_id,
            )

        # Cashbook hook: cash/bank/cheque refunds move real money out of the
        # till — mirror the GL credit (1010/1020) so the day-end cashbook ↔ GL
        # identity holds. Credit-note refunds move no money → no cashbook entry.
        if (sale_return.payment_method or "").lower() in ("cash", "bank_transfer", "cheque"):
            self._ensure_cashbook_entry_for_sale_return(db, sale_return, invoice)
        
        db.commit()
        
        # Update customer credit balance if this return affects a credit invoice
        # (balance_due may have been reduced by credit note, changing outstanding credit)
        if invoice.customer_id and ((invoice.payment_method or '').lower() == 'credit' or (invoice.credit_amount or 0) > 0):
            try:
                customer_credit_service.update_customer_credit_balance(db, invoice.customer_id)
            except Exception as cred_err:
                import logging
                logging.getLogger(__name__).warning(
                    f"Customer credit balance update after sale return {sale_return.sale_return_no} "
                    f"failed (non-blocking): {cred_err}"
                )
        
        db.refresh(sale_return)
        
        return {
            "sale_return": sale_return,
            "credit_note_id": credit_note_id,
            "refund_reference": refund_reference,
            "items_restocked": items_restocked,
            "items_to_company_assets": items_to_company_assets,
            "message": f"Sale return processed successfully. {items_restocked} items restocked. {items_to_company_assets} items saved to company assets."
        }
    
    def _ensure_cashbook_entry_for_sale_return(self, db: Session, sale_return, invoice) -> None:
        """Record cashbook money-out for a cash/bank/cheque sale-return refund.

        Mirrors the GL credit to 1010/1020 so the day-end cashbook ↔ GL
        reconciliation identity holds. Idempotent per sale_return id; runs in
        the caller's transaction (no commit here). Credit-note refunds move no
        money and must NOT reach this helper.
        """
        try:
            from app.modules.finance.models import CashbookEntryRecord

            existing = db.query(CashbookEntryRecord.id).filter(
                CashbookEntryRecord.source_table == "sale_return",
                CashbookEntryRecord.source_id == sale_return.id,
            ).first()
            if existing:
                return

            total_refund = Decimal(str(sale_return.total_refund or 0))
            if total_refund <= 0:
                return

            customer_name = None
            if invoice is not None and invoice.customer_id:
                from app.modules.customers.models import Customer
                row = db.query(Customer.customer_name).filter(
                    Customer.id == invoice.customer_id
                ).first()
                customer_name = row[0] if row else None

            db.execute(
                text("""
                    SELECT fn_insert_cashbook_entry(
                        :entry_type, :transaction_date, :source_table, :source_id,
                        :reference_no, :description, :party_name, :payment_method,
                        :money_in, :money_out, :branch_code
                    )
                """),
                {
                    "entry_type": "sale_return_refund",
                    "transaction_date": datetime.combine(
                        sale_return.refund_date or sale_return.added_date or tz.today(),
                        datetime.min.time(),
                    ),
                    "source_table": "sale_return",
                    "source_id": sale_return.id,
                    "reference_no": sale_return.sale_return_no,
                    "description": f"Sale Return {sale_return.sale_return_no} - refund to customer",
                    "party_name": customer_name or (f"Customer #{invoice.customer_id}" if invoice else "Customer"),
                    "payment_method": sale_return.payment_method,
                    "money_in": Decimal("0"),
                    "money_out": total_refund,
                    "branch_code": sale_return.branch_code,
                },
            )
        except Exception as cashbook_err:
            logging.getLogger(__name__).warning(
                f"Cashbook posting for sale return {sale_return.sale_return_no} failed (non-blocking): {cashbook_err}"
            )

    def delete_sale_return(self, db: Session, return_id: int):
        """Delete a pending sale return."""
        sale_return = self.get_sale_return(db, return_id)
        
        if sale_return.status not in [DocumentStatus.PENDING, DocumentStatus.REJECTED]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete a processed or approved sale return"
            )
        
        db.delete(sale_return)
        db.commit()
        return {"message": "Sale return deleted successfully"}
    
    def get_return_statistics(self, db: Session):
        """Get sale return statistics for dashboard."""
        today = tz.today()
        current_month_start = today.replace(day=1)
        
        total_returns = db.query(func.count(SaleReturn.id)).scalar() or 0
        pending_returns = db.query(func.count(SaleReturn.id)).filter(
            SaleReturn.status == DocumentStatus.PENDING
        ).scalar() or 0
        
        current_month_returns = db.query(func.count(SaleReturn.id)).filter(
            SaleReturn.added_date >= current_month_start
        ).scalar() or 0
        
        total_refunded = db.query(func.coalesce(func.sum(SaleReturn.refund_amount), 0)).filter(
            SaleReturn.refund_status == 'processed'
        ).scalar() or 0
        
        return {
            "total_returns": total_returns,
            "pending_returns": pending_returns,
            "current_month_returns": current_month_returns,
            "total_refunded": float(total_refunded)
        }
    
    def settle_credit_payment(self, db: Session, payment_data: schemas.CreditPaymentCreate, user_id: int):
        """
        Settle (full or partial) payment for a credit sales order.
        Creates settlement record and updates invoice payment status.
        Standard ERP credit payment settlement flow.
        """
        from app.modules.customers.models import CustomerCreditsSettle, CustomerCreditsSettleTransaction
        from app.modules.finance.models import ChequePayments, CardPayments, BankDeposits
        
        # Lock the invoice row to prevent concurrent payment updates
        invoice = db.query(Invoice).filter(Invoice.id == payment_data.invoice_id).with_for_update().first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Invoice with id {payment_data.invoice_id} not found"
            )
        
        # Branch isolation: only settle payments for invoices in the user's branch(es).
        self._assert_branch_access(db, user_id, invoice.branch_code)
        
        # Validate it's a credit invoice
        if (invoice.payment_method or '').lower() != 'credit' and (invoice.credit_amount or 0) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This invoice is not a credit sale"
            )
        
        # Validate invoice is approved/completed
        if invoice.approval_status not in ['approved', 'completed']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot settle payment for invoice with status: {invoice.approval_status}"
            )
        
        # Validate payment amount (accounting for pending bank transfer amounts)
        pending_bt_amount = db.query(func.coalesce(func.sum(CustomerCreditsSettleTransaction.payment_amount), 0)).filter(
            CustomerCreditsSettleTransaction.invoice_id == invoice.id,
            CustomerCreditsSettleTransaction.status == "pending_verification"
        ).scalar() or 0
        effective_balance = float(Decimal(str(invoice.balance_due)) - Decimal(str(pending_bt_amount)))
        if payment_data.payment_amount > effective_balance:
            detail_msg = f"Payment amount (Rs. {payment_data.payment_amount:,.2f}) exceeds available balance (Rs. {effective_balance:,.2f})"
            if float(pending_bt_amount) > 0:
                detail_msg += f". Note: Rs. {float(pending_bt_amount):,.2f} is pending bank transfer verification."
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=detail_msg
            )
        
        # Generate settlement number with advisory lock for concurrency safety
        year = tz.year()
        settle_prefix = f"CCS-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": settle_prefix})
        last_settle = (
            db.query(CustomerCreditsSettle)
            .filter(CustomerCreditsSettle.customer_credits_settle_no.like(f"{settle_prefix}-%"))
            .order_by(CustomerCreditsSettle.id.desc())
            .first()
        )
        if last_settle:
            try:
                last_seq = int(last_settle.customer_credits_settle_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        settle_no = f"{settle_prefix}-{next_seq:05d}"
        
        # Create credit settle record
        credit_settle = CustomerCreditsSettle(
            customer_credits_settle_no=settle_no,
            branch_code=invoice.branch_code,
            created_date=tz.now(),
            customer_id=invoice.customer_id
        )
        db.add(credit_settle)
        db.flush()
        
        # Create payment record based on method
        payment_method = payment_data.payment_method.lower()
        bank_deposit = None  # Will be set if payment_method is bank_transfer
        
        # Handle cheque payment
        if payment_method == "cheque":
            cheque_payment = ChequePayments(
                cheque_number=str(payment_data.cheque_number).strip() if payment_data.cheque_number else "",
                branch_code=invoice.branch_code,
                from_party=(invoice.customer.customer_name or "Customer")[:50],
                bank=payment_data.cheque_bank or "",
                amount=payment_data.payment_amount,
                cheque_date=payment_data.cheque_date or payment_data.payment_date,
                deposit_date=payment_data.payment_date,
                remark=payment_data.remarks or f"Credit settlement for {invoice.invoice_no}",
                payment_for="Credit Settlement",
                invoice_no=invoice.invoice_no
            )
            db.add(cheque_payment)
            db.flush()
        
        # Handle card payment
        elif payment_method in ["card_visa", "card_mastercard", "card_amex"]:
            card_type_map = {
                "card_visa": "VISA",
                "card_mastercard": "MASTER",
                "card_amex": "AMEX"
            }
            remark_parts = []
            if payment_data.card_holder_name:
                remark_parts.append(payment_data.card_holder_name)
            if payment_data.service_charge_amount and payment_data.service_charge_amount > 0:
                remark_parts.append(f"Service Charge: Rs. {payment_data.service_charge_amount:,.2f}")
            card_payment = CardPayments(
                card_type=card_type_map.get(payment_method, "VISA"),
                amount=payment_data.payment_amount + (payment_data.service_charge_amount or 0),
                date_time=tz.now(),
                remark=" | ".join(remark_parts) if remark_parts else f"Credit settlement for {invoice.invoice_no}",
                ref_number=payment_data.card_ref_number or "",
                invoice_no=invoice.invoice_no,
                deposited=True
            )
            db.add(card_payment)
            db.flush()
        
        # Handle bank transfer
        elif payment_method == "bank_transfer":
            bank_deposit = BankDeposits(
                deposits_amount=payment_data.payment_amount,
                remarks=f"Ref: {payment_data.bank_transfer_ref}" if payment_data.bank_transfer_ref else f"Credit settlement for {invoice.invoice_no}",
                created_date=tz.now(),
                branch_code=invoice.branch_code,
                bank_name=payment_data.bank_name or "",
                user_id=user_id,
                payment_for="Credit Settlement",
                invoice_no=invoice.invoice_no,
                verified=False,
                returned=False
            )
            db.add(bank_deposit)
            db.flush()
        
        # Create settlement transaction
        txn_remarks = payment_data.remarks
        if payment_data.service_charge_amount and payment_data.service_charge_amount > 0:
            sc_text = f"Service Charge: Rs. {payment_data.service_charge_amount:,.2f}"
            if txn_remarks:
                txn_remarks = f"{txn_remarks} ({sc_text})"
            else:
                txn_remarks = sc_text

        # Determine bank_deposit_id if bank transfer
        linked_bank_deposit_id = None
        if payment_method == "bank_transfer" and bank_deposit:
            linked_bank_deposit_id = bank_deposit.id

        settle_transaction = CustomerCreditsSettleTransaction(
            payment_method=payment_data.payment_method,
            cheque_date=payment_data.cheque_date or payment_data.payment_date,
            payment_amount=payment_data.payment_amount,
            payment_method_number=payment_data.cheque_number or payment_data.card_ref_number or payment_data.bank_transfer_ref,
            remarks=txn_remarks,
            created_date=payment_data.payment_date,
            customer_credit_settle_id=credit_settle.id,
            invoice_id=invoice.id,
            status="pending_verification" if payment_method == "bank_transfer" else "completed",
            bank_deposit_id=linked_bank_deposit_id
        )
        settle_transaction.service_charge_amount = Decimal(str(payment_data.service_charge_amount or 0))
        db.add(settle_transaction)
        
        # For bank transfers: defer balance update and GL posting until verification
        if payment_method == "bank_transfer":
            previous_balance = invoice.balance_due
            db.commit()
            db.refresh(invoice)
            return {
                "invoice_id": invoice.id,
                "payment_amount": payment_data.payment_amount,
                "previous_balance": previous_balance,
                "new_balance": invoice.balance_due,  # Unchanged — pending verification
                "payment_status": "pending_bank_verification",
                "settlement_record_id": credit_settle.id,
                "message": f"Bank transfer payment of Rs. {payment_data.payment_amount:,.2f} submitted for verification. Balance will be updated after verification."
            }
        
        # Update invoice payment tracking (non-bank-transfer methods)
        previous_balance = invoice.balance_due
        invoice.paid_amount = float(Decimal(str(invoice.paid_amount)) + Decimal(str(payment_data.payment_amount)))
        invoice.balance_due = float(Decimal(str(invoice.balance_due)) - Decimal(str(payment_data.payment_amount)))
        
        # Update payment status
        if invoice.balance_due <= 0:
            invoice.payment_status = PaymentStatus.PAID
            invoice.balance_due = 0  # Ensure no negative balance
            invoice.approval_status = DocumentStatus.COMPLETED
        elif invoice.paid_amount > 0:
            invoice.payment_status = PaymentStatus.PARTIAL
        
        db.commit()
        
        # Step 12: Update customer credit balance (restore left_credit_amount)
        customer_credit_service.update_customer_credit_balance(db, invoice.customer_id)
        
        # Step 13: Post credit settlement to GL (Dr Cash/Bank/Card, Cr Trade Debtors)
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(db)
            gl_service.post_customer_credit_settlement_to_gl(
                credit_settle, [settle_transaction], user_id=user_id
            )
            db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(
                f"GL posting for credit settlement {settle_no} failed (non-blocking): {gl_err}"
            )
        
        db.refresh(invoice)
        
        return {
            "invoice_id": invoice.id,
            "payment_amount": payment_data.payment_amount,
            "previous_balance": previous_balance,
            "new_balance": invoice.balance_due,
            "payment_status": invoice.payment_status,
            "settlement_record_id": credit_settle.id,
            "message": f"Payment of Rs. {payment_data.payment_amount:,.2f} recorded successfully. New balance: Rs. {invoice.balance_due:,.2f}"
        }
    
    def get_invoice_payment_history(self, db: Session, invoice_id: int):
        """Get payment history for a credit invoice."""
        from app.modules.customers.models import CustomerCreditsSettleTransaction
        
        invoice = self.get_invoice(db, invoice_id)
        
        if (invoice.payment_method or '').lower() != 'credit' and (invoice.credit_amount or 0) <= 0:
            return []
        
        transactions = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.invoice_id == invoice_id
        ).order_by(CustomerCreditsSettleTransaction.created_date.desc()).all()
        
        # Calculate running balance
        current_balance = invoice.credit_amount
        history = []
        
        # Sort by date ascending for balance calculation
        sorted_transactions = sorted(transactions, key=lambda x: x.created_date)
        
        pm_map = {
            "cash": "Cash",
            "card": "Card",
            "card_visa": "Visa Card",
            "card_mastercard": "Mastercard",
            "card_amex": "Amex Card",
            "bank_transfer": "Bank Transfer",
            "bank": "Bank Transfer",
            "cheque": "Cheque",
        }
        
        for trans in sorted_transactions:
            # Only deduct from balance for completed transactions
            if not hasattr(trans, 'status') or trans.status == "completed":
                current_balance -= trans.payment_amount
            
            # Add status indicator for pending/rejected bank transfers
            payment_method_display = pm_map.get(trans.payment_method.lower(), trans.payment_method) if trans.payment_method else ""
            txn_status = getattr(trans, 'status', 'completed')
            if txn_status == "pending_verification":
                payment_method_display += " (Pending Verification)"
            elif txn_status == "rejected":
                payment_method_display += " (Rejected)"
            
            history.append({
                "id": trans.id,
                "payment_date": trans.created_date,
                "payment_method": payment_method_display,
                "payment_amount": float(trans.payment_amount),
                "balance_after_payment": float(current_balance),
                "remarks": trans.remarks,
                "created_at": trans.credit_settle.created_date
            })
        
        # Return in descending order (most recent first)
        return list(reversed(history))

    def get_pending_bank_transfers(
        self, 
        db: Session, 
        branch_code: Optional[str] = None,
        user_branches: Optional[List[str]] = None
    ):
        """Get all invoices with bank transfer payments (all statuses)."""
        from app.auth.models import User
        
        query = db.query(Invoice).filter(
            Invoice.payment_method == "bank_transfer"
        )
        
        # Apply branch filter
        if user_branches:
            query = query.filter(Invoice.branch_code.in_(user_branches))
        elif branch_code:
            query = query.filter(Invoice.branch_code == branch_code)
        
        invoices = query.order_by(Invoice.created_date.desc(), Invoice.id.desc()).all()
        
        result = []
        for inv in invoices:
            # Get customer name
            customer_name = inv.customer.customer_name if inv.customer else "Unknown"
            
            # Get created by user name
            created_by_name = None
            if inv.sale_rep_id:
                user = db.query(User).filter(User.id == inv.sale_rep_id).first()
                if user:
                    created_by_name = f"{user.first_name} {user.last_name}".strip() or user.username
            
            # Get items
            items = []
            for item in inv.items:
                items.append({
                    "id": item.id,
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "selling_price": float(item.selling_price),
                    "minimum_selling_price": float(item.minimum_selling_price),
                    "warrenty_month": item.warrenty_month,
                    "barcode": item.barcode,
                    "discount_percent": float(item.discount_percent or 0),
                    "discount_amount": float(item.discount_amount or 0),
                    "line_total": float(item.line_total or 0),
                    "invoice_id": item.invoice_id,
                    "created_date": item.created_date
                })
            
            # Get verified by user name
            verified_by_name = None
            if inv.bank_transfer_verified_by:
                verified_user = db.query(User).filter(User.id == inv.bank_transfer_verified_by).first()
                if verified_user:
                    verified_by_name = f"{verified_user.first_name} {verified_user.last_name}".strip() or verified_user.username
            
            result.append({
                "id": inv.id,
                "invoice_no": inv.invoice_no,
                "customer_id": inv.customer_id,
                "customer_name": customer_name,
                "branch_code": inv.branch_code,
                "bank_transfer_amount": float(inv.bank_transfer_amount),
                "bank_transfer_ref": inv.bank_transfer.remarks if inv.bank_transfer else None,
                "bank_name": inv.bank_transfer.bank_name if inv.bank_transfer else None,
                "grand_total": float(inv.grand_total),
                "created_date": inv.created_date_time,
                "created_by_name": created_by_name,
                "bank_transfer_status": inv.bank_transfer_status,
                "bank_transfer_verified_by_name": verified_by_name,
                "bank_transfer_verified_at": inv.bank_transfer_verified_date,
                "bank_transfer_rejection_reason": inv.bank_transfer_rejection_reason,
                "items": items,
                "source": "sales_order",
                "settlement_transaction_id": None
            })
        
        # --- Also include credit settlement bank transfers ---
        from app.modules.customers.models import CustomerCreditsSettleTransaction
        from app.modules.finance.models import BankDeposits as BankDepositsModel

        cs_query = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.payment_method.ilike("%bank%"),
            CustomerCreditsSettleTransaction.status.in_(["pending_verification", "completed", "rejected"])
        )

        cs_txns = cs_query.order_by(CustomerCreditsSettleTransaction.created_date.desc()).all()

        for txn in cs_txns:
            cs_invoice = txn.invoice
            if not cs_invoice:
                continue

            # Apply branch filter
            if user_branches and cs_invoice.branch_code not in user_branches:
                continue
            elif branch_code and cs_invoice.branch_code != branch_code:
                continue

            customer_name = cs_invoice.customer.customer_name if cs_invoice.customer else "Unknown"

            # Get bank deposit details
            bt_ref = None
            bt_bank = None
            if txn.bank_deposit_id:
                bd = db.query(BankDepositsModel).filter(BankDepositsModel.id == txn.bank_deposit_id).first()
                if bd:
                    bt_ref = bd.remarks
                    bt_bank = bd.bank_name

            # Map status
            status_map = {
                "pending_verification": "pending_verification",
                "completed": "verified",
                "rejected": "rejected"
            }

            # Get created by user name
            created_by_name = None
            if cs_invoice.sale_rep_id:
                user = db.query(User).filter(User.id == cs_invoice.sale_rep_id).first()
                if user:
                    created_by_name = f"{user.first_name} {user.last_name}".strip() or user.username

            result.append({
                "id": cs_invoice.id,
                "invoice_no": cs_invoice.invoice_no,
                "customer_id": cs_invoice.customer_id,
                "customer_name": customer_name,
                "branch_code": cs_invoice.branch_code,
                "bank_transfer_amount": float(txn.payment_amount),
                "bank_transfer_ref": bt_ref,
                "bank_name": bt_bank,
                "grand_total": float(cs_invoice.grand_total),
                "created_date": txn.credit_settle.created_date if txn.credit_settle else txn.created_date,
                "created_by_name": created_by_name,
                "bank_transfer_status": status_map.get(txn.status, txn.status),
                "bank_transfer_verified_by_name": None,
                "bank_transfer_verified_at": None,
                "bank_transfer_rejection_reason": txn.remarks if txn.status == "rejected" else None,
                "items": [],
                "source": "credit_settlement",
                "settlement_transaction_id": txn.id
            })

        return result

    def confirm_bank_transfer(
        self, 
        db: Session, 
        invoice_id: int, 
        action: str, 
        user_id: int,
        rejection_reason: Optional[str] = None
    ):
        """Confirm (verify) or reject a bank transfer payment."""
        # Lock the invoice row to prevent concurrent verify/reject
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
        
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found"
            )
        
        if invoice.payment_method != "bank_transfer":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invoice is not a bank transfer payment"
            )
        
        if invoice.bank_transfer_status != "pending_verification":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Bank transfer is not pending verification. Current status: {invoice.bank_transfer_status}"
            )
        
        if action == "verify":
            # Mark as verified and complete the sale
            invoice.bank_transfer_status = "verified"
            invoice.bank_transfer_verified_by = user_id
            invoice.bank_transfer_verified_date = tz.now()
            invoice.approval = True
            invoice.approval_status = DocumentStatus.COMPLETED
            invoice.paid_amount = float(invoice.grand_total)
            invoice.balance_due = 0
            invoice.payment_status = PaymentStatus.PAID
            
            # Mark bank deposit as verified
            if invoice.bank_transfer:
                invoice.bank_transfer.verified = True
            
            # Mark reserved stock as sold (lock rows to prevent concurrent modification)
            for item in invoice.items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                    if stock_item and stock_item.status == StockStatus.RESERVED:
                        stock_item.status = StockStatus.SOLD
                        stock_item.is_active = False
            
            # Scenario 30: Auto-post to GL on bank transfer verification
            try:
                from app.modules.sales.accounting_integration import SalesAccountingIntegration
                gl_integration = SalesAccountingIntegration(db)
                gl_integration.post_all_for_invoice(invoice, user_id)
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(
                    f"GL posting failed for verified bank transfer {invoice.invoice_no}: {e}"
                )
                record_gl_commit_failure(
                    db,
                    reference_type="Invoice",
                    reference_id=invoice.id,
                    reference_no=invoice.invoice_no,
                    branch_code=invoice.branch_code,
                    transaction_type="Sale",
                    description=f"Sale GL posting failed on bank-transfer verify ({invoice.invoice_no})",
                    error=e,
                    user_id=user_id,
                )
            
            db.commit()
            db.refresh(invoice)
            
            return {
                "success": True,
                "message": f"Bank transfer verified. Sales order {invoice.invoice_no} is now complete.",
                "invoice_no": invoice.invoice_no,
                "status": "completed"
            }
        
        elif action == "reject":
            if not rejection_reason:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Rejection reason is required"
                )
            
            # Mark as rejected and cancel the order
            invoice.bank_transfer_status = "rejected"
            invoice.bank_transfer_verified_by = user_id
            invoice.bank_transfer_verified_date = tz.now()
            invoice.bank_transfer_rejection_reason = rejection_reason
            invoice.approval = False
            invoice.approval_status = DocumentStatus.CANCELLED
            invoice.payment_status = PaymentStatus.UNPAID
            invoice.status = False
            
            # Release reserved stock back to available (lock rows to prevent concurrent modification)
            for item in invoice.items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                    if stock_item and stock_item.status == StockStatus.RESERVED:
                        stock_item.status = StockStatus.AVAILABLE
                        stock_item.is_active = True
            
            db.commit()
            db.refresh(invoice)
            
            return {
                "success": True,
                "message": f"Bank transfer rejected. Sales order {invoice.invoice_no} has been cancelled.",
                "invoice_no": invoice.invoice_no,
                "status": "cancelled"
            }
        
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid action. Use 'verify' or 'reject'."
            )

    def confirm_credit_settlement_bank_transfer(
        self,
        db: Session,
        transaction_id: int,
        action: str,
        user_id: int,
        rejection_reason: Optional[str] = None
    ):
        """
        Verify or reject a credit settlement bank transfer payment.
        Mirrors the sales order bank transfer verification flow.
        - verify: Apply the deferred balance update, mark BankDeposit verified, post GL
        - reject: Void the settlement transaction, mark BankDeposit rejected
        """
        from app.modules.customers.models import CustomerCreditsSettle, CustomerCreditsSettleTransaction
        from app.modules.finance.models import BankDeposits

        # Lock the transaction row
        txn = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.id == transaction_id
        ).with_for_update().first()

        if not txn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Settlement transaction not found"
            )

        if txn.status != "pending_verification":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Transaction is not pending verification. Current status: {txn.status}"
            )

        # Lock the related invoice
        invoice = db.query(Invoice).filter(
            Invoice.id == txn.invoice_id
        ).with_for_update().first()

        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Related invoice not found"
            )

        credit_settle = db.query(CustomerCreditsSettle).filter(
            CustomerCreditsSettle.id == txn.customer_credit_settle_id
        ).first()

        if action == "verify":
            # Mark transaction as completed
            txn.status = "completed"

            # Apply the deferred balance update
            invoice.paid_amount = float(Decimal(str(invoice.paid_amount)) + Decimal(str(txn.payment_amount)))
            invoice.balance_due = float(Decimal(str(invoice.balance_due)) - Decimal(str(txn.payment_amount)))

            # Update payment status
            if invoice.balance_due <= 0:
                invoice.payment_status = PaymentStatus.PAID
                invoice.balance_due = 0
                invoice.approval_status = DocumentStatus.COMPLETED
            elif invoice.paid_amount > 0:
                invoice.payment_status = PaymentStatus.PARTIAL

            # Mark linked BankDeposit as verified
            if txn.bank_deposit_id:
                bank_deposit = db.query(BankDeposits).filter(
                    BankDeposits.id == txn.bank_deposit_id
                ).first()
                if bank_deposit:
                    bank_deposit.verified = True
                    bank_deposit.confirmed_by = user_id
                    bank_deposit.confirmed_date = tz.now()
                    bank_deposit.status = "confirmed"

            db.commit()

            # Update customer credit balance
            customer_credit_service.update_customer_credit_balance(db, invoice.customer_id)

            # Post credit settlement to GL
            try:
                from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                gl_service = PurchaseExpensePayrollGL(db)
                gl_service.post_customer_credit_settlement_to_gl(
                    credit_settle, [txn], user_id=user_id
                )
                db.commit()
            except Exception as gl_err:
                import logging
                logging.getLogger(__name__).warning(
                    f"GL posting for verified credit settlement bank transfer "
                    f"{credit_settle.customer_credits_settle_no} failed (non-blocking): {gl_err}"
                )

            db.refresh(invoice)

            return {
                "success": True,
                "message": f"Bank transfer verified. Payment of Rs. {float(txn.payment_amount):,.2f} applied to invoice {invoice.invoice_no}.",
                "invoice_no": invoice.invoice_no,
                "status": "completed"
            }

        elif action == "reject":
            if not rejection_reason:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Rejection reason is required"
                )

            # Mark transaction as rejected
            txn.status = "rejected"
            txn.remarks = f"{txn.remarks or ''} | REJECTED: {rejection_reason}".strip(" |")

            # Mark linked BankDeposit as rejected
            if txn.bank_deposit_id:
                bank_deposit = db.query(BankDeposits).filter(
                    BankDeposits.id == txn.bank_deposit_id
                ).first()
                if bank_deposit:
                    bank_deposit.returned = True
                    bank_deposit.status = "rejected"
                    bank_deposit.confirmed_by = user_id
                    bank_deposit.confirmed_date = tz.now()

            db.commit()

            return {
                "success": True,
                "message": f"Bank transfer rejected for invoice {invoice.invoice_no}. Reason: {rejection_reason}",
                "invoice_no": invoice.invoice_no,
                "status": "rejected"
            }

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid action. Use 'verify' or 'reject'."
            )


class PaymentCardService:
    """Service for managing payment card configurations."""
    
    def get_all(self, db: Session, active_only: bool = False):
        """Get all payment cards, optionally filtered by active status."""
        from app.modules.sales.models import PaymentCard
        
        query = db.query(PaymentCard)
        if active_only:
            query = query.filter(PaymentCard.active == True)
        return query.order_by(PaymentCard.card_name).all()
    
    def get_by_id(self, db: Session, card_id: int):
        """Get a specific payment card by ID."""
        from app.modules.sales.models import PaymentCard
        
        card = db.query(PaymentCard).filter(PaymentCard.id == card_id).first()
        if not card:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment card not found"
            )
        return card
    
    def create(self, db: Session, card_data: schemas.PaymentCardCreate):
        """Create a new payment card."""
        from app.modules.sales.models import PaymentCard
        
        # Check for duplicate card name
        existing = db.query(PaymentCard).filter(
            PaymentCard.card_name == card_data.card_name
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment card '{card_data.card_name}' already exists"
            )
        
        card = PaymentCard(
            card_name=card_data.card_name,
            card_type=card_data.card_type,
            service_charge_percent=card_data.service_charge_percent,
            description=card_data.description,
            active=card_data.active,
        )
        db.add(card)
        db.commit()
        db.refresh(card)
        return card
    
    def update(self, db: Session, card_id: int, card_data: schemas.PaymentCardUpdate):
        """Update an existing payment card."""
        from app.modules.sales.models import PaymentCard
        
        card = self.get_by_id(db, card_id)
        
        # Check for duplicate card name if name is being changed
        if card_data.card_name and card_data.card_name != card.card_name:
            existing = db.query(PaymentCard).filter(
                PaymentCard.card_name == card_data.card_name,
                PaymentCard.id != card_id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment card '{card_data.card_name}' already exists"
                )
        
        # Update fields
        update_data = card_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(card, field, value)
        
        db.commit()
        db.refresh(card)
        return card
    
    def delete(self, db: Session, card_id: int):
        """Soft delete a payment card by setting active=False."""
        card = self.get_by_id(db, card_id)
        card.active = False
        db.commit()
    
    def calculate_service_charge(self, db: Session, card_id: int, amount: float) -> dict:
        """Calculate service charge for a card payment."""
        card = self.get_by_id(db, card_id)
        service_charge = amount * (float(card.service_charge_percent) / 100)
        return {
            "amount": amount,
            "service_charge_percent": float(card.service_charge_percent),
            "service_charge": round(service_charge, 2),
            "total_amount": round(amount + service_charge, 2),
        }


sales_service = SalesService()
payment_card_service = PaymentCardService()
