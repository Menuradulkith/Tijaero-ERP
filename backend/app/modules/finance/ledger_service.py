"""
Ledger Service — abstraction layer for General Ledger postings.

All cross-module GL interactions (sales → finance, purchasing → finance,
expense → finance) should call methods here rather than directly
importing and constructing finance ORM models.
"""

import logging
from sqlalchemy.orm import Session

from app.core import timezone as tz

logger = logging.getLogger(__name__)


class LedgerService:
    def __init__(self, db: Session):
        self.db = db

    def post_entry(self, entry_id: int) -> None:
        """Post a pending journal entry to the general ledger.

        Marks the entry as posted and updates the posting timestamp.
        """
        from app.modules.finance.accounting_models import JournalEntry

        entry = (
            self.db.query(JournalEntry)
            .filter(JournalEntry.id == entry_id)
            .first()
        )
        if entry is None:
            logger.warning("JournalEntry %s not found — skipping post", entry_id)
            return
        if getattr(entry, "is_posted", False):
            logger.info("JournalEntry %s already posted — skipping", entry_id)
            return
        entry.is_posted = True
        entry.posted_date = tz.now()
        self.db.flush()
        logger.info("JournalEntry %s posted to ledger", entry_id)


def get_ledger_service(db: Session) -> LedgerService:
    """Factory helper for dependency injection."""
    return LedgerService(db)
