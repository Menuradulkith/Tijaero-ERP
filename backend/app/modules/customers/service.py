from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from datetime import datetime, date
from decimal import Decimal
from app.modules.customers import repository, schemas
from app.modules.customers.models import Customer, CustomerCuponCodes, CouponUsage
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
        
        # Calculate discount on applicable subtotal only
        if coupon.discount_type == "PERCENT":
            calculated_discount = (applicable_subtotal * coupon.discount_value) / 100
        else:  # AMOUNT
            calculated_discount = min(coupon.discount_value, applicable_subtotal)
        
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
