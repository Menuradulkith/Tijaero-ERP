"""
Ledger Service — the documented single entry point for cross-module GL postings.

All cross-module GL interactions (sales → finance, purchasing → finance,
expense → finance) should go through this facade rather than constructing
finance ORM models directly. Under the hood it delegates to
:class:`GLPostingService`, which enforces double-entry balance, reference-based
idempotency, rounding to a dedicated account, period checks and durable failure
recording.
"""

import logging
from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core import timezone as tz
from app.modules.finance.gl_posting_service import GLPostingService, PostResult

logger = logging.getLogger(__name__)


class LedgerService:
    def __init__(self, db: Session):
        self.db = db
        self._gl = GLPostingService(db)

    def post(
        self,
        *,
        reference_type: str,
        reference_id: int,
        lines: List[Dict[str, Any]],
        description: str,
        user_id: int,
        entry_date: Optional[date] = None,
        branch_code: Optional[str] = None,
        transaction_type: str = "Manual",
        reference_no: Optional[str] = None,
        je_prefix: str = "JE-AUTO",
        source_module: str = "finance",
        marker: Optional[str] = None,
    ) -> PostResult:
        """Post a balanced set of debit/credit lines via the central gateway."""
        return self._gl.post(
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            lines=lines,
            entry_date=entry_date or tz.today(),
            description=description,
            branch_code=branch_code,
            user_id=user_id,
            transaction_type=transaction_type,
            je_prefix=je_prefix,
            source_module=source_module,
            marker=marker,
        )

    def post_entry(self, entry_id: int, posted_by: int = 0) -> None:
        """Post an existing draft/approved journal entry to the general ledger.

        Delegates to :class:`JournalEntryService` so the correct workflow rules
        and the real ``status`` / ``posted_at`` columns are used (the previous
        implementation referenced non-existent ``is_posted`` / ``posted_date``
        attributes and would have raised at runtime).
        """
        from app.modules.finance.accounting_models import JournalEntry
        from app.modules.finance.accounting_service import JournalEntryService

        entry = (
            self.db.query(JournalEntry)
            .filter(JournalEntry.id == entry_id)
            .first()
        )
        if entry is None:
            logger.warning("JournalEntry %s not found — skipping post", entry_id)
            return
        if entry.status == "posted":
            logger.info("JournalEntry %s already posted — skipping", entry_id)
            return
        JournalEntryService(self.db).post_journal_entry(entry_id, posted_by=posted_by)
        logger.info("JournalEntry %s posted to ledger", entry_id)


def get_ledger_service(db: Session) -> LedgerService:
    """Factory helper for dependency injection."""
    return LedgerService(db)
