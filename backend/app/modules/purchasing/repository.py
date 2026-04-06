from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, func, text
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import date, datetime
from . import models, schemas
from app.core import timezone as tz

class SupplierRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, supplier: schemas.SupplierCreate) -> models.Supplier:
        db_supplier = models.Supplier(
            **supplier.model_dump(),
            date_joined=tz.now()
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
    
    def get_next_po_number(self) -> str:
        """Generate next PO number: PO-YYYY-XXXXX with advisory lock"""
        year = tz.year()
        prefix = f"PO-{year}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            self.db.query(models.PurchasingOrder)
            .filter(models.PurchasingOrder.purchasing_order_no.like(f"{prefix}-%"))
            .order_by(models.PurchasingOrder.id.desc())
            .first()
        )
        if last:
            try:
                last_seq = int(last.purchasing_order_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}-{next_seq:05d}"
    
    def create(self, order: schemas.PurchasingOrderCreate, initial_status: str = "pending") -> models.PurchasingOrder:
        order_data = order.model_dump(exclude={'items'})
        # Server-side sequential number generation
        order_data['purchasing_order_no'] = self.get_next_po_number()
        db_order = models.PurchasingOrder(
            **order_data,
            status=initial_status,
            created_date=tz.today(),
            added_date=tz.now()
        )
        self.db.add(db_order)
        self.db.flush()
        
        for item in order.items:
            db_item = models.PurchasingOrderItems(
                **item.model_dump(),
                purchasingorders_id=db_order.id,
                created_date=tz.today(),
                added_date=tz.now()
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
        # Branch-based access control: filter by allowed branches
        elif filters.branch_codes:
            query = query.filter(models.PurchasingOrder.branch_code.in_(filters.branch_codes))
        if filters.date_from:
            query = query.filter(models.PurchasingOrder.purchasing_order_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.PurchasingOrder.purchasing_order_date <= filters.date_to)
        
        return query.order_by(models.PurchasingOrder.purchasing_order_date.desc()).offset(filters.skip).limit(filters.limit).all()
    
    def update(self, order_id: int, order_update: schemas.PurchasingOrderUpdate) -> Optional[models.PurchasingOrder]:
        db_order = self.get_by_id(order_id)
        if db_order:
            update_data = order_update.model_dump(exclude_unset=True)
            
            items_data = update_data.pop('items', None)
            
            for field, value in update_data.items():
                setattr(db_order, field, value)
            
            if items_data is not None:
                self.db.query(models.PurchasingOrderItems).filter(
                    models.PurchasingOrderItems.purchasingorders_id == order_id
                ).delete()

                for item in items_data:
                    db_item = models.PurchasingOrderItems(
                        **item,
                        purchasingorders_id=db_order.id,
                        created_date=tz.today(),
                        added_date=tz.now()
                    )
                    self.db.add(db_item)
            
            self.db.commit()
            self.db.refresh(db_order)
        return db_order
    
    def delete(self, order_id: int) -> bool:
        db_order = self.get_by_id(order_id)
        if db_order:
            # Check if order is approved or completed — those cannot be deleted
            order_status = (db_order.status or "").lower()
            if order_status in ("approved", "completed"):
                raise ValueError(f"Cannot delete purchase order with status '{db_order.status}'")
            
            # Get PO item IDs for cascading
            po_item_ids = [
                item_id for (item_id,) in
                self.db.query(models.PurchasingOrderItems.id).filter(
                    models.PurchasingOrderItems.purchasingorders_id == order_id
                ).all()
            ]
            
            # Cascade-delete GRN items linked to this PO's items
            if po_item_ids:
                self.db.query(models.GoodReceivedItems).filter(
                    models.GoodReceivedItems.purchasing_order_items_id.in_(po_item_ids)
                ).delete(synchronize_session=False)
            
            # Delete GRNs linked to this PO
            self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.purchasingorders_id == order_id
            ).delete()
            
            # Delete PO items
            self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.purchasingorders_id == order_id
            ).delete()
            self.db.delete(db_order)
            self.db.commit()
            return True
        return False
    
    def count_daily_orders_by_branch(self, branch_code: str, target_date: date) -> int:
        return self.db.query(models.PurchasingOrder).filter(
            and_(
                models.PurchasingOrder.branch_code == branch_code,
                func.date(models.PurchasingOrder.added_date) == target_date
            )
        ).count()

class PurchasingReturnRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def get_next_return_number(self) -> str:
        """Generate next Purchase Return number: RET-YYYY-XXXXX with advisory lock"""
        year = tz.year()
        prefix = f"RET-{year}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            self.db.query(models.PurchasingReturn)
            .filter(models.PurchasingReturn.purchasing_return_no.like(f"{prefix}-%"))
            .order_by(models.PurchasingReturn.id.desc())
            .first()
        )
        if last:
            try:
                last_seq = int(last.purchasing_return_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}-{next_seq:05d}"
    
    def create(self, return_data: schemas.PurchasingReturnCreate) -> models.PurchasingReturn:
        return_dict = return_data.model_dump(exclude={'items'})
        # Server-side sequential number generation
        return_dict['purchasing_return_no'] = self.get_next_return_number()
        db_return = models.PurchasingReturn(**return_dict, added_date=tz.today())
        self.db.add(db_return)
        self.db.flush()
        
        for item in return_data.items:
            db_item = models.PurchasingReturnItems(
                **item.model_dump(),
                purchasingreturn_id=db_return.id,
                branch_code=return_dict['branch_code'],
                added_date=tz.now()
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
    
    def get_next_grn_number(self) -> str:
        """Generate next GRN number: GRN-YYYY-XXXXX with advisory lock"""
        year = tz.year()
        prefix = f"GRN-{year}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            self.db.query(models.GoodReceivedNote)
            .filter(models.GoodReceivedNote.good_received_no.like(f"{prefix}-%"))
            .order_by(models.GoodReceivedNote.id.desc())
            .first()
        )
        if last:
            try:
                last_seq = int(last.good_received_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}-{next_seq:05d}"
    
    def create(self, grn: schemas.GoodReceivedNoteCreate) -> models.GoodReceivedNote:
        grn_data = grn.model_dump()
        # Server-side sequential number generation
        grn_data['good_received_no'] = self.get_next_grn_number()
        db_grn = models.GoodReceivedNote(
            **grn_data,
            created_date=tz.today(),
            added_date=tz.now()
        )
        self.db.add(db_grn)
        self.db.flush()
        self.db.refresh(db_grn)
        return db_grn
    
    def get_by_id(self, grn_id: int) -> Optional[models.GoodReceivedNote]:
        return self.db.query(models.GoodReceivedNote).filter(models.GoodReceivedNote.id == grn_id).first()
    
    def get_all(self, filters: schemas.GoodReceivedNoteListFilter) -> List[models.GoodReceivedNote]:
        query = self.db.query(models.GoodReceivedNote)
        
        if filters.branch_code:
            query = query.filter(models.GoodReceivedNote.branch_code == filters.branch_code)
        elif filters.branch_codes:
            # Multi-branch filtering for branch-based access control
            query = query.filter(models.GoodReceivedNote.branch_code.in_(filters.branch_codes))
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
            created_date=tz.today(),
            added_date=tz.now()
        )
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item


class SupplierCreditsSettleRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, settle: schemas.SupplierCreditsSettleCreate) -> models.SupplierCreditsSettle:
        settle_data = settle.model_dump(exclude={"transactions"})
        db_settle = models.SupplierCreditsSettle(
            **settle_data,
            created_date=tz.now()
        )
        self.db.add(db_settle)
        self.db.flush()

        for transaction in settle.transactions:
            db_transaction = models.SupplierCreditsSettleTransaction(
                **transaction.model_dump(),
                supplier_credit_settle_id=db_settle.id,
                created_date=tz.now()
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
            self.db.query(models.SupplierCreditsSettleTransaction).filter(
                models.SupplierCreditsSettleTransaction.supplier_credit_settle_id == settle_id
            ).delete()
            self.db.delete(db_settle)
            self.db.commit()
            return True
        return False


class SupplierPaymentRepository:
    
    def __init__(self, db: Session):
        self.db = db
    
    def _generate_payment_no(self) -> str:
        today = tz.today()
        prefix = f"SP-{today.strftime('%Y%m%d')}"
        
        # Advisory lock to prevent race conditions on sequence generation
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last_payment = self.db.query(models.SupplierPayment).filter(
            models.SupplierPayment.payment_no.like(f"{prefix}%")
        ).order_by(models.SupplierPayment.payment_no.desc()).first()
        
        if last_payment:
            try:
                last_num = int(last_payment.payment_no.split("-")[-1])
                new_num = last_num + 1
            except (ValueError, IndexError):
                new_num = 1
        else:
            new_num = 1
        
        return f"{prefix}-{new_num:03d}"
    
    def create(self, payment: schemas.SupplierPaymentCreate, created_by: int = None) -> models.SupplierPayment:
        # Retry loop to handle concurrent payment number collisions
        for attempt in range(5):
            payment_no = self._generate_payment_no()
            
            db_payment = models.SupplierPayment(
                payment_no=payment_no,
                supplier_id=payment.supplier_id,
                purchasing_order_id=payment.purchasing_order_id,
                payment_date=payment.payment_date,
                payment_method=payment.payment_method,
                payment_amount=payment.payment_amount,
                reference_number=payment.reference_number,
                bank_name=payment.bank_name,
                branch_code=payment.branch_code,
                payment_for=payment.payment_for,
                invoice_reference=payment.invoice_reference,
                remarks=payment.remarks,
                status="pending",
                created_date=tz.now(),
                created_by=created_by
            )
            self.db.add(db_payment)
            try:
                self.db.commit()
                self.db.refresh(db_payment)
                return db_payment
            except IntegrityError:
                self.db.rollback()
                continue
        
        raise ValueError("Failed to generate unique payment number after 5 attempts. Please retry.")
    
    def get_by_id(self, payment_id: int) -> Optional[models.SupplierPayment]:
        return self.db.query(models.SupplierPayment).filter(
            models.SupplierPayment.id == payment_id
        ).first()
    
    def get_all(self, filters: schemas.SupplierPaymentListFilter) -> List[models.SupplierPayment]:
        query = self.db.query(models.SupplierPayment)
        
        if filters.supplier_id:
            query = query.filter(models.SupplierPayment.supplier_id == filters.supplier_id)
        if filters.branch_code:
            query = query.filter(models.SupplierPayment.branch_code == filters.branch_code)
        if filters.payment_method:
            query = query.filter(models.SupplierPayment.payment_method == filters.payment_method)
        if filters.payment_for:
            query = query.filter(models.SupplierPayment.payment_for == filters.payment_for)
        if filters.status:
            query = query.filter(models.SupplierPayment.status == filters.status)
        if filters.date_from:
            query = query.filter(models.SupplierPayment.payment_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.SupplierPayment.payment_date <= filters.date_to)
        
        return query.order_by(
            models.SupplierPayment.payment_date.desc(),
            models.SupplierPayment.created_date.desc()
        ).offset(filters.skip).limit(filters.limit).all()
    
    def get_by_supplier(self, supplier_id: int, skip: int = 0, limit: int = 100) -> List[models.SupplierPayment]:
        return self.db.query(models.SupplierPayment).filter(
            models.SupplierPayment.supplier_id == supplier_id
        ).order_by(
            models.SupplierPayment.payment_date.desc()
        ).offset(skip).limit(limit).all()
    
    def update(self, payment_id: int, payment_update: schemas.SupplierPaymentUpdate) -> Optional[models.SupplierPayment]:
        db_payment = self.get_by_id(payment_id)
        if db_payment:
            update_data = payment_update.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                setattr(db_payment, field, value)
            self.db.commit()
            self.db.refresh(db_payment)
        return db_payment
    
    def verify(self, payment_id: int, verified_by: int) -> Optional[models.SupplierPayment]:
        # Lock the payment row to prevent concurrent verify/cancel
        db_payment = self.db.query(models.SupplierPayment).filter(
            models.SupplierPayment.id == payment_id
        ).with_for_update().first()
        if db_payment and db_payment.status == "pending":
            db_payment.status = "verified"
            db_payment.verified_by = verified_by
            db_payment.verified_date = tz.now()
            self.db.commit()
            self.db.refresh(db_payment)
        return db_payment
    
    def cancel(self, payment_id: int) -> Optional[models.SupplierPayment]:
        # Lock the payment row to prevent concurrent verify/cancel
        db_payment = self.db.query(models.SupplierPayment).filter(
            models.SupplierPayment.id == payment_id
        ).with_for_update().first()
        if db_payment and db_payment.status == "pending":
            db_payment.status = "cancelled"
            self.db.commit()
            self.db.refresh(db_payment)
        return db_payment
    
    def delete(self, payment_id: int) -> bool:
        db_payment = self.get_by_id(payment_id)
        if db_payment and db_payment.status == "pending":
            self.db.delete(db_payment)
            self.db.commit()
            return True
        return False
    
    def get_total_by_supplier(self, supplier_id: int, status: str = "verified") -> float:
        result = self.db.query(func.sum(models.SupplierPayment.payment_amount)).filter(
            models.SupplierPayment.supplier_id == supplier_id,
            models.SupplierPayment.status == status
        ).scalar()
        return float(result) if result else 0.0


class SupplierAdvancePaymentRepository:
    """Repository for Supplier Advance Payments"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def _generate_advance_no(self) -> str:
        """Generate unique advance payment number: ADV-YYYYMMDD-XXX"""
        today = tz.now()
        prefix = f"ADV-{today.strftime('%Y%m%d')}-"
        
        # Advisory lock to prevent race conditions on sequence generation
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last_advance = self.db.query(models.SupplierAdvancePayment).filter(
            models.SupplierAdvancePayment.advance_no.like(f"{prefix}%")
        ).order_by(models.SupplierAdvancePayment.advance_no.desc()).first()
        
        if last_advance:
            try:
                last_num = int(last_advance.advance_no.split("-")[-1])
                new_num = last_num + 1
            except (ValueError, IndexError):
                new_num = 1
        else:
            new_num = 1
        
        return f"{prefix}{new_num:03d}"
    
    def create(self, data: schemas.SupplierAdvancePaymentCreate, created_by: Optional[int] = None) -> models.SupplierAdvancePayment:
        # Retry loop to handle concurrent advance number collisions
        for attempt in range(5):
            advance_no = self._generate_advance_no()
            
            db_advance = models.SupplierAdvancePayment(
                advance_no=advance_no,
                supplier_id=data.supplier_id,
                payment_date=data.payment_date,
                branch_code=data.branch_code,
                payment_method=data.payment_method,
                original_amount=data.original_amount,
                applied_amount=0,
                remaining_amount=data.original_amount,  # Initially, remaining = original
                reference_number=data.reference_number,
                bank_name=data.bank_name,
                is_fully_applied=False,
                remarks=data.remarks,
                created_by=created_by
            )
            self.db.add(db_advance)
            try:
                self.db.commit()
                self.db.refresh(db_advance)
                return db_advance
            except IntegrityError:
                self.db.rollback()
                continue
        
        raise ValueError("Failed to generate unique advance number after 5 attempts. Please retry.")
    
    def get_by_id(self, advance_id: int) -> Optional[models.SupplierAdvancePayment]:
        return self.db.query(models.SupplierAdvancePayment).options(
            joinedload(models.SupplierAdvancePayment.applications)
        ).filter(models.SupplierAdvancePayment.id == advance_id).first()
    
    def get_by_advance_no(self, advance_no: str) -> Optional[models.SupplierAdvancePayment]:
        return self.db.query(models.SupplierAdvancePayment).filter(
            models.SupplierAdvancePayment.advance_no == advance_no
        ).first()
    
    def get_all(self, filters: schemas.SupplierAdvancePaymentListFilter) -> List[models.SupplierAdvancePayment]:
        query = self.db.query(models.SupplierAdvancePayment).options(
            joinedload(models.SupplierAdvancePayment.supplier)
        )
        
        if filters.supplier_id:
            query = query.filter(models.SupplierAdvancePayment.supplier_id == filters.supplier_id)
        if filters.branch_code:
            query = query.filter(models.SupplierAdvancePayment.branch_code == filters.branch_code)
        if filters.is_fully_applied is not None:
            query = query.filter(models.SupplierAdvancePayment.is_fully_applied == filters.is_fully_applied)
        if filters.date_from:
            query = query.filter(models.SupplierAdvancePayment.payment_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.SupplierAdvancePayment.payment_date <= filters.date_to)
        
        return query.order_by(models.SupplierAdvancePayment.created_at.desc()
        ).offset(filters.skip).limit(filters.limit).all()
    
    def get_active_by_supplier(self, supplier_id: int) -> List[models.SupplierAdvancePayment]:
        """Get all active advance payments with available balance for a supplier"""
        return self.db.query(models.SupplierAdvancePayment).filter(
            models.SupplierAdvancePayment.supplier_id == supplier_id,
            models.SupplierAdvancePayment.is_fully_applied == False,
            models.SupplierAdvancePayment.remaining_amount > 0
        ).order_by(models.SupplierAdvancePayment.payment_date).all()
    
    def get_balance_by_supplier(self, supplier_id: int) -> float:
        """Get total available advance balance for a supplier"""
        result = self.db.query(func.sum(models.SupplierAdvancePayment.remaining_amount)).filter(
            models.SupplierAdvancePayment.supplier_id == supplier_id,
            models.SupplierAdvancePayment.is_fully_applied == False
        ).scalar()
        return float(result) if result else 0.0
    
    def update(self, advance_id: int, data: schemas.SupplierAdvancePaymentUpdate) -> Optional[models.SupplierAdvancePayment]:
        db_advance = self.db.query(models.SupplierAdvancePayment).filter(
            models.SupplierAdvancePayment.id == advance_id
        ).first()
        
        if db_advance and not db_advance.is_fully_applied:
            update_data = data.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                setattr(db_advance, field, value)
            self.db.commit()
            self.db.refresh(db_advance)
        return db_advance
    
    def apply_to_grn(self, advance_id: int, application_amount: float) -> Optional[models.SupplierAdvancePayment]:
        """Apply advance to GRN - reduce remaining balance (row-locked to prevent race conditions)"""
        # SELECT FOR UPDATE to prevent concurrent applications from overwriting each other
        db_advance = self.db.query(models.SupplierAdvancePayment).filter(
            models.SupplierAdvancePayment.id == advance_id
        ).with_for_update().first()
        
        if db_advance:
            new_applied = float(db_advance.applied_amount) + application_amount
            new_remaining = float(db_advance.original_amount) - new_applied
            
            # Re-validate balance under lock to prevent over-application
            if new_remaining < 0:
                raise ValueError(
                    f"Insufficient advance balance. Available: {float(db_advance.remaining_amount)}, Requested: {application_amount}"
                )
            
            db_advance.applied_amount = new_applied
            db_advance.remaining_amount = new_remaining
            
            # Update status if fully applied
            if db_advance.remaining_amount <= 0:
                db_advance.is_fully_applied = True
                db_advance.remaining_amount = 0
            
            self.db.commit()
            self.db.refresh(db_advance)
        return db_advance
    
    def delete(self, advance_id: int) -> bool:
        """Delete an advance payment (only if no applications)"""
        db_advance = self.db.query(models.SupplierAdvancePayment).filter(
            models.SupplierAdvancePayment.id == advance_id
        ).first()
        
        if db_advance and float(db_advance.applied_amount) == 0:
            self.db.delete(db_advance)
            self.db.commit()
            return True
        return False


class SupplierAdvanceApplicationRepository:
    """Repository for Supplier Advance Applications"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, data: schemas.SupplierAdvanceApplicationCreate, created_by: Optional[int] = None) -> models.SupplierAdvanceApplication:
        db_application = models.SupplierAdvanceApplication(
            advance_id=data.advance_id,
            grn_id=data.grn_id,
            applied_amount=data.applied_amount,
            application_date=data.application_date,
            remarks=data.remarks
        )
        self.db.add(db_application)
        self.db.commit()
        self.db.refresh(db_application)
        return db_application
    
    def get_by_id(self, application_id: int) -> Optional[models.SupplierAdvanceApplication]:
        return self.db.query(models.SupplierAdvanceApplication).filter(
            models.SupplierAdvanceApplication.id == application_id
        ).first()
    
    def get_by_advance(self, advance_id: int) -> List[models.SupplierAdvanceApplication]:
        return self.db.query(models.SupplierAdvanceApplication).filter(
            models.SupplierAdvanceApplication.advance_id == advance_id
        ).order_by(models.SupplierAdvanceApplication.application_date).all()
    
    def get_by_grn(self, grn_id: int) -> List[models.SupplierAdvanceApplication]:
        return self.db.query(models.SupplierAdvanceApplication).filter(
            models.SupplierAdvanceApplication.grn_id == grn_id
        ).all()
    
    def get_total_by_grn(self, grn_id: int) -> float:
        """Get total advance applications applied to a GRN"""
        result = self.db.query(func.sum(models.SupplierAdvanceApplication.applied_amount)).filter(
            models.SupplierAdvanceApplication.grn_id == grn_id
        ).scalar()
        return float(result) if result else 0.0

