import logging

from sqlalchemy.orm import Session
from app.modules.branches import schemas, repository
from app.auth.models import Branch
from typing import List, Optional
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

class BranchService:
    def __init__(self):
        self.repository = repository.branch_repository
    
    def get_all_branches(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[Branch]:
        return self.repository.get_all(db, skip, limit, active_only)
    
    def get_branch(self, db: Session, branch_id: int) -> Branch:
        branch = self.repository.get_by_id(db, branch_id)
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        return branch
    
    def create_branch(self, db: Session, branch: schemas.BranchCreate) -> Branch:

        existing = self.repository.get_by_code(db, branch.branch_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch code already exists"
            )
        
        return self.repository.create(db, branch)
    
    def update_branch(self, db: Session, branch_id: int, branch: schemas.BranchUpdate) -> Branch:
        updated_branch = self.repository.update(db, branch_id, branch)
        if not updated_branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        return updated_branch
    
    def delete_branch(self, db: Session, branch_id: int) -> dict:
        """Hard-delete a branch when it has no real activity.

        Every branch auto-creates at least one warehouse location, so an empty
        location is treated as disposable scaffolding and is removed together
        with the branch. The delete is blocked only when genuine downstream data
        (users, GRNs, stock, transfers, returns, invoices, etc.) is tied to the
        branch or its locations.
        """
        from sqlalchemy import text
        from sqlalchemy.exc import IntegrityError, ProgrammingError

        branch = self.repository.get_by_id(db, branch_id)
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )

        code = branch.branch_code
        usage_checks = []

        # --- Users assigned to this branch (FK via the user_branches junction) ---
        from app.auth.models import User
        users_count = db.query(User).filter(User.branches.any(id=branch_id)).count()
        if users_count > 0:
            usage_checks.append(f"users ({users_count})")

        # --- Warehouse locations ---
        # A branch auto-creates at least one location, so an EMPTY location is just
        # scaffolding and is removed with the branch. Only real downstream activity
        # on those locations blocks the delete. These tables reference locations by
        # id and have no branch_code column of their own.
        location_ids = [
            row[0]
            for row in db.execute(
                text("SELECT id FROM good_received_locations WHERE branch_code = :code"),
                {"code": code},
            ).fetchall()
        ]

        if location_ids:
            location_usage = [
                ("good_received_note", "good_received_locations_id", "goods received notes"),
                ("sale_return", "good_received_locations_id", "sales returns"),
            ]
            for table_name, column, label in location_usage:
                try:
                    count = db.execute(
                        text(f"SELECT COUNT(*) FROM {table_name} WHERE {column} = ANY(:ids)"),
                        {"ids": location_ids},
                    ).scalar() or 0
                    if count > 0:
                        usage_checks.append(f"{label} ({count})")
                except ProgrammingError:
                    # Table/column doesn't exist in this deployment — skip safely.
                    db.rollback()
                    logger.warning("Skipping usage check on %s: table/column not found", table_name)

            # Transfer notes reference a location at BOTH ends.
            try:
                count = db.execute(
                    text(
                        "SELECT COUNT(*) FROM item_transfer_note "
                        "WHERE from_location_id = ANY(:ids) OR to_location_id = ANY(:ids)"
                    ),
                    {"ids": location_ids},
                ).scalar() or 0
                if count > 0:
                    usage_checks.append(f"transfer notes ({count})")
            except ProgrammingError:
                db.rollback()
                logger.warning("Skipping usage check on item_transfer_note: table/column not found")

        # --- Tables that reference the branch directly by branch_code ---
        branch_code_tables = [
            ("invoices", "invoices"),
            ("purchasing_orders", "purchase orders"),
            ("sales_stock", "stock records"),
            ("expenses", "expenses"),
            ("customer_support", "support tickets"),
            ("reimbursements", "reimbursements"),
            ("monthly_branch_sales_summary", "sales summaries"),
            ("sales_officer_monthly_commissions", "commissions"),
        ]
        for table_name, label in branch_code_tables:
            try:
                count = db.execute(
                    text(f"SELECT COUNT(*) FROM {table_name} WHERE branch_code = :code"),
                    {"code": code},
                ).scalar() or 0
                if count > 0:
                    usage_checks.append(f"{label} ({count})")
            except ProgrammingError:
                # Table/column doesn't exist in this deployment — skip safely.
                db.rollback()
                logger.warning("Skipping usage check on %s: table/column not found", table_name)

        if usage_checks:
            usage_list = ", ".join(usage_checks)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete branch '{branch.branch_name}' ({code}). "
                       f"It is referenced by: {usage_list}. "
                       f"Please reassign or remove these records first.",
            )

        # No real activity — drop the branch's empty scaffolding locations first
        # (to satisfy the FK), then hard-delete the branch itself. Both run in the
        # same transaction so a missed reference rolls everything back cleanly.
        try:
            if location_ids:
                db.execute(
                    text("DELETE FROM good_received_locations WHERE id = ANY(:ids)"),
                    {"ids": location_ids},
                )
            success = self.repository.delete(db, branch_id)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete branch '{branch.branch_name}' ({code}). "
                       f"It is still linked to other records. "
                       f"Please reassign or remove them first.",
            )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found",
            )

        return {"message": f"Branch '{branch.branch_name}' deleted successfully"}
    
    def get_total_count(self, db: Session) -> int:
        return self.repository.count(db)

branch_service = BranchService()
