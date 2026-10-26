"""
GL posting regenerators
=======================

A ``commit_failed`` row in ``gl_posting_failures`` is written by a module hook
whose journal entry was built by :meth:`GLPostingService.post` but whose outer
``commit()`` then failed (see :func:`record_gl_commit_failure`). Those rows carry
no lines - the hook never handed them over - so "retry" cannot replay a payload.

Instead the retry reloads the *source document* and re-runs the SAME module
posting hook that originally failed, so the lines are rebuilt from the source.
This module is the registry of those hooks, keyed on
``(reference_type, marker | None)`` exactly as the call sites record them.

Every hook re-run here is idempotent (each checks ``already_posted`` /
``_check_already_posted`` before posting, and ``GLPostingService.post`` re-checks
under an advisory lock). The one hook that is not (supplier advance return,
``idempotent=False``) is guarded in its regenerator.

Sources that build their lines inline at the call site (no reusable hook) are
listed in :data:`NOT_REGENERABLE`; their failures must be posted manually until
the inline code is refactored into a hook.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable, Dict, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from .accounting_models import JournalEntry, JournalEntryLine

logger = logging.getLogger(__name__)

D = Decimal


class RegenerationError(Exception):
    """A regenerator could not rebuild the posting (``code`` goes on the failure row)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


RegenerateFn = Callable[[Session, int, int], Any]
VerifyFn = Callable[[Session, int, Any], Optional[JournalEntry]]


@dataclass(frozen=True)
class Regenerator:
    reference_type: str
    regenerate_fn: RegenerateFn
    # Description marker that tells this posting apart from other postings of
    # the same (reference_type, reference_id) - e.g. "GRN ID: 5" vs the cancel
    # entry "GRN Cancel ID: 5". None = any non-reversed Auto JE for the ref.
    lookup_marker: Optional[Callable[[int], Optional[str]]] = None
    verify_fn: Optional[VerifyFn] = None

    def regenerate(self, db: Session, reference_id: int, user_id: int) -> Any:
        return self.regenerate_fn(db, reference_id, user_id)

    def verify(self, db: Session, reference_id: int, returned: Any) -> Optional[JournalEntry]:
        """The posted, non-reversed Auto JE for the source, or None."""
        if self.verify_fn is not None:
            return self.verify_fn(db, reference_id, returned)
        from .gl_posting_service import GLPostingService

        marker = self.lookup_marker(reference_id) if self.lookup_marker else None
        return GLPostingService(db).already_posted(self.reference_type, reference_id, marker)


# ─── helpers ────────────────────────────────────────────────────────────────
def _load(db: Session, model, reference_id: int, label: str):
    obj = db.query(model).filter(model.id == reference_id).first()
    if obj is None:
        raise RegenerationError("source_not_found", f"{label} #{reference_id} no longer exists")
    return obj


def _pepgl(db: Session):
    from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL

    return PurchaseExpensePayrollGL(db)


def _sales(db: Session):
    from app.modules.sales.accounting_integration import SalesAccountingIntegration

    return SalesAccountingIntegration(db)


def _require_status(obj, expected: str, label: str) -> None:
    if (getattr(obj, "status", None) or "").lower() != expected:
        raise RegenerationError(
            "source_state_changed",
            f"{label} is '{getattr(obj, 'status', None)}', expected '{expected}' - not re-posting",
        )


def _simple(model_path: Tuple[str, str], label: str, hook: Callable[[Session, Any, int], Any]) -> RegenerateFn:
    """Load ``model`` by id and run ``hook(db, obj, user_id)``."""

    def _fn(db: Session, reference_id: int, user_id: int):
        import importlib

        model = getattr(importlib.import_module(model_path[0]), model_path[1])
        obj = _load(db, model, reference_id, label)
        return hook(db, obj, user_id)

    return _fn


def _marker(fmt: str) -> Callable[[int], str]:
    return lambda rid: fmt.format(id=rid)


# ─── customers ──────────────────────────────────────────────────────────────
_GV = ("app.modules.customers.models", "CustomerGiftVoucher")


def _gv_expiry(db, voucher, user_id):
    _require_status(voucher, "expired", f"Gift voucher {voucher.barcode_no}")
    return _sales(db).post_gift_voucher_expiry_to_gl(voucher, user_id=user_id)


# ─── sales ──────────────────────────────────────────────────────────────────
def _invoice(db, invoice, user_id):
    res = _sales(db).post_all_for_invoice(invoice, user_id)
    if res.get("errors"):
        raise RegenerationError("regeneration_failed", "; ".join(str(e) for e in res["errors"]))
    return res


def sale_return_ar_applied(db: Session, sale_return, invoice) -> Decimal:
    """Re-derive the receivable the return cancelled (``ar_applied`` passed to
    ``post_sale_return_to_gl`` by ``process_sale_return``) from stored data.

    process_sale_return computes ``ar_applied = min(refund, balance_before)``
    on credit invoices and refunds the rest (``paid_out``) through the chosen
    method. ``balance_before`` is not stored, but ``paid_out`` is:
      * credit_note refund -> the issued credit note's amount (none => all AR);
      * cash / bank_transfer / cheque -> the return's cashbook money_out.
    Limitation: a cash/bank/cheque return on a split invoice whose credit part
    was fully cancelled AND whose cashbook entry is missing is read as a cash
    sale (ar_applied = 0).
    """
    refund = D(str(sale_return.total_refund or 0))
    method = (sale_return.payment_method or "").lower()
    if method == "credit_note":
        note_id = getattr(sale_return, "credit_note_id", None)
        if note_id:
            from app.modules.customers.models import CustomerCreditNotes

            note = db.query(CustomerCreditNotes).filter(CustomerCreditNotes.id == note_id).first()
            paid_out = D(str(note.amount or 0)) if note else D("0")
            return max(D("0"), refund - paid_out)
        if (getattr(sale_return, "refund_reference", None) or "").startswith("AR-"):
            return refund
        return D("0")
    if method in ("cash", "bank_transfer", "cheque"):
        from app.modules.finance.models import CashbookEntryRecord

        money_out = (
            db.query(func.coalesce(func.sum(CashbookEntryRecord.money_out), 0))
            .filter(
                CashbookEntryRecord.source_table == "sale_return",
                CashbookEntryRecord.source_id == sale_return.id,
            )
            .scalar()
        )
        money_out = D(str(money_out or 0))
        if money_out > 0:
            return max(D("0"), refund - money_out)
        is_credit = (invoice.payment_method or "").lower() == "credit" or D(str(invoice.credit_amount or 0)) > 0
        return refund if is_credit else D("0")
    return D("0")


def _sale_return(db, sale_return, user_id):
    from app.modules.sales.models import Invoice

    invoice = db.query(Invoice).filter(Invoice.id == sale_return.invoice_id).first()
    if invoice is None:
        raise RegenerationError("source_not_found", f"Invoice of sale return {sale_return.sale_return_no} not found")
    ar = sale_return_ar_applied(db, sale_return, invoice)
    return _sales(db).post_sale_return_to_gl(sale_return, user_id, ar_applied=ar)


# ─── purchasing ─────────────────────────────────────────────────────────────
def _purchase_return(db, pr, user_id):
    # The cashbook row is written from the GL posting itself.
    return _pepgl(db).post_purchase_return_to_gl(pr, user_id=user_id)


def _grn_cancel(db, grn, user_id):
    _require_status(grn, "cancelled", f"GRN {grn.good_received_no}")
    return _pepgl(db).post_grn_cancel_to_gl(grn, user_id=user_id)


def _landed_cost_cancel(db, voucher, user_id):
    _require_status(voucher, "cancelled", f"Landed cost voucher {voucher.voucher_no}")
    return _pepgl(db).post_landed_cost_cancel_to_gl(voucher, user_id=user_id)


def _applications_of_grn(db: Session, grn_id: int):
    from app.modules.purchasing.models import SupplierAdvanceApplication

    return (
        db.query(SupplierAdvanceApplication)
        .filter(SupplierAdvanceApplication.grn_id == grn_id)
        .order_by(SupplierAdvanceApplication.id)
        .all()
    )


def _grn_advance_applications(db: Session, grn_id: int, user_id: int):
    apps = _applications_of_grn(db, grn_id)
    if not apps:
        raise RegenerationError("source_not_found", f"GRN #{grn_id} has no advance applications")
    gl = _pepgl(db)
    for app in apps:
        gl.post_advance_application_to_gl(app, user_id=user_id)
    return apps


def _verify_grn_advance_applications(db: Session, grn_id: int, _returned) -> Optional[JournalEntry]:
    from .gl_posting_service import GLPostingService

    svc = GLPostingService(db)
    last = None
    for app in _applications_of_grn(db, grn_id):
        if D(str(app.applied_amount or 0)) <= 0:
            continue
        je = svc.already_posted("AdvanceApplication", app.id, f"AdvApp ID: {app.id}")
        if je is None:
            return None
        last = je
    return last


def _posted_advance_returns(db: Session, advance_id: int) -> Decimal:
    """Total already posted as SupplierAdvanceReturn JEs for the advance."""
    rows = (
        db.query(JournalEntry.id, JournalEntry.total_debit)
        .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(
            JournalEntryLine.reference_type == "SupplierAdvanceReturn",
            JournalEntryLine.reference_id == advance_id,
            JournalEntry.entry_type == "Auto",
            JournalEntry.status != "reversed",
            JournalEntry.is_reversed.isnot(True),
        )
        .distinct()
        .all()
    )
    return sum((D(str(t or 0)) for _id, t in rows), D("0"))


def _supplier_advance_return(db: Session, advance_id: int, user_id: int):
    """post_supplier_advance_return_to_gl is NOT idempotent (partial returns,
    no per-return record), so only the part of ``returned_amount`` that has no
    posted return JE yet is posted, at the advance's stored return date/method."""
    from app.modules.purchasing.models import SupplierAdvancePayment

    advance = _load(db, SupplierAdvancePayment, advance_id, "Supplier advance")
    unposted = D(str(advance.returned_amount or 0)) - _posted_advance_returns(db, advance_id)
    if unposted <= D("0.005"):
        raise RegenerationError(
            "nothing_to_regenerate",
            f"Supplier advance {advance.advance_no}: returned_amount ({advance.returned_amount}) is already "
            "fully posted - the failed return was not persisted on the advance; post it manually",
        )
    je = _pepgl(db).post_supplier_advance_return_to_gl(
        advance,
        return_amount=unposted.quantize(D("0.01")),
        return_date=advance.return_date,
        return_method=advance.return_method,
        user_id=user_id,
    )
    if je is None:
        raise RegenerationError("regeneration_failed", f"Advance return posting for {advance.advance_no} did not post")
    return je


def _verify_returned_je(db: Session, _reference_id: int, returned) -> Optional[JournalEntry]:
    return returned if isinstance(returned, JournalEntry) else None


# ─── registry ───────────────────────────────────────────────────────────────
_P = "app.modules.purchasing.models"
_F = "app.modules.finance.models"
_H = "app.modules.hr.models"
_C = "app.modules.customers.models"
_S = "app.modules.sales.models"

REGISTRY: Dict[Tuple[str, Optional[str]], Regenerator] = {}


def _register(reference_type: str, marker: Optional[str], regenerate: RegenerateFn, **kw) -> None:
    key = (reference_type, marker.lower() if marker else None)
    REGISTRY[key] = Regenerator(reference_type=reference_type, regenerate_fn=regenerate, **kw)


# customers
_register("GiftVoucherSale", None, _simple(_GV, "Gift voucher",
          lambda db, v, uid: _sales(db).post_gift_voucher_sale_to_gl(v, user_id=uid)))
_register("GiftVoucherExpiry", None, _simple(_GV, "Gift voucher", _gv_expiry))

# finance
_register("BankDeposit", None, _simple((_F, "BankDeposits"), "Bank deposit",
          lambda db, o, uid: _pepgl(db).post_bank_deposit_to_gl(o, user_id=uid)),
          lookup_marker=_marker("BankDeposit ID: {id}"))
_register("Expense", None, _simple((_F, "Expenses"), "Expense",
          lambda db, o, uid: _pepgl(db).post_expense_to_gl(o, user_id=uid)),
          lookup_marker=_marker("Expense ID: {id}"))
_register("CustomerCreditNote", None, _simple((_C, "CustomerCreditNotes"), "Customer credit note",
          lambda db, o, uid: _pepgl(db).post_customer_credit_note_to_gl(o, user_id=uid)),
          lookup_marker=_marker("CustomerCreditNote ID: {id}"))
_register("CustomerAdvance", None, _simple((_C, "CustomerAdvancePayments"), "Customer advance",
          lambda db, o, uid: _pepgl(db).post_customer_advance_receipt_to_gl(o, user_id=uid)),
          lookup_marker=_marker("CustomerAdvanceReceipt ID: {id}"))

# hr
_register("Reimbursement", None, _simple((_H, "Reimbursements"), "Reimbursement",
          lambda db, o, uid: _pepgl(db).post_reimbursement_payment_to_gl(o, user_id=uid)),
          lookup_marker=_marker("ReimbursementPayment ID: {id}"))
_register("StatutoryPayment", None, _simple((_H, "PayrollBatch"), "Payroll batch",
          lambda db, o, uid: _pepgl(db).post_statutory_payment_to_gl(o, user_id=uid)),
          lookup_marker=_marker("StatutoryPayment BatchID: {id}"))
_register("PayrollBatch", None, _simple((_H, "PayrollBatch"), "Payroll batch",
          lambda db, o, uid: _pepgl(db).post_payroll_batch_to_gl(o, user_id=uid)),
          lookup_marker=_marker("PayrollBatch ID: {id}"))

# purchasing
_register("SupplierPayment", None, _simple((_P, "SupplierPayment"), "Supplier payment",
          lambda db, o, uid: _pepgl(db).post_supplier_payment_to_gl(o, uid)),
          lookup_marker=_marker("SupPayment ID: {id}"))
_register("LandedCost", None, _simple((_P, "LandedCostVoucher"), "Landed cost voucher",
          lambda db, o, uid: _pepgl(db).post_landed_cost_to_gl(o, user_id=uid)),
          lookup_marker=_marker("LCV ID: {id}"))
_register("LandedCost", "cancel", _simple((_P, "LandedCostVoucher"), "Landed cost voucher", _landed_cost_cancel),
          lookup_marker=_marker("LCV Cancel ID: {id}"))
_register("PurchaseReturn", None, _simple((_P, "PurchasingReturn"), "Purchase return", _purchase_return),
          lookup_marker=_marker("PurchaseReturn ID: {id}"))
_register("GRN", None, _simple((_P, "GoodReceivedNote"), "GRN",
          lambda db, o, uid: _pepgl(db).post_grn_to_gl(o, user_id=uid)),
          lookup_marker=_marker("GRN ID: {id}"))
_register("GRN", "cancel", _simple((_P, "GoodReceivedNote"), "GRN", _grn_cancel),
          lookup_marker=_marker("GRN Cancel ID: {id}"))
_register("AdvanceApplication", None, _simple((_P, "SupplierAdvanceApplication"), "Advance application",
          lambda db, o, uid: _pepgl(db).post_advance_application_to_gl(o, user_id=uid)),
          lookup_marker=_marker("AdvApp ID: {id}"))
# Loop-level failure keyed on the GRN id: re-post every application of the GRN.
_register("AdvanceApplication", "grn", _grn_advance_applications, verify_fn=_verify_grn_advance_applications)
_register("CreditSettle", None, _simple((_P, "SupplierCreditsSettle"), "Credit settlement",
          lambda db, o, uid: _pepgl(db).post_credit_settlement_to_gl(o, user_id=uid)),
          lookup_marker=_marker("CreditSettle ID: {id}"))
_register("SupplierAdvance", None, _simple((_P, "SupplierAdvancePayment"), "Supplier advance",
          lambda db, o, uid: _pepgl(db).post_supplier_advance_to_gl(o, user_id=uid)),
          lookup_marker=_marker("Advance ID: {id}"))
_register("SupplierAdvanceReturn", None, _supplier_advance_return, verify_fn=_verify_returned_je)

# sales
_register("Invoice", None, _simple((_S, "Invoice"), "Invoice", _invoice), lookup_marker=lambda _rid: "Revenue")
_register("SaleReturn", None, _simple((_S, "SaleReturn"), "Sale return", _sale_return))

# Call sites that build their lines inline (no reusable hook) or are keyed on
# something that is not a single source document. Their commit_failed rows
# cannot be rebuilt automatically -> retry answers "not_regenerable".
NOT_REGENERABLE: Dict[str, str] = {
    # Legacy rows only: new invoice advance-application failures are recorded per
    # application ("AdvanceApplication") and regenerate normally.
    "AdvanceApplicationBatch": (
        "legacy supplier-level row; re-posting every invoice application of the supplier "
        "could post old ones - post the failed applications manually"
    ),
}


def get_regenerator(reference_type: str, marker: Optional[str] = None) -> Optional[Regenerator]:
    """Registered regenerator for a failure's ``(reference_type, posting_marker)``.

    An exact ``(type, marker)`` match wins. A marker with no registration of
    its own falls back to the type's unmarked regenerator only when the type
    has no marker-specific entries (e.g. the informational
    ``"GiftVoucherExpiry ID: 5"``); a ``"Cancel"`` row never falls back to the
    forward posting.
    """
    if reference_type in NOT_REGENERABLE:
        return None
    key_marker = marker.lower() if marker else None
    hit = REGISTRY.get((reference_type, key_marker))
    if hit is not None or key_marker is None:
        return hit
    has_marked = any(t == reference_type and m is not None for t, m in REGISTRY)
    return None if has_marked else REGISTRY.get((reference_type, None))
