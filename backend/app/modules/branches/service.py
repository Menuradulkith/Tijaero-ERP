import logging

from sqlalchemy.orm import Session
from app.common.audit import log_audit
from app.modules.branches import schemas, repository
from app.auth.models import Branch
from typing import List, Optional
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

class BranchService:
    def __init__(self):
        self.repository = repository.branch_repository

    def _attach_user_names(self, db: Session, branches: List[Branch]) -> None:
        """Resolve created_by/updated_by ids to display names, in one batched
        query, and stamp them onto each branch as dynamic attributes."""
        from app.auth.models import User

        user_ids = {
            uid for b in branches for uid in (b.created_by, b.updated_by) if uid
        }
        if not user_ids:
            for b in branches:
                b.created_by_name = None
                b.updated_by_name = None
            return

        users = db.query(User).filter(User.id.in_(user_ids)).all()
        name_map = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in users
        }
        for b in branches:
            b.created_by_name = name_map.get(b.created_by)
            b.updated_by_name = name_map.get(b.updated_by)

    def get_all_branches(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[Branch]:
        branches = self.repository.get_all(db, skip, limit, active_only)
        self._attach_user_names(db, branches)
        return branches

    def get_branch(self, db: Session, branch_id: int) -> Branch:
        branch = self.repository.get_by_id(db, branch_id)
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        self._attach_user_names(db, [branch])
        return branch
    
    def create_branch(self, db: Session, branch: schemas.BranchCreate, created_by: Optional[int] = None) -> Branch:

        existing = self.repository.get_by_code(db, branch.branch_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch code already exists"
            )

        if self.repository.get_by_name(db, branch.branch_name):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch name already exists"
            )

        if branch.email and self.repository.get_by_email(db, branch.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists"
            )

        created = self.repository.create(db, branch, created_by=created_by)
        self._attach_user_names(db, [created])
        return created

    def update_branch(self, db: Session, branch_id: int, branch: schemas.BranchUpdate, updated_by: Optional[int] = None) -> Branch:
        db_branch = self.repository.get_by_id(db, branch_id)
        if not db_branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )

        if branch.branch_name and branch.branch_name != db_branch.branch_name:
            existing_name = self.repository.get_by_name(db, branch.branch_name)
            if existing_name and existing_name.id != branch_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Branch name already exists"
                )

        if branch.email and branch.email != db_branch.email:
            existing_email = self.repository.get_by_email(db, branch.email)
            if existing_email and existing_email.id != branch_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already exists"
                )

        updated_branch = self.repository.update(db, branch_id, branch, updated_by=updated_by)
        if not updated_branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        self._attach_user_names(db, [updated_branch])
        return updated_branch

    def get_total_count(self, db: Session) -> int:
        return self.repository.count(db)

    def get_branch_performance(self, db: Session, branch_id: int) -> schemas.BranchPerformance:
        """Quick sales/stock KPIs for a branch, for the detail-panel widget."""
        from datetime import date

        from sqlalchemy import func

        from app.core import timezone as tz
        from app.modules.inventory.service import SalesStockService
        from app.modules.sales.models import Invoice

        branch = self.repository.get_by_id(db, branch_id)
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )

        today = tz.today()
        month_start = date(today.year, today.month, 1)

        sales_sum_expr = (
            Invoice.cash_amount
            + Invoice.card_amex_amount
            + Invoice.card_mastercard_amount
            + Invoice.card_visa_amount
            + Invoice.cheque_amount
            + Invoice.bank_transfer_amount
            + Invoice.credit_amount
        )

        sales_today = (
            db.query(func.coalesce(func.sum(sales_sum_expr), 0))
            .filter(Invoice.branch_code == branch.branch_code, Invoice.created_date == today)
            .scalar()
        )
        sales_month = (
            db.query(func.coalesce(func.sum(sales_sum_expr), 0))
            .filter(Invoice.branch_code == branch.branch_code, Invoice.created_date >= month_start)
            .scalar()
        )
        orders_today = (
            db.query(func.count(Invoice.id))
            .filter(Invoice.branch_code == branch.branch_code, Invoice.created_date == today)
            .scalar() or 0
        )
        orders_month = (
            db.query(func.count(Invoice.id))
            .filter(Invoice.branch_code == branch.branch_code, Invoice.created_date >= month_start)
            .scalar() or 0
        )

        stock_summary = SalesStockService(db).get_summary(branch_code=branch.branch_code)

        return schemas.BranchPerformance(
            sales_today=float(sales_today or 0),
            sales_month=float(sales_month or 0),
            orders_today=orders_today,
            orders_month=orders_month,
            in_stock=stock_summary["in_stock"],
            reserved=stock_summary["reserved"],
            sold_today=stock_summary["sold_today"],
            returned=stock_summary["returned"],
        )

branch_service = BranchService()
