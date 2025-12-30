from sqlalchemy.orm import Session
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
    
    def create(self, order: schemas.PurchasingOrderCreate) -> models.PurchasingOrder:
        order_data = order.model_dump(exclude={'items'})
        db_order = models.PurchasingOrder(
            **order_data,
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

class PurchasingReturnRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, return_data: schemas.PurchasingReturnCreate) -> models.PurchasingReturn:
        return_dict = return_data.model_dump(exclude={'items'})
        db_return = models.PurchasingReturn(**return_dict)
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
        return self.db.query(models.PurchasingReturn).filter(
            models.PurchasingReturn.id == return_id
        ).first()

