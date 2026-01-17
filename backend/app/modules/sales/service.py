from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from app.modules.sales import repository, schemas
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn, SaleReturnItems
from app.modules.inventory.models import SalesStock
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

class SalesService:
    def get_all_invoices(self, db: Session, skip: int = 0, limit: int = 100):
        return repository.sales_repository.get_all(db, skip, limit)
    
    def get_all_invoices_with_items(self, db: Session, skip: int = 0, limit: int = 100):
        """Get invoices with items eagerly loaded"""
        return repository.sales_repository.get_all_with_items(db, skip, limit)
    
    def search_invoices(self, db: Session, query: str, skip: int = 0, limit: int = 100):
        return repository.sales_repository.search(db, query, skip, limit)
    
    def get_invoice(self, db: Session, invoice_id: int):
        invoice = repository.sales_repository.get_by_id(db, invoice_id)
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invoice not found"
            )
        return invoice
    
    def get_pending_approval(self, db: Session, skip: int = 0, limit: int = 100):
        """Get invoices pending approval - server-side filtered"""
        return repository.sales_repository.get_pending_approval(db, skip, limit)
    
    def get_by_customer(self, db: Session, customer_id: int, skip: int = 0, limit: int = 100):
        """Get invoices for a specific customer"""
        return repository.sales_repository.get_by_customer(db, customer_id, skip, limit)
    
    def get_returns_by_invoice(self, db: Session, invoice_id: int, skip: int = 0, limit: int = 100):
        """Get sale returns for a specific invoice"""
        return repository.sales_repository.get_returns_by_invoice(db, invoice_id, skip, limit)
    
    def get_sales_statistics(self, db: Session):
        """Get sales statistics for dashboard"""
        today = date.today()
        current_month_start = today.replace(day=1)
        last_month_start = (today - relativedelta(months=1)).replace(day=1)
        last_month_end = current_month_start - relativedelta(days=1)
        
        # Total invoices count
        total_invoices = db.query(func.count(Invoice.id)).scalar() or 0
        
        # Current month invoices
        current_month_invoices = db.query(func.count(Invoice.id)).filter(
            Invoice.created_date >= current_month_start
        ).scalar() or 0
        
        # Last month invoices
        last_month_invoices = db.query(func.count(Invoice.id)).filter(
            Invoice.created_date >= last_month_start,
            Invoice.created_date <= last_month_end
        ).scalar() or 0
        
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
        
        total_revenue = calc_revenue(db.query(Invoice))
        current_month_revenue = calc_revenue(
            db.query(Invoice).filter(Invoice.created_date >= current_month_start)
        )
        
        # Pending approval count
        pending_approval = db.query(func.count(Invoice.id)).filter(
            Invoice.approval == False
        ).scalar() or 0
        
        # Total sale returns
        sale_returns_count = db.query(func.count(SaleReturn.id)).scalar() or 0
        
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
        # Validate all products are available in sales stock before creating invoice
        for item_data in invoice_data.items:
            self.validate_product_availability(db, item_data.product_id, item_data.quantity)
        
        # Create invoice
        invoice_dict = invoice_data.model_dump(exclude={'items'})
        invoice_dict['created_date'] = date.today()
        invoice_dict['created_date_time'] = datetime.now()
        invoice_dict['status'] = True
        invoice_dict['approval'] = False
        invoice_dict['cupon_amount'] = 0
        invoice_dict['credit_note_amount'] = 0
        invoice_dict['cheque_date'] = date.today()
        
        invoice = Invoice(**invoice_dict)
        db.add(invoice)
        db.flush()
        
        # Create invoice items
        for item_data in invoice_data.items:
            item_dict = item_data.model_dump()
            item_dict['invoice_id'] = invoice.id
            item_dict['created_date'] = datetime.now()
            item = InvoiceItems(**item_dict)
            db.add(item)
        
        db.commit()
        db.refresh(invoice)
        return invoice
    
    def update_invoice(self, db: Session, invoice_id: int, invoice_data: schemas.InvoiceUpdate, user_id: int):
        invoice = self.get_invoice(db, invoice_id)
        
        update_data = invoice_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(invoice, field, value)
        
        db.commit()
        db.refresh(invoice)
        return invoice
    
    def delete_invoice(self, db: Session, invoice_id: int):
        invoice = self.get_invoice(db, invoice_id)
        db.delete(invoice)
        db.commit()
        return {"message": "Invoice deleted successfully"}
    
    def get_all_sale_returns(self, db: Session, skip: int = 0, limit: int = 100):
        return db.query(SaleReturn).offset(skip).limit(limit).all()
    
    def get_sale_return(self, db: Session, return_id: int):
        sale_return = db.query(SaleReturn).filter(SaleReturn.id == return_id).first()
        if not sale_return:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sale return not found"
            )
        return sale_return
    
    def create_sale_return(self, db: Session, sale_return_data: schemas.SaleReturnCreate):
        # Create sale return
        return_dict = sale_return_data.model_dump(exclude={'items'})
        return_dict['added_date'] = date.today()
        return_dict['cheque_date'] = date.today()
        
        sale_return = SaleReturn(**return_dict)
        db.add(sale_return)
        db.flush()
        
        # Create sale return items
        for item_data in sale_return_data.items:
            item_dict = item_data.model_dump()
            item_dict['sale_return_id'] = sale_return.id
            item_dict['added_date'] = datetime.now()
            item = SaleReturnItems(**item_dict)
            db.add(item)
        
        db.commit()
        db.refresh(sale_return)
        return sale_return

sales_service = SalesService()
