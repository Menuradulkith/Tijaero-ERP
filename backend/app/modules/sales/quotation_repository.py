from datetime import date, datetime
from typing import List, Optional, Tuple
from app.core import timezone as tz

from app.modules.sales.quotation_models import (
    QuoteStatus,
    QuoteType,
    SalesQuote,
    SalesQuoteItem,
)
from app.modules.sales.quotation_schemas import (
    QuoteStatusEnum,
    QuoteTypeEnum,
    SalesQuoteCreate,
    SalesQuoteFilter,
    SalesQuoteItemCreate,
    SalesQuoteUpdate,
)
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session, joinedload


class SalesQuoteRepository:
    """Repository for Sales Quote database operations"""

    # ==================== Quote CRUD ====================

    def get_all(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        quote_type: Optional[str] = None,
    ) -> List[SalesQuote]:
        """Get all quotes with optional type filter"""
        query = db.query(SalesQuote)

        if quote_type:
            query = query.filter(SalesQuote.quote_type == quote_type)

        return (
            query.order_by(SalesQuote.created_date_time.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def get_by_id(self, db: Session, quote_id: int) -> Optional[SalesQuote]:
        """Get quote by ID"""
        return db.query(SalesQuote).filter(SalesQuote.id == quote_id).first()

    def get_by_id_with_items(self, db: Session, quote_id: int) -> Optional[SalesQuote]:
        """Get quote by ID with items loaded"""
        return (
            db.query(SalesQuote)
            .options(joinedload(SalesQuote.items))
            .filter(SalesQuote.id == quote_id)
            .first()
        )

    def get_by_quote_no(self, db: Session, quote_no: str) -> Optional[SalesQuote]:
        """Get quote by quote number"""
        return db.query(SalesQuote).filter(SalesQuote.quote_no == quote_no).first()

    def get_filtered(
        self, db: Session, filters: SalesQuoteFilter, skip: int = 0, limit: int = 100
    ) -> Tuple[List[SalesQuote], int]:
        """Get quotes with filters and pagination"""
        query = db.query(SalesQuote)

        # Apply filters
        if filters.quote_type:
            query = query.filter(SalesQuote.quote_type == filters.quote_type.value)

        if filters.status:
            query = query.filter(SalesQuote.status == filters.status.value)

        if filters.customer_id:
            query = query.filter(SalesQuote.customer_id == filters.customer_id)

        if filters.sale_rep_id:
            query = query.filter(SalesQuote.sale_rep_id == filters.sale_rep_id)

        if filters.branch_code:
            query = query.filter(SalesQuote.branch_code == filters.branch_code)

        if filters.date_from:
            query = query.filter(SalesQuote.created_date >= filters.date_from)

        if filters.date_to:
            query = query.filter(SalesQuote.created_date <= filters.date_to)

        if filters.is_expired is not None:
            today = tz.today()
            if filters.is_expired:
                query = query.filter(SalesQuote.valid_until < today)
            else:
                query = query.filter(SalesQuote.valid_until >= today)

        if filters.search:
            search_term = f"%{filters.search}%"
            query = query.filter(
                or_(
                    SalesQuote.quote_no.ilike(search_term),
                    SalesQuote.remarks.ilike(search_term),
                )
            )

        # Get total count efficiently
        from app.common.pagination import fast_count
        total = fast_count(query)

        # Apply pagination
        quotes = (
            query.order_by(SalesQuote.created_date_time.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

        return quotes, total

    def create(self, db: Session, quote: SalesQuote) -> SalesQuote:
        """Create a new quote"""
        db.add(quote)
        db.commit()
        db.refresh(quote)
        return quote

    def update(self, db: Session, quote: SalesQuote) -> SalesQuote:
        """Update an existing quote"""
        db.commit()
        db.refresh(quote)
        return quote

    def delete(self, db: Session, quote_id: int) -> bool:
        """Delete a quote"""
        quote = self.get_by_id(db, quote_id)
        if quote:
            db.delete(quote)
            db.commit()
            return True
        return False

    # ==================== Quote Items ====================

    def get_items_by_quote_id(self, db: Session, quote_id: int) -> List[SalesQuoteItem]:
        """Get all items for a quote"""
        return (
            db.query(SalesQuoteItem).filter(SalesQuoteItem.quote_id == quote_id).all()
        )

    def add_item(self, db: Session, item: SalesQuoteItem) -> SalesQuoteItem:
        """Add item to quote"""
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    def update_item(self, db: Session, item: SalesQuoteItem) -> SalesQuoteItem:
        """Update quote item"""
        db.commit()
        db.refresh(item)
        return item

    def delete_item(self, db: Session, item_id: int) -> bool:
        """Delete quote item"""
        item = db.query(SalesQuoteItem).filter(SalesQuoteItem.id == item_id).first()
        if item:
            db.delete(item)
            db.commit()
            return True
        return False

    def delete_items_by_quote_id(self, db: Session, quote_id: int) -> int:
        """Delete all items for a quote"""
        count = (
            db.query(SalesQuoteItem)
            .filter(SalesQuoteItem.quote_id == quote_id)
            .delete()
        )
        db.commit()
        return count

    # ==================== Number Generation ====================

    def get_next_quote_number(
        self, db: Session, quote_type: str, branch_code: str
    ) -> str:
        """Generate next quote number"""
        year = tz.year()
        prefix_type = "QT" if quote_type == QuoteType.QUOTATION.value else "PI"
        
        # Extract branch code with default
        branch_code = branch_code or "HQ"
        
        # Advisory lock to prevent race conditions on sequence generation
        lock_key = f"{prefix_type}-{branch_code}-{year}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": lock_key})
        
        # Get the last quote number for this type, branch and year
        pattern = f"{prefix_type}-{branch_code}-{year}-%"
        last_quote = (
            db.query(SalesQuote)
            .filter(SalesQuote.quote_no.like(pattern))
            .order_by(SalesQuote.id.desc())
            .first()
        )

        if last_quote:
            # Extract the sequence number
            try:
                last_seq = int(last_quote.quote_no.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1

        return f"{prefix_type}-{branch_code}-{year}-{next_seq:05d}"

    def get_next_revision_number(self, db: Session, parent_quote_id: int) -> int:
        """Get next revision number for a quote"""
        # Advisory lock to prevent race conditions on revision number generation
        db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": parent_quote_id})
        max_revision = (
            db.query(func.max(SalesQuote.revision_number))
            .filter(
                or_(
                    SalesQuote.id == parent_quote_id,
                    SalesQuote.parent_quote_id == parent_quote_id,
                )
            )
            .scalar()
        )

        return (max_revision or 1) + 1

    # ==================== Statistics ====================

    def get_quotes_count_by_status(
        self, db: Session, quote_type: Optional[str] = None
    ) -> dict:
        """Get count of quotes by status"""
        query = db.query(SalesQuote.status, func.count(SalesQuote.id).label("count"))

        if quote_type:
            query = query.filter(SalesQuote.quote_type == quote_type)

        result = query.group_by(SalesQuote.status).all()

        return {row.status: row.count for row in result}

    def get_quotes_by_customer(self, db: Session, customer_id: int) -> List[SalesQuote]:
        """Get all quotes for a customer"""
        return (
            db.query(SalesQuote)
            .filter(SalesQuote.customer_id == customer_id)
            .order_by(SalesQuote.created_date_time.desc())
            .all()
        )

    def get_expiring_quotes(self, db: Session, days: int = 7) -> List[SalesQuote]:
        """Get quotes expiring within given days"""
        from datetime import timedelta

        today = tz.today()
        expiry_date = today + timedelta(days=days)

        return (
            db.query(SalesQuote)
            .filter(
                and_(
                    SalesQuote.valid_until >= today,
                    SalesQuote.valid_until <= expiry_date,
                    SalesQuote.status.in_(
                        [QuoteStatus.APPROVED.value, QuoteStatus.SENT.value]
                    ),
                )
            )
            .all()
        )

    def get_expired_quotes(self, db: Session) -> List[SalesQuote]:
        """Get all expired quotes that haven't been marked as expired"""
        today = tz.today()

        return (
            db.query(SalesQuote)
            .filter(
                and_(
                    SalesQuote.valid_until < today,
                    SalesQuote.status.notin_(
                        [
                            QuoteStatus.EXPIRED.value,
                            QuoteStatus.CONVERTED.value,
                            QuoteStatus.CANCELLED.value,
                            QuoteStatus.REJECTED.value,
                        ]
                    ),
                )
            )
            .all()
        )


# Singleton instance
sales_quote_repository = SalesQuoteRepository()
