from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from datetime import datetime, date
from decimal import Decimal
from app.modules.customers import repository, schemas
from app.modules.customers.models import Customer, CustomerCuponCodes, CouponUsage, CustomerGiftVoucher, VoucherUsage
from app.modules.products.models import Product

class CustomerService:
    def get_customer(self, db: Session, customer_id: int) -> Customer:
        customer = repository.customer_repository.get_by_id(db, customer_id)
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {customer_id} not found"
            )
        return customer
    
    def get_all_customers(self, db: Session, skip: int = 0, limit: int = 100) -> List[Customer]:
        return repository.customer_repository.get_all(db, skip, limit)
    
    def search_customers(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[Customer]:
        return repository.customer_repository.search(db, query, skip, limit)
    
    def create_customer(self, db: Session, customer: schemas.CustomerCreate, user_id: int) -> Customer:
        return repository.customer_repository.create(db, customer, user_id)
    
    def update_customer(self, db: Session, customer_id: int, customer: schemas.CustomerUpdate, user_id: int) -> Customer:
        updated_customer = repository.customer_repository.update(db, customer_id, customer, user_id)
        if not updated_customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {customer_id} not found"
            )
        return updated_customer
    
    def delete_customer(self, db: Session, customer_id: int) -> dict:
        success = repository.customer_repository.delete(db, customer_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {customer_id} not found"
            )
        return {"message": "Customer deleted successfully"}
    
    def get_customer_count(self, db: Session) -> int:
        return repository.customer_repository.count(db)

customer_service = CustomerService()


class CouponService:
    """Service for managing coupons and coupon validation"""
    
    def get_all_coupons(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[CustomerCuponCodes]:
        """Get all coupons with usage count"""
        query = db.query(CustomerCuponCodes)
        if active_only:
            query = query.filter(CustomerCuponCodes.active == True)
        coupons = query.order_by(CustomerCuponCodes.created_date.desc()).offset(skip).limit(limit).all()
        
        # Add usage count and product_ids to each coupon
        for coupon in coupons:
            coupon.usage_count = db.query(func.count(CouponUsage.id)).filter(
                CouponUsage.coupon_id == coupon.id
            ).scalar() or 0
            # Populate product_ids from the many-to-many relationship
            coupon.product_ids = [p.id for p in coupon.products]
        
        return coupons
    
    def get_coupon(self, db: Session, coupon_id: int) -> CustomerCuponCodes:
        """Get a single coupon by ID"""
        coupon = db.query(CustomerCuponCodes).filter(CustomerCuponCodes.id == coupon_id).first()
        if not coupon:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Coupon with id {coupon_id} not found"
            )
        coupon.usage_count = db.query(func.count(CouponUsage.id)).filter(
            CouponUsage.coupon_id == coupon.id
        ).scalar() or 0
        return coupon
    
    def get_coupon_by_code(self, db: Session, coupon_code: str) -> Optional[CustomerCuponCodes]:
        """Get a coupon by its code/barcode"""
        coupon = db.query(CustomerCuponCodes).filter(
            CustomerCuponCodes.cupon_code == coupon_code
        ).first()
        if coupon:
            coupon.usage_count = db.query(func.count(CouponUsage.id)).filter(
                CouponUsage.coupon_id == coupon.id
            ).scalar() or 0
            # Populate product_ids from the many-to-many relationship
            coupon.product_ids = [p.id for p in coupon.products]
        return coupon
    
    def create_coupon(self, db: Session, coupon_data: schemas.CustomerCuponCodesCreate) -> CustomerCuponCodes:
        """Create a new coupon"""
        # Check if coupon code already exists
        existing = db.query(CustomerCuponCodes).filter(
            CustomerCuponCodes.cupon_code == coupon_data.cupon_code
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Coupon code '{coupon_data.cupon_code}' already exists"
            )
        
        # Validate discount type
        if coupon_data.discount_type not in ["PERCENT", "AMOUNT"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="discount_type must be 'PERCENT' or 'AMOUNT'"
            )
        
        # Validate percent range
        if coupon_data.discount_type == "PERCENT" and coupon_data.discount_value > 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Percent discount cannot exceed 100%"
            )
        
        coupon = CustomerCuponCodes(
            cupon_code=coupon_data.cupon_code,
            description=coupon_data.description,
            discount_type=coupon_data.discount_type,
            discount_value=coupon_data.discount_value,
            minimum_invoice_amount=coupon_data.minimum_invoice_amount,
            limit_by_usage=coupon_data.limit_by_usage,
            limit_for_customer=coupon_data.limit_for_customer,
            valid_until_date=coupon_data.valid_until_date,
            active=coupon_data.active,
            limit_validity_product_id=coupon_data.limit_validity_product_id,
        )
        
        db.add(coupon)
        db.flush()  # Flush to get the coupon ID
        
        # Add product restrictions if provided
        if coupon_data.product_ids:
            products = db.query(Product).filter(Product.id.in_(coupon_data.product_ids)).all()
            coupon.products = products
        
        db.commit()
        db.refresh(coupon)
        coupon.product_ids = [p.id for p in coupon.products]
        return coupon
    
    def update_coupon(self, db: Session, coupon_id: int, coupon_data: schemas.CustomerCuponCodesUpdate) -> CustomerCuponCodes:
        """Update an existing coupon"""
        coupon = db.query(CustomerCuponCodes).filter(CustomerCuponCodes.id == coupon_id).first()
        if not coupon:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Coupon with id {coupon_id} not found"
            )
        
        update_data = coupon_data.model_dump(exclude_unset=True)
        
        # Handle product_ids separately
        product_ids = update_data.pop('product_ids', None)
        
        # Check if code is being changed and if new code exists
        if "cupon_code" in update_data and update_data["cupon_code"] != coupon.cupon_code:
            existing = db.query(CustomerCuponCodes).filter(
                CustomerCuponCodes.cupon_code == update_data["cupon_code"]
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Coupon code '{update_data['cupon_code']}' already exists"
                )
        
        for field, value in update_data.items():
            setattr(coupon, field, value)
        
        # Update product restrictions if provided
        if product_ids is not None:
            if product_ids:  # If list is not empty
                products = db.query(Product).filter(Product.id.in_(product_ids)).all()
                coupon.products = products
            else:  # If empty list, clear all product restrictions
                coupon.products = []
        
        db.commit()
        db.refresh(coupon)
        coupon.usage_count = db.query(func.count(CouponUsage.id)).filter(
            CouponUsage.coupon_id == coupon.id
        ).scalar() or 0
        coupon.product_ids = [p.id for p in coupon.products]
        return coupon
    
    def delete_coupon(self, db: Session, coupon_id: int) -> dict:
        """Delete a coupon (only if not used)"""
        coupon = db.query(CustomerCuponCodes).filter(CustomerCuponCodes.id == coupon_id).first()
        if not coupon:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Coupon with id {coupon_id} not found"
            )
        
        # Check if coupon has been used
        usage_count = db.query(func.count(CouponUsage.id)).filter(
            CouponUsage.coupon_id == coupon_id
        ).scalar() or 0
        
        if usage_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete coupon that has been used {usage_count} time(s). Deactivate it instead."
            )
        
        db.delete(coupon)
        db.commit()
        return {"message": "Coupon deleted successfully"}
    
    def validate_coupon(
        self, 
        db: Session, 
        request: schemas.CouponValidationRequest
    ) -> schemas.CouponValidationResponse:
        """Validate a coupon for use on an invoice"""
        
        # Find coupon by code
        coupon = self.get_coupon_by_code(db, request.coupon_code)
        if not coupon:
            return schemas.CouponValidationResponse(
                valid=False,
                message="Coupon not found"
            )
        
        # Check if coupon is active
        if not coupon.active:
            return schemas.CouponValidationResponse(
                valid=False,
                message="Coupon is not active"
            )
        
        # Check expiry date
        if coupon.valid_until_date < date.today():
            return schemas.CouponValidationResponse(
                valid=False,
                message=f"Coupon expired on {coupon.valid_until_date}"
            )
        
        # Check global usage limit
        total_usage = db.query(func.count(CouponUsage.id)).filter(
            CouponUsage.coupon_id == coupon.id
        ).scalar() or 0
        
        if total_usage >= coupon.limit_by_usage:
            return schemas.CouponValidationResponse(
                valid=False,
                message="Coupon usage limit exceeded"
            )
        
        # Check per-customer usage limit
        customer_usage = db.query(func.count(CouponUsage.id)).filter(
            CouponUsage.coupon_id == coupon.id,
            CouponUsage.customer_id == request.customer_id
        ).scalar() or 0
        
        if customer_usage >= coupon.limit_for_customer:
            return schemas.CouponValidationResponse(
                valid=False,
                message=f"You have already used this coupon {customer_usage} time(s). Limit is {coupon.limit_for_customer}"
            )
        
        # Check product validity restriction (if specified)
        # Use the new products relationship, fallback to legacy single product
        restricted_product_ids = [p.id for p in coupon.products] if coupon.products else []
        if not restricted_product_ids and coupon.limit_validity_product_id:
            # Legacy support: use single product field
            restricted_product_ids = [coupon.limit_validity_product_id]
        
        # Calculate the applicable subtotal (excluding restricted products)
        # This is the subtotal AFTER item discounts but BEFORE invoice discount
        applicable_subtotal = Decimal("0")
        
        if restricted_product_ids:
            # Restricted products = products that CANNOT use this coupon
            # Calculate subtotal only for NON-restricted products
            has_eligible_products = False
            for item in (request.line_items or []):
                if item.product_id not in restricted_product_ids:
                    applicable_subtotal += Decimal(str(item.quantity)) * Decimal(str(item.selling_price))
                    has_eligible_products = True
            
            if not has_eligible_products:
                return schemas.CouponValidationResponse(
                    valid=False,
                    message="Coupon cannot be applied to the restricted products in this invoice"
                )
            
            # Check if eligible products meet minimum amount
            if applicable_subtotal < coupon.minimum_invoice_amount:
                return schemas.CouponValidationResponse(
                    valid=False,
                    message=f"Minimum amount for eligible products is Rs. {coupon.minimum_invoice_amount} (current: Rs. {applicable_subtotal})"
                )
        else:
            # No product restriction - coupon applies to all products
            applicable_subtotal = request.invoice_subtotal
            if applicable_subtotal < coupon.minimum_invoice_amount:
                return schemas.CouponValidationResponse(
                    valid=False,
                    message=f"Minimum invoice amount is Rs. {coupon.minimum_invoice_amount}"
                )
        
        # Apply invoice discount first (following correct flow: Item Discount → Invoice Discount → Coupon)
        invoice_discount_amount = Decimal("0")
        if request.invoice_discount_type and request.invoice_discount_value:
            if request.invoice_discount_type == "percent":
                invoice_discount_amount = (applicable_subtotal * Decimal(str(request.invoice_discount_value))) / 100
            else:  # amount
                invoice_discount_amount = Decimal(str(request.invoice_discount_value))
        
        # Amount after invoice discount (this is the base for coupon calculation)
        amount_after_invoice_discount = applicable_subtotal - invoice_discount_amount
        
        # Calculate coupon discount on amount AFTER invoice discount
        if coupon.discount_type == "PERCENT":
            calculated_discount = (amount_after_invoice_discount * coupon.discount_value) / 100
        else:  # AMOUNT
            calculated_discount = min(coupon.discount_value, amount_after_invoice_discount)
        
        return schemas.CouponValidationResponse(
            valid=True,
            coupon_id=coupon.id,
            discount_type=coupon.discount_type,
            discount_value=coupon.discount_value,
            calculated_discount=calculated_discount,
            message=f"Coupon valid! Discount: Rs. {calculated_discount:.2f}"
        )
    
    def record_coupon_usage(
        self, 
        db: Session, 
        coupon_id: int, 
        customer_id: int, 
        invoice_id: int, 
        discount_amount: Decimal
    ) -> CouponUsage:
        """Record coupon usage after invoice is created"""
        usage = CouponUsage(
            coupon_id=coupon_id,
            customer_id=customer_id,
            invoice_id=invoice_id,
            discount_amount=discount_amount,
            used_date=datetime.now()
        )
        db.add(usage)
        db.commit()
        db.refresh(usage)
        return usage
    
    def get_coupon_usage_history(self, db: Session, coupon_id: int, skip: int = 0, limit: int = 100) -> List[CouponUsage]:
        """Get usage history for a coupon with customer and invoice details"""
        from app.modules.sales.models import Invoice
        
        usage_records = db.query(
            CouponUsage,
            Invoice.invoice_no,
            Customer.customer_name
        ).join(
            Invoice, CouponUsage.invoice_id == Invoice.id, isouter=True
        ).join(
            Customer, CouponUsage.customer_id == Customer.id, isouter=True
        ).filter(
            CouponUsage.coupon_id == coupon_id
        ).order_by(CouponUsage.used_date.desc()).offset(skip).limit(limit).all()
        
        # Enrich usage objects with invoice_no and customer_name
        result = []
        for usage, invoice_no, customer_name in usage_records:
            usage.invoice_no = invoice_no
            usage.customer_name = customer_name
            result.append(usage)
        
        return result

coupon_service = CouponService()


class VoucherService:
    """Service for managing gift vouchers"""
    
    def get_all_vouchers(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[CustomerGiftVoucher]:
        """Get all vouchers"""
        query = db.query(CustomerGiftVoucher)
        if active_only:
            query = query.filter(CustomerGiftVoucher.status == "active")
        return query.order_by(CustomerGiftVoucher.created_at.desc()).offset(skip).limit(limit).all()
    
    def get_voucher(self, db: Session, voucher_id: int) -> CustomerGiftVoucher:
        """Get a single voucher by ID"""
        voucher = db.query(CustomerGiftVoucher).filter(CustomerGiftVoucher.id == voucher_id).first()
        if not voucher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Voucher with id {voucher_id} not found"
            )
        return voucher
    
    def get_voucher_by_barcode(self, db: Session, barcode_no: str) -> Optional[CustomerGiftVoucher]:
        """Get a voucher by its barcode"""
        return db.query(CustomerGiftVoucher).filter(
            CustomerGiftVoucher.barcode_no == barcode_no
        ).first()
    
    def create_voucher(self, db: Session, voucher_data: schemas.GiftVoucherCreate) -> CustomerGiftVoucher:
        """Create a new gift voucher"""
        # Check if barcode already exists
        existing = db.query(CustomerGiftVoucher).filter(
            CustomerGiftVoucher.barcode_no == voucher_data.barcode_no
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Voucher with barcode '{voucher_data.barcode_no}' already exists"
            )
        
        voucher = CustomerGiftVoucher(
            barcode_no=voucher_data.barcode_no,
            amount=voucher_data.amount,
            balance=voucher_data.amount,  # Initially, balance equals amount
            date=date.today(),
            valid_period_in_months=voucher_data.valid_period_in_months,
            status="active",
            purchased_invoice_no=voucher_data.purchased_invoice_no,
            # Payment details for cashbook tracking
            payment_method=voucher_data.payment_method or "cash",
            branch_code=voucher_data.branch_code,
            customer_name=voucher_data.customer_name or "Walk-in Customer",
        )
        
        db.add(voucher)
        db.commit()
        db.refresh(voucher)
        return voucher
    
    def _get_expiry_date(self, voucher: CustomerGiftVoucher) -> date:
        """Calculate voucher expiry date"""
        from dateutil.relativedelta import relativedelta
        return voucher.date + relativedelta(months=voucher.valid_period_in_months)
    
    def _is_expired(self, voucher: CustomerGiftVoucher) -> bool:
        """Check if voucher is expired"""
        return date.today() > self._get_expiry_date(voucher)
    
    def validate_voucher(
        self,
        db: Session,
        request: schemas.VoucherValidationRequest
    ) -> schemas.VoucherValidationResponse:
        """
        Validate a voucher for use on an invoice.
        
        IMPORTANT: Vouchers can only be used ONE TIME for the FULL amount.
        Partial redemptions are not allowed. If the voucher balance exceeds
        the invoice amount, the excess is forfeited (not carried forward).
        """
        
        # Find voucher by barcode
        voucher = self.get_voucher_by_barcode(db, request.barcode_no)
        if not voucher:
            return schemas.VoucherValidationResponse(
                valid=False,
                message="Voucher not found"
            )
        
        # Check if voucher is active (not already used)
        if voucher.status != "active":
            status_messages = {
                "fully_claimed": "This voucher has already been used",
                "expired": "This voucher has expired",
            }
            return schemas.VoucherValidationResponse(
                valid=False,
                message=status_messages.get(voucher.status, f"Voucher is {voucher.status}")
            )
        
        # Check if expired
        expiry_date = self._get_expiry_date(voucher)
        if self._is_expired(voucher):
            # Update status to expired
            voucher.status = "expired"
            db.commit()
            return schemas.VoucherValidationResponse(
                valid=False,
                message=f"Voucher expired on {expiry_date}"
            )
        
        # Check if balance is available (should always be full amount for unused voucher)
        if voucher.balance <= 0:
            voucher.status = "fully_claimed"
            db.commit()
            return schemas.VoucherValidationResponse(
                valid=False,
                message="This voucher has already been used"
            )
        
        # ONE-TIME FULL USAGE: The entire voucher balance will be applied.
        # If invoice amount is less than voucher balance, excess is forfeited.
        redeemable_amount = min(voucher.balance, request.invoice_amount_due)
        
        # Build appropriate message
        if voucher.balance > request.invoice_amount_due:
            message = (f"Voucher valid! Full value: Rs. {voucher.balance:.2f}. "
                      f"Rs. {redeemable_amount:.2f} will be applied. "
                      f"Note: Remaining Rs. {(voucher.balance - redeemable_amount):.2f} will be forfeited (one-time use only).")
        else:
            message = f"Voucher valid! Full amount Rs. {voucher.balance:.2f} will be applied."
        
        return schemas.VoucherValidationResponse(
            valid=True,
            voucher_id=voucher.id,
            barcode_no=voucher.barcode_no,
            original_amount=voucher.amount,
            balance=voucher.balance,
            redeemable_amount=redeemable_amount,
            expiry_date=expiry_date,
            message=message
        )
    
    def redeem_voucher(
        self,
        db: Session,
        voucher_id: int,
        invoice_id: int,
        invoice_no: str,
        amount_to_redeem: Decimal
    ) -> VoucherUsage:
        """Redeem voucher for an invoice"""
        voucher = self.get_voucher(db, voucher_id)
        
        # Validate amount
        if amount_to_redeem <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Redeem amount must be greater than 0"
            )
        
        if amount_to_redeem > voucher.balance:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Amount exceeds voucher balance. Available: Rs. {voucher.balance}"
            )
        
        # Create usage record
        usage = VoucherUsage(
            voucher_id=voucher_id,
            invoice_id=invoice_id,
            amount_used=amount_to_redeem,
            used_date=datetime.now()
        )
        db.add(usage)
        
        # Update voucher balance
        voucher.balance = voucher.balance - amount_to_redeem
        
        # If fully claimed, update status
        if voucher.balance <= 0:
            voucher.status = "fully_claimed"
            voucher.claimed_date = datetime.now()
            voucher.claimed_invoice_no = invoice_no
        
        db.commit()
        db.refresh(usage)
        return usage
    
    def get_voucher_usage_history(self, db: Session, voucher_id: int, skip: int = 0, limit: int = 100) -> List[VoucherUsage]:
        """Get usage history for a voucher"""
        from app.modules.sales.models import Invoice
        
        usage_records = db.query(
            VoucherUsage,
            Invoice.invoice_no
        ).join(
            Invoice, VoucherUsage.invoice_id == Invoice.id, isouter=True
        ).filter(
            VoucherUsage.voucher_id == voucher_id
        ).order_by(VoucherUsage.used_date.desc()).offset(skip).limit(limit).all()
        
        result = []
        for usage, invoice_no in usage_records:
            usage.invoice_no = invoice_no
            result.append(usage)
        
        return result
    
    def update_voucher(self, db: Session, voucher_id: int, voucher_data: schemas.GiftVoucherUpdate) -> CustomerGiftVoucher:
        """Update an existing voucher"""
        voucher = self.get_voucher(db, voucher_id)
        
        # Check if voucher has been used - only allow limited updates
        usage_count = db.query(func.count(VoucherUsage.id)).filter(
            VoucherUsage.voucher_id == voucher_id
        ).scalar() or 0
        
        if usage_count > 0 and voucher_data.amount is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change amount of a voucher that has been used"
            )
        
        update_data = voucher_data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            if hasattr(voucher, key):
                setattr(voucher, key, value)
        
        db.commit()
        db.refresh(voucher)
        return voucher
    
    def delete_voucher(self, db: Session, voucher_id: int) -> dict:
        """Delete a voucher (only if not used)"""
        voucher = self.get_voucher(db, voucher_id)
        
        # Check if voucher has been used
        usage_count = db.query(func.count(VoucherUsage.id)).filter(
            VoucherUsage.voucher_id == voucher_id
        ).scalar() or 0
        
        if usage_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete voucher that has been used {usage_count} time(s)"
            )
        
        db.delete(voucher)
        db.commit()
        return {"message": "Voucher deleted successfully"}
    
    def redeem_voucher_api(self, db: Session, request: schemas.VoucherRedeemRequest) -> schemas.VoucherRedeemResponse:
        """API wrapper for redeeming a voucher"""
        # Find voucher by barcode
        voucher = self.get_voucher_by_barcode(db, request.barcode_no)
        if not voucher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Voucher not found"
            )
        
        # Get invoice to get the invoice_no
        from app.modules.sales.models import Invoice
        invoice = db.query(Invoice).filter(Invoice.id == request.invoice_id).first()
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found"
            )
        
        # Redeem
        self.redeem_voucher(
            db, 
            voucher.id, 
            request.invoice_id, 
            invoice.invoice_no, 
            request.amount_to_redeem
        )
        
        # Refresh voucher to get updated balance
        db.refresh(voucher)
        
        return schemas.VoucherRedeemResponse(
            success=True,
            voucher_id=voucher.id,
            amount_redeemed=request.amount_to_redeem,
            remaining_balance=voucher.balance,
            message=f"Successfully redeemed Rs. {request.amount_to_redeem:.2f}. Remaining balance: Rs. {voucher.balance:.2f}"
        )

voucher_service = VoucherService()