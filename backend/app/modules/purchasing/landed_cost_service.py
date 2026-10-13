"""Landed cost vouchers: freight / duty / insurance... allocated across the lines of a GRN."""

from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List

from fastapi import HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.common.audit import log_audit
from app.core import timezone as tz
from app.modules.finance.gl_posting_service import record_gl_commit_failure
from app.modules.products.models import Product
from . import models, schemas

logger = logging.getLogger(__name__)
CENT = Decimal("0.01")


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


class LandedCostService:
    def __init__(self, db: Session):
        self.db = db

    # ---- numbering ------------------------------------------------------------------------
    def _next_voucher_no(self, branch_code: str) -> str:
        prefix = f"LCV-{branch_code or 'HQ'}-{str(tz.year())[-2:]}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": prefix})
        last = (
            self.db.query(models.LandedCostVoucher.voucher_no)
            .filter(models.LandedCostVoucher.voucher_no.like(f"{prefix}%"))
            .order_by(models.LandedCostVoucher.id.desc())
            .first()
        )
        seq = 1
        if last:
            try:
                seq = int(last[0][len(prefix):]) + 1
            except ValueError:
                seq = 1
        return f"{prefix}{seq:06d}"

    # ---- create ---------------------------------------------------------------------------
    def create(self, grn_id: int, data: schemas.LandedCostCreate, user_id: int) -> models.LandedCostVoucher:
        grn = self.db.query(models.GoodReceivedNote).filter(models.GoodReceivedNote.id == grn_id).with_for_update().first()
        if not grn:
            raise _bad("GRN not found", status.HTTP_404_NOT_FOUND)
        if grn.status != "posted":
            raise _bad("Landed cost can only be added to a posted GRN.")
        if data.supplier_id and not self.db.query(models.Supplier.id).filter(models.Supplier.id == data.supplier_id).first():
            raise _bad("Supplier not found.")

        # One weight per PO line: its received quantity on this GRN (or quantity x unit price).
        lines = (
            self.db.query(
                models.GoodReceivedItems.purchasing_order_items_id,
                func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0),
            )
            .filter(
                models.GoodReceivedItems.good_received_note == grn.good_received_no,
                models.GoodReceivedItems.active.is_(True),
            )
            .group_by(models.GoodReceivedItems.purchasing_order_items_id)
            .order_by(models.GoodReceivedItems.purchasing_order_items_id)
            .all()
        )
        if not lines:
            raise _bad("This GRN has no received lines to allocate the cost to.")
        prices = {
            pi.id: Decimal(str(pi.unit_price))
            for pi in self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.id.in_([l[0] for l in lines])
            )
        }
        weights = {
            po_item_id: Decimal(qty) * (prices[po_item_id] if data.allocation_basis == "value" else Decimal(1))
            for po_item_id, qty in lines
        }
        total_weight = sum(weights.values())
        if total_weight <= 0:
            raise _bad("Cannot allocate: the GRN lines carry no quantity/value.")

        amount = Decimal(data.amount).quantize(CENT, rounding=ROUND_HALF_UP)
        voucher = models.LandedCostVoucher(
            voucher_no=self._next_voucher_no(grn.branch_code),
            voucher_date=data.voucher_date or tz.today(),
            good_received_note_id=grn.id,
            branch_code=grn.branch_code,
            supplier_id=data.supplier_id,
            charge_type=data.charge_type,
            description=(data.description or "").strip() or None,
            amount=amount,
            allocation_basis=data.allocation_basis,
            payment_method=data.payment_method,
            reference_no=(data.reference_no or "").strip() or None,
            status="posted",
            created_by=user_id,
        )
        self.db.add(voucher)
        self.db.flush()

        allocated = Decimal("0")
        for i, (po_item_id, qty) in enumerate(lines):
            if i == len(lines) - 1:
                share = amount - allocated  # the last line takes the rounding remainder
            else:
                share = (amount * weights[po_item_id] / total_weight).quantize(CENT, rounding=ROUND_HALF_UP)
            allocated += share
            self.db.add(models.LandedCostAllocation(
                voucher_id=voucher.id, purchasing_order_items_id=po_item_id, quantity=int(qty),
                amount=share, created_by=user_id,
            ))
        self.db.flush()
        log_audit(self.db, user_id=user_id, action="create", entity_type="landed_cost_voucher", entity_id=voucher.id,
                  changes={"voucher_no": voucher.voucher_no, "grn_no": grn.good_received_no,
                           "charge_type": data.charge_type, "amount": str(amount)})
        self.db.commit()
        self.db.refresh(voucher)

        # Dr 1210 Inventory / Cr creditors|cash|bank - non-blocking, retryable
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            PurchaseExpensePayrollGL(self.db).post_landed_cost_to_gl(voucher, user_id=user_id or 0)
            self.db.commit()
        except Exception as gl_err:  # noqa: BLE001
            logger.warning("GL posting for landed cost %s failed (non-blocking): %s", voucher.voucher_no, gl_err)
            self.db.rollback()
            record_gl_commit_failure(
                self.db, reference_type="LandedCost", reference_id=voucher.id, reference_no=voucher.voucher_no,
                transaction_type="Purchase", description=f"Landed cost GL commit failed ({voucher.voucher_no})",
                error=gl_err, user_id=user_id or 0,
            )
        return voucher

    # ---- cancel ---------------------------------------------------------------------------
    def cancel(self, voucher_id: int, reason: str, user_id: int) -> models.LandedCostVoucher:
        voucher = self.db.query(models.LandedCostVoucher).filter(models.LandedCostVoucher.id == voucher_id).with_for_update().first()
        if not voucher:
            raise _bad("Landed cost voucher not found", status.HTTP_404_NOT_FOUND)
        if voucher.status == "cancelled":
            raise _bad("This landed cost voucher is already cancelled.")
        voucher.status = "cancelled"
        voucher.cancelled_at = tz.now()
        voucher.cancelled_by = user_id
        voucher.cancel_reason = reason
        log_audit(self.db, user_id=user_id, action="cancel", entity_type="landed_cost_voucher", entity_id=voucher.id,
                  changes={"voucher_no": voucher.voucher_no, "reason": reason})
        self.db.commit()
        self.db.refresh(voucher)
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            PurchaseExpensePayrollGL(self.db).post_landed_cost_cancel_to_gl(voucher, user_id=user_id or 0)
            self.db.commit()
        except Exception as gl_err:  # noqa: BLE001
            logger.warning("GL reversal for landed cost %s failed: %s", voucher.voucher_no, gl_err)
            self.db.rollback()
            record_gl_commit_failure(
                self.db, reference_type="LandedCost", reference_id=voucher.id, reference_no=voucher.voucher_no,
                transaction_type="Purchase", marker="Cancel",
                description=f"Landed cost cancel GL commit failed ({voucher.voucher_no})",
                error=gl_err, user_id=user_id or 0,
            )
        return voucher

    # ---- read -----------------------------------------------------------------------------
    def summary(self, grn_id: int) -> dict:
        grn = self.db.query(models.GoodReceivedNote).filter(models.GoodReceivedNote.id == grn_id).first()
        if not grn:
            raise _bad("GRN not found", status.HTTP_404_NOT_FOUND)
        vouchers = (
            self.db.query(models.LandedCostVoucher)
            .filter(models.LandedCostVoucher.good_received_note_id == grn_id)
            .order_by(models.LandedCostVoucher.id)
            .all()
        )
        supplier_ids = {v.supplier_id for v in vouchers if v.supplier_id}
        supplier_names: Dict[int, str] = {}
        if supplier_ids:
            supplier_names = dict(
                self.db.query(models.Supplier.id, models.Supplier.company_name).filter(models.Supplier.id.in_(supplier_ids)).all()
            )
        voucher_out: List[dict] = [
            {
                "id": v.id, "voucher_no": v.voucher_no, "voucher_date": v.voucher_date, "charge_type": v.charge_type,
                "description": v.description, "amount": v.amount, "allocation_basis": v.allocation_basis,
                "payment_method": v.payment_method, "supplier_id": v.supplier_id,
                "supplier_name": supplier_names.get(v.supplier_id), "reference_no": v.reference_no,
                "status": v.status, "cancel_reason": v.cancel_reason,
            }
            for v in vouchers
        ]

        received = dict(
            self.db.query(
                models.GoodReceivedItems.purchasing_order_items_id,
                func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0),
            )
            .filter(
                models.GoodReceivedItems.good_received_note == grn.good_received_no,
                models.GoodReceivedItems.active.is_(True),
            )
            .group_by(models.GoodReceivedItems.purchasing_order_items_id)
            .all()
        )
        landed = dict(
            self.db.query(models.LandedCostAllocation.purchasing_order_items_id, func.coalesce(func.sum(models.LandedCostAllocation.amount), 0))
            .join(models.LandedCostVoucher, models.LandedCostVoucher.id == models.LandedCostAllocation.voucher_id)
            .filter(models.LandedCostVoucher.good_received_note_id == grn_id, models.LandedCostVoucher.status == "posted")
            .group_by(models.LandedCostAllocation.purchasing_order_items_id)
            .all()
        )
        lines: List[dict] = []
        total = Decimal("0")
        if received:
            items = self.db.query(models.PurchasingOrderItems, Product.name).join(
                Product, Product.id == models.PurchasingOrderItems.product_id
            ).filter(models.PurchasingOrderItems.id.in_(received.keys())).order_by(models.PurchasingOrderItems.id).all()
            for pi, name in items:
                qty = int(received[pi.id])
                landed_total = Decimal(str(landed.get(pi.id, 0)))
                per_unit = (landed_total / qty).quantize(CENT, rounding=ROUND_HALF_UP) if qty else Decimal("0")
                total += landed_total
                lines.append({
                    "purchasing_order_items_id": pi.id, "product_name": name, "quantity": qty,
                    "unit_price": pi.unit_price, "landed_total": landed_total, "landed_per_unit": per_unit,
                    "landed_unit_cost": Decimal(str(pi.unit_price)) + per_unit,
                })
        return {"vouchers": voucher_out, "lines": lines, "total_landed": total}
