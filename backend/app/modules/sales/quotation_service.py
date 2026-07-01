from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Tuple
from app.core import timezone as tz

from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.sales.quotation_models import (DiscountType, QuoteStatus,
                                                QuoteType, SalesQuote,
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
from sqlalchemy import text
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
        return self.repository.get_all(db, skip, limit, quote_type)
    
    def get_quote_by_id(self, db: Session, quote_id: int) -> Optional[SalesQuote]:
        """Get quote by ID"""
        return self.repository.get_by_id_with_items(db, quote_id)
    
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
        skip = (page - 1) * per_page
        quotes, total = self.repository.get_filtered(db, filters, skip, per_page)
        pages = (total + per_page - 1) // per_page
        return quotes, total, pages
    
    def create_quote(
        self,
        db: Session,
        quote_data: SalesQuoteCreate,
        created_by: Optional[int] = None
    ) -> SalesQuote:
        """Create a new quote (quotation or proforma)"""
        
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
            status=QuoteStatus.DRAFT.value,
            approval=False,
            is_estimate=is_estimate,
            remarks=quote_data.remarks,
            customer_notes=quote_data.customer_notes,
            special=quote_data.special,
            discount_type=quote_data.discount_type.value if quote_data.discount_type else 'none',
            discount_percentage=quote_data.discount_value or 0,
            tax_mode=quote_data.tax_mode or 'none',
            tax_rate=quote_data.tax_rate or 0,
            total_amount=0
        )
        
        # Add items
        for item_data in quote_data.items:
            item = self._create_quote_item(item_data, now)
            quote.items.append(item)
        
        # Calculate totals
        self._calculate_quote_totals(quote)
        
        # Save to database
        return self.repository.create(db, quote)
    
    def update_quote(
        self,
        db: Session,
        quote_id: int,
        quote_data: SalesQuoteUpdate
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
        
        # Check if quote can be edited (not converted or cancelled)
        if quote.status in [QuoteStatus.CONVERTED.value, QuoteStatus.CANCELLED.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit quote in '{quote.status}' status"
            )
        
        # ── Validate customer is active (if customer is being changed) ──
        update_dict = quote_data.model_dump(exclude_unset=True, exclude={'items'})
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
        update_data = quote_data.model_dump(exclude_unset=True, exclude={'items'})
        for key, value in update_data.items():
            if value is not None:
                if key == 'discount_type':
                    setattr(quote, key, value.value)
                elif key == 'discount_value':
                    setattr(quote, 'discount_percentage', value)
                else:
                    setattr(quote, key, value)
        
        # Update items if provided
        if quote_data.items is not None:
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
        
        return self.repository.update(db, quote)
    
    def delete_quote(self, db: Session, quote_id: int) -> bool:
        """Delete a quote"""
        quote = self.repository.get_by_id(db, quote_id)
        
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        # Only prevent deletion of converted or cancelled quotes
        if quote.status in [QuoteStatus.CONVERTED.value, QuoteStatus.CANCELLED.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete quote in '{quote.status}' status."
            )
        
        return self.repository.delete(db, quote_id)
    
    # ==================== Status Management ====================
    
    def update_status(
        self,
        db: Session,
        quote_id: int,
        status_update: SalesQuoteStatusUpdate
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
        
        return self.repository.update(db, quote)
    
    def submit_for_approval(self, db: Session, quote_id: int) -> SalesQuote:
        """Submit quote for approval"""
        return self.update_status(
            db, quote_id,
            SalesQuoteStatusUpdate(status=QuoteStatusEnum.PENDING_APPROVAL)
        )
    
    def submit_to_customer(self, db: Session, quote_id: int) -> SalesQuote:
        """Submit quote to customer - updates status and sets submitted_date"""
        # Lock the quote row to prevent concurrent status changes
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        # Can submit from draft, pending_approval, or approved
        valid_from = [QuoteStatus.DRAFT.value, QuoteStatus.PENDING_APPROVAL.value, QuoteStatus.APPROVED.value]
        if quote.status not in valid_from:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit quote in '{quote.status}' status. Must be draft, pending_approval, or approved."
            )
        
        now = tz.now()
        quote.status = QuoteStatus.SUBMITTED.value
        quote.submitted_date = now
        
        return self.repository.update(db, quote)
    
    def mark_under_review(self, db: Session, quote_id: int) -> SalesQuote:
        """Mark quote as under review by customer (proforma stage)"""
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
    
    def toggle_proforma(self, db: Session, quote_id: int, is_proforma: bool) -> SalesQuote:
        """Promote a quotation to proforma invoice type (one-way: quotation → proforma only)"""
        # Lock the quote row to prevent concurrent type/status changes
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        # Only allow toggle before conversion
        if quote.status in [QuoteStatus.CONVERTED.value, QuoteStatus.CONVERTED_TO_INVOICE.value, QuoteStatus.CANCELLED.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot change type in '{quote.status}' status"
            )
        
        # Enforce one-way: a Quotation can be promoted to Proforma, but not the reverse
        if not is_proforma:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A Proforma Invoice cannot be converted back to a Quotation. Create a new Quotation instead."
            )
        
        # Only quotations can be promoted
        if quote.quote_type != QuoteType.QUOTATION.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only a Quotation can be promoted to a Proforma Invoice."
            )
        
        quote.quote_type = QuoteType.PROFORMA.value
        quote.is_estimate = False
        
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
            QuoteStatus.DRAFT.value,
            QuoteStatus.SUBMITTED.value, QuoteStatus.UNDER_REVIEW.value,
            QuoteStatus.SENT.value, QuoteStatus.PO_CREATED.value
        ]
        if quote.status not in valid_from:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve from '{quote.status}'. Must be draft, submitted, under_review, sent, or po_created."
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
    
    def approve_quote(self, db: Session, quote_id: int) -> SalesQuote:
        """Approve a quote"""
        return self.update_status(
            db, quote_id,
            SalesQuoteStatusUpdate(status=QuoteStatusEnum.APPROVED)
        )
    
    def reject_quote(self, db: Session, quote_id: int, reason: Optional[str] = None, cancel_linked_po: bool = False) -> SalesQuote:
        """Reject a quote with optional reason and optional PO cancellation"""
        # Lock the quote row to prevent concurrent approve/reject race
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        
        # Allow rejection from most non-final statuses
        non_rejectable = [QuoteStatus.CONVERTED.value, QuoteStatus.CONVERTED_TO_INVOICE.value, QuoteStatus.CANCELLED.value, QuoteStatus.REVISED.value, QuoteStatus.REJECTED.value]
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
        
        return self.repository.update(db, quote)
    
    def mark_as_sent(self, db: Session, quote_id: int) -> SalesQuote:
        """Mark quote as sent to customer. Allowed from DRAFT or SENT (idempotent)."""
        quote = db.query(SalesQuote).filter(SalesQuote.id == quote_id).with_for_update().first()
        if not quote:
            raise HTTPException(status_code=404, detail=f"Quote {quote_id} not found")
        if quote.status not in (QuoteStatus.DRAFT.value, QuoteStatus.SENT.value):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot mark as sent: quotation is already '{quote.status}'"
            )
        quote.status = QuoteStatus.SENT.value
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
        quote.status = QuoteStatus.CANCELLED.value
        if reason:
            quote.remarks = reason
        # Cancel all items that haven't been converted to an SO yet
        for item in quote.items:
            if item.item_status not in ("so_created", "completed", "cancelled"):
                item.item_status = "cancelled"
        return self.repository.update(db, quote)
    
    # ==================== Conversion to Invoice ====================

    def _recompute_quote_status(self, db: Session, quote: SalesQuote) -> None:
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
            QuoteStatus.CONVERTED_TO_INVOICE.value,
            QuoteStatus.CONVERTED.value,
        }
        if quote.status in terminal:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot create SO — quotation is in terminal status: {quote.status}"
            )

        # Build a lookup of quote items by id
        item_map = {i.id: i for i in quote.items}

        # Validate requested items and quantities
        invoice_items_to_create = []
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
            invoice_items_to_create.append((qi, req_item.quantity))

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

        for qi, qty in invoice_items_to_create:
            db.add(InvoiceItems(
                invoice_id=invoice.id,
                product_id=qi.product_id,
                quantity=qty,
                selling_price=qi.selling_price,
                minimum_selling_price=qi.minimum_selling_price,
                warrenty_month=qi.warrenty_month,
                created_date=now,
            ))
            qi.converted_qty = (qi.converted_qty or 0) + qty
            # Mark item as so_created regardless of partial or full qty
            qi.item_status = "so_created"

        # Recompute overall quote status
        self._recompute_quote_status(db, quote)
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

        self._recompute_quote_status(db, quote)
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

        self._recompute_quote_status(db, quote)
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
        for qi in db.query(SalesQuoteItem).filter(
            SalesQuoteItem.quote_id == quote_id,
            SalesQuoteItem.product_id.in_(product_ids),
            SalesQuoteItem.item_status == "procurement",
        ).all():
            qi.item_status = "itn_created"
            qi.stock_status = "in_stock"

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
        self._recompute_quote_status(db, quote)
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
        """Convert quote/proforma to invoice"""
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
        
        # Check if already converted
        if quote.status in [QuoteStatus.CONVERTED.value, QuoteStatus.CONVERTED_TO_INVOICE.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Quote has already been converted to an invoice"
            )
        
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
        db.refresh(original_quote, attribute_names=["items"])
        
        # Only quotations can have revisions
        if original_quote.quote_type != QuoteType.QUOTATION.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only quotations can have revisions. For proforma, create a new document."
            )
        
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
                remark=orig_item.remark
            )
            new_quote.items.append(new_item)
        
        # Mark original as revised
        original_quote.status = QuoteStatus.REVISED.value
        
        db.add(new_quote)
        db.commit()
        db.refresh(new_quote)
        
        return new_quote
    
    # ==================== Helper Methods ====================
    
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
            discount_percentage=item_data.discount_percent
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
        ACCEPTED, PO_CREATED) are still supported for backwards-compat endpoints
        like approve_quote, submit_for_approval, mark_as_accepted.  They can
        transition forward freely but never backwards.
        """
        FINAL = {QuoteStatus.COMPLETED.value, QuoteStatus.CANCELLED.value,
                 QuoteStatus.CONVERTED_TO_INVOICE.value, QuoteStatus.REVISED.value}

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
                "stock_status": 'in_stock' if is_sufficient else ('needs_transfer' if other_branches else 'needs_procurement')
            })
        
        if update_items:
            db.commit()
        
        return {
            "quote_id": quote_id,
            "branch_code": quote.branch_code,
            "items": items_availability,
            "all_sufficient": all_sufficient
        }
    
    # ==================== Create PO from Quotation ====================
    
    def create_po_from_quote(
        self,
        db: Session,
        quote_id: int,
        po_data: dict,
        created_by: Optional[int] = None
    ):
        """Create a Purchasing Order from an accepted/approved quotation"""
        from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems

        # Lock the quote row to prevent concurrent PO creation
        quote = db.query(SalesQuote).filter(
            SalesQuote.id == quote_id
        ).with_for_update().first()
        if not quote:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Quote with ID {quote_id} not found"
            )
        db.refresh(quote, attribute_names=["items"])
        
        # Must be in an active, non-terminal status
        terminal = {
            QuoteStatus.COMPLETED.value,
            QuoteStatus.CANCELLED.value,
            QuoteStatus.REVISED.value,
            QuoteStatus.CONVERTED_TO_INVOICE.value,
        }
        if quote.status in terminal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create PO from a quote in terminal status: '{quote.status}'"
            )
        
        # Generate PO number
        now = tz.now()
        year = now.year
        
        # Acquire advisory lock to prevent duplicate PO numbers
        prefix = f"PO-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        
        last_po = db.query(PurchasingOrder).filter(
            PurchasingOrder.purchasing_order_no.like(f"PO-{year}-%")
        ).order_by(PurchasingOrder.id.desc()).first()
        
        if last_po:
            try:
                last_seq = int(last_po.purchasing_order_no.split('-')[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        
        po_no = f"PO-{year}-{next_seq:05d}"
        
        # Create PO
        po = PurchasingOrder(
            purchasing_order_no=po_no,
            purchasing_invoice_no=po_data.get("purchasing_invoice_no", po_no),
            branch_code=quote.branch_code,
            payment_method=po_data.get("payment_method", "credit"),
            purchasing_order_date=now.date(),
            good_received_note_date=po_data.get("good_received_note_date", now.date()),
            remarks=po_data.get("remarks", f"Created from quotation {quote.quote_no}"),
            credit_date=po_data.get("credit_date"),
            created_date=now.date(),
            first_suppliers_id=po_data["first_suppliers_id"],
            second_suppliers_id=po_data["second_suppliers_id"],
            added_date=now,
            status="pending",
            sales_quote_id=quote.id
        )
        
        db.add(po)
        db.flush()  # Get PO ID
        
        # Create PO items from remaining quote quantities
        # Skip items that have already been procured / fulfilled
        skipped_statuses = ("po_created", "itn_created", "so_created", "completed", "cancelled")
        po_items_created = 0
        for quote_item in quote.items:
            if quote_item.item_status in skipped_statuses:
                continue
            remaining_qty = quote_item.quantity - (quote_item.converted_qty or 0)
            if remaining_qty <= 0:
                continue
            po_item = PurchasingOrderItems(
                quantity=remaining_qty,
                unit_price=quote_item.selling_price,
                warrenty_month=quote_item.warrenty_month,
                remark=quote_item.remark or "",
                created_date=now.date(),
                product_id=quote_item.product_id,
                purchasingorders_id=po.id,
                added_date=now
            )
            db.add(po_item)
            quote_item.item_status = "procurement"
            po_items_created += 1

        if po_items_created == 0:
            raise HTTPException(
                status_code=400,
                detail="No items require procurement — all items are already fulfilled or cancelled."
            )
        
        # Update quote status based on item statuses
        quote.po_created_date = now
        quote.linked_po_id = po.id
        self._recompute_quote_status(db, quote)
        
        db.commit()
        db.refresh(po)
        
        return po
    
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
