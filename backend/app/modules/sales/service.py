from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from app.modules.sales import repository, schemas
from app.modules.sales.models import Invoice, InvoiceItems, InvoiceItemsBarcode, SaleReturn, SaleReturnItems
from app.modules.inventory.models import SalesStock
from app.modules.finance.models import ChequePayments, CardPayments, BankDeposits
from app.modules.customers.credit_service import CustomerCreditService
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus
from decimal import Decimal
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from typing import List, Optional

# Initialize credit service
customer_credit_service = CustomerCreditService()

class SalesService:
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
    
    def get_sales_statistics(self, db: Session, branch_codes: Optional[List[str]] = None):
        """Get sales statistics for dashboard"""
        today = date.today()
        current_month_start = today.replace(day=1)
        last_month_start = (today - relativedelta(months=1)).replace(day=1)
        last_month_end = current_month_start - relativedelta(days=1)
        
        # Base query with branch filtering
        def base_query():
            q = db.query(Invoice)
            if branch_codes:
                q = q.filter(Invoice.branch_code.in_(branch_codes))
            return q
        
        # Total invoices count
        total_invoices = base_query().with_entities(func.count(Invoice.id)).scalar() or 0
        
        # Current month invoices
        current_month_invoices = base_query().filter(
            Invoice.created_date >= current_month_start
        ).with_entities(func.count(Invoice.id)).scalar() or 0
        
        # Last month invoices
        last_month_invoices = base_query().filter(
            Invoice.created_date >= last_month_start,
            Invoice.created_date <= last_month_end
        ).with_entities(func.count(Invoice.id)).scalar() or 0
        
        # Revenue calculations
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
        
        total_revenue = calc_revenue(base_query())
        current_month_revenue = calc_revenue(
            base_query().filter(Invoice.created_date >= current_month_start)
        )
        
        # Pending approval count
        pending_approval = base_query().filter(
            Invoice.approval == False
        ).with_entities(func.count(Invoice.id)).scalar() or 0
        
        # Total sale returns (with branch filtering)
        returns_query = db.query(SaleReturn)
        if branch_codes:
            returns_query = returns_query.filter(SaleReturn.branch_code.in_(branch_codes))
        sale_returns_count = returns_query.with_entities(func.count(SaleReturn.id)).scalar() or 0
        
        return {
            "total_orders": total_invoices,
            "current_month_orders": current_month_invoices,
            "last_month_orders": last_month_invoices,
            "total_revenue": float(total_revenue),
            "current_month_revenue": float(current_month_revenue),
            "pending_approval": pending_approval,
            "sale_returns_count": sale_returns_count
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
            SalesStock.status == 'available',
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
            SalesStock.status == 'available',
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
        # Calculate subtotal from items (after item-level discounts)
        subtotal = Decimal("0")
        gross_total = Decimal("0")
        for item in invoice_data.items:
            item_gross = Decimal(str(item.quantity)) * Decimal(str(item.selling_price))
            gross_total += item_gross
            item_discount_percent = Decimal(str(getattr(item, 'discount_percent', 0) or 0))
            item_discount = item_gross * (item_discount_percent / 100)
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
        # 4. Tax (+)
        # 5. Voucher Payment (-)
        # 6. Service Charge (+)
        # 7. Grand Total
        
        # Step 2: Calculate invoice discount (percentage takes priority, then fixed amount)
        calculated_discount = Decimal("0")
        if discount_percent > 0:
            calculated_discount = Decimal(str(subtotal)) * (discount_percent / Decimal('100'))
        elif discount_amount_input > 0:
            calculated_discount = discount_amount_input
        after_invoice_discount_calc = Decimal(str(subtotal)) - calculated_discount
        
        # Step 3: After coupon (applied after invoice discount)
        after_discount = after_invoice_discount_calc - coupon_amount
        
        # Step 4: Calculate tax amount (on amount after discounts)
        tax_amount = after_discount * (tax_rate / 100) if tax_rate > 0 else Decimal("0")
        after_tax = after_discount + tax_amount
        
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

        # Validate credit status for credit sales (warning-only, approval required)
        if is_credit_payment:
            credit_validation = customer_credit_service.validate_credit_sale(
                db,
                invoice_data.customer_id,
                Decimal(str(grand_total)),
                allow_over_limit=True
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
        invoice_dict['created_date'] = date.today()
        invoice_dict['created_date_time'] = datetime.now()
        invoice_dict['status'] = True
        
        # Set calculated totals
        invoice_dict['subtotal'] = float(subtotal)
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
            invoice_dict['payment_status'] = "pending"
        else:
            # Cash/Card/Cheque - auto-approved and fully paid
            invoice_dict['approval'] = True
            invoice_dict['approval_status'] = "completed"
            invoice_dict['paid_amount'] = float(grand_total)  # Full grand total is paid (voucher + payment method)
            invoice_dict['balance_due'] = 0
            invoice_dict['payment_status'] = "paid"
        
        # Handle coupon/discount code
        coupon_id = getattr(invoice_data, 'cupon_id', None)
        coupon_amount = getattr(invoice_data, 'cupon_amount', 0) or 0
        invoice_dict['cupon_id'] = coupon_id
        invoice_dict['cupon_amount'] = float(coupon_amount)
        
        # Handle cheque date
        if cheque_date_str:
            try:
                invoice_dict['cheque_date'] = datetime.strptime(cheque_date_str, '%Y-%m-%d').date()
            except:
                invoice_dict['cheque_date'] = date.today()
        else:
            invoice_dict['cheque_date'] = date.today()
        
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
                deposit_date=date.today(),
                remark=invoice_data.remarks or "",
                payment_for="Sales Invoice",
                invoice_no=invoice_data.invoice_no
            )
            db.add(cheque_payment)
            db.flush()
            cheque_payment_id = cheque_payment.id
        
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
                date_time=datetime.now(),
                remark=card_holder_name or "",
                ref_number=card_ref_number or "",
                invoice_no=invoice_data.invoice_no,
                deposited=True
            )
            db.add(card_payment)
            db.flush()
            card_payment_id = card_payment.id
        
        # Handle bank transfer
        if payment_method == "bank_transfer":
            bank_deposit = BankDeposits(
                deposits_amount=invoice_data.bank_transfer_amount or 0,
                remarks=f"Ref: {bank_transfer_ref}" if bank_transfer_ref else "",
                created_date=datetime.now(),
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
        
        # Set payment record IDs
        invoice_dict['cheque_payment_id'] = cheque_payment_id
        invoice_dict['card_payment_id'] = card_payment_id
        invoice_dict['bank_transfer_id'] = bank_transfer_id
        
        invoice = Invoice(**invoice_dict)
        db.add(invoice)
        db.flush()
        
        # Create invoice items and handle sales stock
        for item_data in invoice_data.items:
            item_dict = item_data.model_dump()
            item_dict['invoice_id'] = invoice.id
            item_dict['created_date'] = datetime.now()
            
            # Get barcode from item_dict (keep it for reference)
            barcode = item_dict.get('barcode', None)
            sales_stock_id = None
            
            # Find and link the sales stock item if barcode provided
            if barcode:
                stock_item = db.query(SalesStock).filter(
                    SalesStock.barcode == barcode,
                    SalesStock.status == 'available'
                ).first()
                
                if stock_item:
                    sales_stock_id = stock_item.id
                    item_dict['sales_stock_id'] = sales_stock_id
                    
                    # Update stock status based on approval status
                    if invoice_dict['approval_status'] == 'completed':
                        # Cash/Card/Cheque orders - mark as sold immediately
                        stock_item.status = 'sold'
                        stock_item.is_active = False
                    elif invoice_dict['approval_status'] in ['pending_approval', 'pending_bank_verification']:
                        # Credit orders or bank transfers - reserve stock until approved/verified
                        stock_item.status = 'reserved'
            
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
                                created_date=datetime.now(),
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
                used_date=datetime.now()
            )
            db.add(coupon_usage)
            
            # Increment coupon usage count
            coupon = db.query(CustomerCuponCodes).filter(CustomerCuponCodes.id == coupon_id).first()
            if coupon:
                coupon.usage_count = (coupon.usage_count or 0) + 1
        
        # Record voucher redemptions - prioritize multiple vouchers over legacy single voucher
        voucher_redemptions = getattr(invoice_data, 'voucher_redemptions', []) or []
        
        if voucher_redemptions:
            # Multiple vouchers - create usage record for each
            from app.modules.customers.models import CustomerGiftVoucher, VoucherUsage
            
            for redemption in voucher_redemptions:
                # Create voucher usage record
                voucher_usage = VoucherUsage(
                    voucher_id=redemption.voucher_id,
                    invoice_id=invoice.id,
                    amount_used=Decimal(str(redemption.amount_to_redeem)),
                    used_date=datetime.now()
                )
                db.add(voucher_usage)
                
                # Update voucher balance
                voucher = db.query(CustomerGiftVoucher).filter(CustomerGiftVoucher.id == redemption.voucher_id).first()
                if voucher:
                    voucher.balance = voucher.balance - Decimal(str(redemption.amount_to_redeem))
                    if voucher.balance <= 0:
                        voucher.status = "fully_claimed"
                        voucher.claimed_date = datetime.now()
                        voucher.claimed_invoice_no = invoice_data.invoice_no
        
        elif gift_voucher_id and gift_voucher_amount > 0:
            # Legacy single voucher (backwards compatibility)
            from app.modules.customers.models import CustomerGiftVoucher, VoucherUsage
            
            # Create voucher usage record
            voucher_usage = VoucherUsage(
                voucher_id=gift_voucher_id,
                invoice_id=invoice.id,
                amount_used=gift_voucher_amount,
                used_date=datetime.now()
            )
            db.add(voucher_usage)
            
            # Update voucher balance
            voucher = db.query(CustomerGiftVoucher).filter(CustomerGiftVoucher.id == gift_voucher_id).first()
            if voucher:
                voucher.balance = voucher.balance - gift_voucher_amount
                if voucher.balance <= 0:
                    voucher.status = "fully_claimed"
                    voucher.claimed_date = datetime.now()
                    voucher.claimed_invoice_no = invoice_data.invoice_no
        
        db.commit()
        db.refresh(invoice)
        return invoice
    
    def update_invoice(self, db: Session, invoice_id: int, invoice_data: schemas.InvoiceUpdate, user_id: int):
        invoice = self.get_invoice(db, invoice_id)
        
        # Track original status for re-approval logic
        was_completed = invoice.approval_status == 'completed'
        
        # Block manual approval via update_invoice - must use Approval Dashboard
        update_data = invoice_data.model_dump(exclude_unset=True, exclude={'items'})
        if update_data.get('approval_status') == 'completed' and invoice.approval_status == 'pending_approval':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sales orders cannot be manually approved. Please use the Approval Dashboard."
            )
        
        # Handle items update if provided
        if invoice_data.items is not None:
            # First, restore stock for existing items
            existing_items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
            for item in existing_items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                    if stock_item and stock_item.status in ['sold', 'reserved']:
                        stock_item.status = 'available'
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
                        SalesStock.status == 'available'
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
                item_dict['created_date'] = datetime.now()
                
                barcode = item_dict.get('barcode', None)
                sales_stock_id = None
                
                if barcode:
                    stock_item = db.query(SalesStock).filter(
                        SalesStock.barcode == barcode,
                        SalesStock.status == 'available'
                    ).first()
                    
                    if stock_item:
                        sales_stock_id = stock_item.id
                        item_dict['sales_stock_id'] = sales_stock_id
                        
                        # Reserve/sell stock based on approval status
                        if invoice.approval_status == 'completed':
                            stock_item.status = 'sold'
                            stock_item.is_active = False
                        else:
                            stock_item.status = 'reserved'
                
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
                update_data['approval_status'] = "pending_approval"
            else:
                # Cash/Card/Cheque/Bank - auto-approved and completed
                update_data['approval'] = True
                update_data['approval_status'] = "completed"
        
        for field, value in update_data.items():
            setattr(invoice, field, value)
        
        db.commit()
        db.refresh(invoice)
        
        # If a completed/approved sales order was edited, reset to pending_approval
        if was_completed and invoice.payment_method and invoice.payment_method.lower() == 'credit':
            from app.modules.common.models import Approvals
            
            invoice.approval = False
            invoice.approval_status = "pending_approval"
            
            # Reset the existing approval record back to pending
            if invoice.approval_id:
                approval_record = db.query(Approvals).filter(Approvals.id == invoice.approval_id).first()
                if approval_record:
                    approval_record.status = "pending"
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
            
            # Restore stock to reserved state
            items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
            for item in items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                    if stock_item and stock_item.status == 'sold':
                        stock_item.status = 'reserved'
                        stock_item.is_active = True
            
            db.commit()
            db.refresh(invoice)
        
        return invoice
    
    def delete_invoice(self, db: Session, invoice_id: int):
        invoice = self.get_invoice(db, invoice_id)
        
        # Restore sales stock for items that were sold
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                if stock_item and stock_item.status == 'sold':
                    # Restore the stock item to available
                    stock_item.status = 'available'
                    stock_item.is_active = True
        
        db.delete(invoice)
        db.commit()
        return {"message": "Invoice deleted successfully and stock restored"}
    
    def approve_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Approve a pending credit invoice through the centralized approval system.
        Updates the approval record and changes invoice status to completed.
        """
        invoice = self.get_invoice(db, invoice_id)
        
        if invoice.approval_status != 'pending_approval':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invoice is already {invoice.approval_status}"
            )
        
        # Verify and update approval record
        if invoice.approval_id:
            from app.modules.common.models import Approvals
            approval_record = db.query(Approvals).filter(Approvals.id == invoice.approval_id).first()
            if approval_record:
                if approval_record.status != 'pending':
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                # Update approval record
                approval_record.status = 'approved'
                approval_record.status_changed_by = user_id
                approval_record.remark = f"Approved by user {user_id} on {datetime.now().strftime('%Y-%m-%d %H:%M')}"
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
            approval_record.status = 'approved'
            approval_record.status_changed_by = user_id
            invoice.approval_id = approval_record.id
        
        # Update invoice approval status
        invoice.approval = True
        invoice.approval_status = 'completed'  # Credit orders go directly to completed after approval
        
        # Update sales stock status to 'sold' for all items with barcodes
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                if stock_item and stock_item.status == 'reserved':
                    stock_item.status = 'sold'
                    stock_item.is_active = False
        
        # For credit orders that are approved, automatically mark as completed
        # since stock is already marked as sold
        invoice.approval_status = 'completed'
        
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
        invoice.approval_status = 'completed'
        
        # Ensure all stock items are marked as sold
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                if stock_item:
                    stock_item.status = 'sold'
                    stock_item.is_active = False
        
        db.commit()
        db.refresh(invoice)
        return invoice
    
    def cancel_invoice(self, db: Session, invoice_id: int, user_id: int):
        """
        Cancel an invoice and restore stock to available.
        """
        invoice = self.get_invoice(db, invoice_id)
        
        if invoice.approval_status == 'completed':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot cancel a completed invoice. Please create a sale return instead."
            )
        
        # Restore sales stock for all items
        items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == invoice_id).all()
        for item in items:
            if item.sales_stock_id:
                stock_item = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                if stock_item:
                    stock_item.status = 'available'
                    stock_item.is_active = True
        
        invoice.status = False
        invoice.approval_status = 'cancelled'
        
        db.commit()
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
        return_dict['added_date'] = date.today()
        return_dict['cheque_date'] = date.today()
        return_dict['status'] = 'pending'
        return_dict['subtotal'] = float(subtotal)
        return_dict['tax_refund'] = float(tax_refund)
        return_dict['total_refund'] = float(total_refund)
        return_dict['refund_status'] = 'pending'
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
                'added_date': datetime.now(),
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
        
        if sale_return.status != 'pending':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sale return is already {sale_return.status}"
            )
        
        # Update approval record
        if sale_return.approval_id:
            from app.modules.common.models import Approvals
            approval_record = db.query(Approvals).filter(Approvals.id == sale_return.approval_id).first()
            if approval_record:
                if approval_record.status != 'pending':
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                approval_record.status = 'approved'
                approval_record.status_changed_by = user_id
                approval_record.remark = f"Approved by user {user_id} on {datetime.now().strftime('%Y-%m-%d %H:%M')}"
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
            approval_record.status = 'approved'
            approval_record.status_changed_by = user_id
            sale_return.approval_id = approval_record.id
        
        sale_return.status = 'approved'
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
                approval_record.status = 'rejected'
                approval_record.status_changed_by = user_id
                approval_record.remark = reason or f"Rejected by user {user_id}"
        
        sale_return.status = 'rejected'
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
        
        if sale_return.status not in ['pending', 'approved']:
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
        
        # Process each return item
        for item in sale_return.items:
            if item.restockable and item.condition == 'good':
                # Restore stock to available
                if item.sales_stock_id:
                    stock = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).first()
                    if stock:
                        stock.status = 'available'
                        stock.is_active = True
                        stock.returned_date = datetime.now()
                        item.restocked = True
                        items_restocked += item.quantity
                elif item.barcode:
                    # Try to find the stock by barcode
                    stock = db.query(SalesStock).filter(SalesStock.barcode == item.barcode).first()
                    if stock:
                        stock.status = 'available'
                        stock.is_active = True
                        stock.returned_date = datetime.now()
                        item.restocked = True
                        items_restocked += item.quantity
        
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
                date=datetime.now(),
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
        sale_return.refund_date = date.today()
        sale_return.refund_reference = refund_reference
        sale_return.processed_by = user_id
        
        # Update invoice totals if needed
        # Reduce the paid amount and grand total
        new_paid_amount = float(invoice.paid_amount or 0) - float(sale_return.total_refund)
        new_grand_total = float(invoice.grand_total or 0) - float(sale_return.total_refund)
        
        if new_paid_amount < 0:
            new_paid_amount = 0
        if new_grand_total < 0:
            new_grand_total = 0
            
        invoice.paid_amount = new_paid_amount
        invoice.grand_total = new_grand_total
        invoice.balance_due = max(0, new_grand_total - new_paid_amount)
        
        if invoice.grand_total > 0 and invoice.paid_amount >= invoice.grand_total:
            invoice.payment_status = 'paid'
        elif invoice.paid_amount > 0:
            invoice.payment_status = 'partial'
        else:
            invoice.payment_status = 'unpaid'
        
        db.commit()
        db.refresh(sale_return)
        
        return {
            "sale_return": sale_return,
            "credit_note_id": credit_note_id,
            "refund_reference": refund_reference,
            "items_restocked": items_restocked,
            "message": f"Sale return processed successfully. {items_restocked} items restocked."
        }
    
    def delete_sale_return(self, db: Session, return_id: int):
        """Delete a pending sale return."""
        sale_return = self.get_sale_return(db, return_id)
        
        if sale_return.status not in ['pending', 'rejected']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete a processed or approved sale return"
            )
        
        db.delete(sale_return)
        db.commit()
        return {"message": "Sale return deleted successfully"}
    
    def get_return_statistics(self, db: Session):
        """Get sale return statistics for dashboard."""
        today = date.today()
        current_month_start = today.replace(day=1)
        
        total_returns = db.query(func.count(SaleReturn.id)).scalar() or 0
        pending_returns = db.query(func.count(SaleReturn.id)).filter(
            SaleReturn.status == 'pending'
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
        
        # Get invoice
        invoice = self.get_invoice(db, payment_data.invoice_id)
        
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
        
        # Generate settlement number
        settle_count = db.query(func.count(CustomerCreditsSettle.id)).scalar() or 0
        settle_no = f"CS-{invoice.branch_code}-{date.today().strftime('%Y%m%d')}-{settle_count + 1:04d}"
        
        # Create credit settle record
        credit_settle = CustomerCreditsSettle(
            customer_credits_settle_no=settle_no,
            branch_code=invoice.branch_code,
            created_date=datetime.now(),
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
                date_time=datetime.now(),
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
                created_date=datetime.now(),
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
            invoice.payment_status = "paid"
            invoice.balance_due = 0  # Ensure no negative balance
        elif invoice.paid_amount > 0:
            invoice.payment_status = "partial"
        
        db.commit()
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
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        
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
            invoice.bank_transfer_verified_date = datetime.now()
            invoice.approval = True
            invoice.approval_status = "completed"
            invoice.paid_amount = float(invoice.grand_total)
            invoice.balance_due = 0
            invoice.payment_status = "paid"
            
            # Mark bank deposit as verified
            if invoice.bank_transfer:
                invoice.bank_transfer.verified = True
            
            # Mark reserved stock as sold
            for item in invoice.items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).first()
                    if stock_item and stock_item.status == 'reserved':
                        stock_item.status = 'sold'
                        stock_item.is_active = False
            
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
            invoice.bank_transfer_verified_date = datetime.now()
            invoice.bank_transfer_rejection_reason = rejection_reason
            invoice.approval = False
            invoice.approval_status = "cancelled"
            invoice.payment_status = "cancelled"
            invoice.status = False
            
            # Release reserved stock back to available
            for item in invoice.items:
                if item.sales_stock_id:
                    stock_item = db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).first()
                    if stock_item and stock_item.status == 'reserved':
                        stock_item.status = 'available'
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

sales_service = SalesService()
