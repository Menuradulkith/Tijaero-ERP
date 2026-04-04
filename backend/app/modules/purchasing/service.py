from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal
from . import models, schemas, repository
from fastapi import HTTPException, status
from app.core import timezone as tz
from app.common.audit import log_audit
from app.common.enums import PurchaseOrderStatus, DocumentStatus, StockStatus
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus

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
            
            # Use the same session (self.repo.db) to avoid TOCTOU race conditions
            pending_orders = self.repo.db.query(models.PurchasingOrder).filter(
                (models.PurchasingOrder.first_suppliers_id == supplier_id) | 
                (models.PurchasingOrder.second_suppliers_id == supplier_id),
                models.PurchasingOrder.status.in_([
                    PurchaseOrderStatus.PENDING,
                    PurchaseOrderStatus.APPROVED,
                    PurchaseOrderStatus.PENDING_APPROVAL,
                ])
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
        self.db = db
        self.repo = repository.PurchasingOrderRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
    
    def check_daily_limit(self, branch_code: str, target_date: date = None) -> schemas.DailyPOLimitCheck:
        if target_date is None:
            target_date = tz.today()
        
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
    
    def create_order(self, order: schemas.PurchasingOrderCreate, created_by: int = 1) -> models.PurchasingOrder:
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
        
        # All orders start with pending_approval status (both credit and non-credit)
        initial_status = PurchaseOrderStatus.PENDING_APPROVAL
        
        # For credit purchases, perform credit check to warn about limit
        if order.payment_method.lower() == "credit":
            from app.modules.purchasing.credit_service import SupplierCreditService
            credit_service = SupplierCreditService()
            credit_check = credit_service.check_po_credit(
                self.repo.db, order.first_suppliers_id, po_total, order.payment_method
            )
            # Note: Credit check is informational; status remains pending_approval
        
        # Create the order with pending_approval status
        created_order = self.repo.create(order, initial_status=initial_status)

        # Create approval record for the new PO
        approval_record = approval_service.create_approval_request(
            db=self.db,
            approval_type=ApprovalType.PURCHASE_ORDER,
            reference_id=created_order.id,
            reference_no=created_order.purchasing_order_no,
            branch_code=order.branch_code,
            requested_by=created_by,
            remarks=f"Purchase order pending approval.",
            approval_group="purchasing_approvers"
        )
        created_order.approval_id = approval_record.id
        self.db.commit()
        self.db.refresh(created_order)
        log_audit(self.db, user_id=created_by, action="create", entity_type="purchase_order", entity_id=created_order.id, changes={"status": initial_status, "po_no": created_order.purchasing_order_no})
        self.db.commit()

        # If PO was created from a proforma/quotation, update the quote status to po_created
        if order.sales_quote_id:
            try:
                from app.modules.sales.quotation_models import SalesQuote, QuoteStatus
                linked_quote = self.db.query(SalesQuote).filter(SalesQuote.id == order.sales_quote_id).first()
                if linked_quote and linked_quote.status not in [
                    QuoteStatus.PO_CREATED.value,
                    QuoteStatus.ITEM_RECEIVED.value,
                    QuoteStatus.CONVERTED_TO_INVOICE.value,
                    QuoteStatus.CANCELLED.value,
                ]:
                    linked_quote.status = QuoteStatus.PO_CREATED.value
                    linked_quote.linked_po_id = created_order.id
                    linked_quote.po_created_date = tz.now()
                    self.db.commit()
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Failed to update linked quote status: {e}")

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
        
        if existing_po.status in (PurchaseOrderStatus.PARTIALLY_COMPLETED, PurchaseOrderStatus.COMPLETED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit purchase order with status '{existing_po.status}'. Purchase orders that have received goods (GRN created) cannot be edited."
            )
        
        # Prevent manual status update to 'approved' via generic update endpoint
        if order_update.status == "approved" and existing_po.status in ["pending", "pending_approval"]:
             raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Purchase orders cannot be manually approved. Please use the Approval Dashboard."
            )
        
        # If updating suppliers, verify they are active
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
        
        # Track if this was an approved PO being edited
        was_approved = existing_po.status == "approved"
        
        order = self.repo.update(order_id, order_update)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        
        # If an approved PO was edited, reset it back to pending_approval
        if was_approved:
            from app.modules.common.models import Approvals
            
            order.status = PurchaseOrderStatus.PENDING_APPROVAL
            
            # Reset the existing approval record back to pending
            if order.approval_id:
                approval_record = self.db.query(Approvals).filter(Approvals.id == order.approval_id).first()
                if approval_record:
                    approval_record.status = ApprovalStatus.PENDING
                    approval_record.status_changed_by = None
                    approval_record.remark = "Re-approval required: Purchase order was edited after approval."
            else:
                # Create a new approval record if one doesn't exist
                approval_record = approval_service.create_approval_request(
                    db=self.db,
                    approval_type=ApprovalType.PURCHASE_ORDER,
                    reference_id=order.id,
                    reference_no=order.purchasing_order_no,
                    branch_code=order.branch_code,
                    requested_by=0,  # System-triggered re-approval
                    remarks="Re-approval required: Purchase order was edited after approval.",
                    approval_group="purchasing_approvers"
                )
                order.approval_id = approval_record.id
            
            self.db.commit()
            self.db.refresh(order)
        
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

    def approve_order(self, order_id: int, approve: bool, remarks: Optional[str] = None, user_id: int = 0) -> models.PurchasingOrder:
        """
        Approve or reject a purchase order.
        """
        from app.modules.common.models import Approvals
        from decimal import Decimal
        from sqlalchemy import func
        from app.modules.purchasing.credit_service import supplier_credit_service
        from app.modules.purchasing.models import PurchasingOrderItems
        
        # Lock the order row to prevent concurrent approval
        order = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == order_id
        ).with_for_update().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        
        # Determine if we can approve based on current status
        if order.status != "pending_approval":
            # Allow approving if it's just 'pending' (legacy) or 'pending_approval'
            if order.status != "pending":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Order is not pending approval. Current status: {order.status}"
                )
            
        # Perform credit check if approving
        if approve and order.payment_method and order.payment_method.lower() == "credit":
            
            po_total = self.db.query(
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
            ).filter(
                PurchasingOrderItems.purchasingorders_id == order_id
            ).scalar() or Decimal("0")
            
            credit_check = supplier_credit_service.check_po_credit(
                self.db, order.first_suppliers_id, po_total, order.payment_method
            )
            
            if credit_check["requires_approval"]:
                if remarks:
                    remarks += f" [Credit Limit Exceeded: {credit_check['message']}]"
                else:
                    remarks = f"Credit Limit Exceeded: {credit_check['message']}"

        # Update Approval Record in approvals table
        if order.approval_id:
            # Lock the approval record to prevent concurrent updates
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == order.approval_id
            ).with_for_update().first()
            if approval_record:
                # If approval record exists, update it
                if approval_record.status == ApprovalStatus.PENDING:
                    approval_record.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
                    approval_record.status_changed_by = user_id
                    approval_record.remark = remarks or f"{'Approved' if approve else 'Rejected'} by user {user_id}"
        
        # Update PO Status
        if approve:
            order.status = PurchaseOrderStatus.APPROVED
        else:
            order.status = PurchaseOrderStatus.REJECTED
            
        self.db.commit()
        self.db.refresh(order)
        return order

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

        initial_status = DocumentStatus.PENDING if return_data.require_approval else DocumentStatus.APPROVED
        stock_status = "return_pending" if return_data.require_approval else "returned_to_supplier"

        now = tz.now()
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
        
        # Create approval record for purchase returns that require approval
        if return_data.require_approval:
            approval_record = approval_service.create_approval_request(
                db=self.db,
                approval_type=ApprovalType.PURCHASE_RETURN,
                reference_id=db_return.id,
                reference_no=return_no,
                branch_code=return_data.branch_code,
                requested_by=0,  # TODO: Get from current user
                remarks=f"Purchase return pending approval.",
                approval_group="purchasing_approvers"
            )
            db_return.approval_id = approval_record.id
        
        self.db.commit()
        self.db.refresh(db_return)

        if not return_data.require_approval:
            po = self.db.query(models.PurchasingOrder).filter(
                models.PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if po and po.first_suppliers_id:
                credit_service = SupplierCreditService()
                credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
                self.db.commit()

            # ── GL Hook: Post purchase return to GL ──
            try:
                from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                gl_svc = PurchaseExpensePayrollGL(self.db)
                gl_svc.post_purchase_return_to_gl(db_return, user_id=0)
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Purchase return GL posting failed: {e}")
        
        return db_return
    
    def approve_return(self, return_id: int, approve: bool, remarks: Optional[str] = None, user_id: int = 0) -> models.PurchasingReturn:
        """
        Approve or reject a purchase return through the centralized approval system.
        Uses SELECT FOR UPDATE to prevent double-approval race conditions.
        """
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock
        from app.modules.common.models import Approvals
        
        # Lock the return row to prevent concurrent approval processing
        return_record = self.db.query(models.PurchasingReturn).filter(
            models.PurchasingReturn.id == return_id
        ).with_for_update().first()
        if not return_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase return with id {return_id} not found"
            )
        
        if return_record.status != DocumentStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Return is not pending approval. Current status: {return_record.status}"
            )
        
        now = tz.now()
        
        # Update approval record
        if return_record.approval_id:
            # Lock the approval record to prevent concurrent updates
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == return_record.approval_id
            ).with_for_update().first()
            if approval_record:
                if approval_record.status != ApprovalStatus.PENDING:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                approval_record.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
                approval_record.status_changed_by = user_id
                approval_record.remark = remarks or f"{'Approved' if approve else 'Rejected'} by user {user_id}"
        
        if approve:
            return_record.status = DocumentStatus.APPROVED
            return_record.approved_date = now
            if remarks:
                return_record.remark = (return_record.remark or "") + f" | Approval note: {remarks}"
            
            for item in return_record.items:
                if item.sales_stock_id:
                    # Lock the stock item row before updating
                    stock_item = self.db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
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
            return_record.status = DocumentStatus.REJECTED
            if remarks:
                return_record.remark = (return_record.remark or "") + f" | Rejection reason: {remarks}"

            for item in return_record.items:
                if item.sales_stock_id:
                    # Lock the stock item row before updating
                    stock_item = self.db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                    if stock_item:
                        stock_item.status = StockStatus.AVAILABLE
                        stock_item.purchase_return_id = None
        
        self.db.commit()
        self.db.refresh(return_record)

        # ── GL Hook: Post approved purchase return to GL ──
        if approve and return_record.status == "approved":
            try:
                from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                gl_svc = PurchaseExpensePayrollGL(self.db)
                gl_svc.post_purchase_return_to_gl(return_record, user_id=user_id)
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Purchase return GL posting failed: {e}")

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
        
        # If PO is linked to a sales quote/proforma and is completed, update quote status to item_received
        if po_status == "completed" and po.sales_quote_id:
            try:
                from app.modules.sales.quotation_models import SalesQuote, QuoteStatus
                linked_quote = self.db.query(SalesQuote).filter(SalesQuote.id == po.sales_quote_id).first()
                if linked_quote and linked_quote.status == QuoteStatus.PO_CREATED.value:
                    linked_quote.status = QuoteStatus.ITEM_RECEIVED.value
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Failed to update linked quote status on GRN: {e}")
        
        # Update credit balance in the same transaction for atomicity
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        
        # ═══════════════════════════════════════════════════════════════
        # Gap P1: Auto-deduct supplier advance when PO payment_method
        # is "advance". Finds active advances for the supplier and
        # auto-applies them against this GRN.
        # ═══════════════════════════════════════════════════════════════
        if po.payment_method and po.payment_method.lower() == "advance":
            # Calculate GRN total from PO items
            po_items = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.purchasingorders_id == po.id
            ).all()
            grn_total = sum(
                Decimal(str(item.quantity)) * item.unit_price
                for item in po_items
            ) if po_items else Decimal("0")
            
            if grn_total > 0:
                # Get IDs of active (non-fully-applied) advances for this supplier, oldest first
                advance_ids = self.db.query(models.SupplierAdvancePayment.id).filter(
                    models.SupplierAdvancePayment.supplier_id == po.first_suppliers_id,
                    models.SupplierAdvancePayment.is_fully_applied == False
                ).order_by(models.SupplierAdvancePayment.payment_date.asc()).all()
                advance_ids = [a[0] for a in advance_ids]
                
                remaining_to_apply = grn_total
                for advance_id in advance_ids:
                    if remaining_to_apply <= 0:
                        break
                    # Lock each advance row individually to prevent race condition
                    advance = self.db.query(models.SupplierAdvancePayment).filter(
                        models.SupplierAdvancePayment.id == advance_id
                    ).with_for_update().first()
                    if not advance or advance.is_fully_applied:
                        continue
                    available = Decimal(str(advance.remaining_amount))
                    apply_amount = min(available, remaining_to_apply)
                    if apply_amount > 0:
                        # Create application record
                        application = models.SupplierAdvanceApplication(
                            advance_id=advance.id,
                            grn_id=created_grn.id,
                            applied_amount=apply_amount,
                            application_date=tz.today(),
                            remarks=f"Auto-applied during GRN {created_grn.good_received_no} creation"
                        )
                        self.db.add(application)
                        
                        # Update advance balances
                        advance.applied_amount = Decimal(str(advance.applied_amount)) + apply_amount
                        advance.remaining_amount = Decimal(str(advance.original_amount)) - Decimal(str(advance.applied_amount))
                        if advance.remaining_amount <= 0:
                            advance.remaining_amount = Decimal("0")
                            advance.is_fully_applied = True
                        
                        remaining_to_apply -= apply_amount
                
                import logging
                applied_total = grn_total - remaining_to_apply
                if applied_total > 0:
                    logging.getLogger(__name__).info(
                        f"Auto-applied Rs. {applied_total:,.2f} from supplier advances to GRN {created_grn.good_received_no}"
                    )
        
        self.db.commit()
        self.db.refresh(created_grn)
        
        # ── GL Auto-Posting: Scenario 31 – GRN Received ────────────────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_grn_to_gl(created_grn, user_id=grn.created_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for GRN {created_grn.good_received_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
        # ────────────────────────────────────────────────────────────────
        
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
        
        if not items:
            return []
        
        # Batch-load all PO items for these GRN items in one query
        po_item_ids = [item.purchasing_order_items_id for item in items if item.purchasing_order_items_id]
        po_items_map = {}
        if po_item_ids:
            po_items = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.id.in_(po_item_ids)
            ).all()
            po_items_map = {pi.id: pi for pi in po_items}
        
        # Batch-load all products referenced by PO items in one query
        product_ids = [pi.product_id for pi in po_items_map.values() if pi.product_id]
        products_map = {}
        if product_ids:
            products = self.db.query(Product).filter(Product.id.in_(product_ids)).all()
            products_map = {p.id: p.name for p in products}
        
        # Batch-load barcodes that exist in sales stock for this GRN
        all_barcodes = [item.barcode for item in items]
        stock_barcodes = set(
            row[0] for row in self.db.query(SalesStock.barcode).filter(
                SalesStock.good_received_note_id == grn_id,
                SalesStock.barcode.in_(all_barcodes)
            ).all()
        )
        
        # Batch-load barcodes that exist in company assets for this GRN
        asset_barcodes = set(
            row[0] for row in self.db.query(CompanyAssets.barcode).filter(
                CompanyAssets.good_received_note_id == grn_id,
                CompanyAssets.barcode.in_(all_barcodes)
            ).all()
        )
        
        result = []
        for item in items:
            po_item = po_items_map.get(item.purchasing_order_items_id)
            product_id = po_item.product_id if po_item else None
            product_name = products_map.get(product_id) if product_id else None
            
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
                "saved_to_sales_stock": item.barcode in stock_barcodes,
                "saved_to_company_assets": item.barcode in asset_barcodes,
            })
        
        return result
    
    def barcode_exists(self, barcode: str) -> bool:
        return self.db.query(models.GoodReceivedItems).filter(
            models.GoodReceivedItems.barcode == barcode
        ).first() is not None
    
    def get_items_by_po(self, po_id: int) -> List[models.GoodReceivedItems]:
        """Get all GRN items for a specific Purchase Order"""
        # Get all GRN items that belong to this PO's items
        return self.db.query(models.GoodReceivedItems).join(
            models.PurchasingOrderItems,
            models.GoodReceivedItems.purchasing_order_items_id == models.PurchasingOrderItems.id
        ).filter(
            models.PurchasingOrderItems.purchasingorders_id == po_id
        ).all()
    
    def create_item(self, item: schemas.GoodReceivedItemCreate) -> models.GoodReceivedItems:
        if self.barcode_exists(item.barcode):
            raise ValueError(f"Barcode '{item.barcode}' already exists in Good Received Items")
        
        created_item = self.repo.create_item(item)
        
        # Update PO status after creating GRN item
        # Get the PO ID from the item's PO item reference
        if item.purchasing_order_items_id:
            po_item = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.id == item.purchasing_order_items_id
            ).first()
            
            if po_item:
                # Update the PO status based on received items
                po_status = self._determine_po_completion_status(po_item.purchasingorders_id)
                po = self.db.query(models.PurchasingOrder).filter(
                    models.PurchasingOrder.id == po_item.purchasingorders_id
                ).first()
                
                if po:
                    po.status = po_status
                    self.db.commit()
        
        return created_item


class SupplierCreditsSettleService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierCreditsSettleRepository(db)
        self.db = db
    
    def create(self, settle: schemas.SupplierCreditsSettleCreate) -> models.SupplierCreditsSettle:

        from app.modules.purchasing.credit_service import SupplierCreditService

        # Lock supplier row to prevent concurrent credit balance overwrites
        self.db.query(models.Supplier).filter(
            models.Supplier.id == settle.suppliers_id
        ).with_for_update().first()

        created_settle = self.repo.create(settle)

        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, settle.suppliers_id)
        self.db.commit()
        
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
    
    def list_settlements_with_transactions(self, skip: int = 0, limit: int = 100) -> List[schemas.SupplierCreditsSettleWithTransactions]:
        """List settlements with eagerly loaded transactions (batch query, no N+1)."""
        settlements = self.repo.get_all(skip, limit)
        if not settlements:
            return []
        
        settle_ids = [s.id for s in settlements]
        
        # Batch-load all transactions for all settlements in one query
        all_transactions = self.db.query(models.SupplierCreditsSettleTransaction).filter(
            models.SupplierCreditsSettleTransaction.supplier_credit_settle_id.in_(settle_ids)
        ).all()
        
        # Batch-load all GRNs referenced by transactions
        grn_ids = list(set(t.good_received_id for t in all_transactions if t.good_received_id))
        grns_map = {}
        if grn_ids:
            grns = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id.in_(grn_ids)
            ).all()
            grns_map = {g.id: g for g in grns}
        
        # Batch-load all POs referenced by GRNs
        po_ids = list(set(g.purchasingorders_id for g in grns_map.values() if g.purchasingorders_id))
        pos_map = {}
        if po_ids:
            pos = self.db.query(models.PurchasingOrder).filter(
                models.PurchasingOrder.id.in_(po_ids)
            ).all()
            pos_map = {p.id: p for p in pos}
        
        # Group transactions by settlement ID
        txns_by_settle = {}
        for t in all_transactions:
            txns_by_settle.setdefault(t.supplier_credit_settle_id, []).append(t)
        
        results = []
        for settle in settlements:
            enriched_transactions = []
            for t in txns_by_settle.get(settle.id, []):
                grn = grns_map.get(t.good_received_id)
                grn_no = grn.good_received_no if grn else None
                po = pos_map.get(grn.purchasingorders_id) if grn and grn.purchasingorders_id else None
                po_no = po.purchasing_order_no if po else None
                invoice_no = po.purchasing_invoice_no if po else None
                
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
            
            results.append(schemas.SupplierCreditsSettleWithTransactions(
                id=settle.id,
                supplier_credits_settle_no=settle.supplier_credits_settle_no,
                branch_code=settle.branch_code,
                created_date=settle.created_date,
                suppliers_id=settle.suppliers_id,
                status=settle.status,
                verified_by=settle.verified_by,
                verified_date=settle.verified_date,
                transactions=enriched_transactions
            ))
        
        return results
    
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
            status=settle.status,
            verified_by=settle.verified_by,
            verified_date=settle.verified_date,
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
        self.db.commit()
        
        return result
    
    def verify_settlement(self, settle_id: int, verified_by: int = None) -> models.SupplierCreditsSettle:
        """Verify a credit settlement"""
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        if settle.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only pending settlements can be verified. Current status: {settle.status}"
            )
        
        from datetime import datetime
        settle.status = "verified"
        settle.verified_by = verified_by
        settle.verified_date = tz.now()
        self.db.commit()
        self.db.refresh(settle)
        
        # ── GL Auto-Posting: Scenario 31 – Credit Settlement Verified ──
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_credit_settlement_to_gl(settle, user_id=verified_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for credit settlement {settle.supplier_credits_settle_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
        # ────────────────────────────────────────────────────────────────
        
        return settle
    
    def cancel_settlement(self, settle_id: int, verified_by: int = None) -> models.SupplierCreditsSettle:
        """Cancel a credit settlement"""
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        if settle.status not in ["pending", "verified"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Settlement cannot be cancelled. Current status: {settle.status}"
            )
        
        from datetime import datetime
        settle.status = DocumentStatus.CANCELLED
        settle.verified_by = verified_by
        settle.verified_date = tz.now()
        self.db.commit()
        self.db.refresh(settle)
        
        return settle


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
        
        result = self.repo.verify(payment_id, verified_by)
        
        # ── GL Auto-Posting: Scenario 31 – Supplier Payment Verified ──
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_supplier_payment_to_gl(result, user_id=verified_by)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for supplier payment {result.payment_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
        # ────────────────────────────────────────────────────────────────
        
        return result
    
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


class SupplierAdvancePaymentService:
    """
    Service for Supplier Advance Payments
    
    ERP Best Practice Workflow:
    1. Create advance payment when paying supplier before goods received
    2. Track available balance per supplier
    3. Apply advances against GRNs when goods are received
    4. Delete unused advances if needed
    """
    
    def __init__(self, db: Session):
        self.db = db
        self.repo = repository.SupplierAdvancePaymentRepository(db)
        self.application_repo = repository.SupplierAdvanceApplicationRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
    
    def create_advance(self, data: schemas.SupplierAdvancePaymentCreate, created_by: Optional[int] = None) -> models.SupplierAdvancePayment:
        # Validate supplier exists
        supplier = self.supplier_repo.get_by_id(data.supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {data.supplier_id} not found"
            )
        
        advance = self.repo.create(data, created_by)
        
        # ── GL Auto-Posting: Scenario 31 – Supplier Advance Created ───
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_supplier_advance_to_gl(advance, user_id=created_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for advance {advance.advance_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
        # ────────────────────────────────────────────────────────────────
        
        return advance
    
    def get_advance(self, advance_id: int) -> models.SupplierAdvancePayment:
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        return advance
    
    def list_advances(self, filters: schemas.SupplierAdvancePaymentListFilter) -> List[models.SupplierAdvancePayment]:
        return self.repo.get_all(filters)
    
    def get_supplier_balance(self, supplier_id: int) -> schemas.SupplierAdvanceBalanceSummary:
        """Get advance payment balance summary for a supplier"""
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        
        # Get all active advances
        active_advances = self.repo.get_active_by_supplier(supplier_id)
        
        # Calculate totals
        total_advances = sum(float(a.original_amount) for a in active_advances)
        total_applied = sum(float(a.applied_amount) for a in active_advances)
        available_balance = sum(float(a.remaining_amount) for a in active_advances)
        
        return schemas.SupplierAdvanceBalanceSummary(
            supplier_id=supplier_id,
            supplier_name=supplier.full_name,
            total_advances=total_advances,
            total_applied=total_applied,
            available_balance=available_balance,
            active_advance_count=len(active_advances),
            advances=active_advances
        )
    
    def update_advance(self, advance_id: int, data: schemas.SupplierAdvancePaymentUpdate) -> models.SupplierAdvancePayment:
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        
        if advance.is_fully_applied:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot update fully applied advance payment"
            )
        
        updated = self.repo.update(advance_id, data)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update advance payment"
            )
        return updated
    
    def delete_advance(self, advance_id: int) -> bool:
        """Delete an advance payment (only if no applications)"""
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        
        if float(advance.applied_amount) > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete advance payment that has applications"
            )
        
        return self.repo.delete(advance_id)
    
    def create_application(self, data: schemas.SupplierAdvanceApplicationCreate, created_by: Optional[int] = None) -> models.SupplierAdvanceApplication:
        """
        Create an application to apply advance against a GRN
        This reduces the advance remaining balance and marks the corresponding GRN as partially/fully paid
        """
        # Validate advance exists and is not fully applied
        advance = self.repo.get_by_id(data.advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {data.advance_id} not found"
            )
        
        if advance.is_fully_applied:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot apply from a fully applied advance payment"
            )
        
        # Check sufficient balance
        if float(data.applied_amount) > float(advance.remaining_amount):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Application amount ({data.applied_amount}) exceeds available balance ({advance.remaining_amount})"
            )
        
        # Create the application
        application = self.application_repo.create(data, created_by)
        
        # Update the advance balance
        self.repo.apply_to_grn(data.advance_id, float(data.applied_amount))
        
        # ── GL Auto-Posting: Scenario 31 – Advance Applied to GRN ─────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_advance_application_to_gl(application, user_id=created_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for advance application failed (non-blocking): {gl_err}")
            self.db.rollback()
        # ────────────────────────────────────────────────────────────────
        
        return application
    
    def get_applications_by_advance(self, advance_id: int) -> List[schemas.SupplierAdvanceApplication]:
        """Get all applications for an advance with enriched GRN details"""
        applications = self.application_repo.get_by_advance(advance_id)
        result = []
        for app in applications:
            # Get GRN number
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == app.grn_id
            ).first()
            grn_no = grn.good_received_no if grn else None
            
            # Get Advance number
            advance = self.repo.get_by_id(app.advance_id)
            advance_no = advance.advance_no if advance else None
            
            result.append(schemas.SupplierAdvanceApplication(
                id=app.id,
                advance_id=app.advance_id,
                grn_id=app.grn_id,
                applied_amount=app.applied_amount,
                application_date=app.application_date,
                remarks=app.remarks,
                created_at=app.created_at,
                updated_at=app.updated_at,
                grn_no=grn_no,
                advance_no=advance_no,
            ))
        return result
    
    def get_applications_by_grn(self, grn_id: int) -> List[schemas.SupplierAdvanceApplication]:
        """Get all applications for a GRN with enriched advance details"""
        applications = self.application_repo.get_by_grn(grn_id)
        result = []
        for app in applications:
            # Get GRN number
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == app.grn_id
            ).first()
            grn_no = grn.good_received_no if grn else None
            
            # Get Advance number
            advance = self.repo.get_by_id(app.advance_id)
            advance_no = advance.advance_no if advance else None
            
            result.append(schemas.SupplierAdvanceApplication(
                id=app.id,
                advance_id=app.advance_id,
                grn_id=app.grn_id,
                applied_amount=app.applied_amount,
                application_date=app.application_date,
                remarks=app.remarks,
                created_at=app.created_at,
                updated_at=app.updated_at,
                grn_no=grn_no,
                advance_no=advance_no,
            ))
        return result
    
    def get_total_advance_applied_to_grn(self, grn_id: int) -> float:
        """Get total advance applications applied to a GRN"""
        return self.application_repo.get_total_by_grn(grn_id)

