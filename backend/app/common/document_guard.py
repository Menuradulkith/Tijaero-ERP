"""Print / email gate: only approved documents may leave the system.

A document that is still waiting for approval (or was rejected / cancelled / is a draft) must
not be printed or emailed. "Approved" means the document has passed its approval step, so every
state that follows approval (partially received, completed, paid, posted...) is allowed too.
Mirrors `canPrintDocument` in the frontend (components/tijaero/base/TPrintButton.tsx).
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

# States a document is in once approval is behind it.
APPROVED_OR_LATER = frozenset({
    "approved", "partial_approved", "partially_approved",
    "completed", "partially_completed", "short_closed",
    "processed", "partially_processed", "so_created",
    "paid", "posted", "verified", "recorded", "salary_paid", "statutory_paid",
    "submitted", "under_review", "sent", "accepted",
    "dispatched", "in_transit", "partially_received", "received", "delivered", "closed",
})


# A production order goes to the shop floor once released; drafts and cancelled orders stay in.
PRODUCTION_PRINTABLE = frozenset({"released", "in_progress", "completed", "closed"})


def is_printable_status(value: Optional[str], document_type: Optional[str] = None) -> bool:
    allowed = PRODUCTION_PRINTABLE if document_type in ("production-order", "job-card") else APPROVED_OR_LATER
    return (value or "").strip().lower() in allowed


def ensure_printable_status(value: Optional[str], label: str = "document", document_type: Optional[str] = None) -> None:
    if not is_printable_status(value, document_type):
        shown = (str(getattr(value, "value", value)) or "unknown").replace("_", " ")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot print or email this {label}: only approved documents can be printed or emailed (current status: {shown}).",
        )


def _registry():
    from app.modules.finance.accounting_models import JournalEntry
    from app.modules.finance.models import Expenses
    from app.modules.manufacturing.models import MfgProductionOrder
    from app.modules.purchasing.models import GoodReceivedNote, PurchasingOrder, PurchasingReturn
    from app.modules.sales.models import Invoice, SaleReturn
    from app.modules.sales.quotation_models import SalesQuote
    from app.modules.warehouse.models import ItemTransferNote

    # document type -> (model, status attribute, label)
    return {
        "purchase-order": (PurchasingOrder, "status", "purchase order"),
        "grn": (GoodReceivedNote, "status", "goods received note"),
        "purchase-return": (PurchasingReturn, "status", "purchase return"),
        "quotation": (SalesQuote, "status", "quotation"),
        "invoice": (Invoice, "approval_status", "invoice"),
        "sales-order": (Invoice, "approval_status", "sales order"),
        "credit-note": (SaleReturn, "status", "credit note"),
        "sales-return": (SaleReturn, "status", "sales return"),
        "expense": (Expenses, "status", "expense"),
        "item-transfer-note": (ItemTransferNote, "status", "item transfer note"),
        "journal-entry": (JournalEntry, "status", "journal entry"),
        "production-order": (MfgProductionOrder, "status", "production order"),
        "job-card": (MfgProductionOrder, "status", "production order"),
    }


def ensure_document_printable(db: Session, document_type: str, document_id: int, user) -> None:
    """Raise unless `user` may print this document.

    404 when the document belongs to a branch the user is not assigned to (same answer as a
    missing document, so other branches' ids are not revealed); 400 unless it is in an approved
    (or later) state. Unknown types and missing documents are left to the caller's own 404
    handling.
    """
    from app.auth.dependencies import validate_branch_access

    entry = _registry().get(document_type)
    if not entry:
        return
    model, attr, label = entry
    row = db.query(model).filter(model.id == document_id).first()
    if row is None:
        return
    branch_code = getattr(row, "branch_code", None)
    if branch_code and not validate_branch_access(user, branch_code):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label.capitalize()} not found")
    ensure_printable_status(getattr(row, attr, None), label, document_type)
