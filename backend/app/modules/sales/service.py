from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.modules.sales import repository, schemas
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn, SaleReturnItems
from datetime import datetime, date

class SalesService:
    def get_all_invoices(self, db: Session, skip: int = 0, limit: int = 100):
        return repository.sales_repository.get_all(db, skip, limit)
    
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
    
    def create_invoice(self, db: Session, invoice_data: schemas.InvoiceCreate, user_id: int):
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
