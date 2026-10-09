from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Tuple
from app.core import timezone as tz

from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus
from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.sales.quotation_models import (DiscountType, QuoteStatus,
                                                SalesQuote,
                                                SalesQuoteItem)
from app.modules.sales.quotation_repository import sales_quote_repository
from app.modules.sales.quotation_schemas import (ConvertToInvoiceRequest,
                                                 CreatePartialSORequest,
                                                 CancelQuoteItemRequest,
                                                 DiscountTypeEnum,
                                                 QuoteStatusEnum,
                                                 QuoteTypeEnum,
                                                 SalesQuoteCreate,
                                                 SalesQuoteFilter,
                                                 SalesQuoteItemCreate,
                                                 SalesQuoteStatusUpdate,
                                                 SalesQuoteUpdate)
from fastapi import HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session


class SalesQuoteService:
    """Service layer for Sales Quote business logic"""
    
    def __init__(self):
        self.repository = sales_quote_repository
    
    # ==================== CRUD Operations ====================
    
    def get_all_quotes(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        quote_type: Optional[str] = None
    ) -> List[SalesQuote]:
        """Get all quotes"""
        quotes = self.repository.get_all(db, skip, limit, quote_type)
        self._attach_user_names(db, quotes)
        return quotes
    
    def get_quote_by_id(self, db: Session, quote_id: int) -> Optional[SalesQuote]:
        """Get quote by ID"""
        quote = self.repository.get_by_id_with_items(db, quote_id)
        if quote and quote.status not in (
            QuoteStatus.EXPIRED.value, QuoteStatus.COMPLETED.value,
            QuoteStatus.CANCELLED.value, QuoteStatus.REJECTED.value,
            QuoteStatus.SO_CREATED.value, QuoteStatus.REVISED.value,
            QuoteStatus.PARTIALLY_PROCESSED.value,
        ) and quote.valid_until < tz.today():
            quote.status = QuoteStatus.EXPIRED.value
            db.commit()
            db.refresh(quote)
        if quote:
            self._attach_related_purchase_orders(db, quote)
            self._attach_user_names(db, [quote])
        return quote

    def _attach_user_names(self, db: Session, quotes: List[SalesQuote]) -> None:
        """Resolve created_by/updated_by ids to display names, in one batched
        query (same pattern as SupplierService._attach_user_names), for the
        quote detail page's Activity History section."""
        from app.auth.models import User

        user_ids = {uid for q in quotes for uid in (q.created_by, q.updated_by) if uid}
        if not user_ids:
            for q in quotes:
                q.created_by_name = None
                q.updated_by_name = None
            return

        users = db.query(User).filter(User.id.in_(user_ids)).all()
        name_map = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in users
        }
        for q in quotes:
            q.created_by_name = name_map.get(q.created_by)
            q.updated_by_name = name_map.get(q.updated_by)

    def _attach_related_purchase_orders(self, db: Session, quote: SalesQuote) -> None:
        """Stamp quote.related_purchase_orders — every PO generated from this
        quote, for the quote detail page's traceability panel."""
        from sqlalchemy.orm import joinedload
        from sqlalchemy import func
        from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems, GoodReceivedItems

        orders = (
            db.query(PurchasingOrder)
            .options(joinedload(PurchasingOrder.first_supplier), joinedload(PurchasingOrder.items))
            .filter(PurchasingOrder.sales_quote_id == quote.id)
            .order_by(PurchasingOrder.id)
            .all()
        )

        po_ids = [po.id for po in orders]
        received_by_po = {}
        if po_ids:
            rows = (
                db.query(PurchasingOrderItems.purchasingorders_id, func.count(GoodReceivedItems.id))
                .join(GoodReceivedItems, GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id)
                .filter(
                    PurchasingOrderItems.purchasingorders_id.in_(po_ids),
                    GoodReceivedItems.active == True,
                )
                .group_by(PurchasingOrderItems.purchasingorders_id)
                .all()
            )
            received_by_po = {po_id: count for po_id, count in rows}

        quote.related_purchase_orders = [
            {
                "id": po.id,
                "purchasing_order_no": po.purchasing_order_no,
                "status": po.status,
                "supplier_name": po.first_supplier.company_name if po.first_supplier else None,
                "ordered_quantity": sum((i.quantity for i in po.items), 0),
                "received_quantity": received_by_po.get(po.id, 0),
            }
            for po in orders
        ]
    
    def get_quote_by_no(self, db: Session, quote_no: str) -> Optional[SalesQuote]:
        """Get quote by quote number"""
        return self.repository.get_by_quote_no(db, quote_no)
    
    def get_filtered_quotes(
        self,
        db: Session,
        filters: SalesQuoteFilter,
        page: int = 1,
        per_page: int = 20
    ) -> Tuple[List[SalesQuote], int, int]:
        """Get filtered quotes with pagination"""
        # Lazily flip any quote past its valid_until date to "expired" before
        # listing — cheaper than a scheduled job and keeps the status accurate
        # for anyone browsing the list, without needing a cron/worker process.
        self.mark_expired_quotes(db)
        skip = (page - 1) * per_page
        quotes, total = self.repository.get_filtered(db, filters, skip, per_page)
        pages = (total + per_page - 1) // per_page
        self._attach_user_names(db, quotes)
        return quotes, total, pages
    
    def create_quote(
        self,
        db: Session,
        quote_data: SalesQuoteCreate,
        created_by: Optional[int] = None
    ) -> SalesQuote:
        """Create a new quote"""
        
        # ── Validate branch is active ──
        from app.common.branch_validation import validate_branch_is_active
        validate_branch_is_active(db, quote_data.branch_code)

        # ── Validate customer is active ──
        from app.modules.customers.models import Customer
        customer = db.query(Customer).filter(Customer.id == quote_data.customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {quote_data.customer_id} not found"
            )
        if not customer.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{customer.customer_name}' is inactive. Please reactivate the customer before creating a quotation."
            )

        # ── Validate customer agent is active (if provided) ──
        if quote_data.customer_agent_id:
            agent = db.query(Customer).filter(Customer.id == quote_data.customer_agent_id).first()
            if agent and not agent.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer agent '{agent.customer_name}' is inactive. Please reactivate the agent before creating a quotation."
                )

        # Generate quote number
        quote_no = self.repository.get_next_quote_number(
            db, 
            quote_data.quote_type.value,
            quote_data.branch_code
        )
        
        # Determine is_estimate based on quote_type
        is_estimate = quote_data.quote_type == QuoteTypeEnum.QUOTATION
        
        # Create quote object
        now = tz.now()
        quote = SalesQuote(
            quote_no=quote_no,
            quote_type=quote_data.quote_type.value,
            branch_code=quote_data.branch_code,
            customer_id=quote_data.customer_id,
            sale_rep_id=quote_data.sale_rep_id if quote_data.sale_rep_id else None,
            customer_agent_id=quote_data.customer_agent_id,
            created_date=now.date(),
            created_date_time=now,
            valid_until=quote_data.valid_until,
            expected_delivery_date=quote_data.expected_delivery_date,
            status=QuoteStatus.PENDING_APPROVAL.value,
            approval=False,
            is_estimate=is_estimate,
            remarks=quote_data.remarks,
            customer_notes=quote_data.customer_notes,
            special=quote_data.special,
            discount_type=quote_data.discount_type.value if quote_data.discount_type else 'none',
            discount_percentage=quote_data.discount_value or 0,
            tax_mode=quote_data.tax_mode or 'none',
            tax_rate=quote_data.tax_rate or 0,
            total_amount=0,
            created_by=created_by,
            updated_by=created_by,
        )
        
        # Add items
        for item_data in quote_data.items:
            item = self._create_quote_item(item_data, now)
            quote.items.append(item)
        
        # Calculate totals
        self._calculate_quote_totals(quote)
        self._check_discount(quote)
        
        # Save to database
        created = self.repository.create(db, quote)

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=created_by or 0,
            action="create",
            entity_type="sales_quote",
            entity_id=created.id,
            changes={"quote_no": created.quote_no},
        )
        db.commit()

        # Every new quote starts pending approval — create the approval
        # request the same way PurchasingOrderService.create_order does for POs.
        approval_record = approval_service.create_approval_request(
            db=db,
            approval_type=ApprovalType.SALES_QUOTE,
            reference_id=created.id,
            reference_no=created.quote_no,
            branch_code=created.branch_code,
            requested_by=created_by or 0,
            remarks="Sales quotation pending approval.",
            approval_group="sales_quote_approvers",
        )
        created.approval_id = approval_record.id
        db.commit()
        db.refresh(created)

        return created

    def update_quote(
        self,
        db: Session,
        quote_id: int,
        quote_data: SalesQuoteUpdate,
        user_id: Optional[int] = None
    ) -> SalesQuote:
        """Update an existing quote"""
        # Lock the quote row to prevent concurrent edits from clobbering each other
        quote = db.query(SalesQuote).filter(
            SalesQuote.id == quote_id
        ).with_for_update().first()

        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        # Check if quote can be edited (not converted, cancelled or superseded)
        if quote.status in [QuoteStatus.COMPLETED.value, QuoteStatus.CANCELLED.value, QuoteStatus.REVISED.value, QuoteStatus.SO_CREATED.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit quote in '{quote.status}' status"
            )
        from app.common.concurrency import ensure_not_stale
        ensure_not_stale(quote.updated_at, None, f"Quotation {quote.quote_no}", quote_data.expected_version)

        was_approved = quote.status == QuoteStatus.APPROVED.value

        # ── Validate customer is active (if customer is being changed) ──
        update_dict = quote_data.model_dump(exclude_unset=True, exclude={'items', 'expected_version'})
        today_ = tz.today()
        if 'valid_until' in update_dict and update_dict['valid_until'] != quote.valid_until and update_dict['valid_until'] < today_:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Valid-until date cannot be moved into the past")
        if update_dict.get('expected_delivery_date') and update_dict['expected_delivery_date'] != quote.expected_delivery_date and update_dict['expected_delivery_date'] < today_:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expected delivery date cannot be moved into the past")
        if 'branch_code' in update_dict and update_dict['branch_code'] != quote.branch_code:
            from app.common.branch_validation import validate_branch_is_active
            validate_branch_is_active(db, update_dict['branch_code'])
        if 'customer_id' in update_dict:
            from app.modules.customers.models import Customer
            customer = db.query(Customer).filter(Customer.id == update_dict['customer_id']).first()
            if customer and not customer.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer '{customer.customer_name}' is inactive. Please reactivate the customer before updating the quotation."
                )

        # ── Validate customer agent is active (if agent is being changed) ──
        if 'customer_agent_id' in update_dict and update_dict['customer_agent_id']:
            from app.modules.customers.models import Customer as CustomerModel
            agent = db.query(CustomerModel).filter(CustomerModel.id == update_dict['customer_agent_id']).first()
            if agent and not agent.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer agent '{agent.customer_name}' is inactive. Please reactivate the agent before updating the quotation."
                )

        # Update fields
        update_data = quote_data.model_dump(exclude_unset=True, exclude={'items', 'expected_version'})
        before_values = {key: getattr(quote, key, None) for key in update_data}
        changed_fields = set(update_data.keys())
        for key, value in update_data.items():
            if value is not None:
                if key == 'discount_type':
                    setattr(quote, key, value.value)
                elif key == 'discount_value':
                    setattr(quote, 'discount_percentage', value)
                else:
                    setattr(quote, key, value)

        # Update items if provided
        item_changes = []
        if quote_data.items is not None:
            before_items = [
                {"product_id": i.product_id, "quantity": i.quantity, "unit_price": float(i.selling_price)}
                for i in quote.items
            ]
            after_items = [
                {"product_id": i.product_id, "quantity": i.quantity, "unit_price": float(i.selling_price)}
                for i in quote_data.items
            ]
            from app.common.audit import diff_line_items
            item_changes = diff_line_items(before_items, after_items, key_field="product_id")
            if item_changes:
                changed_fields.add("items")

            # Delete existing items
            self.repository.delete_items_by_quote_id(db, quote_id)

            # Add new items
            now = tz.now()
            quote.items = []
            for item_data in quote_data.items:
                item = self._create_quote_item(item_data, now)
                quote.items.append(item)

        # Recalculate totals
        self._calculate_quote_totals(quote)
        self._check_discount(quote)
        quote.updated_by = user_id

        updated = self.repository.update(db, quote)

        if changed_fields:
            from app.common.audit import log_audit, diff_changes
            changes = diff_changes(before_values, update_data)
            if item_changes:
                from app.modules.products.models import Product

                product_ids = {entry["key"] for entry in item_changes}
                product_names = {
                    p.id: p.name
                    for p in db.query(Product).filter(Product.id.in_(product_ids)).all()
                }
                for entry in item_changes:
                    entry["product_name"] = product_names.get(entry["key"], f"Product #{entry['key']}")
                changes["item_changes"] = item_changes
                changes.setdefault("fields", [])
                changes["fields"] = sorted(set(changes["fields"]) | {"items"})
            log_audit(
                db,
                user_id=user_id or 0,
                action="update",
                entity_type="sales_quote",
                entity_id=updated.id,
                changes=changes or {"fields": sorted(changed_fields)},
            )
            db.commit()

        # Editing an approved quote invalidates that approval — reset it to
        # pending_approval and require re-approval, mirroring
        # PurchasingOrderService.update_order's re-approval-on-edit behavior.
        if was_approved and changed_fields:
            from app.modules.common.models import Approvals

            updated.status = QuoteStatus.PENDING_APPROVAL.value
            # The frontend gates Send/Create PO/Create SO on this flag, not on
            # status alone — it must be cleared too or those stay unlocked.
            updated.approval = False
            if updated.approval_id:
                approval_record = db.query(Approvals).filter(
                    Approvals.id == updated.approval_id
                ).with_for_update().first()
                if approval_record:
                    approval_record.status = ApprovalStatus.PENDING
                    approval_record.status_changed_by = None
                    approval_record.remark = "Re-approval required: quotation was edited after approval."
            else:
                approval_record = approval_service.create_approval_request(
                    db=db,
                    approval_type=ApprovalType.SALES_QUOTE,
                    reference_id=updated.id,
                    reference_no=updated.quote_no,
                    branch_code=updated.branch_code,
                    requested_by=user_id or 0,
                    remarks="Re-approval required: quotation was edited after approval.",
                    approval_group="sales_quote_approvers",
                )
                updated.approval_id = approval_record.id
            db.commit()
            db.refresh(updated)

        return updated

    def delete_quote(self, db: Session, quote_id: int, user_id: Optional[int] = None) -> bool:
        """Delete a quote"""
        quote = self.repository.get_by_id(db, quote_id)

        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )

        # Only prevent deletion of converted or cancelled quotes
        if quote.status in [QuoteStatus.COMPLETED.value, QuoteStatus.CANCELLED.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete quote in '{quote.status}' status."
            )

        # A quotation that has already led to a PO, a sales order or a stock reservation is part of
        # the trail: cancel it instead of deleting it.
        converted = [i for i in (quote.items or []) if i.item_status not in ("pending", "cancelled", None)]
        if quote.linked_po_id or quote.converted_to_invoice_id or converted:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete: this quotation already has a purchase order, sales order or processed items. Cancel it instead.",
            )
        self._cancel_pending_approval(db, quote, user_id, "Quotation deleted")
        quote_no_for_log = quote.quote_no
        deleted = self.repository.delete(db, quote_id)
        if deleted:
            from app.common.audit import log_audit
            log_audit(
                db,
                user_id=user_id or 0,
                action="delete",
                entity_type="sales_quote",
                entity_id=quote_id,
                changes={"quote_no": quote_no_for_log},
            )
            db.commit()
        return deleted

    # ==================== Status Management ====================

    def update_status(
        self,
        db: Session,
        quote_id: int,
        status_update: SalesQuoteStatusUpdate,
        user_id: Optional[int] = None
    ) -> SalesQuote:
        """Update quote status"""
        # Lock the quote row to prevent concurrent status transition conflicts
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()

        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )

        new_status = status_update.status.value

        # Only a few statuses can be set by hand. approved / rejected / pending_approval are decided by the
        # approval workflow, and completed / revised / so_created / partially_processed by the document
        # actions (convert, revise, create-SO) — letting a user set them here bypassed the approval.
        manual = {QuoteStatus.ACCEPTED.value, QuoteStatus.CANCELLED.value, QuoteStatus.EXPIRED.value}
        if new_status not in manual:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Status '{new_status}' cannot be set manually. Use the approval workflow or the document action.",
            )
        if new_status == QuoteStatus.ACCEPTED.value and (not quote.approval or quote.status not in (QuoteStatus.APPROVED.value, QuoteStatus.SENT.value)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A quotation can only be accepted after it has been approved.",
            )

        # Validate status transition
        if not self._is_valid_status_transition(quote.status, new_status):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status transition from '{quote.status}' to '{new_status}'"
            )

        quote.status = new_status

        if status_update.remarks:
            quote.remarks = status_update.remarks

        # Set approval flag for approved status
        if new_status == QuoteStatus.APPROVED.value:
            quote.approval = True
            quote.approved_date = tz.now()

        # Track dates for workflow states
        now = tz.now()
        if new_status == QuoteStatus.SUBMITTED.value:
            quote.submitted_date = now
        elif new_status == QuoteStatus.REJECTED.value:
            quote.rejection_date = now

        updated = self.repository.update(db, quote)

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=user_id or 0,
            action="status_change",
            entity_type="sales_quote",
            entity_id=updated.id,
            changes={"status": new_status},
        )
        db.commit()

        return updated

    def submit_for_approval(self, db: Session, quote_id: int, user_id: Optional[int] = None) -> SalesQuote:
        """Resubmit a quote for approval (e.g. after editing a rejected quote),
        creating a fresh approval request the same way create_quote does for a
        brand-new one."""
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )

        if not self._is_valid_status_transition(quote.status, QuoteStatus.PENDING_APPROVAL.value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit quote in '{quote.status}' status for approval"
            )

        quote.status = QuoteStatus.PENDING_APPROVAL.value

        approval_record = approval_service.create_approval_request(
            db=db,
            approval_type=ApprovalType.SALES_QUOTE,
            reference_id=quote.id,
            reference_no=quote.quote_no,
            branch_code=quote.branch_code,
            requested_by=user_id or 0,
            remarks="Sales quotation resubmitted for approval.",
            approval_group="sales_quote_approvers",
        )
        quote.approval_id = approval_record.id

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=user_id or 0,
            action="status_change",
            entity_type="sales_quote",
            entity_id=quote.id,
            changes={"status": quote.status},
        )
        db.commit()
        db.refresh(quote)
        return quote

    def resolve_quote_approval(
        self, db: Session, quote_id: int, approve: bool, remarks: Optional[str] = None, user_id: int = 0
    ) -> SalesQuote:
        """
        Approve or reject a pending sales quotation. Mirrors
        PurchasingOrderService.approve_order: locks the quote and its linked
        Approvals row and updates both together. Called only via the generic
        approval dispatch (approval_service._dispatch_approve/_dispatch_reject),
        never directly from a quotation-specific endpoint.
        """
        from app.modules.common.models import Approvals

        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )

        if quote.status != QuoteStatus.PENDING_APPROVAL.value:
            action_word = "approve" if approve else "reject"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot {action_word}. Quote is not pending approval. Current status: {quote.status}"
            )

        if quote.approval_id:
            approval_record = db.query(Approvals).filter(
                Approvals.id == quote.approval_id
            ).with_for_update().first()
            if approval_record and approval_record.status == ApprovalStatus.PENDING:
                approval_record.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
                approval_record.status_changed_by = user_id
                approval_record.remark = remarks or f"{'Approved' if approve else 'Rejected'} by user {user_id}"

        now = tz.now()
        if approve:
            quote.status = QuoteStatus.APPROVED.value
            quote.approval = True
            quote.approved_date = now
        else:
            quote.status = QuoteStatus.REJECTED.value
            quote.rejection_date = now
            if remarks:
                quote.rejection_reason = remarks

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=user_id,
            action="approve" if approve else "reject",
            entity_type="sales_quote",
            entity_id=quote.id,
            changes={"status": quote.status, "remarks": remarks},
        )
        db.commit()
        db.refresh(quote)
        return quote

    def submit_to_customer(self, db: Session, quote_id: int) -> SalesQuote:
        """Submit quote to customer - updates status and sets submitted_date"""
        # Lock the quote row to prevent concurrent status changes
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        # Only an internally approved quotation can go to the customer
        valid_from = [QuoteStatus.APPROVED.value]
        if quote.status not in valid_from or not quote.approval:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit quote in '{quote.status}' status. It must be approved first."
            )
        
        now = tz.now()
        quote.status = QuoteStatus.SUBMITTED.value
        quote.submitted_date = now
        
        return self.repository.update(db, quote)
    
    def mark_under_review(self, db: Session, quote_id: int) -> SalesQuote:
        """Mark quote as under review by customer"""
        # Lock the quote row to prevent concurrent status changes
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        if quote.status != QuoteStatus.SUBMITTED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot mark as under_review from '{quote.status}'. Must be submitted first."
            )
        
        quote.status = QuoteStatus.UNDER_REVIEW.value
        return self.repository.update(db, quote)
    
    def customer_approve(self, db: Session, quote_id: int, approved_by: Optional[str] = None, remarks: Optional[str] = None) -> SalesQuote:
        """Customer approves the quotation - ready to convert"""
        # Lock the quote row to prevent concurrent double-approval
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        valid_from = [
            QuoteStatus.SUBMITTED.value, QuoteStatus.UNDER_REVIEW.value,
            QuoteStatus.SENT.value,
        ]
        if quote.status not in valid_from or not quote.approval:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve from '{quote.status}'. It must be internally approved and submitted, under review or sent."
            )
        
        now = tz.now()
        quote.status = QuoteStatus.APPROVED.value
        quote.approval = True
        quote.approved_date = now
        if approved_by:
            quote.approved_by_customer = approved_by
        if remarks:
            quote.remarks = remarks
        
        return self.repository.update(db, quote)
    
    def reject_quote(self, db: Session, quote_id: int, reason: Optional[str] = None, cancel_linked_po: bool = False, user_id: Optional[int] = None) -> SalesQuote:
        """Reject a quote with optional reason and optional PO cancellation"""
        # Lock the quote row to prevent concurrent approve/reject race
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        if quote.status == QuoteStatus.PENDING_APPROVAL.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This quotation is waiting for approval; approve or reject it from Quotation Approvals.",
            )
        # Allow rejection from most non-final statuses
        non_rejectable = [QuoteStatus.COMPLETED.value, QuoteStatus.CANCELLED.value, QuoteStatus.REVISED.value, QuoteStatus.REJECTED.value]
        if quote.status in non_rejectable:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject quote in '{quote.status}' status"
            )
        
        now = tz.now()
        quote.status = QuoteStatus.REJECTED.value
        quote.rejection_date = now
        if reason:
            quote.rejection_reason = reason
            quote.remarks = reason
        
        # Handle linked PO cancellation if requested
        if cancel_linked_po and quote.linked_po_id:
            from app.modules.purchasing.models import PurchasingOrder
            linked_po = db.query(PurchasingOrder).filter(
                PurchasingOrder.id == quote.linked_po_id
            ).first()
            if linked_po and linked_po.status in ['pending', 'approved']:
                linked_po.status = 'cancelled'
                linked_po.remarks = f"Cancelled due to quotation {quote.quote_no} rejection"

        updated = self.repository.update(db, quote)

        if cancel_linked_po:
            # Abandoning procurement for this rejected quote — release any
            # stock already received and reserved for it. Best-effort: the
            # rejection itself is already committed above, so a failure here
            # shouldn't surface as a 500 — it just needs manual follow-up via
            # the release_reservation endpoint.
            try:
                self._release_reservations_for_items(db, [i.id for i in quote.items], user_id=user_id)
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(
                    f"Failed to release stock reservations for rejected quote {quote.id}: {e}"
                )

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=user_id or 0,
            action="reject",
            entity_type="sales_quote",
            entity_id=updated.id,
            changes={"reason": reason},
        )
        db.commit()

        return updated

    def mark_as_sent(self, db: Session, quote_id: int) -> SalesQuote:
        """Record that a quote was sent to the customer. This is deliberately
        NOT a `status` transition — "sent" isn't tracked as a header status
        at all, only as `submitted_date` (repurposed from the old
        submit_to_customer flow), so marking a quote sent never disturbs its
        real status (e.g. it stays "approved" for create_po/create_so and
        for the Quotation Approvals dashboard). Only allowed once the quote
        has cleared internal approval (quote.approval == True)."""
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")
        if not quote.approval or quote.status in (QuoteStatus.REJECTED.value, QuoteStatus.CANCELLED.value, QuoteStatus.REVISED.value):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot mark as sent: quotation must be approved first (current status: '{quote.status}')"
            )
        quote.submitted_date = tz.now()
        return self.repository.update(db, quote)

    def mark_as_accepted(self, db: Session, quote_id: int) -> SalesQuote:
        """Mark quote as accepted by customer"""
        return self.update_status(
            db, quote_id,
            SalesQuoteStatusUpdate(status=QuoteStatusEnum.ACCEPTED)
        )
    
    def cancel_quote(self, db: Session, quote_id: int, reason: Optional[str] = None) -> SalesQuote:
        """Cancel a quote — allowed from any non-terminal status."""
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")
        if quote.status == QuoteStatus.CANCELLED.value:
            raise HTTPException(status_code=400, detail="Quote is already cancelled")
        if quote.status == QuoteStatus.COMPLETED.value:
            raise HTTPException(status_code=400, detail="Cannot cancel a completed quotation")
        db.refresh(quote, attribute_names=["items"])
        self._cancel_pending_approval(db, quote, None, f"Quotation cancelled: {reason or ''}".strip())
        quote.status = QuoteStatus.CANCELLED.value
        if reason:
            quote.remarks = reason
        # Cancel all items that haven't been converted to an SO yet
        for item in quote.items:
            if item.item_status not in ("so_created", "completed", "cancelled"):
                item.item_status = "cancelled"
        updated = self.repository.update(db, quote)
        # Business rule: a cancelled quotation must release any stock that
        # was reserved for it during procurement — it becomes available for
        # other customers again. Best-effort: the cancellation itself is
        # already committed above, so a failure here shouldn't surface as a
        # 500 — it just needs manual follow-up via the release_reservation
        # endpoint.
        try:
            self._release_reservations_for_items(db, [i.id for i in quote.items])
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                f"Failed to release stock reservations for cancelled quote {quote.id}: {e}"
            )
        return updated

    def _release_reservations_for_items(
        self, db: Session, item_ids: List[int], user_id: Optional[int] = None
    ) -> int:
        from app.modules.inventory.service import SalesStockService
        stock_service = SalesStockService(db)
        released = 0
        for item_id in item_ids:
            released += stock_service.release_reservation_for_quote_item(item_id, user_id=user_id)
        return released

    def release_reservation(
        self,
        db: Session,
        quote_id: int,
        item_id: Optional[int] = None,
        reason: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> dict:
        """
        Explicitly release procurement stock reserved for this quotation (or
        a single item on it) back to the available pool. Unlike cancellation,
        this does not require the quotation itself to be cancelled — it's the
        "authorized user changes/releases the reservation" business rule.
        """
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")
        db.refresh(quote, attribute_names=["items"])

        if item_id is not None:
            target_ids = [i.id for i in quote.items if i.id == item_id]
            if not target_ids:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found on quote {quote_id}")
        else:
            target_ids = [i.id for i in quote.items]

        released = self._release_reservations_for_items(db, target_ids, user_id=user_id)

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=user_id or 0,
            action="release_reservation",
            entity_type="sales_quote",
            entity_id=quote.id,
            changes={"item_id": item_id, "units_released": released, "reason": reason},
        )
        db.commit()

        return {"quote_id": quote_id, "units_released": released}
    
    # ==================== Conversion to Invoice ====================

    def recompute_quote_status(self, db: Session, quote: SalesQuote) -> None:
        """
        Recompute the overall quote status based on item statuses.

        Logic:
          - ALL items 'so_created' or 'cancelled' (with at least one so_created) → COMPLETED
          - ANY item progressed beyond 'pending' (procurement/po_created/itn_created/so_created) → PARTIALLY_PROCESSED
          - Otherwise leave unchanged (DRAFT / SENT)
        """
        if quote.status == QuoteStatus.CANCELLED.value:
            return
        items = quote.items
        if not items:
            return

        total  = len(items)
        terminal = sum(1 for i in items if i.item_status in ("so_created", "cancelled"))
        in_so  = sum(1 for i in items if i.item_status == "so_created")
        progressed = sum(1 for i in items if i.item_status in (
            "procurement", "po_created", "itn_created", "so_created"
        ))

        if terminal == total and in_so > 0:
            # All items are either SO-created or cancelled → fully done
            quote.status = QuoteStatus.COMPLETED.value
        elif progressed > 0:
            # At least one item has moved beyond pending → work in progress
            quote.status = QuoteStatus.PARTIALLY_PROCESSED.value
        elif quote.status == QuoteStatus.PARTIALLY_PROCESSED.value and progressed == 0:
            # everything that had been ordered was cancelled / rejected: back to the approved state
            quote.status = QuoteStatus.APPROVED.value if quote.approval else quote.status
        # else: no work started yet — leave header as DRAFT / SENT

    def create_partial_so(
        self,
        db: Session,
        quote_id: int,
        request: CreatePartialSORequest,
        created_by: Optional[int] = None,
    ) -> Invoice:
        """
        Create a Sales Order from selected items / partial quantities of a quotation.
        Updates per-item converted_qty and item_status, then recomputes quote status.
        """
        quote = db.query(SalesQuote).filter(
            SalesQuote.id == quote_id
        ).with_for_update().first()

        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")

        db.refresh(quote, attribute_names=["items"])

        # Quote must be in an active (non-terminal) state
        terminal = {
            QuoteStatus.CANCELLED.value,
            QuoteStatus.REJECTED.value,
            QuoteStatus.REVISED.value,
            QuoteStatus.COMPLETED.value,
        }
        if quote.status in terminal:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot create SO — quotation is in terminal status: {quote.status}"
            )

        # A Sales Order can only be created once the quotation has been
        # approved. `approval` (not `status`) is the gate: once some items
        # are converted the header status moves on to partially_processed,
        # but `approval` stays True from the original sign-off.
        if not quote.approval:
            raise HTTPException(
                status_code=400,
                detail="Cannot create SO — this quotation has not been approved yet."
            )

        from app.modules.inventory.models import SalesStock
        from app.common.enums import StockStatus

        # Build a lookup of quote items by id
        item_map = {i.id: i for i in quote.items}

        # Validate requested items, quantities, and — critically — real
        # physical stock. item_status alone (po_created/itn_created) only
        # means procurement was *initiated*, not that anything has actually
        # arrived (see check_stock_availability above for the same class of
        # bug). Lock the matching sales_stock rows here so two concurrent SO
        # conversions, or an SO conversion racing a normal POS sale, can't
        # both claim the same physical unit.
        invoice_items_to_create = []  # (qi, [SalesStock, ...])
        for req_item in request.items:
            qi = item_map.get(req_item.item_id)
            if not qi:
                raise HTTPException(status_code=400, detail=f"Quote item id {req_item.item_id} not found")
            if qi.item_status == "cancelled":
                raise HTTPException(status_code=400, detail=f"Item {req_item.item_id} is already cancelled")
            if qi.item_status == "so_created":
                raise HTTPException(status_code=400, detail=f"Item {req_item.item_id} has already been converted to a Sales Order")
            remaining = qi.quantity - qi.converted_qty
            if req_item.quantity > remaining:
                raise HTTPException(
                    status_code=400,
                    detail=f"Requested qty {req_item.quantity} exceeds remaining qty {remaining} for item {req_item.item_id}"
                )

            # Prefer units already reserved/committed to this quote item
            # (received via a PO raised specifically for this quotation) over
            # the general available pool — that stock was procured for this
            # customer and must not be taken by someone else's sale first.
            reserved_units = (
                db.query(SalesStock)
                .filter(
                    SalesStock.reserved_for_quote_item_id == qi.id,
                    SalesStock.status == StockStatus.RESERVED,
                    SalesStock.is_active == True,
                )
                .order_by(SalesStock.id)
                .with_for_update(skip_locked=True)
                .limit(req_item.quantity)
                .all()
            )
            still_needed = req_item.quantity - len(reserved_units)
            extra_units = []
            if still_needed > 0:
                extra_units = (
                    db.query(SalesStock)
                    .filter(
                        SalesStock.product_id == qi.product_id,
                        SalesStock.branch_code == quote.branch_code,
                        SalesStock.status == StockStatus.AVAILABLE,
                        SalesStock.is_active == True,
                    )
                    .order_by(SalesStock.id)
                    .with_for_update(skip_locked=True)
                    .limit(still_needed)
                    .all()
                )
            allocated_units = reserved_units + extra_units
            if len(allocated_units) < req_item.quantity:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Only {len(allocated_units)} unit(s) of item {req_item.item_id} are actually in "
                        f"stock at {quote.branch_code} right now ({req_item.quantity} requested)."
                    ),
                )
            invoice_items_to_create.append((qi, allocated_units))

        # Generate invoice number with branch code: INV-BranchCode-YYYY-XXXXX
        now = tz.now()
        year = now.year
        branch_code = quote.branch_code or "HQ"
        prefix = f"INV-{branch_code}-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last_invoice = db.query(Invoice).filter(
            Invoice.invoice_no.like(f"INV-{branch_code}-{year}-%")
        ).order_by(Invoice.id.desc()).first()
        if last_invoice:
            try:
                next_seq = int(last_invoice.invoice_no.split('-')[-1]) + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        invoice_no = f"INV-{branch_code}-{year}-{next_seq:05d}"

        # Create the invoice
        invoice = Invoice(
            invoice_no=invoice_no,
            branch_code=quote.branch_code,
            customer_id=quote.customer_id,
            sale_rep_id=quote.sale_rep_id,
            customer_agent_id=quote.customer_agent_id,
            payment_method=request.payment_method or "cash",
            cash_amount=0,
            card_visa_amount=0,
            card_mastercard_amount=0,
            card_amex_amount=0,
            cheque_amount=0,
            bank_transfer_amount=0,
            credit_amount=0,
            payment_adjustments=0,
            # NOT NULL on the invoices table regardless of payment method —
            # same "default to today" convention used by the normal invoice
            # creation path (SalesService.create_invoice) for non-cheque sales.
            cheque_date=now.date(),
            remarks=request.remarks or f"Partial SO from {quote.quote_no}",
            created_date=now.date(),
            created_date_time=now,
            special=quote.special,
            status=True,
            approval=True,
            cupon_amount=0,
            source_quote_id=quote.id,
            source_quote_type=quote.quote_type,
        )
        db.add(invoice)
        db.flush()

        for qi, units in invoice_items_to_create:
            # One InvoiceItems row per physical unit consumed — same
            # convention as the normal barcode-less POS sale path, so every
            # unit stays traceable/restorable on approve/cancel/return.
            for unit in units:
                unit.status = StockStatus.SOLD
                unit.is_active = False
                db.add(InvoiceItems(
                    invoice_id=invoice.id,
                    product_id=qi.product_id,
                    quantity=1,
                    selling_price=qi.selling_price,
                    minimum_selling_price=qi.minimum_selling_price,
                    warrenty_month=qi.warrenty_month,
                    created_date=now,
                    sales_stock_id=unit.id,
                    barcode=unit.barcode,
                ))
            qi.converted_qty = (qi.converted_qty or 0) + len(units)
            # Mark item as so_created regardless of partial or full qty
            qi.item_status = "so_created"

        # Recompute overall quote status
        self.recompute_quote_status(db, quote)
        db.commit()
        db.refresh(invoice)
        return invoice

    def cancel_quote_item(
        self,
        db: Session,
        quote_id: int,
        item_id: int,
        reason: Optional[str] = None,
        cancelled_by: Optional[int] = None,
    ) -> SalesQuote:
        """
        Cancel a single item on a quotation.
        Re-evaluates overall quote status after cancellation.
        """
        quote = (
            db.query(SalesQuote)
            .filter(SalesQuote.id == quote_id)
            .with_for_update()
            .first()
        )

        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")

        db.refresh(quote, attribute_names=["items"])
        item = next((i for i in quote.items if i.id == item_id), None)
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found on quote {quote_id}")

        if item.item_status == "cancelled":
            raise HTTPException(status_code=400, detail="Item is already cancelled")
        if item.item_status in ("completed", "so_created"):
            raise HTTPException(status_code=400, detail="Cannot cancel an item that has already been converted to a Sales Order")

        item.item_status = "cancelled"
        if reason:
            item.remark = (item.remark or "") + f" [Cancelled: {reason}]"

        self.recompute_quote_status(db, quote)
        db.commit()
        db.refresh(quote)
        return quote

    def mark_items_procurement(
        self,
        db: Session,
        quote_id: int,
        item_ids: List[int],
    ) -> SalesQuote:
        """Mark selected quotation items as procurement (PO/ITN)"""
        quote = (
            db.query(SalesQuote)
            .filter(SalesQuote.id == quote_id)
            .with_for_update()
            .first()
        )

        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")

        db.refresh(quote, attribute_names=["items"])
        targets = [i for i in quote.items if i.id in set(item_ids)]
        if not targets:
            raise HTTPException(status_code=400, detail="No matching items found for this quote")

        for item in targets:
            # Only allow transitioning items that have not yet been procured/fulfilled
            if item.item_status not in ("pending", "procurement"):
                continue  # Protect po_created, itn_created, so_created, completed, cancelled
            item.item_status = "procurement"

        self.recompute_quote_status(db, quote)
        db.commit()
        db.refresh(quote)
        return quote

    def mark_quote_items_itn_created_by_product(
        self,
        db: Session,
        quote_id: int,
        product_ids: List[int],
    ) -> None:
        """
        Called by the warehouse bulk-receive path when an ITN is fully received.
        Updates quote items in 'procurement' state (matched by product) to 'itn_created'.
        """
        from app.modules.sales.quotation_models import SalesQuoteItem
        if not product_ids:
            return
        matched = db.query(SalesQuoteItem).filter(
            SalesQuoteItem.quote_id == quote_id,
            SalesQuoteItem.product_id.in_(product_ids),
            SalesQuoteItem.item_status == "procurement",
        ).all()
        if not matched:
            return
        for qi in matched:
            qi.item_status = "itn_created"
            qi.stock_status = "in_stock"

        # Keep the quote header in sync — without this it can go stale after
        # a transfer completes (still showing e.g. 'approved' even though an
        # item has now progressed past pending).
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).first()
        if quote:
            db.refresh(quote, attribute_names=["items"])
            self.recompute_quote_status(db, quote)

    def mark_items_so_created(
        self,
        db: Session,
        quote_id: int,
        product_ids: List[int],
    ) -> SalesQuote:
        """
        Called after a Sales Order is successfully saved from the Sales page.
        Marks matching quote items as 'so_created' and recomputes header status.
        product_ids: the product IDs that were included in the SO.
        """
        quote = (
            db.query(SalesQuote)
            .filter(SalesQuote.id == quote_id)
            .with_for_update()
            .first()
        )
        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")
        db.refresh(quote, attribute_names=["items"])
        product_set = set(product_ids)
        for item in quote.items:
            if item.product_id in product_set and item.item_status not in ("so_created", "cancelled", "completed"):
                item.item_status = "so_created"
                item.converted_qty = item.quantity  # fully converted
        self.recompute_quote_status(db, quote)
        db.commit()
        db.refresh(quote)
        return quote

    def convert_to_invoice(
        self,
        db: Session,
        quote_id: int,
        conversion_data: ConvertToInvoiceRequest,
        converted_by: Optional[int] = None
    ) -> Invoice:
        """Convert quote to invoice"""
        # Lock the quote row to prevent concurrent conversions
        quote = db.query(SalesQuote).filter(
            SalesQuote.id == quote_id
        ).with_for_update().first()
        
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        db.refresh(quote, attribute_names=["items"])
        
        # Check if quote can be converted (must be in an active, non-terminal status)
        terminal = {
            QuoteStatus.COMPLETED.value,
            QuoteStatus.CANCELLED.value,
            QuoteStatus.REVISED.value,
        }
        if quote.status in terminal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Quote must be in an active status to convert. Current status: '{quote.status}'"
            )
        
        # For quotations with estimates, verify all prices are exact
        if quote.is_estimate:
            for item in quote.items:
                if item.is_price_estimate:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Item '{item.product_id}' has estimate pricing. Please set exact prices before converting."
                    )
        
        # Validate stock availability before conversion
        stock_check = self.check_stock_availability(db, quote_id)
        if not stock_check["all_sufficient"]:
            insufficient = [
                f"{i['product_name'] or i['product_id']} (need {i['requested_quantity']}, have {i['available_quantity']})"
                for i in stock_check["items"] if not i["is_sufficient"]
            ]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock for: {', '.join(insufficient)}"
            )
        
        # ── Validate branch is still active at conversion time ──
        from app.common.branch_validation import validate_branch_is_active
        validate_branch_is_active(db, quote.branch_code)

        # ── Validate customer is still active at conversion time ──
        from app.modules.customers.models import Customer
        customer = db.query(Customer).filter(Customer.id == quote.customer_id).first()
        if customer and not customer.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{customer.customer_name}' is inactive. Please reactivate the customer before converting the quotation to an invoice."
            )

        # ── Validate customer agent is still active (if present) ──
        if quote.customer_agent_id:
            agent = db.query(Customer).filter(Customer.id == quote.customer_agent_id).first()
            if agent and not agent.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Customer agent '{agent.customer_name}' is inactive. Please reactivate the agent before converting the quotation to an invoice."
                )

        # Generate invoice number
        now = tz.now()
        year = now.year
        
        # Acquire advisory lock to prevent duplicate invoice numbers
        prefix = f"INV-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        
        # Get next invoice number
        last_invoice = db.query(Invoice).filter(
            Invoice.invoice_no.like(f"INV-{year}-%")
        ).order_by(Invoice.id.desc()).first()
        
        if last_invoice:
            try:
                last_seq = int(last_invoice.invoice_no.split('-')[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        
        invoice_no = f"INV-{year}-{next_seq:05d}"
        
        # Create invoice
        invoice = Invoice(
            invoice_no=invoice_no,
            branch_code=quote.branch_code,
            customer_id=quote.customer_id,
            sale_rep_id=quote.sale_rep_id,
            customer_agent_id=quote.customer_agent_id,
            payment_method=conversion_data.payment_method,
            cash_amount=conversion_data.cash_amount,
            card_visa_amount=conversion_data.card_visa_amount,
            card_mastercard_amount=conversion_data.card_mastercard_amount,
            card_amex_amount=conversion_data.card_amex_amount,
            cheque_amount=conversion_data.cheque_amount,
            cheque_date=conversion_data.cheque_date or now.date(),
            bank_transfer_amount=conversion_data.bank_transfer_amount,
            credit_amount=conversion_data.credit_amount,
            payment_adjustments=conversion_data.payment_adjustments,
            remarks=conversion_data.remarks or quote.remarks,
            created_date=now.date(),
            created_date_time=now,
            special=quote.special,
            status=True,
            approval=True,
            cupon_amount=0,
            source_quote_id=quote.id,
            source_quote_type=quote.quote_type
        )
        
        db.add(invoice)
        db.flush()  # Get invoice ID
        
        # Create invoice items
        for quote_item in quote.items:
            invoice_item = InvoiceItems(
                invoice_id=invoice.id,
                product_id=quote_item.product_id,
                quantity=quote_item.quantity,
                selling_price=quote_item.selling_price,
                minimum_selling_price=quote_item.minimum_selling_price,
                warrenty_month=quote_item.warrenty_month,
                created_date=now
            )
            db.add(invoice_item)
            # Mark item as fully converted
            quote_item.converted_qty = quote_item.quantity
            quote_item.item_status = "so_created"
        
        # Update quote status — full conversion = COMPLETED
        quote.status = QuoteStatus.COMPLETED.value
        quote.converted_to_invoice_id = invoice.id
        quote.converted_at = now
        quote.converted_by = converted_by
        quote.conversion_date = now

        from app.common.audit import log_audit
        log_audit(
            db,
            user_id=converted_by or 0,
            action="convert",
            entity_type="sales_quote",
            entity_id=quote.id,
            changes={"invoice_id": invoice.id, "invoice_no": getattr(invoice, "invoice_no", None)},
        )

        db.commit()
        db.refresh(invoice)

        return invoice
    
    # ==================== Revision Management ====================
    
    def create_revision(
        self,
        db: Session,
        quote_id: int,
        reason: Optional[str] = None
    ) -> SalesQuote:
        """Create a new revision of a quotation"""
        # Lock the original quote row to prevent concurrent revision requests
        original_quote = db.query(SalesQuote).filter(
            SalesQuote.id == quote_id
        ).with_for_update().first()

        if not original_quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        if original_quote.status in (QuoteStatus.REVISED.value, QuoteStatus.CANCELLED.value, QuoteStatus.COMPLETED.value, QuoteStatus.SO_CREATED.value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot revise a quotation in '{original_quote.status}' status",
            )
        db.refresh(original_quote, attribute_names=["items"])
        self._cancel_pending_approval(db, original_quote, None, "Superseded by a revision")

        # Get next revision number
        parent_id = original_quote.parent_quote_id or original_quote.id
        next_revision = self.repository.get_next_revision_number(db, parent_id)
        
        # Generate new quote number with revision
        base_quote_no = original_quote.quote_no.split('-R')[0]  # Remove existing revision suffix
        new_quote_no = f"{base_quote_no}-R{next_revision}"
        
        now = tz.now()
        
        # Create new quote as revision
        new_quote = SalesQuote(
            quote_no=new_quote_no,
            quote_type=original_quote.quote_type,
            branch_code=original_quote.branch_code,
            customer_id=original_quote.customer_id,
            sale_rep_id=original_quote.sale_rep_id,
            customer_agent_id=original_quote.customer_agent_id,
            created_date=now.date(),
            created_date_time=now,
            valid_until=original_quote.valid_until,
            expected_delivery_date=original_quote.expected_delivery_date,
            status=QuoteStatus.DRAFT.value,
            approval=False,
            is_estimate=original_quote.is_estimate,
            remarks=reason or f"Revision of {original_quote.quote_no}",
            customer_notes=original_quote.customer_notes,
            special=original_quote.special,
            total_amount=float(original_quote.total_amount),
            parent_quote_id=parent_id,
            revision_number=next_revision
        )
        
        # Copy items
        for orig_item in original_quote.items:
            new_item = SalesQuoteItem(
                product_id=orig_item.product_id,
                quantity=orig_item.quantity,
                selling_price=orig_item.selling_price,
                minimum_selling_price=orig_item.minimum_selling_price,
                warrenty_month=orig_item.warrenty_month,
                created_date=now,
                is_price_estimate=orig_item.is_price_estimate,
                description=orig_item.description,
                remark=orig_item.remark,
                price_tier_id=orig_item.price_tier_id
            )
            new_quote.items.append(new_item)
        
        # Mark original as revised
        original_quote.status = QuoteStatus.REVISED.value
        
        db.add(new_quote)
        db.commit()
        db.refresh(new_quote)
        
        return new_quote
    
    # ==================== Helper Methods ====================
    
    def _cancel_pending_approval(self, db: Session, quote: SalesQuote, user_id: Optional[int], remark: str) -> None:
        """If the quote still has a pending approval request, close it so it stops showing in approval lists."""
        if not quote.approval_id:
            return
        from app.modules.common.models import Approvals
        row = db.query(Approvals).filter(Approvals.id == quote.approval_id).with_for_update().first()
        if row and row.status == ApprovalStatus.PENDING:
            row.status = ApprovalStatus.CANCELLED
            row.status_changed_by = user_id
            row.remark = (remark or "Quotation withdrawn")[:255]

    def _check_discount(self, quote: SalesQuote) -> None:
        """A fixed quote-level discount cannot exceed the value of the lines."""
        if (getattr(quote, "discount_type", "none") or "none") != "fixed":
            return
        subtotal = sum(float(i.selling_price) * i.quantity for i in quote.items)
        if (quote.discount_percentage or 0) > subtotal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A fixed discount cannot be larger than the quotation total",
            )

    def _create_quote_item(self, item_data: SalesQuoteItemCreate, created_date: datetime) -> SalesQuoteItem:
        """Create a quote item from schema"""
        item = SalesQuoteItem(
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            selling_price=item_data.selling_price,
            minimum_selling_price=item_data.minimum_selling_price,
            warrenty_month=item_data.warrenty_month,
            created_date=created_date,
            is_price_estimate=item_data.is_price_estimate or False,
            description=item_data.description,
            remark=item_data.remark,
            discount_percentage=item_data.discount_percent,
            price_tier_id=item_data.price_tier_id
        )
        
        return item
    
    def _calculate_item_total(self, item: SalesQuoteItem) -> None:
        """Calculate line total for an item"""
        base_total = Decimal(str(item.selling_price)) * item.quantity
        
        # Apply discount
        if item.discount_percentage > 0:
            discount = base_total * (Decimal(str(item.discount_percentage)) / 100)
            base_total -= discount
        
        # Apply tax
        # if item.tax_rate > 0:
        #     tax = base_total * (Decimal(str(item.tax_rate)) / 100)
        #     base_total += tax
        
        # item.line_total = float(base_total)
        return base_total
    
    def _calculate_quote_totals(self, quote: SalesQuote) -> None:
        """Calculate quote totals from items"""
        total = Decimal('0')
        
        for item in quote.items:
            # Calculate item total: quantity * selling_price
            item_total = Decimal(str(item.selling_price)) * item.quantity
            
            # Apply discount
            if item.discount_percentage > 0:
                discount = item_total * (Decimal(str(item.discount_percentage)) / 100)
                item_total -= discount
                
                
            # Validate minimum price
            if item.minimum_selling_price > 0 and item.selling_price < item.minimum_selling_price:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Selling price {item.selling_price} cannot be less than minimum price {item.minimum_selling_price} for product {item.product_id}"
                )

            total += item_total
        
        quote.total_amount = float(total)

        # Apply quote-level tax if exclusive (adds to total)
        tax_mode = getattr(quote, 'tax_mode', 'none') or 'none'
        tax_rate = Decimal(str(getattr(quote, 'tax_rate', 0) or 0))
        if tax_mode == 'exclusive' and tax_rate > 0:
            quote.total_amount = float(total * (1 + tax_rate / 100))

    def _is_valid_status_transition(self, current: str, new: str) -> bool:
        """
        Primary 5-status model:
          DRAFT → SENT → PARTIALLY_PROCESSED → COMPLETED
                       ↘ CANCELLED (from DRAFT / SENT / PARTIALLY_PROCESSED)

        Legacy statuses (PENDING_APPROVAL, SUBMITTED, UNDER_REVIEW, APPROVED,
        ACCEPTED) are still supported for backwards-compat endpoints
        like approve_quote, submit_for_approval, mark_as_accepted.  They can
        transition forward freely but never backwards.
        """
        FINAL = {QuoteStatus.COMPLETED.value, QuoteStatus.CANCELLED.value,
                 QuoteStatus.REVISED.value}

        # Cannot leave a final state
        if current in FINAL:
            return False

        # Core 5-status transitions
        valid_transitions = {
            QuoteStatus.DRAFT.value: [
                QuoteStatus.SENT.value,
                QuoteStatus.PENDING_APPROVAL.value,
                QuoteStatus.SUBMITTED.value,
                QuoteStatus.APPROVED.value,
                QuoteStatus.ACCEPTED.value,
                QuoteStatus.PARTIALLY_PROCESSED.value,
                QuoteStatus.COMPLETED.value,
                QuoteStatus.CANCELLED.value,
            ],
            QuoteStatus.SENT.value: [
                QuoteStatus.PENDING_APPROVAL.value,
                QuoteStatus.SUBMITTED.value,
                QuoteStatus.APPROVED.value,
                QuoteStatus.ACCEPTED.value,
                QuoteStatus.PARTIALLY_PROCESSED.value,
                QuoteStatus.COMPLETED.value,
                QuoteStatus.CANCELLED.value,
            ],
            QuoteStatus.PARTIALLY_PROCESSED.value: [
                QuoteStatus.COMPLETED.value,
                QuoteStatus.CANCELLED.value,
            ],
        }

        allowed = valid_transitions.get(current)
        if allowed is not None:
            return new in allowed

        # Legacy statuses: allow any forward move except going back to draft
        if new == QuoteStatus.DRAFT.value:
            return False
        return True
    
    # ==================== Stock Availability ====================
    
    def check_stock_availability(self, db: Session, quote_id: int, update_items: bool = True) -> dict:
        """Check stock availability for all items in a quote and optionally update item stock_status"""
        from app.modules.inventory.models import SalesStock
        from sqlalchemy import func
        
        quote = self.repository.get_by_id_with_items(db, quote_id)
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        items_availability = []
        all_sufficient = True
        
        for item in quote.items:
            # converted_qty is bumped the moment a PO or ITN is *created* for
            # this line (see PurchasingOrderService._fulfill_quote_items /
            # mark_quote_items_itn_created_by_product) — long before any GRN
            # or transfer actually lands physical stock. Treating that as
            # "already covered" here would zero out remaining_qty and make
            # is_sufficient (0 >= 0) true, wrongly reporting an unreceived
            # item as in_stock. Only a genuine SO conversion should reduce
            # the physical quantity still needed.
            if item.item_status in ("po_created", "itn_created"):
                remaining_qty = item.quantity
            else:
                remaining_qty = item.quantity - (item.converted_qty or 0)
            if remaining_qty < 0:
                remaining_qty = 0

            # Count available stock for this product grouped by branch
            branch_counts = db.query(
                SalesStock.branch_code,
                func.count(SalesStock.id)
            ).filter(
                SalesStock.product_id == item.product_id,
                SalesStock.status == 'available',
                SalesStock.is_active == True
            ).group_by(SalesStock.branch_code).all()

            branch_qtys = {branch: qty for branch, qty in branch_counts}
            current_branch_available = branch_qtys.get(quote.branch_code, 0)

            other_branches = [
                {"branch_code": branch, "available_quantity": qty}
                for branch, qty in branch_qtys.items()
                if branch != quote.branch_code and qty > 0
            ]

            is_sufficient = current_branch_available >= remaining_qty
            if not is_sufficient:
                all_sufficient = False
            
            # Update item stock_status if requested
            if update_items:
                if is_sufficient:
                    item.stock_status = 'in_stock'
                elif other_branches:
                    item.stock_status = 'needs_transfer'
                else:
                    item.stock_status = 'needs_procurement'
            
            # Get product name
            from app.modules.products.models import Product
            product = db.query(Product).filter(Product.id == item.product_id).first()
            product_name = product.name if product else None
            
            items_availability.append({
                "product_id": item.product_id,
                "product_name": product_name,
                "requested_quantity": remaining_qty,
                "available_quantity": current_branch_available,
                "current_branch_available": current_branch_available,
                "is_sufficient": is_sufficient,
                "other_branches": other_branches,
                "stock_status": 'in_stock' if is_sufficient else ('needs_transfer' if other_branches else 'needs_procurement'),
                # Partial availability: only the shortfall needs to be
                # purchased, not the full requested quantity — e.g. customer
                # wants 100, 40 are already in stock, so only 60 to purchase.
                "to_purchase_quantity": max(remaining_qty - current_branch_available, 0),
            })
        
        if update_items:
            db.commit()
        
        return {
            "quote_id": quote_id,
            "branch_code": quote.branch_code,
            "items": items_availability,
            "all_sufficient": all_sufficient
        }

    def get_procurement_summary(self, db: Session, quote_id: int) -> dict:
        """
        Full procurement/reservation traceability for a quote's items:
        required vs. ordered (PO'd) vs. received (GRN'd) vs. reserved
        (committed sales_stock units) vs. available (product/branch stock
        not committed to anyone) vs. outstanding (still owed by suppliers).
        """
        from app.modules.inventory.models import SalesStock
        from app.modules.purchasing.models import PurchasingOrderItems, GoodReceivedItems
        from app.modules.products.models import Product
        from app.common.enums import StockStatus

        quote = self.repository.get_by_id_with_items(db, quote_id)
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )

        items_out = []
        for item in quote.items:
            product = db.query(Product).filter(Product.id == item.product_id).first()

            ordered_qty = db.query(func.coalesce(func.sum(PurchasingOrderItems.quantity), 0)).filter(
                PurchasingOrderItems.quote_item_id == item.id
            ).scalar() or 0

            received_qty = (
                db.query(func.count(GoodReceivedItems.id))
                .join(PurchasingOrderItems, GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id)
                .filter(
                    PurchasingOrderItems.quote_item_id == item.id,
                    GoodReceivedItems.active == True,
                )
                .scalar() or 0
            )

            reserved_qty = db.query(func.count(SalesStock.id)).filter(
                SalesStock.reserved_for_quote_item_id == item.id,
                SalesStock.status == StockStatus.RESERVED,
                SalesStock.is_active == True,
            ).scalar() or 0

            on_hand_qty = db.query(func.count(SalesStock.id)).filter(
                SalesStock.product_id == item.product_id,
                SalesStock.branch_code == quote.branch_code,
                SalesStock.status.in_([StockStatus.AVAILABLE, StockStatus.RESERVED]),
                SalesStock.is_active == True,
            ).scalar() or 0

            available_qty = db.query(func.count(SalesStock.id)).filter(
                SalesStock.product_id == item.product_id,
                SalesStock.branch_code == quote.branch_code,
                SalesStock.status == StockStatus.AVAILABLE,
                SalesStock.is_active == True,
            ).scalar() or 0

            outstanding_qty = max(ordered_qty - received_qty, 0)
            required_qty = max(item.quantity - (item.converted_qty or 0), 0)
            # Partial availability rule: what's already in stock (and what's
            # already on order) reduces how much more actually needs buying.
            to_purchase_qty = max(required_qty - available_qty - outstanding_qty, 0)

            items_out.append({
                "item_id": item.id,
                "product_id": item.product_id,
                "product_name": product.name if product else None,
                "required_quantity": required_qty,
                "ordered_quantity": int(ordered_qty),
                "received_quantity": int(received_qty),
                "reserved_quantity": int(reserved_qty),
                "on_hand_quantity": int(on_hand_qty),
                "available_quantity": int(available_qty),
                "outstanding_quantity": int(outstanding_qty),
                "to_purchase_quantity": int(to_purchase_qty),
            })

        return {
            "quote_id": quote_id,
            "branch_code": quote.branch_code,
            "items": items_out,
        }
    
    # ==================== Create PO from Quotation ====================
    
    # ==================== Expiry Management ====================
    
    def mark_expired_quotes(self, db: Session) -> int:
        """Mark all expired quotes as expired"""
        expired_quotes = self.repository.get_expired_quotes(db)
        count = 0
        
        for quote in expired_quotes:
            quote.status = QuoteStatus.EXPIRED.value
            count += 1
        
        if count > 0:
            db.commit()
        
        return count
    
    def get_expiring_soon(self, db: Session, days: int = 7) -> List[SalesQuote]:
        """Get quotes expiring within given days"""
        return self.repository.get_expiring_quotes(db, days)


# Singleton instance
sales_quote_service = SalesQuoteService()
