from sqlalchemy.orm import Session
from sqlalchemy import func, text
from fastapi import HTTPException, status
import logging
from app.modules.sales import repository, schemas
from app.modules.sales.models import Invoice, InvoiceItems, InvoiceItemsBarcode, SaleReturn, SaleReturnItems
from app.modules.inventory.models import SalesStock
from app.modules.finance.models import ChequePayments, CardPayments, BankDeposits
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
    def _get_next_invoice_number(self, db: Session) -> str:
        """Generate next Invoice number: INV-YYYY-XXXXX with advisory lock"""
        year = tz.year()
        prefix = f"INV-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            db.query(Invoice)
            .filter(Invoice.invoice_no.like(f"{prefix}-%"))
            .order_by(Invoice.id.desc())
            .first()
        )
        if last:
            try:
                last_seq = int(last.invoice_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}-{next_seq:05d}"
    
    def _get_next_sale_return_number(self, db: Session) -> str:
        """Generate next Sale Return number: SR-YYYY-XXXXX with advisory lock"""
        year = tz.year()
        prefix = f"SR-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            db.query(SaleReturn)
            .filter(SaleReturn.sale_return_no.like(f"{prefix}-%"))
            .order_by(SaleReturn.id.desc())
            .first()
        )
        if last:
            try:
                last_seq = int(last.sale_return_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}-{next_seq:05d}"
    
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
        """Get all sale returns"""
        return repository.sales_repository.get_all_sale_returns(db, skip, limit, branch_codes)
    
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
        
        # Base query
        query = db.query(Invoice)
        
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
        for item_data in invoice_data.items:
            product = db.query(Product).filter(Product.id == item_data.product_id).first()
            if product and not product.active:
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

        # Calculate subtotal and gross_total from items (after item-level discounts)
        subtotal = Decimal("0")
        gross_total = Decimal("0")
        is_tax_invoice = getattr(invoice_data, 'is_tax_invoice', False)
        tax_rate = Decimal(str(getattr(invoice_data, 'tax_rate', 0) or 0))
        item_display_totals = []
        for item in invoice_data.items:
            item_gross = Decimal(str(item.quantity)) * Decimal(str(item.selling_price))
            gross_total += item_gross
            item_discount_percent = Decimal(str(getattr(item, 'discount_percent', 0) or 0))
            item_discount = item_gross * (item_discount_percent / 100)
            if is_tax_invoice and tax_rate > 0:
                # Tax-inclusive: displayed price = actual_price * (1 - tax_rate/100)
                display_price = Decimal(str(item.selling_price)) * (Decimal('1') - tax_rate / Decimal('100'))
                display_line_total = Decimal(str(item.quantity)) * display_price
                item_display_totals.append(display_line_total - item_discount)
            else:
                # Tax-exclusive: display = actual
                item_display_totals.append(item_gross - item_discount)
            subtotal += (item_gross - item_discount)
        
        # Get discount parameters for combined validation
        # New Flow: Item Discount → Invoice Discount → Coupon → Tax → Voucher → Service Charge
        coupon_amount = Decimal(str(getattr(invoice_data, 'cupon_amount', 0) or 0))
        discount_percent = Decimal(str(getattr(invoice_data, 'discount_percent', 0) or 0))
        discount_amount_input = Decimal(str(getattr(invoice_data, 'discount_amount', 0) or 0))
        
        # Calculate invoice discount percentage (percentage takes priority, then fixed amount)
        # Invoice discount is applied on subtotal (after item discounts)
        invoice_discount_percent = Decimal("0")
        if discount_percent > 0:
            invoice_discount_percent = discount_percent
        elif discount_amount_input > 0 and subtotal > 0:
            invoice_discount_percent = (discount_amount_input / subtotal * 100)
        # Calculate amount after invoice discount for coupon percentage
        after_invoice_discount = subtotal * (1 - invoice_discount_percent / 100)
        # Calculate coupon discount as percentage (applied after invoice discount)
        coupon_discount_percent = (coupon_amount / after_invoice_discount * 100) if after_invoice_discount > 0 else Decimal("0")
        # For tax-inclusive, recalculate subtotal as sum of displayed prices
        if is_tax_invoice and tax_rate > 0:
            subtotal_displayed = sum(item_display_totals)
        else:
            subtotal_displayed = subtotal
        
        # Validate all products are available in sales stock before creating invoice
        for item_data in invoice_data.items:
            self.validate_product_availability(db, item_data.product_id, item_data.quantity)
            
            # Validate selling price is not below minimum price
            if item_data.selling_price < item_data.minimum_selling_price:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Selling price ({item_data.selling_price}) cannot be less than minimum price ({item_data.minimum_selling_price}) for product ID {item_data.product_id}"
                )
            
            # Validate effective price after ALL discounts (item + coupon + invoice) is not below minimum price
            item_discount_percent = Decimal(str(getattr(item_data, 'discount_percent', 0) or 0))
            
            # Step 1: Apply item discount
            price_after_item_discount = Decimal(str(item_data.selling_price)) * (Decimal('1') - item_discount_percent / Decimal('100'))
            
            # Step 2: Apply invoice discount (proportionally)
            price_after_invoice_discount = price_after_item_discount * (Decimal('1') - invoice_discount_percent / Decimal('100'))
            
            # Step 3: Apply coupon discount (proportionally)
            effective_price = price_after_invoice_discount * (Decimal('1') - coupon_discount_percent / Decimal('100'))
            
            if effective_price < Decimal(str(item_data.minimum_selling_price)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Effective price after all discounts ({float(effective_price):.2f}) cannot be less than minimum price ({item_data.minimum_selling_price}) for product ID {item_data.product_id}"
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
        is_credit_payment = payment_method == "credit"
        credit_validation = None
        
        # Calculate tax rate (discount values already calculated above)
        tax_rate = Decimal(str(getattr(invoice_data, 'tax_rate', 0) or 0))
        
        # Get coupon ID for storage
        coupon_id = getattr(invoice_data, 'cupon_id', None)
        
        # Calculation Order:
        # 1. Subtotal (after item discounts)
        # 2. Invoice Discount (-)
        # 3. Coupon Discount (-)
        # 4. Tax (+) or (Tax absorbed if is_tax_invoice)
        # 5. Voucher Payment (-)
        # 6. Service Charge (+)
        # 7. Grand Total
        calculated_discount = Decimal("0")
        if discount_percent > 0:
            calculated_discount = Decimal(str(subtotal_displayed)) * (discount_percent / Decimal('100'))
        elif discount_amount_input > 0:
            calculated_discount = discount_amount_input
        after_invoice_discount_calc = Decimal(str(subtotal_displayed)) - calculated_discount
        after_discount = after_invoice_discount_calc - coupon_amount
        if is_tax_invoice and tax_rate > 0:
            # Tax-inclusive: grand_total is sum of actual prices, subtotal is displayed (reduced), tax_amount = grand_total - subtotal
            grand_total = gross_total
            tax_amount = grand_total - after_discount
            subtotal_final = after_discount
        else:
            # Tax-exclusive: add tax on top
            tax_amount = after_discount * (tax_rate / 100) if tax_rate > 0 else Decimal("0")
            grand_total = after_discount + tax_amount
            subtotal_final = after_discount
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
        service_charge_rate = Decimal("0")
        service_charge_amount = Decimal("0")
        if payment_method == "card_amex":
            service_charge_rate = Decimal("0.03")  # 3% for Amex
            service_charge_amount = after_credit_note * service_charge_rate
        elif payment_method in ["card_visa", "card_mastercard"]:
            service_charge_rate = Decimal("0.027")  # 2.7% for Visa/Mastercard
            service_charge_amount = after_credit_note * service_charge_rate
        
        # Step 8: Calculate grand total (remaining amount to pay)
        grand_total = after_credit_note + service_charge_amount

        # Comprehensive credit sale validation (BLOCKING validations)
        if is_credit_payment:
            # Use comprehensive validation - blocking by default
            credit_validation = customer_credit_service.validate_credit_sale_comprehensive(
                db,
                invoice_data.customer_id,
                Decimal(str(grand_total)),
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
            'voucher_redemptions'  # Array field - not stored in Invoice table
        })
        
        # Override sale_rep_id with the logged-in user
        invoice_dict['sale_rep_id'] = user_id
        
        # Server-side sequential invoice number generation
        invoice_dict['invoice_no'] = self._get_next_invoice_number(db)
        
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
        invoice_dict['credit_amount'] = float(grand_total) if is_credit_payment else 0
        
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
        if is_credit_payment:
            # Credit payment - needs approval, unpaid until settled
            invoice_dict['approval'] = False
            invoice_dict['approval_status'] = "pending_approval"
            invoice_dict['paid_amount'] = float(total_prepaid)  # Voucher + credit note paid
            invoice_dict['balance_due'] = float(amount_after_voucher)
            invoice_dict['payment_status'] = "unpaid" if amount_after_voucher > 0 else "paid"
        elif payment_method == "bank_transfer":
            # Bank transfer - needs verification by finance manager
            invoice_dict['approval'] = False
            invoice_dict['approval_status'] = "pending_bank_verification"
            invoice_dict['bank_transfer_status'] = "pending_verification"
            invoice_dict['paid_amount'] = float(total_prepaid)  # Voucher + credit note paid
            invoice_dict['balance_due'] = float(amount_after_voucher)
            invoice_dict['payment_status'] = PaymentStatus.UNPAID
        else:
            # Cash/Card/Cheque - auto-approved and fully paid
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
            cheque_payment = ChequePayments(
                cheque_number=int(cheque_number) if cheque_number else 0,
                branch_code=0,  # Will be updated
                from_party=card_holder_name or "Customer",
                bank=cheque_bank or "",
                amount=invoice_data.cheque_amount or 0,
                cheque_date=invoice_dict['cheque_date'],
                deposit_date=tz.today(),
                remark=invoice_data.remarks or "",
                payment_for="Sales Invoice",
                invoice_no=invoice_data.invoice_no
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
        if payment_method in ["card_visa", "card_mastercard", "card_amex"]:
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
                amount=grand_total,
                credit_terms=f"{credit_days} days",
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
            sales_stock_id = None
            
            # Find and link the sales stock item if barcode provided
            if barcode:
                # Lock the stock row to prevent two invoices reserving the same item
                stock_item = db.query(SalesStock).filter(
                    SalesStock.barcode == barcode,
                    SalesStock.status == StockStatus.AVAILABLE
                ).with_for_update().first()
                
                if stock_item:
                    sales_stock_id = stock_item.id
                    item_dict['sales_stock_id'] = sales_stock_id
                    
                    # Update stock status based on approval status
                    if invoice_dict['approval_status'] == DocumentStatus.COMPLETED:
                        # Cash/Card/Cheque orders - mark as sold immediately
                        stock_item.status = StockStatus.SOLD
                        stock_item.is_active = False
                    elif invoice_dict['approval_status'] in [DocumentStatus.PENDING_APPROVAL, 'pending_bank_verification']:
                        # Credit orders or bank transfers - reserve stock until approved/verified
                        stock_item.status = StockStatus.RESERVED
            
            # Calculate line total with item discount
            gross_line_total = Decimal(str(item_dict['quantity'])) * Decimal(str(item_dict['selling_price']))
            item_discount_percent = Decimal(str(item_dict.get('discount_percent', 0) or 0))
            item_discount_amount = gross_line_total * (item_discount_percent / Decimal('100'))
            item_dict['discount_percent'] = float(item_discount_percent)
            item_dict['discount_amount'] = float(item_discount_amount)
            line_total = gross_line_total - item_discount_amount
            item_dict['line_total'] = float(line_total)
            
            item = InvoiceItems(**item_dict)
            db.add(item)
            db.flush()
            
            # Create InvoiceItemsBarcode link if we have both barcode and GRN item
            if barcode and sales_stock_id:
                # Get the good_received_note from sales_stock
                stock_item = db.query(SalesStock).filter(SalesStock.id == sales_stock_id).first()
                if stock_item and stock_item.good_received_note_id:
                    # Get the GRN note number
                    from app.modules.purchasing.models import GoodReceivedItems, GoodReceivedNote
                    grn = db.query(GoodReceivedNote).filter(
                        GoodReceivedNote.id == stock_item.good_received_note_id
                    ).first()
                    
                    if grn:
                        # Find the GRN item for this barcode using the note number
                        grn_item = db.query(GoodReceivedItems).filter(
                            GoodReceivedItems.good_received_note == grn.good_received_no,
                            GoodReceivedItems.barcode == barcode
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
            
            # Create usage record
            coupon_usage = CouponUsage(
                coupon_id=coupon_id,
                invoice_id=invoice.id,
                customer_id=invoice_data.customer_id,
                discount_amount=coupon_amount,
                used_date=tz.now()
            )
            db.add(coupon_usage)
            
            # Lock the coupon row before updating usage count to prevent race condition
            coupon = db.query(CustomerCuponCodes).filter(
                CustomerCuponCodes.id == coupon_id
            ).with_for_update().first()
            if coupon:
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
                    continue
                    
                # Verify voucher hasn't been used already
                if voucher.status != "active":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Voucher {voucher.barcode_no} has already been used"
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
        # Auto-create commission if invoice has a customer agent (Scenario 17)
        # =================================================================
        customer_agent_id = getattr(invoice_data, 'customer_agent_id', None)
        if customer_agent_id:
            from app.modules.customers.models import Customer as CustomerModel
            agent = db.query(CustomerModel).filter(
                CustomerModel.id == customer_agent_id,
                CustomerModel.is_customer_agent == True
            ).first()
            
            if agent and agent.commission_rate:
                from app.modules.customers.commission_models import CustomerAgentCommission as CommissionModel
                commission_rate = Decimal(str(agent.commission_rate))
                commission_amount = Decimal(str(grand_total)) * (commission_rate / Decimal("100"))
                
                commission = CommissionModel(
                    invoice_id=invoice.id,
                    customer_agent_id=customer_agent_id,
                    represented_customer_id=invoice_data.customer_id,
                    invoice_amount=grand_total,
                    commission_type="PERCENT",
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
        db.refresh(invoice)
        return invoice
    
    def update_invoice(self, db: Session, invoice_id: int, invoice_data: schemas.InvoiceUpdate, user_id: int):
        invoice = self.get_invoice(db, invoice_id)
        
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
            for item_data in invoice_data.items:
                if hasattr(item_data, 'product_id') and item_data.product_id:
                    product = db.query(Product).filter(Product.id == item_data.product_id).first()
                    if product and not product.active:
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
        
        db.commit()
        db.refresh(invoice)
        
        # If a completed/approved sales order was edited, reset to pending_approval
        if was_completed and invoice.payment_method and invoice.payment_method.lower() == 'credit':
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
            db.refresh(invoice)
        
        return invoice
    
    def delete_invoice(self, db: Session, invoice_id: int):
        invoice = self.get_invoice(db, invoice_id)
        
        # Restore sales stock for items that were sold (lock rows to prevent concurrent modification)
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).with_for_update().first()
                if stock_item and stock_item.status == StockStatus.SOLD:
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
        invoice.approval_status = DocumentStatus.COMPLETED  # Credit orders go directly to completed after approval
        
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
        
        # For credit orders that are approved, automatically mark as completed
        # since stock is already marked as sold
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
        
        db.commit()
        db.refresh(invoice)
        return invoice
    
    def complete_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Mark an approved invoice as completed (e.g., when delivered/paid).
        """
        invoice = self.get_invoice(db, invoice_id)
        
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
        
        db.commit()
        db.refresh(invoice)
        return invoice
    
    def cancel_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Cancel an invoice and restore stock to available.
        """
        invoice = self.get_invoice(db, invoice_id)
        
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
        
        invoice.status = False
        invoice.approval_status = DocumentStatus.CANCELLED
        
        db.commit()
        
        # Restore customer credit balance (recalculate left_credit_amount)
        if invoice.credit_amount and invoice.credit_amount > 0:
            customer_credit_service.update_customer_credit_balance(db, invoice.customer_id)
        
        db.refresh(invoice)
        return invoice
    
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
        
        # Validate each return item
        subtotal = Decimal("0")
        validated_items = []
        
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
            
            # Calculate return price (use sold price if not specified)
            return_price = Decimal(str(item_data.return_price or item_data.sold_price))
            quantity = item_data.quantity
            
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
        
        # Create sale return record
        return_dict = sale_return_data.model_dump(exclude={'items'})
        return_dict['sale_return_no'] = self._get_next_sale_return_number(db)
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
    
    def approve_sale_return(self, db: Session, return_id: int, user_id: int):
        """
        Approve a pending sale return through the centralized approval system.
        """
        sale_return = self.get_sale_return(db, return_id)
        
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
        sale_return = self.get_sale_return(db, return_id)
        
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
        sale_return = self.get_sale_return(db, return_id)
        
        if sale_return.status not in [DocumentStatus.PENDING, DocumentStatus.APPROVED]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot process sale return with status: {sale_return.status}"
            )
        
        # Get the original invoice
        invoice = db.query(Invoice).filter(Invoice.id == sale_return.invoice_id).first()
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
                # Restore stock to available - lock the row first
                if item.sales_stock_id:
                    stock = db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                    if stock:
                        stock.status = StockStatus.AVAILABLE
                        stock.is_active = True
                        stock.returned_date = tz.now()
                        item.restocked = True
                        items_restocked += item.quantity
                elif item.barcode:
                    # Try to find the stock by barcode - lock the row first
                    stock = db.query(SalesStock).filter(
                        SalesStock.barcode == item.barcode
                    ).with_for_update().first()
                    if stock:
                        stock.status = StockStatus.AVAILABLE
                        stock.is_active = True
                        stock.returned_date = tz.now()
                        item.restocked = True
                        items_restocked += item.quantity
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
            if (invoice.payment_method or '').lower() == 'credit':
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
        
        db.commit()
        
        # Update customer credit balance if this return affects a credit invoice
        # (balance_due may have been reduced by credit note, changing outstanding credit)
        if invoice.customer_id and (invoice.payment_method or '').lower() == 'credit':
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
        
        # Validate it's a credit invoice
        if invoice.payment_method != 'credit':
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
        
        # Validate payment amount
        if payment_data.payment_amount > invoice.balance_due:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment amount (Rs. {payment_data.payment_amount:,.2f}) exceeds balance due (Rs. {invoice.balance_due:,.2f})"
            )
        
        # Generate settlement number with advisory lock for concurrency safety
        settle_prefix = f"CS-{invoice.branch_code}-{tz.today().strftime('%Y%m%d')}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": settle_prefix})
        settle_count = db.query(func.count(CustomerCreditsSettle.id)).scalar() or 0
        settle_no = f"{settle_prefix}-{settle_count + 1:04d}"
        
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
        
        # Handle cheque payment
        if payment_method == "cheque":
            cheque_payment = ChequePayments(
                cheque_number=int(payment_data.cheque_number) if payment_data.cheque_number else 0,
                branch_code=0,
                from_party=invoice.customer.customer_name,
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
            card_payment = CardPayments(
                card_type=card_type_map.get(payment_method, "VISA"),
                amount=payment_data.payment_amount,
                date_time=tz.now(),
                remark=payment_data.card_holder_name or f"Credit settlement for {invoice.invoice_no}",
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
        settle_transaction = CustomerCreditsSettleTransaction(
            payment_method=payment_data.payment_method,
            cheque_date=payment_data.cheque_date or payment_data.payment_date,
            payment_amount=payment_data.payment_amount,
            payment_method_number=payment_data.cheque_number or payment_data.card_ref_number or payment_data.bank_transfer_ref,
            remarks=payment_data.remarks,
            created_date=payment_data.payment_date,
            customer_credit_settle_id=credit_settle.id,
            invoice_id=invoice.id
        )
        db.add(settle_transaction)
        
        # Update invoice payment tracking
        previous_balance = invoice.balance_due
        invoice.paid_amount = float(Decimal(str(invoice.paid_amount)) + Decimal(str(payment_data.payment_amount)))
        invoice.balance_due = float(Decimal(str(invoice.balance_due)) - Decimal(str(payment_data.payment_amount)))
        
        # Update payment status
        if invoice.balance_due <= 0:
            invoice.payment_status = PaymentStatus.PAID
            invoice.balance_due = 0  # Ensure no negative balance
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
        
        if invoice.payment_method != 'credit':
            return []
        
        transactions = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.invoice_id == invoice_id
        ).order_by(CustomerCreditsSettleTransaction.created_date.desc()).all()
        
        # Calculate running balance
        current_balance = invoice.grand_total
        history = []
        
        # Sort by date ascending for balance calculation
        sorted_transactions = sorted(transactions, key=lambda x: x.created_date)
        
        for trans in sorted_transactions:
            current_balance -= trans.payment_amount
            history.append({
                "id": trans.id,
                "payment_date": trans.created_date,
                "payment_method": trans.payment_method,
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
        
        invoices = query.order_by(Invoice.created_date.desc()).all()
        
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
                "items": items
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
