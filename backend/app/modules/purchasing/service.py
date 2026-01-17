from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from . import models, schemas, repository
from fastapi import HTTPException, status

DAILY_PO_LIMIT_PER_BRANCH = 5

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
        if supplier_update.active is False:
            supplier = self.repo.get_by_id(supplier_id)
            if not supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Supplier with id {supplier_id} not found"
                )
            
            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                pending_orders = db.query(models.PurchasingOrder).filter(
                    (models.PurchasingOrder.first_suppliers_id == supplier_id) | 
                    (models.PurchasingOrder.second_suppliers_id == supplier_id),
                    models.PurchasingOrder.status.in_(["pending", "approved"])
                ).count()
                
                if pending_orders > 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Cannot deactivate supplier '{supplier.full_name}': {pending_orders} pending purchase order(s) exist. Complete or cancel all pending orders first."
                    )
                
                if supplier.left_credit_amount and supplier.left_credit_amount < supplier.initial_credit_amount:
                    outstanding = supplier.initial_credit_amount - supplier.left_credit_amount
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Cannot deactivate supplier '{supplier.full_name}': Outstanding credit balance of Rs. {outstanding:,.2f}. Settle all dues first."
                    )
            finally:
                db.close()
        
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
    
    def check_daily_limit(self, branch_code: str, target_date: date = None) -> schemas.DailyPOLimitCheck:
        if target_date is None:
            target_date = date.today()
        
        count = self.repo.count_daily_orders_by_branch(branch_code, target_date)
        remaining = max(0, DAILY_PO_LIMIT_PER_BRANCH - count)
        can_create = count < DAILY_PO_LIMIT_PER_BRANCH
        
        if can_create:
            message = f"Branch {branch_code} has created {count} PO(s) today. {remaining} remaining."
        else:
            message = f"Daily limit of {DAILY_PO_LIMIT_PER_BRANCH} POs reached for branch {branch_code}. Cannot create more POs today."
        
        return schemas.DailyPOLimitCheck(
            branch_code=branch_code,
            date=target_date,
            count=count,
            limit=DAILY_PO_LIMIT_PER_BRANCH,
            remaining=remaining,
            can_create=can_create,
            message=message
        )
    
    def create_order(self, order: schemas.PurchasingOrderCreate) -> models.PurchasingOrder:
        limit_check = self.check_daily_limit(order.branch_code)
        if not limit_check.can_create:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=limit_check.message
            )
        
        first_supplier = self.supplier_repo.get_by_id(order.first_suppliers_id)
        if not first_supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"First supplier with id {order.first_suppliers_id} not found"
            )
        if not first_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supplier '{first_supplier.full_name}' is inactive. Please reactivate the supplier before creating a purchase order."
            )
        
        second_supplier = self.supplier_repo.get_by_id(order.second_suppliers_id)
        if not second_supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Second supplier with id {order.second_suppliers_id} not found"
            )
        if not second_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supplier '{second_supplier.full_name}' is inactive. Please reactivate the supplier before creating a purchase order."
            )
        
        from decimal import Decimal
        po_total = sum(
            Decimal(str(item.quantity)) * item.unit_price 
            for item in order.items
        ) if order.items else Decimal("0")
        
        initial_status = "pending"
        
        if order.payment_method.lower() == "credit":
            from app.modules.purchasing.credit_service import SupplierCreditService
            credit_service = SupplierCreditService()
            credit_check = credit_service.check_po_credit(
                self.repo.db, order.first_suppliers_id, po_total, order.payment_method
            )
            
            if credit_check["requires_approval"]:
                initial_status = "pending_approval"
        
        created_order = self.repo.create(order, initial_status=initial_status)
        
        return created_order
    
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
        existing_po = self.repo.get_by_id(order_id)
        if not existing_po:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        
        if existing_po.status in ["partially_completed", "completed"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit purchase order with status '{existing_po.status}'. Purchase orders that have received goods (GRN created) cannot be edited."
            )
        
        if order_update.first_suppliers_id is not None:
            first_supplier = self.supplier_repo.get_by_id(order_update.first_suppliers_id)
            if not first_supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"First supplier with id {order_update.first_suppliers_id} not found"
                )
            if not first_supplier.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{first_supplier.full_name}' is inactive. Please reactivate the supplier before updating the purchase order."
                )
        
        if order_update.second_suppliers_id is not None:
            second_supplier = self.supplier_repo.get_by_id(order_update.second_suppliers_id)
            if not second_supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Second supplier with id {order_update.second_suppliers_id} not found"
                )
            if not second_supplier.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{second_supplier.full_name}' is inactive. Please reactivate the supplier before updating the purchase order."
                )
        
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
    
    def validate_barcode_for_return(
        self, 
        barcode: str, 
        grn_id: int, 
        branch_code: str
    ) -> schemas.BarcodeValidationResponse:

        from app.modules.inventory.models import SalesStock
        from app.modules.products.models import Product
        stock_item = self.db.query(SalesStock).filter(
            SalesStock.barcode == barcode
        ).first()
        
        if not stock_item:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="Barcode not found in sales stock. This item was never received.",
                sales_stock_id=None,
                product_id=None,
                product_name=None,
                purchasing_price=None,
                status=None
            )

        if stock_item.status == "returned_to_supplier":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item has already been returned to supplier.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status == "return_pending":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item is already pending return approval.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status == "sold":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item has been sold and cannot be returned to supplier.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status in ("transferred", "damaged"):
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item has status '{stock_item.status}' and cannot be returned.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if not stock_item.is_active:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item is no longer active in stock.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.good_received_note_id != grn_id:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item belongs to a different GRN (ID: {stock_item.good_received_note_id}), not the selected one.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.branch_code != branch_code:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item belongs to branch '{stock_item.branch_code}', not '{branch_code}'.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        product = self.db.query(Product).filter(Product.id == stock_item.product_id).first()
        product_name = product.name if product else "Unknown"

        po_item = self.db.query(models.PurchasingOrderItems).filter(
            models.PurchasingOrderItems.id == stock_item.purchasing_order_items_id
        ).first()
        purchasing_price = po_item.unit_price if po_item else None

        return schemas.BarcodeValidationResponse(
            valid=True,
            barcode=barcode,
            message="Barcode is valid for return.",
            sales_stock_id=stock_item.id,
            product_id=stock_item.product_id,
            product_name=product_name,
            purchasing_price=purchasing_price,
            status=stock_item.status
        )
    
    def create_return(self, return_data: schemas.PurchasingReturnCreate) -> models.PurchasingReturn:

        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock
        from datetime import datetime
        import uuid

        grn = self.db.query(models.GoodReceivedNote).filter(
            models.GoodReceivedNote.id == return_data.goodreceivednote_id
        ).first()
        
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN {return_data.goodreceivednote_id} not found"
            )

        validated_items = []
        for item in return_data.items:
            validation = self.validate_barcode_for_return(
                item.barcode, 
                return_data.goodreceivednote_id, 
                return_data.branch_code
            )
            if not validation.valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Barcode validation failed: {validation.message}"
                )
            validated_items.append((item, validation))

        return_no = return_data.purchasing_return_no
        if not return_no:
            return_no = f"PR-{uuid.uuid4().hex[:8].upper()}"

        initial_status = "pending" if return_data.require_approval else "approved"
        stock_status = "return_pending" if return_data.require_approval else "returned_to_supplier"

        now = datetime.now()
        db_return = models.PurchasingReturn(
            purchasing_return_no=return_no,
            branch_code=return_data.branch_code,
            remark=return_data.remark,
            status=initial_status,
            added_date=now.date(),
            approved_date=now if not return_data.require_approval else None,
            goodreceivednote_id=return_data.goodreceivednote_id
        )
        self.db.add(db_return)
        self.db.flush() 
        
        for item, validation in validated_items:
            db_item = models.PurchasingReturnItems(
                purchasing_price=item.purchasing_price,
                return_price=item.return_price,
                barcode=item.barcode,
                branch_code=return_data.branch_code,
                added_date=now,
                product_id=item.product_id,
                purchasingreturn_id=db_return.id,
                sales_stock_id=validation.sales_stock_id
            )
            self.db.add(db_item)

            stock_item = self.db.query(SalesStock).filter(
                SalesStock.id == validation.sales_stock_id
            ).first()
            if stock_item:
                stock_item.status = stock_status
                stock_item.purchase_return_id = db_return.id
                if not return_data.require_approval:
                    stock_item.is_active = False
                    stock_item.returned_date = now
        
        self.db.commit()
        self.db.refresh(db_return)

        if not return_data.require_approval:
            po = self.db.query(models.PurchasingOrder).filter(
                models.PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if po and po.first_suppliers_id:
                credit_service = SupplierCreditService()
                credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        
        return db_return
    
    def approve_return(self, return_id: int, approve: bool, remarks: Optional[str] = None) -> models.PurchasingReturn:

        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock
        from datetime import datetime
        
        return_record = self.repo.get_by_id(return_id)
        if not return_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase return with id {return_id} not found"
            )
        
        if return_record.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Return is not pending approval. Current status: {return_record.status}"
            )
        
        now = datetime.now()
        
        if approve:
            return_record.status = "approved"
            return_record.approved_date = now
            if remarks:
                return_record.remark = (return_record.remark or "") + f" | Approval note: {remarks}"
            
            for item in return_record.items:
                if item.sales_stock_id:
                    stock_item = self.db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).first()
                    if stock_item:
                        stock_item.status = "returned_to_supplier"
                        stock_item.is_active = False
                        stock_item.returned_date = now

            grn = return_record.good_received_note
            if grn:
                po = self.db.query(models.PurchasingOrder).filter(
                    models.PurchasingOrder.id == grn.purchasingorders_id
                ).first()
                if po and po.first_suppliers_id:
                    credit_service = SupplierCreditService()
                    credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        else:
            return_record.status = "rejected"
            if remarks:
                return_record.remark = (return_record.remark or "") + f" | Rejection reason: {remarks}"

            for item in return_record.items:
                if item.sales_stock_id:
                    stock_item = self.db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).first()
                    if stock_item:
                        stock_item.status = "available"
                        stock_item.purchase_return_id = None
        
        self.db.commit()
        self.db.refresh(return_record)
        return return_record
    
    def get_return(self, return_id: int) -> models.PurchasingReturn:
        return_record = self.repo.get_by_id(return_id)
        if not return_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase return with id {return_id} not found"
            )
        return return_record
    
    def list_returns(self, skip: int = 0, limit: int = 100, status_filter: Optional[str] = None) -> List[models.PurchasingReturn]:
        query = self.db.query(models.PurchasingReturn)
        if status_filter:
            query = query.filter(models.PurchasingReturn.status == status_filter)
        return query.order_by(models.PurchasingReturn.added_date.desc()).offset(skip).limit(limit).all()

class GoodReceivedNoteService:
    def __init__(self, db: Session):
        self.repo = repository.GoodReceivedNoteRepository(db)
        self.db = db
    
    def create(self, grn: schemas.GoodReceivedNoteCreate, allow_credit_override: bool = False) -> models.GoodReceivedNote:
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.common.models import Locations
        from decimal import Decimal
        
        # Validate Location exists
        location = self.db.query(Locations).filter(Locations.id == grn.good_received_locations_id).first()
        if not location:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Location with id {grn.good_received_locations_id} not found"
            )
        
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        
        if not po:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order {grn.purchasingorders_id} not found"
            )

        first_supplier = self.db.query(models.Supplier).filter(
            models.Supplier.id == po.first_suppliers_id
        ).first()
        
        if first_supplier and not first_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create GRN: Supplier '{first_supplier.full_name}' is inactive. Please reactivate the supplier first."
            )
        
        second_supplier = self.db.query(models.Supplier).filter(
            models.Supplier.id == po.second_suppliers_id
        ).first()
        
        if second_supplier and not second_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create GRN: Supplier '{second_supplier.full_name}' is inactive. Please reactivate the supplier first."
            )

        if po.payment_method and po.payment_method.lower() == "credit":

            po_items = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.purchasingorders_id == po.id
            ).all()
            
            po_total = sum(
                Decimal(str(item.quantity)) * item.unit_price 
                for item in po_items
            ) if po_items else Decimal("0")
            
            credit_service = SupplierCreditService()
            credit_check = credit_service.check_grn_credit(
                self.db, po.first_suppliers_id, po_total, po.id, allow_credit_override
            )
            
            if not credit_check["can_post"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot post GRN: {credit_check['message']}. Current outstanding: Rs. {credit_check['credit_check']['current_outstanding']:,.2f}, Credit limit: Rs. {credit_check['credit_check']['max_credit_limit']:,.2f}. Contact manager for override."
                )
        
        import uuid
        from sqlalchemy.exc import IntegrityError

        def _new_grn_no() -> str:
            return f"GRN-{uuid.uuid4().hex[:8].upper()}"
        working_grn = grn
        if not getattr(working_grn, "good_received_no", None):
            working_grn = working_grn.model_copy(update={"good_received_no": _new_grn_no()})

        created_grn = None
        for _ in range(5):
            try:
                created_grn = self.repo.create(working_grn)
                break
            except IntegrityError as e:
                import logging
                logging.error(f"IntegrityError creating GRN: {str(e)}")
                self.db.rollback()
                working_grn = working_grn.model_copy(update={"good_received_no": _new_grn_no()})

        if created_grn is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GRN number conflict. Please retry."
            )

        po_status = self._determine_po_completion_status(po.id)
        po.status = po_status
        self.db.commit()
        
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        
        return created_grn
    
    def _determine_po_completion_status(self, po_id: int) -> str:
        po_items = self.db.query(models.PurchasingOrderItems).filter(
            models.PurchasingOrderItems.purchasingorders_id == po_id
        ).all()
        
        if not po_items:
            return "completed"

        all_fully_received = True
        any_received = False
        
        for po_item in po_items:
            ordered_qty = po_item.quantity
            
            received_qty = self.db.query(models.GoodReceivedItems).filter(
                models.GoodReceivedItems.purchasing_order_items_id == po_item.id,
                models.GoodReceivedItems.active == True
            ).count()
            
            if received_qty > 0:
                any_received = True
            
            if received_qty < ordered_qty:
                all_fully_received = False
        
        if all_fully_received and any_received:
            return "completed"
        elif any_received:
            return "partially_completed"
        else:
            return "approved"
    
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
        existing_grn = self.repo.get_by_id(grn_id)
        if not existing_grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN with id {grn_id} not found"
            )
        
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == existing_grn.purchasingorders_id
        ).first()
        
        if po and po.status == "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit GRN for fully completed purchase orders. Only partially received GRNs can be edited."
            )
        
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
        from app.modules.inventory.models import SalesStock, CompanyAssets
        from app.modules.products.models import Product
        
        items = self.repo.get_items(grn_id)
        grn = self.repo.get_by_id(grn_id)
        if not grn:
            return []
        
        result = []
        for item in items:
            po_item = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.id == item.purchasing_order_items_id
            ).first()
            
            product_id = po_item.product_id if po_item else None
            product_name = None
            if product_id:
                product = self.db.query(Product).filter(Product.id == product_id).first()
                product_name = product.name if product else None
            
            saved_to_sales_stock = self.db.query(SalesStock).filter(
                SalesStock.good_received_note_id == grn_id,
                SalesStock.barcode == item.barcode
            ).first() is not None
            
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
    
    def barcode_exists(self, barcode: str) -> bool:
        return self.db.query(models.GoodReceivedItems).filter(
            models.GoodReceivedItems.barcode == barcode
        ).first() is not None
    
    def create_item(self, item: schemas.GoodReceivedItemCreate) -> models.GoodReceivedItems:
        if self.barcode_exists(item.barcode):
            raise ValueError(f"Barcode '{item.barcode}' already exists in Good Received Items")
        return self.repo.create_item(item)


class SupplierCreditsSettleService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierCreditsSettleRepository(db)
        self.db = db
    
    def create(self, settle: schemas.SupplierCreditsSettleCreate) -> models.SupplierCreditsSettle:

        from app.modules.purchasing.credit_service import SupplierCreditService

        created_settle = self.repo.create(settle)

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

        enriched_transactions = []
        for t in transactions:
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == t.good_received_id
            ).first()
            
            grn_no = None
            po_no = None
            invoice_no = None
            
            if grn:
                grn_no = grn.good_received_no
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

        from app.modules.purchasing.credit_service import SupplierCreditService
        
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        supplier_id = settle.suppliers_id
        result = self.repo.delete(settle_id)
        
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, supplier_id)
        
        return result


class SupplierPaymentService:
    
    def __init__(self, db: Session):
        self.repo = repository.SupplierPaymentRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
        self.order_repo = repository.PurchasingOrderRepository(db)
        self.db = db
    
    def create_payment(self, payment: schemas.SupplierPaymentCreate, created_by: int = None) -> models.SupplierPayment:
        supplier = self.supplier_repo.get_by_id(payment.supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {payment.supplier_id} not found"
            )

        if payment.purchasing_order_id:
            order = self.order_repo.get_by_id(payment.purchasing_order_id)
            if not order:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Purchase order with id {payment.purchasing_order_id} not found"
                )

            if order.first_suppliers_id != payment.supplier_id and order.second_suppliers_id != payment.supplier_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Purchase order does not belong to this supplier"
                )
        
        return self.repo.create(payment, created_by)
    
    def get_payment(self, payment_id: int) -> schemas.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )

        supplier_name = None
        po_no = None
        
        if payment.supplier:
            supplier_name = payment.supplier.full_name
        
        if payment.purchasing_order:
            po_no = payment.purchasing_order.purchasing_order_no
        
        return schemas.SupplierPayment(
            id=payment.id,
            payment_no=payment.payment_no,
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
            status=payment.status,
            verified_by=payment.verified_by,
            verified_date=payment.verified_date,
            created_date=payment.created_date,
            created_by=payment.created_by,
            supplier_name=supplier_name,
            po_no=po_no
        )
    
    def list_payments(self, filters: schemas.SupplierPaymentListFilter) -> List[schemas.SupplierPayment]:
        payments = self.repo.get_all(filters)
        
        result = []
        for payment in payments:
            supplier_name = None
            po_no = None
            
            if payment.supplier:
                supplier_name = payment.supplier.full_name
            
            if payment.purchasing_order:
                po_no = payment.purchasing_order.purchasing_order_no
            
            result.append(schemas.SupplierPayment(
                id=payment.id,
                payment_no=payment.payment_no,
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
                status=payment.status,
                verified_by=payment.verified_by,
                verified_date=payment.verified_date,
                created_date=payment.created_date,
                created_by=payment.created_by,
                supplier_name=supplier_name,
                po_no=po_no
            ))
        
        return result
    
    def update_payment(self, payment_id: int, payment_update: schemas.SupplierPaymentUpdate) -> models.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update payment with status '{payment.status}'"
            )
        
        return self.repo.update(payment_id, payment_update)
    
    def verify_payment(self, payment_id: int, verified_by: int) -> models.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot verify payment with status '{payment.status}'"
            )
        
        return self.repo.verify(payment_id, verified_by)
    
    def cancel_payment(self, payment_id: int) -> models.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot cancel payment with status '{payment.status}'"
            )
        
        return self.repo.cancel(payment_id)
    
    def delete_payment(self, payment_id: int) -> bool:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete payment with status '{payment.status}'. Only pending payments can be deleted."
            )
        
        return self.repo.delete(payment_id)
    
    def get_supplier_payments(self, supplier_id: int, skip: int = 0, limit: int = 100) -> List[models.SupplierPayment]:
        return self.repo.get_by_supplier(supplier_id, skip, limit)
