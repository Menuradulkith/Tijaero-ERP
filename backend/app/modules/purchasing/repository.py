from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, func
from typing import List, Optional
from datetime import date, datetime
from . import models, schemas

class SupplierRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, supplier: schemas.SupplierCreate) -> models.Supplier:
        db_supplier = models.Supplier(
            **supplier.model_dump(),
            date_joined=datetime.now()
        )
        self.db.add(db_supplier)
        self.db.commit()
        self.db.refresh(db_supplier)
        return db_supplier
    
    def get_by_id(self, supplier_id: int) -> Optional[models.Supplier]:
        return self.db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    
    def get_all(self, filters: schemas.SupplierListFilter) -> List[models.Supplier]:
        query = self.db.query(models.Supplier)
        
        if filters.active is not None:
            query = query.filter(models.Supplier.active == filters.active)
        if filters.country_id:
            query = query.filter(models.Supplier.country_id == filters.country_id)
        if filters.search:
            search_term = f"%{filters.search}%"
            query = query.filter(
                or_(
                    models.Supplier.full_name.ilike(search_term),
                    models.Supplier.company_name.ilike(search_term),
                    models.Supplier.email.ilike(search_term)
                )
            )
        if filters.min_credit_limit:
            query = query.filter(models.Supplier.max_credit_limit >= filters.min_credit_limit)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update(self, supplier_id: int, supplier_update: schemas.SupplierUpdate) -> Optional[models.Supplier]:
        db_supplier = self.get_by_id(supplier_id)
        if db_supplier:
            update_data = supplier_update.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                setattr(db_supplier, field, value)
            self.db.commit()
            self.db.refresh(db_supplier)
        return db_supplier
    
    def delete(self, supplier_id: int) -> bool:
        db_supplier = self.get_by_id(supplier_id)
        if db_supplier:
            self.db.delete(db_supplier)
            self.db.commit()
            return True
        return False

class PurchasingOrderRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, order: schemas.PurchasingOrderCreate, initial_status: str = "pending") -> models.PurchasingOrder:
        # Exclude items - they're handled separately
        order_data = order.model_dump(exclude={'items'})
        db_order = models.PurchasingOrder(
            **order_data,
            status=initial_status,
            created_date=date.today(),
            added_date=datetime.now()
        )
        self.db.add(db_order)
        self.db.flush()
        
        # Add items
        for item in order.items:
            db_item = models.PurchasingOrderItems(
                **item.model_dump(),
                purchasingorders_id=db_order.id,
                created_date=date.today(),
                added_date=datetime.now()
            )
            self.db.add(db_item)
        
        self.db.commit()
        self.db.refresh(db_order)
        return db_order
    
    def get_by_id(self, order_id: int) -> Optional[models.PurchasingOrder]:
        return self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == order_id
        ).first()
    
    def get_by_id_with_items(self, order_id: int) -> Optional[models.PurchasingOrder]:
        """Get purchase order with items eagerly loaded to prevent N+1 queries"""
        return self.db.query(models.PurchasingOrder).options(
            joinedload(models.PurchasingOrder.items)
        ).filter(
            models.PurchasingOrder.id == order_id
        ).first()
    
    def get_all(self, filters: schemas.PurchaseOrderListFilter) -> List[models.PurchasingOrder]:
        query = self.db.query(models.PurchasingOrder)
        
        if filters.supplier_id:
            query = query.filter(
                or_(
                    models.PurchasingOrder.first_suppliers_id == filters.supplier_id,
                    models.PurchasingOrder.second_suppliers_id == filters.supplier_id
                )
            )
        if filters.branch_code:
            query = query.filter(models.PurchasingOrder.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(models.PurchasingOrder.purchasing_order_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.PurchasingOrder.purchasing_order_date <= filters.date_to)
        
        return query.order_by(models.PurchasingOrder.purchasing_order_date.desc()).offset(filters.skip).limit(filters.limit).all()
    
    def update(self, order_id: int, order_update: schemas.PurchasingOrderUpdate) -> Optional[models.PurchasingOrder]:
        db_order = self.get_by_id(order_id)
        if db_order:
            update_data = order_update.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                setattr(db_order, field, value)
            self.db.commit()
            self.db.refresh(db_order)
        return db_order
    
    def delete(self, order_id: int) -> bool:
        db_order = self.get_by_id(order_id)
        if db_order:
            # Check if there are any GRNs associated with this order
            grn_count = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.purchasingorders_id == order_id
            ).count()
            
            if grn_count > 0:
                raise ValueError(f"Cannot delete purchase order: {grn_count} Good Received Note(s) are associated with this order")
            
            # Delete related items first
            self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.purchasingorders_id == order_id
            ).delete()
            self.db.delete(db_order)
            self.db.commit()
            return True
        return False
    
    def count_daily_orders_by_branch(self, branch_code: str, target_date: date) -> int:
        """Count the number of POs created for a branch on a specific date"""
        return self.db.query(models.PurchasingOrder).filter(
            and_(
                models.PurchasingOrder.branch_code == branch_code,
                func.date(models.PurchasingOrder.added_date) == target_date
            )
        ).count()

class PurchasingReturnRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, return_data: schemas.PurchasingReturnCreate) -> models.PurchasingReturn:
        return_dict = return_data.model_dump(exclude={'items'})
        db_return = models.PurchasingReturn(**return_dict, added_date=date.today())
        self.db.add(db_return)
        self.db.flush()
        
        # Add items
        for item in return_data.items:
            db_item = models.PurchasingReturnItems(
                **item.model_dump(),
                purchasingreturn_id=db_return.id,
                branch_code=return_dict['branch_code'],
                added_date=datetime.now()
            )
            self.db.add(db_item)
        
        self.db.commit()
        self.db.refresh(db_return)
        return db_return
    
    def get_by_id(self, return_id: int) -> Optional[models.PurchasingReturn]:
        return self.db.query(models.PurchasingReturn).options(
            joinedload(models.PurchasingReturn.items).joinedload(models.PurchasingReturnItems.product)
        ).filter(
            models.PurchasingReturn.id == return_id
        ).first()
    
    def get_all(self, skip: int = 0, limit: int = 100) -> List[models.PurchasingReturn]:
        return self.db.query(models.PurchasingReturn).order_by(
            models.PurchasingReturn.added_date.desc()
        ).offset(skip).limit(limit).all()


class GoodReceivedNoteRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, grn: schemas.GoodReceivedNoteCreate) -> models.GoodReceivedNote:
        db_grn = models.GoodReceivedNote(
            **grn.model_dump(),
            created_date=date.today(),
            added_date=datetime.now()
        )
        self.db.add(db_grn)
        self.db.commit()
        self.db.refresh(db_grn)
        return db_grn
    
    def get_by_id(self, grn_id: int) -> Optional[models.GoodReceivedNote]:
        return self.db.query(models.GoodReceivedNote).filter(models.GoodReceivedNote.id == grn_id).first()
    
    def get_all(self, filters: schemas.GoodReceivedNoteListFilter) -> List[models.GoodReceivedNote]:
        query = self.db.query(models.GoodReceivedNote)
        
        if filters.branch_code:
            query = query.filter(models.GoodReceivedNote.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(models.GoodReceivedNote.good_received_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.GoodReceivedNote.good_received_date <= filters.date_to)
        
        return query.order_by(models.GoodReceivedNote.added_date.desc()).offset(filters.skip).limit(filters.limit).all()
    
    def update(self, grn_id: int, grn: schemas.GoodReceivedNoteCreate) -> Optional[models.GoodReceivedNote]:
        db_grn = self.get_by_id(grn_id)
        if db_grn:
            update_data = grn.model_dump()
            for field, value in update_data.items():
                setattr(db_grn, field, value)
            self.db.commit()
            self.db.refresh(db_grn)
        return db_grn
    
    def get_items(self, grn_id: int) -> List[models.GoodReceivedItems]:
        grn = self.get_by_id(grn_id)
        if not grn:
            return []
        return self.db.query(models.GoodReceivedItems).filter(
            models.GoodReceivedItems.good_received_note == grn.good_received_no
        ).all()
    
    def create_item(self, item: schemas.GoodReceivedItemCreate) -> models.GoodReceivedItems:
        db_item = models.GoodReceivedItems(
            **item.model_dump(),
            created_date=date.today(),
            added_date=datetime.now()
        )
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item


class SupplierCreditsSettleRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, settle: schemas.SupplierCreditsSettleCreate) -> models.SupplierCreditsSettle:
        # Create the main settlement record
        settle_data = settle.model_dump(exclude={"transactions"})
        db_settle = models.SupplierCreditsSettle(
            **settle_data,
            created_date=datetime.now()
        )
        self.db.add(db_settle)
        self.db.flush()
        
        # Create transaction records
        for transaction in settle.transactions:
            db_transaction = models.SupplierCreditsSettleTransaction(
                **transaction.model_dump(),
                supplier_credit_settle_id=db_settle.id,
                created_date=datetime.now()
            )
            self.db.add(db_transaction)
        
        self.db.commit()
        self.db.refresh(db_settle)
        return db_settle
    
    def get_by_id(self, settle_id: int) -> Optional[models.SupplierCreditsSettle]:
        return self.db.query(models.SupplierCreditsSettle).filter(
            models.SupplierCreditsSettle.id == settle_id
        ).first()
    
    def get_all(self, skip: int = 0, limit: int = 100) -> List[models.SupplierCreditsSettle]:
        return self.db.query(models.SupplierCreditsSettle).order_by(
            models.SupplierCreditsSettle.created_date.desc()
        ).offset(skip).limit(limit).all()
    
    def get_by_supplier(self, supplier_id: int) -> List[models.SupplierCreditsSettle]:
        return self.db.query(models.SupplierCreditsSettle).filter(
            models.SupplierCreditsSettle.suppliers_id == supplier_id
        ).order_by(models.SupplierCreditsSettle.created_date.desc()).all()
    
    def get_transactions(self, settle_id: int) -> List[models.SupplierCreditsSettleTransaction]:
        return self.db.query(models.SupplierCreditsSettleTransaction).filter(
            models.SupplierCreditsSettleTransaction.supplier_credit_settle_id == settle_id
        ).all()
    
    def delete(self, settle_id: int) -> bool:
        db_settle = self.get_by_id(settle_id)
        if db_settle:
            # Delete transactions first
            self.db.query(models.SupplierCreditsSettleTransaction).filter(
                models.SupplierCreditsSettleTransaction.supplier_credit_settle_id == settle_id
            ).delete()
            self.db.delete(db_settle)
            self.db.commit()
            return True
        return False

