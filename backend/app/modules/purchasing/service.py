from sqlalchemy.orm import Session
from typing import List, Optional
from . import models, schemas, repository
from fastapi import HTTPException, status

class SupplierService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierRepository(db)
    
    def create_supplier(self, supplier: schemas.SupplierCreate) -> models.Supplier:
        return self.repo.create(supplier)
    
    def get_supplier(self, supplier_id: int) -> models.Supplier:
        supplier = self.repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        return supplier
    
    def list_suppliers(self, filters: schemas.SupplierListFilter) -> List[models.Supplier]:
        return self.repo.get_all(filters)
    
    def update_supplier(self, supplier_id: int, supplier_update: schemas.SupplierUpdate) -> models.Supplier:
        supplier = self.repo.update(supplier_id, supplier_update)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        return supplier
    
    def delete_supplier(self, supplier_id: int) -> bool:
        if not self.repo.delete(supplier_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        return True

class PurchasingOrderService:
    def __init__(self, db: Session):
        self.repo = repository.PurchasingOrderRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
    
    def create_order(self, order: schemas.PurchasingOrderCreate) -> models.PurchasingOrder:
        # Verify suppliers exist
        if not self.supplier_repo.get_by_id(order.first_suppliers_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"First supplier with id {order.first_suppliers_id} not found"
            )
        if not self.supplier_repo.get_by_id(order.second_suppliers_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Second supplier with id {order.second_suppliers_id} not found"
            )
        
        return self.repo.create(order)
    
    def get_order(self, order_id: int) -> models.PurchasingOrder:
        order = self.repo.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        return order
    
    def list_orders(self, filters: schemas.PurchaseOrderListFilter) -> List[models.PurchasingOrder]:
        return self.repo.get_all(filters)
    
    def update_order(self, order_id: int, order_update: schemas.PurchasingOrderUpdate) -> models.PurchasingOrder:
        order = self.repo.update(order_id, order_update)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        return order
    
    def delete_order(self, order_id: int) -> None:
        order = self.repo.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        try:
            self.repo.delete(order_id)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

class PurchasingReturnService:
    def __init__(self, db: Session):
        self.repo = repository.PurchasingReturnRepository(db)
        self.db = db
    
    def create_return(self, return_data: schemas.PurchasingReturnCreate) -> models.PurchasingReturn:
        """
        Create a purchase return and update supplier credit.
        When goods are returned, supplier.left_credit_amount increases (we owe them less).
        """
        from app.modules.purchasing.credit_service import SupplierCreditService
        
        # Get GRN to find the supplier
        grn = self.db.query(models.GoodReceivedNote).filter(
            models.GoodReceivedNote.id == return_data.goodreceivednote_id
        ).first()
        
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN {return_data.goodreceivednote_id} not found"
            )
        
        # Get PO to find supplier
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        
        # Create the return
        created_return = self.repo.create(return_data)
        
        # Update supplier credit balance if we have supplier
        if po and po.first_suppliers_id:
            credit_service = SupplierCreditService()
            credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        
        return created_return
    
    def get_return(self, return_id: int) -> models.PurchasingReturn:
        return_record = self.repo.get_by_id(return_id)
        if not return_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase return with id {return_id} not found"
            )
        return return_record
    
    def list_returns(self, skip: int = 0, limit: int = 100) -> List[models.PurchasingReturn]:
        return self.repo.get_all(skip, limit)

class GoodReceivedNoteService:
    def __init__(self, db: Session):
        self.repo = repository.GoodReceivedNoteRepository(db)
        self.db = db
    
    def create(self, grn: schemas.GoodReceivedNoteCreate) -> models.GoodReceivedNote:
        """
        Create a GRN and update supplier credit.
        When goods are received on credit, supplier.left_credit_amount decreases.
        """
        from app.modules.purchasing.credit_service import SupplierCreditService
        
        # Get PO to find supplier
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        
        if not po:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order {grn.purchasingorders_id} not found"
            )
        
        import uuid
        from sqlalchemy.exc import IntegrityError

        def _new_grn_no() -> str:
            return f"GRN-{uuid.uuid4().hex[:8].upper()}"

        # Ensure GRN number is present and unique (avoid 500 on collisions)
        working_grn = grn
        if not getattr(working_grn, "good_received_no", None):
            working_grn = working_grn.model_copy(update={"good_received_no": _new_grn_no()})

        created_grn = None
        for _ in range(5):
            try:
                created_grn = self.repo.create(working_grn)
                break
            except IntegrityError:
                self.db.rollback()
                # likely UNIQUE constraint on good_received_no
                working_grn = working_grn.model_copy(update={"good_received_no": _new_grn_no()})

        if created_grn is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GRN number conflict. Please retry."
            )

        # Mark PO as completed after successful GRN creation
        po.status = "completed"
        self.db.commit()
        
        # Update supplier credit balance
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        
        return created_grn
    
    def get_by_id(self, grn_id: int) -> models.GoodReceivedNote:
        grn = self.repo.get_by_id(grn_id)
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN with id {grn_id} not found"
            )
        return grn
    
    def list_grns(self, filters: schemas.GoodReceivedNoteListFilter) -> List[models.GoodReceivedNote]:
        return self.repo.get_all(filters)
    
    def update(self, grn_id: int, grn: schemas.GoodReceivedNoteCreate) -> models.GoodReceivedNote:
        updated = self.repo.update(grn_id, grn)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN with id {grn_id} not found"
            )
        return updated
    
    def get_items(self, grn_id: int) -> List[models.GoodReceivedItems]:
        return self.repo.get_items(grn_id)
    
    def get_items_with_details(self, grn_id: int) -> List[dict]:
        """Get GRN items with product names and saved-to info"""
        from app.modules.inventory.models import SalesStock, CompanyAssets
        from app.modules.products.models import Product
        
        items = self.repo.get_items(grn_id)
        grn = self.repo.get_by_id(grn_id)
        if not grn:
            return []
        
        result = []
        for item in items:
            # Get product info from PO item
            po_item = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.id == item.purchasing_order_items_id
            ).first()
            
            product_id = po_item.product_id if po_item else None
            product_name = None
            if product_id:
                product = self.db.query(Product).filter(Product.id == product_id).first()
                product_name = product.name if product else None
            
            # Check if saved to sales_stock
            saved_to_sales_stock = self.db.query(SalesStock).filter(
                SalesStock.good_received_note_id == grn_id,
                SalesStock.barcode == item.barcode
            ).first() is not None
            
            # Check if saved to company_assets
            saved_to_company_assets = self.db.query(CompanyAssets).filter(
                CompanyAssets.good_received_note_id == grn_id,
                CompanyAssets.barcode == item.barcode
            ).first() is not None
            
            result.append({
                "id": item.id,
                "good_received_note": item.good_received_note,
                "barcode": item.barcode,
                "branch_code": item.branch_code,
                "active": item.active,
                "created_date": item.created_date,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "added_date": item.added_date,
                "product_id": product_id,
                "product_name": product_name,
                "saved_to_sales_stock": saved_to_sales_stock,
                "saved_to_company_assets": saved_to_company_assets,
            })
        
        return result
    
    def create_item(self, item: schemas.GoodReceivedItemCreate) -> models.GoodReceivedItems:
        return self.repo.create_item(item)


class SupplierCreditsSettleService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierCreditsSettleRepository(db)
        self.db = db
    
    def create(self, settle: schemas.SupplierCreditsSettleCreate) -> models.SupplierCreditsSettle:
        """
        Create a credit settlement and update supplier credit.
        When supplier is paid, supplier.left_credit_amount increases.
        """
        from app.modules.purchasing.credit_service import SupplierCreditService
        
        # Create the settlement
        created_settle = self.repo.create(settle)
        
        # Update supplier credit balance
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, settle.suppliers_id)
        
        return created_settle
    
    def get_by_id(self, settle_id: int) -> models.SupplierCreditsSettle:
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        return settle
    
    def list_settlements(self, skip: int = 0, limit: int = 100) -> List[models.SupplierCreditsSettle]:
        return self.repo.get_all(skip, limit)
    
    def get_by_supplier(self, supplier_id: int) -> List[models.SupplierCreditsSettle]:
        return self.repo.get_by_supplier(supplier_id)
    
    def get_with_transactions(self, settle_id: int) -> schemas.SupplierCreditsSettleWithTransactions:
        settle = self.get_by_id(settle_id)
        transactions = self.repo.get_transactions(settle_id)
        
        # Build transactions with GRN and PO details
        enriched_transactions = []
        for t in transactions:
            # Get GRN details
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == t.good_received_id
            ).first()
            
            grn_no = None
            po_no = None
            invoice_no = None
            
            if grn:
                grn_no = grn.good_received_no
                # Get PO details
                po = self.db.query(models.PurchasingOrder).filter(
                    models.PurchasingOrder.id == grn.purchasingorders_id
                ).first()
                if po:
                    po_no = po.purchasing_order_no
                    invoice_no = po.purchasing_invoice_no
            
            enriched_transactions.append(schemas.SupplierCreditsSettleTransaction(
                id=t.id,
                payment_method=t.payment_method,
                cheque_date=t.cheque_date,
                payment_amount=t.payment_amount,
                payment_method_number=t.payment_method_number,
                remarks=t.remarks,
                created_date=t.created_date,
                good_received_id=t.good_received_id,
                supplier_credit_settle_id=t.supplier_credit_settle_id,
                grn_no=grn_no,
                po_no=po_no,
                invoice_no=invoice_no
            ))
        
        return schemas.SupplierCreditsSettleWithTransactions(
            id=settle.id,
            supplier_credits_settle_no=settle.supplier_credits_settle_no,
            branch_code=settle.branch_code,
            created_date=settle.created_date,
            suppliers_id=settle.suppliers_id,
            transactions=enriched_transactions
        )
    
    def delete(self, settle_id: int) -> bool:
        """
        Delete a credit settlement and recalculate supplier credit.
        When settlement is deleted, supplier.left_credit_amount decreases.
        """
        from app.modules.purchasing.credit_service import SupplierCreditService
        
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        supplier_id = settle.suppliers_id
        result = self.repo.delete(settle_id)
        
        # Update supplier credit balance after deleting settlement
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, supplier_id)
        
        return result
