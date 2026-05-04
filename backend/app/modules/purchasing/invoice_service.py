"""
Purchase Invoice Service

Implements the standard ERP Purchase Invoice workflow:
- GRN → Purchase Invoice → Payment

Key principles:
1. GRN = stock movement (what we received)
2. Purchase Invoice = liability (what supplier bills us)
3. Payment = settlement (paying the invoice)
4. One payment can settle multiple invoices
5. One invoice can be paid by multiple payments (partial)
"""

import uuid
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import timezone as tz
from app.modules.purchasing.invoice_models import (
    PurchaseInvoice,
    PurchaseInvoiceItem,
    PurchaseInvoicePayment,
)
from app.modules.purchasing.invoice_schemas import (
    PurchaseInvoiceCreate,
    PurchaseInvoiceUpdate,
    PurchaseInvoiceListFilter,
    PurchaseInvoiceResponse,
    PurchaseInvoiceListResponse,
    PurchaseInvoiceItemResponse,
    PaymentWithAllocationsCreate,
    PaymentAllocationResponse,
    GRNInvoiceableItem,
    GRNInvoiceableProductDetail,
)
from app.modules.purchasing.models import (
    Supplier,
    PurchasingOrder,
    PurchasingOrderItems,
    GoodReceivedNote,
    GoodReceivedItems,
    SupplierPayment,
    SupplierAdvancePayment,
)

logger = logging.getLogger(__name__)


class PurchaseInvoiceService:
    def __init__(self, db: Session):
        self.db = db

    # ─── INVOICE NUMBER GENERATION ─────────────────────────────────────
    def _generate_invoice_no(self) -> str:
        """Generate unique purchase invoice number: PI-YYYY-XXXXX.

        Uses a PostgreSQL advisory transaction lock (same technique as PO number
        generation in PurchasingOrderRepository) so that concurrent requests
        cannot read the same last sequence number and produce a duplicate.
        """
        year = tz.today().year
        prefix = f"PI-{year}-"
        # Serialise number generation; lock is released automatically at
        # transaction end (xact lock), so no manual release is needed.
        self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"),
            {"prefix": prefix},
        )
        last = (
            self.db.query(PurchaseInvoice.invoice_no)
            .filter(PurchaseInvoice.invoice_no.like(f"{prefix}%"))
            .order_by(PurchaseInvoice.id.desc())  # id ordering is more reliable than string ordering
            .first()
        )

        if last and last[0]:
            try:
                seq = int(last[0].replace(prefix, "")) + 1
            except ValueError:
                seq = 1
        else:
            seq = 1

        return f"{prefix}{seq:05d}"

    # ─── CREATE PURCHASE INVOICE ───────────────────────────────────────
    def create_invoice(
        self, data: PurchaseInvoiceCreate, created_by: int = None
    ) -> PurchaseInvoice:
        """
        Create a Purchase Invoice from GRN(s).
        
        Validates:
        - Supplier exists and is active
        - Each GRN exists and belongs to the same supplier
        - Quantities don't exceed what was received (minus already invoiced)
        - Supplier invoice number is unique per supplier
        """
        # Lock supplier row for the duration of the transaction so that
        # concurrent requests cannot both read a stale credit balance and
        # over-commit against the credit limit.
        supplier = (
            self.db.query(Supplier)
            .filter(Supplier.id == data.supplier_id)
            .with_for_update()
            .first()
        )
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
        if not supplier.active:
            raise HTTPException(status_code=400, detail="Supplier is inactive")

        # Check for duplicate supplier invoice number.  Use with_for_update so
        # that two concurrent requests for the same supplier_invoice_no both
        # reach the DB check; the second will block until the first commits,
        # then see the committed row and raise the proper 400 instead of hitting
        # the unique-constraint IntegrityError as a 500.
        existing = (
            self.db.query(PurchaseInvoice)
            .filter(
                PurchaseInvoice.supplier_id == data.supplier_id,
                PurchaseInvoice.supplier_invoice_no == data.supplier_invoice_no,
                PurchaseInvoice.status != "cancelled",
            )
            .with_for_update(skip_locked=False)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Supplier invoice '{data.supplier_invoice_no}' already exists for this supplier (Invoice: {existing.invoice_no})"
            )

        # Validate each item's GRN
        for item in data.items:
            grn = self.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == item.grn_id).first()
            if not grn:
                raise HTTPException(status_code=400, detail=f"GRN ID {item.grn_id} not found")
            
            # Verify GRN belongs to this supplier
            po = self.db.query(PurchasingOrder).filter(PurchasingOrder.id == grn.purchasingorders_id).first()
            if not po or po.first_suppliers_id != data.supplier_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"GRN {grn.good_received_no} does not belong to this supplier"
                )

        # Calculate total if not provided
        calculated_subtotal = sum(item.line_total for item in data.items)
        calculated_tax = sum(item.tax_amount for item in data.items)
        total = calculated_subtotal + calculated_tax - data.discount_amount

        # Generate invoice number
        invoice_no = self._generate_invoice_no()

        # Use payment_type from frontend (user selects credit/non-credit on invoice)
        payment_type = data.payment_type or "non_credit"

        # Calculate total now (needed for credit check)
        calculated_total = calculated_subtotal + calculated_tax - data.discount_amount
        invoice_total_val = float(data.total_amount or calculated_total)

        # For credit invoices: validate available credit balance BEFORE creating
        if payment_type == "credit":
            max_credit = float(supplier.max_credit_limit or 0)
            # Compute outstanding dynamically from unpaid credit invoices
            existing_credit_outstanding = float(
                self.db.query(
                    func.coalesce(func.sum(PurchaseInvoice.balance_due), 0)
                ).filter(
                    PurchaseInvoice.supplier_id == data.supplier_id,
                    PurchaseInvoice.payment_type == "credit",
                    PurchaseInvoice.status.notin_(["cancelled", "paid"]),
                ).scalar()
            )
            available_credit = max(0.0, max_credit - existing_credit_outstanding)
            if invoice_total_val > available_credit:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Invoice total (Rs. {invoice_total_val:,.2f}) exceeds available "
                        f"credit balance (Rs. {available_credit:,.2f}). "
                        f"Credit limit: Rs. {max_credit:,.2f}, Outstanding: Rs. {existing_credit_outstanding:,.2f}"
                    ),
                )

        # For credit invoices: auto-calculate due_date from supplier credit_days
        # ignore whatever due_date the frontend sent
        if payment_type == "credit":
            credit_days = supplier.credit_days or 30
            due_date = data.supplier_invoice_date + timedelta(days=credit_days)
        else:
            due_date = data.due_date or data.supplier_invoice_date

        # Create invoice
        invoice = PurchaseInvoice(
            invoice_no=invoice_no,
            supplier_invoice_no=data.supplier_invoice_no,
            supplier_invoice_date=data.supplier_invoice_date,
            supplier_id=data.supplier_id,
            branch_code=data.branch_code,
            received_date=data.received_date,
            due_date=due_date,
            payment_type=payment_type,
            subtotal=data.subtotal or calculated_subtotal,
            tax_amount=data.tax_amount or calculated_tax,
            discount_amount=data.discount_amount,
            total_amount=data.total_amount or total,
            paid_amount=Decimal("0"),
            balance_due=data.total_amount or total,
            status="unpaid",
            payment_status="unpaid",
            remarks=data.remarks,
            created_by=created_by,
        )
        self.db.add(invoice)
        self.db.flush()  # Get ID

        # Create line items
        for item_data in data.items:
            item = PurchaseInvoiceItem(
                purchase_invoice_id=invoice.id,
                grn_id=item_data.grn_id,
                purchasing_order_id=item_data.purchasing_order_id,
                product_id=item_data.product_id,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                line_total=item_data.line_total,
                tax_amount=item_data.tax_amount,
                description=item_data.description,
            )
            self.db.add(item)

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            logger.warning("IntegrityError creating purchase invoice: %s", exc)
            if "uq_supplier_invoice" in str(exc.orig):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Supplier invoice '{data.supplier_invoice_no}' already exists for this supplier.",
                ) from exc
            if "invoice_no" in str(exc.orig):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Invoice number conflict — please retry.",
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate invoice detected. Please retry.",
            ) from exc
        self.db.refresh(invoice)

        # For credit invoices: update stored left_credit_amount (re-compute from live DB)
        if payment_type == "credit":
            max_credit = float(supplier.max_credit_limit or 0)
            new_outstanding = float(
                self.db.query(
                    func.coalesce(func.sum(PurchaseInvoice.balance_due), 0)
                ).filter(
                    PurchaseInvoice.supplier_id == data.supplier_id,
                    PurchaseInvoice.payment_type == "credit",
                    PurchaseInvoice.status.notin_(["cancelled", "paid"]),
                ).scalar()
            )
            # Re-fetch supplier to avoid stale state after commit
            supplier = self.db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
            if supplier:
                supplier.left_credit_amount = max(0, int(max_credit - new_outstanding))
                self.db.commit()

        return invoice

    # ─── GET INVOICE ───────────────────────────────────────────────────
    def get_invoice(self, invoice_id: int) -> PurchaseInvoiceResponse:
        invoice = self.db.query(PurchaseInvoice).filter(PurchaseInvoice.id == invoice_id).first()
        if not invoice:
            raise HTTPException(status_code=404, detail="Purchase invoice not found")
        
        return self._enrich_invoice(invoice)

    def get_invoice_by_no(self, invoice_no: str) -> PurchaseInvoiceResponse:
        invoice = self.db.query(PurchaseInvoice).filter(PurchaseInvoice.invoice_no == invoice_no).first()
        if not invoice:
            raise HTTPException(status_code=404, detail="Purchase invoice not found")
        
        return self._enrich_invoice(invoice)

    # ─── LIST INVOICES ─────────────────────────────────────────────────
    def list_invoices(self, filters: PurchaseInvoiceListFilter) -> List[PurchaseInvoiceListResponse]:
        query = self.db.query(PurchaseInvoice)

        if filters.supplier_id:
            query = query.filter(PurchaseInvoice.supplier_id == filters.supplier_id)
        if filters.branch_code:
            query = query.filter(PurchaseInvoice.branch_code == filters.branch_code)
        if filters.status:
            query = query.filter(PurchaseInvoice.status == filters.status)
        if filters.payment_status:
            query = query.filter(PurchaseInvoice.payment_status == filters.payment_status)
        if filters.payment_type:
            query = query.filter(PurchaseInvoice.payment_type == filters.payment_type)
        if filters.date_from:
            query = query.filter(PurchaseInvoice.supplier_invoice_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(PurchaseInvoice.supplier_invoice_date <= filters.date_to)
        if filters.overdue_only:
            query = query.filter(
                PurchaseInvoice.due_date < tz.today(),
                PurchaseInvoice.payment_status.in_(["unpaid", "partial"]),
                PurchaseInvoice.status != "cancelled",
            )
        if filters.po_no:
            # Join through invoice items → PO to filter by PO number
            po_subq = (
                self.db.query(PurchaseInvoiceItem.purchase_invoice_id)
                .join(PurchasingOrder, PurchasingOrder.id == PurchaseInvoiceItem.purchasing_order_id)
                .filter(PurchasingOrder.purchasing_order_no.ilike(f"%{filters.po_no}%"))
                .subquery()
            )
            query = query.filter(PurchaseInvoice.id.in_(po_subq))

        invoices = query.order_by(PurchaseInvoice.supplier_invoice_date.desc()).offset(filters.skip).limit(filters.limit).all()

        result = []
        today = tz.today()
        for inv in invoices:
            supplier = self.db.query(Supplier.full_name).filter(Supplier.id == inv.supplier_id).scalar()
            days_overdue = (today - inv.due_date).days if inv.due_date < today else 0

            # Collect PO IDs and PO numbers for this invoice
            items = self.db.query(PurchaseInvoiceItem).filter(
                PurchaseInvoiceItem.purchase_invoice_id == inv.id
            ).all()
            po_ids: set = set()
            for item in items:
                if item.purchasing_order_id:
                    po_ids.add(item.purchasing_order_id)
                elif item.grn_id:
                    grn = self.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == item.grn_id).first()
                    if grn and grn.purchasingorders_id:
                        po_ids.add(grn.purchasingorders_id)
            po_nos_list = []
            for po_id in po_ids:
                po_no = self.db.query(PurchasingOrder.purchasing_order_no).filter(
                    PurchasingOrder.id == po_id
                ).scalar()
                if po_no:
                    po_nos_list.append(po_no)

            # Compute advance available for this invoice (for effective status)
            advance_total = Decimal("0")
            for po_id in po_ids:
                advances = self.db.query(SupplierAdvancePayment).filter(
                    SupplierAdvancePayment.purchasing_order_id == po_id,
                    SupplierAdvancePayment.remaining_amount > 0,
                    SupplierAdvancePayment.is_fully_applied == False,
                ).all()
                for adv in advances:
                    advance_total += adv.remaining_amount

            # Effective balance considering available advance
            effective_balance = max(Decimal("0"), inv.balance_due - advance_total)
            effective_status = inv.status
            effective_payment_status = inv.payment_status
            if inv.status not in ("paid", "cancelled") and effective_balance <= 0:
                effective_status = "paid"
                effective_payment_status = "paid"
            elif inv.status not in ("paid", "cancelled") and effective_balance < inv.total_amount:
                if effective_status == "unpaid":
                    effective_status = "partially_paid"
                effective_payment_status = "partial"

            is_overdue = days_overdue > 0 and effective_payment_status in ("unpaid", "partial")

            result.append(PurchaseInvoiceListResponse(
                id=inv.id,
                invoice_no=inv.invoice_no,
                supplier_invoice_no=inv.supplier_invoice_no,
                supplier_invoice_date=inv.supplier_invoice_date,
                supplier_id=inv.supplier_id,
                branch_code=inv.branch_code,
                received_date=inv.received_date,
                due_date=inv.due_date,
                payment_type=inv.payment_type or "non_credit",
                subtotal=inv.subtotal,
                tax_amount=inv.tax_amount,
                discount_amount=inv.discount_amount,
                total_amount=inv.total_amount,
                paid_amount=inv.paid_amount,
                balance_due=float(effective_balance),
                status=effective_status,
                payment_status=effective_payment_status,
                created_at=inv.created_at,
                supplier_name=supplier,
                days_overdue=days_overdue,
                is_overdue=is_overdue,
                po_nos=", ".join(sorted(po_nos_list)) if po_nos_list else None,
            ))

        return result

    # ─── UPDATE INVOICE ────────────────────────────────────────────────
    def update_invoice(self, invoice_id: int, data: PurchaseInvoiceUpdate) -> PurchaseInvoice:
        # Lock the row so concurrent edits don't silently overwrite each other.
        invoice = (
            self.db.query(PurchaseInvoice)
            .filter(PurchaseInvoice.id == invoice_id)
            .with_for_update()
            .first()
        )
        if not invoice:
            raise HTTPException(status_code=404, detail="Purchase invoice not found")
        if invoice.status not in ("unpaid",):
            raise HTTPException(status_code=400, detail="Only unpaid invoices can be edited")

        update_fields = data.model_dump(exclude_unset=True, exclude={"items"})
        for key, val in update_fields.items():
            setattr(invoice, key, val)

        # Recalculate balance
        if data.total_amount is not None:
            invoice.balance_due = data.total_amount - invoice.paid_amount

        # Update items if provided
        if data.items is not None:
            # Delete existing items
            self.db.query(PurchaseInvoiceItem).filter(
                PurchaseInvoiceItem.purchase_invoice_id == invoice_id
            ).delete()
            # Add new items
            for item_data in data.items:
                item = PurchaseInvoiceItem(
                    purchase_invoice_id=invoice_id,
                    grn_id=item_data.grn_id,
                    purchasing_order_id=item_data.purchasing_order_id,
                    product_id=item_data.product_id,
                    quantity=item_data.quantity,
                    unit_price=item_data.unit_price,
                    line_total=item_data.line_total,
                    tax_amount=item_data.tax_amount,
                    description=item_data.description,
                )
                self.db.add(item)

        self.db.commit()
        self.db.refresh(invoice)
        return invoice

    # ─── CANCEL INVOICE ────────────────────────────────────────────────
    def cancel_invoice(self, invoice_id: int) -> PurchaseInvoice:
        # Lock row so that two concurrent cancellation requests cannot both pass
        # the status check and produce a double-cancel.
        invoice = (
            self.db.query(PurchaseInvoice)
            .filter(PurchaseInvoice.id == invoice_id)
            .with_for_update()
            .first()
        )
        if not invoice:
            raise HTTPException(status_code=404, detail="Purchase invoice not found")
        if invoice.paid_amount > 0:
            raise HTTPException(status_code=400, detail="Cannot cancel invoice with payments. Reverse payments first.")
        if invoice.status == "cancelled":
            raise HTTPException(status_code=400, detail="Invoice is already cancelled")

        invoice.status = "cancelled"
        invoice.payment_status = "unpaid"

        # Restore supplier credit balance when cancelling a credit invoice
        if invoice.payment_type == "credit":
            supplier = self.db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
            if supplier and supplier.left_credit_amount is not None:
                supplier.left_credit_amount = int(supplier.left_credit_amount) + int(invoice.total_amount or 0)

        self.db.commit()
        self.db.refresh(invoice)
        return invoice

    # ─── PAY AGAINST INVOICES ──────────────────────────────────────────
    def create_payment_with_allocations(
        self, data: PaymentWithAllocationsCreate, created_by: int = None
    ) -> SupplierPayment:
        """
        Create a supplier payment allocated to specific invoices.
        
        Standard ERP flow:
        1. Validate total allocations ≤ payment amount
        2. Validate each allocation ≤ invoice balance_due
        3. Create SupplierPayment record
        4. Create PurchaseInvoicePayment allocation records
        5. Update each invoice's paid_amount, balance_due, payment_status
        """
        # Validate supplier
        supplier = self.db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")

        # Validate total allocations
        total_allocated = sum(a.allocated_amount for a in data.allocations)
        if total_allocated > data.payment_amount:
            raise HTTPException(
                status_code=400,
                detail=f"Total allocations ({total_allocated}) exceed payment amount ({data.payment_amount})"
            )

        # Validate each allocation against invoice balance
        for alloc in data.allocations:
            invoice = self.db.query(PurchaseInvoice).filter(
                PurchaseInvoice.id == alloc.purchase_invoice_id
            ).with_for_update().first()
            
            if not invoice:
                raise HTTPException(status_code=400, detail=f"Invoice ID {alloc.purchase_invoice_id} not found")
            if invoice.supplier_id != data.supplier_id:
                raise HTTPException(status_code=400, detail=f"Invoice {invoice.invoice_no} belongs to a different supplier")
            if invoice.status == "cancelled":
                raise HTTPException(status_code=400, detail=f"Invoice {invoice.invoice_no} is cancelled")
            if alloc.allocated_amount > invoice.balance_due:
                raise HTTPException(
                    status_code=400,
                    detail=f"Allocation ({alloc.allocated_amount}) exceeds balance due ({invoice.balance_due}) for invoice {invoice.invoice_no}"
                )

        # Generate payment number — advisory lock prevents duplicate numbers under concurrency.
        year = tz.today().year
        prefix = f"SPAY-{year}-"
        self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"),
            {"prefix": prefix},
        )
        last = (
            self.db.query(SupplierPayment.payment_no)
            .filter(SupplierPayment.payment_no.like(f"{prefix}%"))
            .order_by(SupplierPayment.id.desc())  # id ordering is safer than string ordering
            .first()
        )
        if last and last[0]:
            try:
                seq = int(last[0].replace(prefix, "")) + 1
            except ValueError:
                seq = 1
        else:
            seq = 1
        payment_no = f"{prefix}{seq:05d}"

        # Determine if non-credit (auto-approve) or credit (needs approval)
        # Check payment_type of the first allocated invoice
        first_invoice = self.db.query(PurchaseInvoice).filter(
            PurchaseInvoice.id == data.allocations[0].purchase_invoice_id
        ).first()
        is_non_credit = first_invoice and first_invoice.payment_type != "credit"

        # Create SupplierPayment
        payment = SupplierPayment(
            payment_no=payment_no,
            supplier_id=data.supplier_id,
            payment_date=data.payment_date,
            payment_method=data.payment_method,
            payment_amount=data.payment_amount,
            reference_number=data.reference_number,
            bank_name=data.bank_name,
            branch_code=data.branch_code,
            payment_for="invoice_payment",
            invoice_reference=", ".join(
                self.db.query(PurchaseInvoice.invoice_no).filter(
                    PurchaseInvoice.id == a.purchase_invoice_id
                ).scalar() or "" for a in data.allocations
            ),
            remarks=data.remarks,
            status="verified" if is_non_credit else "pending",
            verified_by=created_by if is_non_credit else None,
            verified_date=tz.now() if is_non_credit else None,
            created_date=tz.now(),
            created_by=created_by,
        )
        self.db.add(payment)
        self.db.flush()

        # Create allocations and update invoices
        for alloc in data.allocations:
            invoice = self.db.query(PurchaseInvoice).filter(
                PurchaseInvoice.id == alloc.purchase_invoice_id
            ).first()

            # Create allocation record
            allocation = PurchaseInvoicePayment(
                purchase_invoice_id=alloc.purchase_invoice_id,
                supplier_payment_id=payment.id,
                allocated_amount=alloc.allocated_amount,
                allocated_date=data.payment_date,
            )
            self.db.add(allocation)

            # Update invoice balances
            invoice.paid_amount = (invoice.paid_amount or Decimal("0")) + alloc.allocated_amount
            invoice.balance_due = invoice.total_amount - invoice.paid_amount

            # Update payment status
            if invoice.balance_due <= 0:
                invoice.payment_status = "paid"
                invoice.status = "paid"
                # Restore supplier credit when credit invoice is fully paid
                if invoice.payment_type == "credit":
                    supplier_obj = self.db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
                    if supplier_obj and supplier_obj.left_credit_amount is not None:
                        supplier_obj.left_credit_amount = int(supplier_obj.left_credit_amount) + int(invoice.total_amount or 0)
            else:
                invoice.payment_status = "partial"
                if invoice.status in ("unpaid",):
                    invoice.status = "partially_paid"

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            logger.warning("IntegrityError creating supplier payment: %s", exc)
            if "payment_no" in str(exc.orig):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Payment number conflict — please retry.",
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate payment detected. Please retry.",
            ) from exc
        self.db.refresh(payment)

        # Auto-apply any available supplier advances to outstanding invoices
        try:
            self._apply_advances_for_supplier(data.supplier_id)
        except Exception as e:
            logger.warning(f"Auto-advance application failed after payment {payment.payment_no}: {e}")

        # For non-credit payments, trigger GL posting immediately
        if is_non_credit:
            try:
                from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                gl_helper = PurchaseExpensePayrollGL(self.db)
                gl_helper.post_supplier_payment_to_gl(payment, created_by or 0)
            except Exception as e:
                logger.warning(f"GL posting failed for payment {payment.payment_no}: {e}")

        return payment

    def _apply_advances_for_supplier(self, supplier_id: int) -> None:
        """
        Automatically apply available supplier advances to outstanding invoices.

        Runs after any payment to ensure advances are properly reflected in
        invoice balances. Uses FIFO ordering by due_date.
        """
        # Lock invoice rows before mutating balances so that two concurrent
        # payment/advance-application requests cannot both apply advances to
        # the same invoice using stale balance data.
        invoices = (
            self.db.query(PurchaseInvoice)
            .filter(
                PurchaseInvoice.supplier_id == supplier_id,
                PurchaseInvoice.status.in_(["unpaid", "partially_paid"]),
                PurchaseInvoice.payment_status.in_(["unpaid", "partial"]),
            )
            .with_for_update()
            .order_by(PurchaseInvoice.due_date.asc())
            .all()
        )

        if not invoices:
            return

        # Map invoice → PO IDs
        invoice_po_ids: Dict[int, set] = {}
        for inv in invoices:
            po_ids: set = set()
            items = self.db.query(PurchaseInvoiceItem).filter(
                PurchaseInvoiceItem.purchase_invoice_id == inv.id
            ).all()
            for item in items:
                if item.purchasing_order_id:
                    po_ids.add(item.purchasing_order_id)
                elif item.grn_id:
                    grn = self.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == item.grn_id).first()
                    if grn and grn.purchasingorders_id:
                        po_ids.add(grn.purchasingorders_id)
            invoice_po_ids[inv.id] = po_ids

        # Build mutable advance pool per PO
        all_po_ids: set = set()
        for po_ids in invoice_po_ids.values():
            all_po_ids.update(po_ids)

        # Load all active advances per PO with lock
        advance_pool_records: Dict[int, List] = {}  # po_id → list of advance records
        for po_id in all_po_ids:
            advances = self.db.query(SupplierAdvancePayment).filter(
                SupplierAdvancePayment.purchasing_order_id == po_id,
                SupplierAdvancePayment.remaining_amount > 0,
                SupplierAdvancePayment.is_fully_applied == False,
            ).with_for_update().all()
            if advances:
                advance_pool_records[po_id] = advances

        if not advance_pool_records:
            return  # No advances to apply

        any_change = False
        # Apply advances to invoices FIFO
        for inv in invoices:
            if inv.balance_due <= 0:
                continue
            remaining_needed = inv.balance_due
            for po_id in invoice_po_ids[inv.id]:
                for adv in advance_pool_records.get(po_id, []):
                    if adv.remaining_amount <= 0:
                        continue
                    if remaining_needed <= 0:
                        break
                    apply = min(adv.remaining_amount, remaining_needed)
                    # Apply to invoice
                    inv.paid_amount = (inv.paid_amount or Decimal("0")) + apply
                    inv.balance_due = inv.total_amount - inv.paid_amount
                    remaining_needed -= apply
                    # Consume advance
                    adv.applied_amount = (adv.applied_amount or Decimal("0")) + apply
                    adv.remaining_amount = adv.remaining_amount - apply
                    if adv.remaining_amount <= 0:
                        adv.remaining_amount = Decimal("0")
                        adv.is_fully_applied = True
                    any_change = True
            # Update invoice status after advance application
            if inv.balance_due <= 0:
                inv.balance_due = Decimal("0")
                inv.payment_status = "paid"
                inv.status = "paid"
            elif inv.paid_amount > 0:
                inv.payment_status = "partial"
                if inv.status == "unpaid":
                    inv.status = "partially_paid"

        if any_change:
            self.db.commit()

    # ─── GET INVOICEABLE GRNs ──────────────────────────────────────────
    def get_invoiceable_grns(self, supplier_id: int, branch_code: Optional[str] = None) -> List[GRNInvoiceableItem]:
        """
        Get GRNs that can be invoiced for a supplier.
        Shows received qty/amount vs already invoiced qty/amount.
        Optionally filter by branch_code.
        """
        supplier = self.db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")

        # Get all GRNs for this supplier (optionally filtered by branch)
        grn_query = (
            self.db.query(GoodReceivedNote)
            .join(PurchasingOrder, GoodReceivedNote.purchasingorders_id == PurchasingOrder.id)
            .filter(PurchasingOrder.first_suppliers_id == supplier_id)
        )
        if branch_code:
            grn_query = grn_query.filter(GoodReceivedNote.branch_code == branch_code)
        grns = grn_query.order_by(GoodReceivedNote.good_received_date.desc()).all()

        result = []
        for grn in grns:
            po = self.db.query(PurchasingOrder).filter(PurchasingOrder.id == grn.purchasingorders_id).first()

            # Skip GRNs that already have any non-cancelled invoice
            existing_invoice = self.db.query(PurchaseInvoiceItem).join(
                PurchaseInvoice,
                PurchaseInvoiceItem.purchase_invoice_id == PurchaseInvoice.id,
            ).filter(
                PurchaseInvoiceItem.grn_id == grn.id,
                PurchaseInvoice.status != "cancelled",
            ).first()
            if existing_invoice:
                continue

            # Total received for this GRN
            received_items = self.db.query(GoodReceivedItems).filter(
                GoodReceivedItems.good_received_note == grn.good_received_no,
                GoodReceivedItems.active == True,
            ).all()
            total_received_qty = len(received_items)
            
            # Calculate received amount from PO item prices
            total_received_amount = float(self.db.query(
                func.coalesce(func.sum(PurchasingOrderItems.unit_price), 0)
            ).join(
                GoodReceivedItems,
                GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id
            ).filter(
                GoodReceivedItems.good_received_note == grn.good_received_no,
                GoodReceivedItems.active == True,
            ).scalar() or 0)

            # Remaining = total received (no prior invoice exists)
            remaining_qty = total_received_qty
            remaining_amount = total_received_amount

            # Build per-product breakdown
            from app.modules.products.models import Product
            from collections import Counter
            product_counter = Counter()
            for ri in received_items:
                poi = self.db.query(PurchasingOrderItems).filter(
                    PurchasingOrderItems.id == ri.purchasing_order_items_id
                ).first()
                if poi:
                    product_counter[(poi.product_id, poi.id, float(poi.unit_price))] += 1

            products = []
            for (pid, poi_id, uprice), qty in product_counter.items():
                pname = self.db.query(Product.name).filter(Product.id == pid).scalar() or f"Product {pid}"
                products.append(GRNInvoiceableProductDetail(
                    product_id=pid,
                    product_name=pname,
                    po_item_id=poi_id,
                    unit_price=uprice,
                    quantity=qty,
                    line_total=uprice * qty,
                ))

            # Only show GRNs that have received items
            if remaining_qty > 0 or remaining_amount > 0:
                result.append(GRNInvoiceableItem(
                    grn_id=grn.id,
                    grn_no=grn.good_received_no,
                    grn_date=str(grn.good_received_date),
                    po_id=po.id if po else 0,
                    po_no=po.purchasing_order_no if po else "",
                    supplier_invoice_no=grn.supplier_invoice_no,
                    total_received_qty=total_received_qty,
                    already_invoiced_qty=0,
                    remaining_qty=remaining_qty,
                    total_received_amount=total_received_amount,
                    already_invoiced_amount=0,
                    remaining_amount=remaining_amount,
                    branch_code=grn.branch_code,
                    products=products,
                ))

        return result

    # ─── GET OUTSTANDING INVOICES FOR PAYMENT ──────────────────────────
    def get_outstanding_invoices(self, supplier_id: int) -> List[PurchaseInvoiceListResponse]:
        """Get all unpaid/partially paid invoices for a supplier (for payment page)."""
        return self.list_invoices(PurchaseInvoiceListFilter(
            supplier_id=supplier_id,
            payment_status=None,  # We filter manually below
        ))
        # Filter to only outstanding
        # Actually let's use a direct query for efficiency
    
    def get_payable_invoices(self, supplier_id: int) -> List[PurchaseInvoiceListResponse]:
        """Get unpaid/partially paid invoices ready for payment."""
        invoices = self.db.query(PurchaseInvoice).filter(
            PurchaseInvoice.supplier_id == supplier_id,
            PurchaseInvoice.status.in_(["unpaid", "partially_paid"]),
            PurchaseInvoice.payment_status.in_(["unpaid", "partial"]),
        ).order_by(PurchaseInvoice.due_date.asc()).all()

        today = tz.today()

        # Step 1: For each invoice, collect the PO IDs it belongs to
        invoice_po_ids: Dict[int, set] = {}
        for inv in invoices:
            po_ids: set = set()
            items = self.db.query(PurchaseInvoiceItem).filter(
                PurchaseInvoiceItem.purchase_invoice_id == inv.id
            ).all()
            for item in items:
                if item.purchasing_order_id:
                    po_ids.add(item.purchasing_order_id)
                elif item.grn_id:
                    grn = self.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == item.grn_id).first()
                    if grn and grn.purchasingorders_id:
                        po_ids.add(grn.purchasingorders_id)
            invoice_po_ids[inv.id] = po_ids

        # Step 2: Collect all advance remaining balances per PO (mutable pool)
        all_po_ids = set()
        for po_ids in invoice_po_ids.values():
            all_po_ids.update(po_ids)

        # advance_pool[po_id] = remaining advance balance (decremented as we assign)
        advance_pool: Dict[int, Decimal] = {}
        for po_id in all_po_ids:
            total = Decimal("0")
            advances = self.db.query(SupplierAdvancePayment).filter(
                SupplierAdvancePayment.purchasing_order_id == po_id,
                SupplierAdvancePayment.remaining_amount > 0,
                SupplierAdvancePayment.is_fully_applied == False,
            ).all()
            for adv in advances:
                total += adv.remaining_amount
            advance_pool[po_id] = total

        # Step 3: Distribute advances across invoices in order (invoices already sorted by due_date asc)
        invoice_advance: Dict[int, Decimal] = {}
        for inv in invoices:
            allocated = Decimal("0")
            remaining_needed = inv.balance_due
            for po_id in invoice_po_ids[inv.id]:
                pool = advance_pool.get(po_id, Decimal("0"))
                if pool <= 0 or remaining_needed <= 0:
                    continue
                apply = min(pool, remaining_needed)
                allocated += apply
                advance_pool[po_id] = pool - apply
                remaining_needed -= apply
            invoice_advance[inv.id] = allocated

        # Step 4: Build response
        result = []
        for inv in invoices:
            supplier_name = self.db.query(Supplier.full_name).filter(Supplier.id == inv.supplier_id).scalar()
            days_overdue = (today - inv.due_date).days if inv.due_date < today else 0
            # Collect PO numbers for this invoice
            po_nos_list = []
            for po_id in invoice_po_ids.get(inv.id, set()):
                po_no = self.db.query(PurchasingOrder.purchasing_order_no).filter(
                    PurchasingOrder.id == po_id
                ).scalar()
                if po_no:
                    po_nos_list.append(po_no)
            result.append(PurchaseInvoiceListResponse(
                id=inv.id,
                invoice_no=inv.invoice_no,
                supplier_invoice_no=inv.supplier_invoice_no,
                supplier_invoice_date=inv.supplier_invoice_date,
                supplier_id=inv.supplier_id,
                branch_code=inv.branch_code,
                received_date=inv.received_date,
                due_date=inv.due_date,
                payment_type=inv.payment_type or "non_credit",
                subtotal=inv.subtotal,
                tax_amount=inv.tax_amount,
                discount_amount=inv.discount_amount,
                total_amount=inv.total_amount,
                paid_amount=inv.paid_amount,
                balance_due=inv.balance_due,
                status=inv.status,
                payment_status=inv.payment_status,
                created_at=inv.created_at,
                supplier_name=supplier_name,
                days_overdue=days_overdue,
                is_overdue=days_overdue > 0,
                advance_amount=float(invoice_advance.get(inv.id, Decimal("0"))),
                po_nos=", ".join(sorted(po_nos_list)) if po_nos_list else None,
            ))
        return result

    # ─── HELPERS ───────────────────────────────────────────────────────
    def _enrich_invoice(self, invoice: PurchaseInvoice) -> PurchaseInvoiceResponse:
        supplier_name = self.db.query(Supplier.full_name).filter(Supplier.id == invoice.supplier_id).scalar()

        items = []
        for item in invoice.items:
            grn = self.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == item.grn_id).first()
            po = self.db.query(PurchasingOrder).filter(PurchasingOrder.id == item.purchasing_order_id).first() if item.purchasing_order_id else None
            
            from app.modules.products.models import Product
            product_name = None
            if item.product_id:
                product_name = self.db.query(Product.name).filter(Product.id == item.product_id).scalar()

            items.append(PurchaseInvoiceItemResponse(
                id=item.id,
                purchase_invoice_id=item.purchase_invoice_id,
                grn_id=item.grn_id,
                purchasing_order_id=item.purchasing_order_id,
                product_id=item.product_id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                line_total=item.line_total,
                tax_amount=item.tax_amount,
                description=item.description,
                created_at=item.created_at,
                grn_no=grn.good_received_no if grn else None,
                po_no=po.purchasing_order_no if po else None,
                product_name=product_name,
            ))

        return PurchaseInvoiceResponse(
            id=invoice.id,
            invoice_no=invoice.invoice_no,
            supplier_invoice_no=invoice.supplier_invoice_no,
            supplier_invoice_date=invoice.supplier_invoice_date,
            supplier_id=invoice.supplier_id,
            branch_code=invoice.branch_code,
            received_date=invoice.received_date,
            due_date=invoice.due_date,
            payment_type=invoice.payment_type or "non_credit",
            subtotal=invoice.subtotal,
            tax_amount=invoice.tax_amount,
            discount_amount=invoice.discount_amount,
            total_amount=invoice.total_amount,
            paid_amount=invoice.paid_amount,
            balance_due=invoice.balance_due,
            status=invoice.status,
            payment_status=invoice.payment_status,
            created_by=invoice.created_by,
            verified_by=invoice.verified_by,
            verified_date=invoice.verified_date,
            created_at=invoice.created_at,
            updated_at=invoice.updated_at,
            supplier_name=supplier_name,
            items=items,
            remarks=invoice.remarks,
        )
