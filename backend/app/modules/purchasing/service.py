from sqlalchemy.orm import Session
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from contextlib import contextmanager
from typing import Dict, List, Optional
from datetime import date, datetime
from decimal import Decimal
from . import models, schemas, repository
from .invoice_models import PurchaseInvoice, PurchaseInvoicePayment, PurchaseInvoiceItem
from fastapi import HTTPException, status
from app.core import timezone as tz
from app.common.audit import log_audit, diff_changes, diff_line_items
from app.common.enums import PurchaseOrderStatus, DocumentStatus, StockStatus
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus
from app.modules.finance.gl_posting_service import record_gl_commit_failure

DAILY_PO_LIMIT_PER_BRANCH = 5


from app.common.concurrency import ensure_not_stale, integrity_error_detail, is_unique_violation

# Fields that must be unique across all suppliers, and their user-facing labels.
SUPPLIER_UNIQUE_FIELDS = {
    "company_name": "Company name",
    "company_registration_number": "Company registration number",
    "tax_registration_number": "Tax/VAT number",
    "email": "Email",
}
# The database indexes backing them (alembic s67) → the same labels.
SUPPLIER_UNIQUE_INDEXES = {
    "uq_supplier_company_name": "Company name",
    "uq_supplier_company_reg_no": "Company registration number",
    "uq_supplier_tax_reg_no": "Tax/VAT number",
    "uq_supplier_email": "Email",
}

class SupplierService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierRepository(db)

    def _check_duplicate_fields(self, data, exclude_id: Optional[int] = None) -> None:
        for field, label in SUPPLIER_UNIQUE_FIELDS.items():
            value = getattr(data, field, None)
            if not value or not str(value).strip():
                continue
            existing = self.repo.find_by_field_value(field, str(value), exclude_id=exclude_id)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{label} '{value}' is already used by another supplier."
                )

    def _attach_user_names(self, suppliers: List[models.Supplier]) -> None:
        """Resolve created_by/updated_by ids to display names, in one batched
        query, and stamp them onto each supplier as dynamic attributes (same
        pattern as average_lead_time_days below)."""
        from app.auth.models import User

        user_ids = {
            uid for s in suppliers for uid in (s.created_by, s.updated_by) if uid
        }
        if not user_ids:
            for s in suppliers:
                s.created_by_name = None
                s.updated_by_name = None
            return

        users = self.repo.db.query(User).filter(User.id.in_(user_ids)).all()
        name_map = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in users
        }
        for s in suppliers:
            s.created_by_name = name_map.get(s.created_by)
            s.updated_by_name = name_map.get(s.updated_by)

    @contextmanager
    def _duplicate_guard(self):
        """Wrap a write (flushes and the commit); turn a unique-index
        violation — a concurrent duplicate that slipped past
        _check_duplicate_fields — into a 400 naming the field. 400, not 409:
        the page treats 409 as "changed by someone else"."""
        try:
            yield
        except IntegrityError as exc:
            self.repo.db.rollback()
            if not is_unique_violation(exc):
                # e.g. the selected country was just deleted — not a duplicate.
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=integrity_error_detail(exc))
            raw = str(getattr(exc, "orig", exc))
            label = next(
                (lbl for index_name, lbl in SUPPLIER_UNIQUE_INDEXES.items() if index_name in raw),
                None,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} is already used by another supplier." if label
                else "This supplier duplicates an existing one.",
            )

    def create_supplier(self, supplier: schemas.SupplierCreate, created_by: Optional[int] = None) -> models.Supplier:
        self._check_currency(supplier.default_currency)
        self._check_duplicate_fields(supplier)
        with self._duplicate_guard():
            created = self.repo.create(supplier)
            log_audit(
                self.repo.db,
                user_id=created_by or 0,
                action="create",
                entity_type="supplier",
                entity_id=created.id,
                changes={"company_name": created.company_name},
            )
            self.repo.db.commit()
        self.repo.db.refresh(created)
        self._attach_user_names([created])
        return created

    def get_supplier(self, supplier_id: int) -> models.Supplier:
        supplier = self.repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        supplier.average_lead_time_days = self.repo.get_average_lead_times([supplier_id]).get(supplier_id)
        self._attach_user_names([supplier])
        return supplier

    def get_activity_log(self, supplier_id: int) -> List[schemas.SupplierActivityLogEntry]:
        from app.auth.models import User
        from app.common.audit import AuditLog

        supplier = self.repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )

        entries = (
            self.repo.db.query(AuditLog)
            .filter(AuditLog.entity_type == "supplier", AuditLog.entity_id == supplier_id)
            .order_by(AuditLog.timestamp.desc())
            .limit(200)
            .all()
        )
        user_ids = {e.user_id for e in entries if e.user_id}
        name_map = {}
        if user_ids:
            users = self.repo.db.query(User).filter(User.id.in_(user_ids)).all()
            name_map = {
                u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
                for u in users
            }

        return [
            schemas.SupplierActivityLogEntry(
                id=e.id,
                action=e.action,
                changes=e.changes,
                timestamp=e.timestamp,
                user_id=e.user_id,
                user_name=name_map.get(e.user_id),
            )
            for e in entries
        ]

    def _set_logo(self, supplier_id: int, new_path: Optional[str], user_id: Optional[int]) -> models.Supplier:
        """Shared by upload/remove (mirrors ProductService._set_image):

        - Row lock: concurrent uploads serialize, so the second deletes the
          first's file instead of orphaning it.
        - Direct UPDATE with updated_at / updated_by set to themselves: the
          supplier form never writes logo_path, so a logo change can't be
          lost by a form save, and it must not make open edit forms fail the
          stale check — nor refresh their version token without refreshing
          their fields, which would let a stale save slip through.
        - Audit row, so it still appears in Activity History."""
        from app.common.file_storage import delete_file

        db = self.repo.db
        supplier = (
            db.query(models.Supplier)
            .filter(models.Supplier.id == supplier_id)
            .with_for_update(key_share=True)
            .first()
        )
        if not supplier:
            db.rollback()
            # The upload endpoint saved the file before calling us.
            if new_path:
                delete_file(new_path)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        old_path = supplier.logo_path
        db.query(models.Supplier).filter(models.Supplier.id == supplier_id).update(
            {
                "logo_path": new_path,
                "updated_at": models.Supplier.updated_at,
                "updated_by": models.Supplier.updated_by,
            },
            synchronize_session=False,
        )
        changes = diff_changes({"logo_path": old_path}, {"logo_path": new_path})
        if changes:
            log_audit(
                db,
                user_id=user_id or 0,
                action="update",
                entity_type="supplier",
                entity_id=supplier_id,
                changes=changes,
            )
        db.commit()
        db.refresh(supplier)
        if old_path and old_path != new_path:
            delete_file(old_path)
        supplier.average_lead_time_days = self.repo.get_average_lead_times([supplier_id]).get(supplier_id)
        self._attach_user_names([supplier])
        return supplier

    def update_logo(self, supplier_id: int, relative_path: str, user_id: Optional[int] = None) -> models.Supplier:
        return self._set_logo(supplier_id, relative_path, user_id)

    def remove_logo(self, supplier_id: int, user_id: Optional[int] = None) -> models.Supplier:
        return self._set_logo(supplier_id, None, user_id)
    
    def list_suppliers(self, filters: schemas.SupplierListFilter) -> List[models.Supplier]:
        suppliers = self.repo.get_all(filters)
        lead_times = self.repo.get_average_lead_times([s.id for s in suppliers])
        for s in suppliers:
            s.average_lead_time_days = lead_times.get(s.id)
        self._attach_user_names(suppliers)
        return suppliers

    def list_suppliers_page(self, page: int, size: int, **filters) -> dict:
        rows, total = self.repo.get_page(page=page, size=size, **filters)
        lead_times = self.repo.get_average_lead_times([s.id for s in rows])
        for s in rows:
            s.average_lead_time_days = lead_times.get(s.id)
        self._attach_user_names(rows)
        return {"items": rows, "total": total, "page": page, "size": size, "pages": -(-total // size)}

    def _check_currency(self, code: Optional[str]) -> None:
        """default_currency must be one of the configured currencies."""
        if not code:
            return
        from app.modules.settings.models import Currency
        exists = self.repo.db.query(Currency.id).filter(Currency.code == code, Currency.is_active.is_(True)).first()
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Currency '{code}' is not a configured, active currency.",
            )

    def list_suppliers_page(self, page: int, size: int, **filters) -> dict:
        rows, total = self.repo.get_page(page=page, size=size, **filters)
        lead_times = self.repo.get_average_lead_times([s.id for s in rows])
        for s in rows:
            s.average_lead_time_days = lead_times.get(s.id)
        self._attach_user_names(rows)
        return {"items": rows, "total": total, "page": page, "size": size, "pages": -(-total // size)}

    def _check_currency(self, code: Optional[str]) -> None:
        """default_currency must be one of the configured currencies."""
        if not code:
            return
        from app.modules.settings.models import Currency
        exists = self.repo.db.query(Currency.id).filter(Currency.code == code, Currency.is_active.is_(True)).first()
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Currency '{code}' is not a configured, active currency.",
            )

    def _ensure_can_deactivate(self, supplier: models.Supplier) -> None:
        """Must run while holding the supplier row lock: PO / payment / GRN
        creation take a shared lock on the supplier (see
        lock_active_supplier), so no new document can appear between these
        checks and the deactivation committing."""
        db = self.repo.db
        pending_orders = db.query(models.PurchasingOrder).filter(
            (models.PurchasingOrder.first_suppliers_id == supplier.id) |
            (models.PurchasingOrder.second_suppliers_id == supplier.id),
            models.PurchasingOrder.status.in_([
                PurchaseOrderStatus.PENDING,
                PurchaseOrderStatus.APPROVED,
                PurchaseOrderStatus.PENDING_APPROVAL,
            ])
        ).count()
        if pending_orders > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot deactivate supplier '{supplier.company_name}': {pending_orders} pending purchase order(s) exist. Complete or cancel all pending orders first."
            )

        # Computed live from the documents. The old check compared the stored
        # left_credit_amount, which is floored at 0 — so a supplier whose
        # credit was fully used (0, falsy) slipped through, and a NULL
        # initial_credit_amount crashed the comparison.
        from app.modules.purchasing.credit_service import SupplierCreditService
        owed = SupplierCreditService().calculate_amount_owed(db, supplier.id)
        if owed > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot deactivate supplier '{supplier.company_name}': Outstanding balance of {owed:,.2f} is still owed to this supplier. Settle all dues first."
            )

    def update_supplier(self, supplier_id: int, supplier_update: schemas.SupplierUpdate, updated_by: Optional[int] = None) -> models.Supplier:
        # Snapshot the fields the request actually touched (exclude_unset) so
        # the audit log only lists what the user genuinely changed, not the
        # entire form the frontend happens to submit on every save.
        submitted_fields = supplier_update.model_dump(exclude_unset=True, exclude={"expected_updated_at", "expected_version"})
        # Row lock first: the stale check, the deactivate checks and the write
        # must not interleave with a concurrent save, PO or payment.
        before = (
            self.repo.db.query(models.Supplier)
            .filter(models.Supplier.id == supplier_id)
            .with_for_update(key_share=True)
            .first()
        )
        if not before:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )

        # Optimistic concurrency check: reject a stale edit instead of silently
        # overwriting a change someone else made after this client loaded the
        # record (the "lost update" problem — two editors, second save wins
        # with no warning). Only enforced when the client actually sends
        # expected_version / expected_updated_at, so older/other callers are
        # unaffected.
        ensure_not_stale(
            before.updated_at,
            supplier_update.expected_updated_at,
            f"Supplier '{before.company_name}'",
            supplier_update.expected_version,
        )

        if supplier_update.active is False and before.active:
            self._ensure_can_deactivate(before)

        self._check_currency(supplier_update.default_currency)
        self._check_currency(supplier_update.default_currency)
        self._check_duplicate_fields(supplier_update, exclude_id=supplier_id)

        if {"mobile_contact_number", "home_contact_number"} & set(submitted_fields):
            # Compare against the stored value of the field that was not sent.
            from app.common.validators import normalize_phone_number

            def _norm(value):
                try:
                    return normalize_phone_number(value)
                except ValueError:  # legacy value in an old format: compare as typed
                    return str(value).strip() or None

            first = _norm(submitted_fields.get("mobile_contact_number", before.mobile_contact_number))
            second = _norm(submitted_fields.get("home_contact_number", before.home_contact_number))
            if first and second and first == second:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Contact No 1 and Contact No 2 must be different",
                )

        before_values = {field: getattr(before, field) for field in submitted_fields}

        # One commit for the field changes, credit recalculation and audit
        # row. Previously these were three commits, so a failure in a later
        # step returned an error for changes that had in fact been saved.
        with self._duplicate_guard():
            supplier = self.repo.update(supplier_id, supplier_update)
            changes = diff_changes(before_values, submitted_fields)

            # When max_credit_limit changes, recalculate left_credit_amount
            if supplier_update.max_credit_limit is not None:
                from app.modules.purchasing.credit_service import SupplierCreditService
                supplier.initial_credit_amount = supplier.max_credit_limit
                SupplierCreditService().update_supplier_credit_balance(self.repo.db, supplier_id)

            if changes:
                log_audit(
                    self.repo.db,
                    user_id=updated_by or 0,
                    action="update",
                    entity_type="supplier",
                    entity_id=supplier.id,
                    changes=changes,
                )
            self.repo.db.commit()
        self.repo.db.refresh(supplier)
        supplier.average_lead_time_days = self.repo.get_average_lead_times([supplier_id]).get(supplier_id)
        self._attach_user_names([supplier])
        return supplier

class SupplierPaymentMethodService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierPaymentMethodRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)

    def _ensure_supplier(self, supplier_id: int) -> models.Supplier:
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        return supplier

    def _get_owned_method(self, supplier_id: int, method_id: int) -> models.SupplierPaymentMethod:
        method = self.repo.get_by_id(method_id)
        if not method or method.supplier_id != supplier_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment method with id {method_id} not found for this supplier"
            )
        return method

    def list_payment_methods(self, supplier_id: int) -> List[models.SupplierPaymentMethod]:
        self._ensure_supplier(supplier_id)
        return self.repo.get_by_supplier(supplier_id)

    def create_payment_method(
        self, supplier_id: int, data: schemas.SupplierPaymentMethodCreate
    ) -> models.SupplierPaymentMethod:
        supplier = self._ensure_supplier(supplier_id)
        if not supplier.active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add a payment method to an inactive supplier.")
        return self.repo.create(supplier_id, data)

    def update_payment_method(
        self, supplier_id: int, method_id: int, data: schemas.SupplierPaymentMethodUpdate
    ) -> models.SupplierPaymentMethod:
        existing = self._get_owned_method(supplier_id, method_id)
        merged = {c.name: getattr(existing, c.name) for c in existing.__table__.columns}
        merged.update(data.model_dump(exclude_unset=True))
        try:
            schemas.check_payment_method_rules(merged)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        return self.repo.update(method_id, data)

    def delete_payment_method(self, supplier_id: int, method_id: int) -> None:
        self._get_owned_method(supplier_id, method_id)
        self.repo.delete(method_id)


# Fields that must be unique across all contact persons (system-wide, not just
# within one supplier — an ID card/passport number identifies one real person).
CONTACT_PERSON_UNIQUE_FIELDS = {
    "id_card_number": "ID card number",
    "passport_no": "Passport number",
    "email": "Email",
}

class SupplierContactPersonService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierContactPersonRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)

    def _ensure_supplier(self, supplier_id: int) -> models.Supplier:
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        return supplier

    def _check_duplicate_fields(self, data, exclude_id: Optional[int] = None) -> None:
        for field, label in CONTACT_PERSON_UNIQUE_FIELDS.items():
            value = getattr(data, field, None)
            if not value or not str(value).strip():
                continue
            existing = self.repo.find_by_field_value(field, str(value), exclude_id=exclude_id)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{label} '{value}' is already used by another contact person."
                )

    def _get_owned_contact(self, supplier_id: int, contact_id: int) -> models.SupplierContactPerson:
        contact = self.repo.get_by_id(contact_id)
        if not contact or contact.supplier_id != supplier_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Contact person with id {contact_id} not found for this supplier"
            )
        return contact

    def list_contacts(self, supplier_id: int) -> List[models.SupplierContactPerson]:
        self._ensure_supplier(supplier_id)
        return self.repo.get_by_supplier(supplier_id)

    def create_contact(
        self, supplier_id: int, data: schemas.SupplierContactPersonCreate
    ) -> models.SupplierContactPerson:
        supplier = self._ensure_supplier(supplier_id)
        if not supplier.active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add a contact person to an inactive supplier.")
        self._check_duplicate_fields(data)
        return self.repo.create(supplier_id, data)

    def update_contact(
        self, supplier_id: int, contact_id: int, data: schemas.SupplierContactPersonUpdate
    ) -> models.SupplierContactPerson:
        self._get_owned_contact(supplier_id, contact_id)
        self._check_duplicate_fields(data, exclude_id=contact_id)
        return self.repo.update(contact_id, data)

    def delete_contact(self, supplier_id: int, contact_id: int) -> None:
        self._get_owned_contact(supplier_id, contact_id)
        self.repo.delete(contact_id)


class SupplierProductService:
    """The "approved vendor list": which suppliers can supply a given
    product, and on what terms (cost, lead time, MOQ, preferred flag)."""

    def __init__(self, db: Session):
        self.db = db
        self.repo = repository.SupplierProductRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)

    def _ensure_supplier(self, supplier_id: int) -> models.Supplier:
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        return supplier

    def _ensure_product(self, product_id: int) -> None:
        from app.modules.products.models import Product

        if not self.db.query(Product).filter(Product.id == product_id).first():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )

    def _get_owned_mapping(self, supplier_id: int, mapping_id: int) -> models.SupplierProduct:
        mapping = self.repo.get_by_id(mapping_id)
        if not mapping or mapping.supplier_id != supplier_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier product with id {mapping_id} not found for this supplier"
            )
        return mapping

    def list_by_supplier(self, supplier_id: int) -> List[models.SupplierProduct]:
        self._ensure_supplier(supplier_id)
        return self.repo.get_by_supplier(supplier_id)

    def list_by_product(self, product_id: int) -> List[models.SupplierProduct]:
        self._ensure_product(product_id)
        return self.repo.get_by_product(product_id)

    def create_mapping(
        self, supplier_id: int, data: schemas.SupplierProductCreate
    ) -> models.SupplierProduct:
        supplier = self._ensure_supplier(supplier_id)
        if not supplier.active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add a product mapping to an inactive supplier.")
        self._ensure_product(data.product_id)
        if self.repo.find_by_pair(supplier_id, data.product_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This product is already mapped to this supplier",
            )
        return self.repo.create(supplier_id, data)

    def update_mapping(
        self, supplier_id: int, mapping_id: int, data: schemas.SupplierProductUpdate
    ) -> models.SupplierProduct:
        self._get_owned_mapping(supplier_id, mapping_id)
        return self.repo.update(mapping_id, data)

    def delete_mapping(self, supplier_id: int, mapping_id: int) -> None:
        self._get_owned_mapping(supplier_id, mapping_id)
        self.repo.delete(mapping_id)


RECEIVABLE_PO_STATUSES = ("approved", "partially_completed")


class PurchasingOrderService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = repository.PurchasingOrderRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
    
    def check_daily_limit(self, branch_code: str, target_date: date = None) -> schemas.DailyPOLimitCheck:
        if target_date is None:
            target_date = tz.today()
        
        count = self.repo.count_daily_orders_by_branch(branch_code, target_date)
        remaining = max(0, DAILY_PO_LIMIT_PER_BRANCH - count)
        can_create = count < DAILY_PO_LIMIT_PER_BRANCH
        
        if can_create:
            message = f"Branch {branch_code} has created {count} PO(s) today. {remaining} remaining."
        else:
            message = f"Daily limit of {DAILY_PO_LIMIT_PER_BRANCH} POs reached for branch {branch_code}. Cannot create more POs today."
        
        return schemas.DailyPOLimitCheck(
            branch_code=branch_code,
            date=target_date,
            count=count,
            limit=DAILY_PO_LIMIT_PER_BRANCH,
            remaining=remaining,
            can_create=can_create,
            message=message
        )

    def _lock_daily_po_limit(self, branch_code: str, target_date: date = None) -> None:
        """Serialize the daily-limit check-then-create per branch/day (transaction-scoped
        advisory lock, same pattern as get_next_po_number) so two concurrent creates can't
        both read a count under the limit before either has committed."""
        if target_date is None:
            target_date = tz.today()
        self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"po-daily-limit-{branch_code}-{target_date}"},
        )
    
    def _validate_order_group(self, order: schemas.PurchasingOrderCreate) -> None:
        """Shared validation for a single PurchasingOrderCreate — branch
        active, suppliers exist/active, products active. Used by both
        create_order (single PO) and create_order_batch (one PO per
        supplier group), so a batch checkout enforces exactly the same
        rules per resulting PO as creating it individually would."""
        from app.common.branch_validation import validate_branch_is_active
        validate_branch_is_active(self.db, order.branch_code)

        # ── A PO sourced from a Sales Quotation requires that quotation to
        # have been approved. `approval` (not `status`) is the gate: once
        # some of the quote's items are converted the header status moves on
        # to partially_processed, but `approval` stays True from the
        # original sign-off. ──
        if order.sales_quote_id:
            from app.modules.sales.quotation_models import SalesQuote, QuoteStatus
            quote = self.db.query(SalesQuote).filter(SalesQuote.id == order.sales_quote_id).first()
            if not quote:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Quotation with id {order.sales_quote_id} not found"
                )
            if not quote.approval or quote.status in (
                QuoteStatus.REJECTED.value, QuoteStatus.CANCELLED.value, QuoteStatus.REVISED.value
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot create a purchase order from quotation {quote.quote_no} — it has not been approved."
                )
            if order.branch_code != quote.branch_code:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Purchase order branch '{order.branch_code}' does not match quotation {quote.quote_no} (branch '{quote.branch_code}')."
                )

        self.supplier_repo.lock_for_document(order.first_suppliers_id, order.second_suppliers_id)
        first_supplier = self.supplier_repo.get_by_id(order.first_suppliers_id)
        if not first_supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"First supplier with id {order.first_suppliers_id} not found"
            )
        if not first_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supplier '{first_supplier.company_name}' is inactive. Please reactivate the supplier before creating a purchase order."
            )

        if order.second_suppliers_id:
            second_supplier = self.supplier_repo.get_by_id(order.second_suppliers_id)
            if not second_supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Second supplier with id {order.second_suppliers_id} not found"
                )
            if not second_supplier.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{second_supplier.company_name}' is inactive. Please reactivate the supplier before creating a purchase order."
                )

        # ── Validate all products in order items are active ──
        if order.items:
            from app.modules.products.models import Product
            for po_item in order.items:
                if hasattr(po_item, 'product_id') and po_item.product_id:
                    product = self.db.query(Product).filter(Product.id == po_item.product_id).first()
                    if product and not product.active:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Product '{product.name}' (ID: {product.id}) is inactive. Please reactivate the product before adding it to a purchase order."
                        )

        # ── Validate quote-sourced items aren't already fulfilled, and that
        # the requested quantity doesn't exceed what's left to procure. This
        # is the server-side guard against creating a duplicate PO for the
        # same quotation line. ──
        if order.items:
            from app.modules.sales.quotation_models import SalesQuoteItem
            # the same quotation line may appear on several PO lines: check the sum
            line_totals: dict = {}
            for po_item in order.items:
                qid_ = getattr(po_item, "quote_item_id", None)
                if qid_:
                    line_totals[qid_] = line_totals.get(qid_, 0) + po_item.quantity
            for po_item in order.items:
                quote_item_id = getattr(po_item, "quote_item_id", None)
                if not quote_item_id:
                    continue
                quote_item = (
                    self.db.query(SalesQuoteItem)
                    .filter(SalesQuoteItem.id == quote_item_id)
                    .with_for_update()
                    .first()
                )
                if not quote_item:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Quotation item with id {quote_item_id} not found"
                    )
                if order.sales_quote_id and quote_item.quote_id != order.sales_quote_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Quotation item {quote_item.id} does not belong to quote {order.sales_quote_id}"
                    )
                _check_quote_item_open(quote_item, line_totals[quote_item_id])
                if po_item.unit_price > quote_item.selling_price:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Unit price {po_item.unit_price} for quotation item {quote_item.id} is higher than its selling price {quote_item.selling_price}; a purchase above the selling price would sell at a loss."
                    )

    def _fulfill_quote_items(self, order: schemas.PurchasingOrderCreate) -> None:
        """Mark this order's quote-sourced items (those carrying a
        quote_item_id) as po_created and bump their converted_qty. Called
        only after the order/items have actually been created — validation
        that they're eligible already ran in _validate_order_group."""
        from app.modules.sales.quotation_models import SalesQuoteItem
        for po_item in order.items:
            quote_item_id = getattr(po_item, "quote_item_id", None)
            if not quote_item_id:
                continue
            quote_item = self.db.query(SalesQuoteItem).filter(SalesQuoteItem.id == quote_item_id).first()
            if not quote_item:
                continue
            quote_item.converted_qty = (quote_item.converted_qty or 0) + po_item.quantity
            # Fully ordered -> po_created; a partial order keeps the item open ("procurement")
            # so the rest can still be ordered.
            quote_item.item_status = "po_created" if quote_item.converted_qty >= quote_item.quantity else "procurement"

            # A PO now exists for this item — it no longer belongs in the
            # procurement queue (TOP page), regardless of which entry point
            # (TOP page or a quotation's own create-PO flow) created the PO.
            self.db.query(models.ProcurementQueueItem).filter(
                models.ProcurementQueueItem.quote_item_id == quote_item_id
            ).delete()

    def _release_quote_items(self, order: models.PurchasingOrder) -> None:
        """A cancelled / rejected PO gives its quantities back to the quotation items it
        was ordered for, so they can be procured again; the quotation status follows."""
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        from app.modules.sales.quotation_service import sales_quote_service

        touched_quotes = set()
        for po_item in order.items or []:
            qid = getattr(po_item, "quote_item_id", None)
            if not qid:
                continue
            qi = self.db.query(SalesQuoteItem).filter(SalesQuoteItem.id == qid).with_for_update().first()
            if not qi or qi.item_status in ("itn_created", "so_created", "completed", "cancelled"):
                continue
            qi.converted_qty = max((qi.converted_qty or 0) - po_item.quantity, 0)
            if qi.converted_qty >= qi.quantity:
                qi.item_status = "po_created"
            elif qi.converted_qty > 0:
                qi.item_status = "procurement"
            else:
                qi.item_status = "pending"
            touched_quotes.add(qi.quote_id)
        for quote_id in touched_quotes:
            quote = self.db.query(SalesQuote).filter(SalesQuote.id == quote_id).first()
            if quote:
                self.db.refresh(quote, attribute_names=["items"])
                sales_quote_service.recompute_quote_status(self.db, quote)

    def create_order(self, order: schemas.PurchasingOrderCreate, created_by: int = 1) -> models.PurchasingOrder:
        self._lock_daily_po_limit(order.branch_code)
        limit_check = self.check_daily_limit(order.branch_code)
        if not limit_check.can_create:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=limit_check.message
            )

        self._validate_order_group(order)

        from decimal import Decimal
        po_total = sum(
            Decimal(str(item.quantity)) * item.unit_price
            for item in order.items
        ) if order.items else Decimal("0")

        # All orders start with pending_approval status (both credit and non-credit)
        initial_status = PurchaseOrderStatus.PENDING_APPROVAL

        # For credit purchases, perform credit check to warn about limit
        if order.payment_method.lower() == "credit":
            from app.modules.purchasing.credit_service import SupplierCreditService
            credit_service = SupplierCreditService()
            credit_check = credit_service.check_po_credit(
                self.repo.db, order.first_suppliers_id, po_total, order.payment_method
            )
            # Note: Credit check is informational; status remains pending_approval

        # Create the order with pending_approval status. Everything below —
        # approval record, audit log, and (if sourced from a quotation) the
        # quote link/item-fulfillment/status-recompute — is committed together
        # in one final transaction (mirrors create_order_batch) so a failure
        # linking the quote can't leave an orphaned PO with a quote item
        # that's still stuck "unfulfilled" in the procurement queue.
        created_order = self.repo.create(order, initial_status=initial_status, commit=False)

        # Create approval record for the new PO
        approval_record = approval_service.create_approval_request(
            db=self.db,
            approval_type=ApprovalType.PURCHASE_ORDER,
            reference_id=created_order.id,
            reference_no=created_order.purchasing_order_no,
            branch_code=order.branch_code,
            requested_by=created_by,
            remarks=f"Purchase order pending approval.",
            approval_group="purchasing_approvers"
        )
        created_order.approval_id = approval_record.id
        log_audit(self.db, user_id=created_by, action="create", entity_type="purchase_order", entity_id=created_order.id, changes={"status": initial_status, "po_no": created_order.purchasing_order_no})

        # If PO was created from a quotation, record the PO link on
        # the quote and mark any quote-sourced items as procured (this is
        # what drives the header to PARTIALLY_PROCESSED/COMPLETED).
        try:
            if order.sales_quote_id:
                from app.modules.sales.quotation_models import SalesQuote
                from app.modules.sales.quotation_service import sales_quote_service
                linked_quote = self.db.query(SalesQuote).filter(SalesQuote.id == order.sales_quote_id).first()
                if linked_quote:
                    linked_quote.linked_po_id = created_order.id
                    linked_quote.po_created_date = tz.now()
                    self._fulfill_quote_items(order)
                    sales_quote_service.recompute_quote_status(self.db, linked_quote)

            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(created_order)
        return created_order

    def create_order_batch(
        self, groups: List[schemas.PurchasingOrderCreate], created_by: int = 1
    ) -> tuple[str, List[models.PurchasingOrder]]:
        """
        Product-first, multi-supplier checkout: create one PurchasingOrder
        per supplier group, all sharing a single freshly-generated
        purchase_batch_id, as one all-or-nothing transaction. Mirrors
        create_order's per-group validation and side effects (approval
        record, audit log, credit check, quote link) but commits once at
        the end so a failure partway through leaves no orphan POs.
        """
        import uuid
        from decimal import Decimal

        if not groups:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one supplier group is required")

        # Daily limit, per distinct branch across ALL groups: each branch must have
        # room for the number of POs this batch creates in it. Locks are taken in
        # sorted branch order so concurrent batches can't deadlock.
        per_branch: dict[str, int] = {}
        for group in groups:
            per_branch[group.branch_code] = per_branch.get(group.branch_code, 0) + 1
        for branch_code in sorted(per_branch):
            self._lock_daily_po_limit(branch_code)
        for branch_code in sorted(per_branch):
            wanted = per_branch[branch_code]
            limit_check = self.check_daily_limit(branch_code)
            if limit_check.remaining < wanted:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"This purchase would create {wanted} purchase orders for branch "
                        f"{branch_code}, but only {limit_check.remaining} remain today. {limit_check.message}"
                    ),
                )

        for group in groups:
            self._validate_order_group(group)

        batch_id = str(uuid.uuid4())
        created_orders: List[models.PurchasingOrder] = []

        try:
            for group in groups:
                po_total = sum(
                    Decimal(str(item.quantity)) * item.unit_price for item in group.items
                ) if group.items else Decimal("0")

                if group.payment_method.lower() == "credit":
                    from app.modules.purchasing.credit_service import SupplierCreditService
                    SupplierCreditService().check_po_credit(
                        self.repo.db, group.first_suppliers_id, po_total, group.payment_method
                    )

                created_order = self.repo.create(
                    group,
                    initial_status=PurchaseOrderStatus.PENDING_APPROVAL,
                    batch_id=batch_id,
                    commit=False,
                )

                approval_record = approval_service.create_approval_request(
                    db=self.db,
                    approval_type=ApprovalType.PURCHASE_ORDER,
                    reference_id=created_order.id,
                    reference_no=created_order.purchasing_order_no,
                    branch_code=group.branch_code,
                    requested_by=created_by,
                    remarks="Purchase order pending approval.",
                    approval_group="purchasing_approvers",
                )
                created_order.approval_id = approval_record.id

                log_audit(
                    self.db,
                    user_id=created_by,
                    action="create",
                    entity_type="purchase_order",
                    entity_id=created_order.id,
                    changes={
                        "status": PurchaseOrderStatus.PENDING_APPROVAL,
                        "po_no": created_order.purchasing_order_no,
                        "purchase_batch_id": batch_id,
                    },
                )

                if group.sales_quote_id:
                    from app.modules.sales.quotation_models import SalesQuote
                    from app.modules.sales.quotation_service import sales_quote_service
                    linked_quote = self.db.query(SalesQuote).filter(SalesQuote.id == group.sales_quote_id).first()
                    if linked_quote:
                        linked_quote.linked_po_id = created_order.id
                        linked_quote.po_created_date = tz.now()
                        self._fulfill_quote_items(group)
                        sales_quote_service.recompute_quote_status(self.db, linked_quote)

                created_orders.append(created_order)

            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        for order in created_orders:
            self.db.refresh(order)

        return batch_id, created_orders
    
    def get_order(self, order_id: int) -> models.PurchasingOrder:
        order = self.repo.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        return order
    
    def list_orders(self, filters: schemas.PurchaseOrderListFilter) -> List[models.PurchasingOrder]:
        return self.repo.get_all(filters)

    def list_orders_page(self, filters: schemas.PurchaseOrderListFilter, page: int, size: int, sort_by=None, order="desc"):
        return self.repo.get_page(filters, page, size, sort_by, order)

    def get_available_stock_by_product(self, product_ids: List[int], branch_code: str) -> Dict[int, int]:
        """Currently-available stock count per product at a branch — same
        "available" definition (status + is_active) as the procurement
        queue's available_quantity. Used by the PO creation wizard so the
        user can see what's already in stock before ordering more."""
        from app.modules.inventory.models import SalesStock

        if not product_ids:
            return {}
        stock_rows = (
            self.db.query(SalesStock.product_id, func.count(SalesStock.id))
            .filter(
                SalesStock.product_id.in_(product_ids),
                SalesStock.branch_code == branch_code,
                SalesStock.status == StockStatus.AVAILABLE,
                SalesStock.is_active == True,
            )
            .group_by(SalesStock.product_id)
            .all()
        )
        return {product_id: int(count) for product_id, count in stock_rows}

    def get_in_transit_by_product(self, product_ids: List[int], branch_code: str) -> Dict[int, int]:
        """Units still on their way per product at a branch: ordered on
        approved / partially received purchase orders, minus what the GRNs
        have already received. Pending-approval, rejected, cancelled,
        completed and short-closed orders never count."""
        if not product_ids:
            return {}
        open_statuses = (PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_COMPLETED)
        ordered = dict(
            self.db.query(
                models.PurchasingOrderItems.product_id,
                func.coalesce(func.sum(models.PurchasingOrderItems.quantity), 0),
            )
            .join(models.PurchasingOrder, models.PurchasingOrder.id == models.PurchasingOrderItems.purchasingorders_id)
            .filter(
                models.PurchasingOrderItems.product_id.in_(product_ids),
                models.PurchasingOrder.branch_code == branch_code,
                models.PurchasingOrder.status.in_(open_statuses),
            )
            .group_by(models.PurchasingOrderItems.product_id)
            .all()
        )
        received = dict(
            self.db.query(
                models.PurchasingOrderItems.product_id,
                func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0),
            )
            .join(
                models.GoodReceivedItems,
                models.GoodReceivedItems.purchasing_order_items_id == models.PurchasingOrderItems.id,
            )
            .join(models.PurchasingOrder, models.PurchasingOrder.id == models.PurchasingOrderItems.purchasingorders_id)
            .filter(
                models.PurchasingOrderItems.product_id.in_(product_ids),
                models.PurchasingOrder.branch_code == branch_code,
                models.PurchasingOrder.status.in_(open_statuses),
                models.GoodReceivedItems.active == True,
            )
            .group_by(models.PurchasingOrderItems.product_id)
            .all()
        )
        result = {}
        for product_id, qty in ordered.items():
            remaining = int(qty) - int(received.get(product_id, 0))
            if remaining > 0:
                result[product_id] = remaining
        return result

    def update_order(self, order_id: int, order_update: schemas.PurchasingOrderUpdate, updated_by: Optional[int] = None) -> models.PurchasingOrder:
        existing_po = self.repo.get_by_id(order_id)
        if not existing_po:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )

        # Snapshot the fields the request actually touched (exclude_unset) so
        # the audit log records what genuinely changed, "old -> new", the
        # same way SupplierService.update_supplier / QuotationService.update_quote do.
        submitted_fields = order_update.model_dump(exclude_unset=True, exclude={"items"})
        before_values = {field: getattr(existing_po, field) for field in submitted_fields}
        
        if existing_po.status in (PurchaseOrderStatus.PARTIALLY_COMPLETED, PurchaseOrderStatus.COMPLETED) or existing_po.good_received_notes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit purchase order. Purchase orders that have received goods (GRN created) cannot be edited."
            )
        
        if existing_po.status in (PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.SHORT_CLOSED):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit purchase order: it is {existing_po.status}."
            )

        # Dates must stay consistent once the edit is merged with the stored order.
        new_order_date = order_update.purchasing_order_date or existing_po.purchasing_order_date
        new_grn_date = order_update.good_received_note_date or existing_po.good_received_note_date
        if new_grn_date < new_order_date:
            raise HTTPException(status_code=422, detail="Expected delivery date cannot be before the order date")
        new_first = order_update.first_suppliers_id or existing_po.first_suppliers_id
        new_second = order_update.second_suppliers_id if "second_suppliers_id" in submitted_fields else existing_po.second_suppliers_id
        if new_second and new_second == new_first:
            raise HTTPException(status_code=422, detail="Second supplier must differ from the first supplier")
        if order_update.branch_code and order_update.branch_code != existing_po.branch_code:
            from app.common.branch_validation import validate_branch_is_active
            validate_branch_is_active(self.db, order_update.branch_code)

        # If updating suppliers, verify they are active
        self.supplier_repo.lock_for_document(order_update.first_suppliers_id, order_update.second_suppliers_id)
        if order_update.first_suppliers_id is not None:
            first_supplier = self.supplier_repo.get_by_id(order_update.first_suppliers_id)
            if not first_supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"First supplier with id {order_update.first_suppliers_id} not found"
                )
            if not first_supplier.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{first_supplier.company_name}' is inactive. Please reactivate the supplier before updating the purchase order."
                )
        
        if order_update.second_suppliers_id:
            second_supplier = self.supplier_repo.get_by_id(order_update.second_suppliers_id)
            if not second_supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Second supplier with id {order_update.second_suppliers_id} not found"
                )
            if not second_supplier.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{second_supplier.company_name}' is inactive. Please reactivate the supplier before updating the purchase order."
                )
        
        # Track if this was an approved PO being edited
        was_approved = existing_po.status == "approved"

        item_changes = []
        if order_update.items is not None:
            before_items = [
                {"product_id": i.product_id, "quantity": i.quantity, "unit_price": float(i.unit_price)}
                for i in existing_po.items
            ]
            after_items = [
                {"product_id": i.product_id, "quantity": i.quantity, "unit_price": float(i.unit_price)}
                for i in order_update.items
            ]
            item_changes = diff_line_items(before_items, after_items, key_field="product_id")

        order = self.repo.update(order_id, order_update)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )

        changed_fields = set(submitted_fields.keys())
        if item_changes:
            changed_fields.add("items")

        if changed_fields:
            changes = diff_changes(before_values, submitted_fields)
            if item_changes:
                from app.modules.products.models import Product

                product_ids = {entry["key"] for entry in item_changes}
                product_names = {
                    p.id: p.name
                    for p in self.db.query(Product).filter(Product.id.in_(product_ids)).all()
                }
                for entry in item_changes:
                    entry["product_name"] = product_names.get(entry["key"], f"Product #{entry['key']}")
                changes["item_changes"] = item_changes
                changes.setdefault("fields", [])
                changes["fields"] = sorted(set(changes["fields"]) | {"items"})
            log_audit(
                self.db,
                user_id=updated_by or 0,
                action="update",
                entity_type="purchase_order",
                entity_id=order.id,
                changes=changes or {"fields": sorted(changed_fields)},
            )
            self.db.commit()

        # If an approved PO was edited, reset it back to pending_approval
        if was_approved:
            from app.modules.common.models import Approvals
            
            order.status = PurchaseOrderStatus.PENDING_APPROVAL
            
            # Reset the existing approval record back to pending
            if order.approval_id:
                approval_record = self.db.query(Approvals).filter(Approvals.id == order.approval_id).first()
                if approval_record:
                    approval_record.status = ApprovalStatus.PENDING
                    approval_record.status_changed_by = None
                    approval_record.remark = "Re-approval required: Purchase order was edited after approval."
            else:
                # Create a new approval record if one doesn't exist
                approval_record = approval_service.create_approval_request(
                    db=self.db,
                    approval_type=ApprovalType.PURCHASE_ORDER,
                    reference_id=order.id,
                    reference_no=order.purchasing_order_no,
                    branch_code=order.branch_code,
                    requested_by=0,  # System-triggered re-approval
                    remarks="Re-approval required: Purchase order was edited after approval.",
                    approval_group="purchasing_approvers"
                )
                order.approval_id = approval_record.id
            
            self.db.commit()
            self.db.refresh(order)
        
        return order

    def cancel_order(self, order_id: int, reason: str, user_id: int = 0) -> models.PurchasingOrder:
        """Cancel a PO that hasn't received any goods yet. Once anything has
        been received, the order must be short-closed instead (see
        short_close_order) so the received units stay on record."""
        from app.modules.common.models import Approvals

        order = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == order_id
        ).with_for_update().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        if order.status in (
            PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.COMPLETED,
            PurchaseOrderStatus.SHORT_CLOSED, PurchaseOrderStatus.REJECTED,
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot cancel: order is already '{order.status}'."
            )
        if order.good_received_notes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot cancel: goods have already been received for this order. Use Short-Close instead."
            )

        self._release_quote_items(order)
        order.status = PurchaseOrderStatus.CANCELLED
        order.cancellation_reason = reason
        order.cancelled_date = tz.now()
        order.cancelled_by = user_id

        if order.approval_id:
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == order.approval_id
            ).with_for_update().first()
            if approval_record and approval_record.status == ApprovalStatus.PENDING:
                approval_record.status = ApprovalStatus.CANCELLED
                approval_record.status_changed_by = user_id
                approval_record.remark = f"Order cancelled: {reason}"

        log_audit(
            self.db,
            user_id=user_id,
            action="cancel",
            entity_type="purchase_order",
            entity_id=order.id,
            changes={"status": str(order.status), "reason": reason},
        )
        self.db.commit()
        self.db.refresh(order)
        return order

    def short_close_order(self, order_id: int, reason: str, user_id: int = 0) -> models.PurchasingOrder:
        """Manually close a partially-received PO when the supplier confirms
        no more units are coming for the remaining ordered quantity — keeps
        it from sitting as "outstanding" forever without pretending it was
        fully completed."""
        order = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == order_id
        ).with_for_update().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        if order.status != PurchaseOrderStatus.PARTIALLY_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Short-close is only allowed for partially received orders (current status: '{order.status}')."
            )

        order.status = PurchaseOrderStatus.SHORT_CLOSED
        order.short_close_reason = reason
        order.short_closed_date = tz.now()
        order.short_closed_by = user_id

        log_audit(
            self.db,
            user_id=user_id,
            action="short_close",
            entity_type="purchase_order",
            entity_id=order.id,
            changes={"status": str(order.status), "reason": reason},
        )
        self.db.commit()
        self.db.refresh(order)
        return order

    def _recalculate_expected_delivery(self, order: models.PurchasingOrder) -> None:
        """Restart the supplier's lead time from the approval date.

        The expected delivery date is first estimated at creation as order
        date + supplier lead time (working days), but the supplier only
        starts the clock once the approved order reaches them. If the date
        still equals that creation estimate (i.e. nobody changed it by hand),
        move it to approval date + lead time. A manually set date is left alone.
        """
        from datetime import date as _date
        from app.common.working_days import add_working_days

        supplier = self.db.query(models.Supplier).filter(
            models.Supplier.id == order.first_suppliers_id
        ).first()
        lead_days = supplier.lead_time_days if supplier else None
        if not lead_days or lead_days <= 0:
            return

        creation_estimate = add_working_days(order.purchasing_order_date, lead_days)
        if order.good_received_note_date != creation_estimate:
            return

        new_estimate = add_working_days(tz.today(), lead_days)
        if new_estimate <= creation_estimate:
            return
        # The wizard fills the required (needed-by) date with the same value.
        if order.required_date == order.good_received_note_date:
            order.required_date = new_estimate
        order.good_received_note_date = new_estimate

    def approve_order(self, order_id: int, approve: bool, remarks: Optional[str] = None, user_id: int = 0) -> models.PurchasingOrder:
        """
        Approve or reject a purchase order.
        """
        from app.modules.common.models import Approvals
        from decimal import Decimal
        from sqlalchemy import func
        from app.modules.purchasing.credit_service import supplier_credit_service
        from app.modules.purchasing.models import PurchasingOrderItems
        
        # Lock the order row to prevent concurrent approval
        order = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == order_id
        ).with_for_update().first()
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order with id {order_id} not found"
            )
        
        # Determine if we can approve based on current status
        if order.status != "pending_approval":
            # Allow approving if it's just 'pending' (legacy) or 'pending_approval'
            if order.status != "pending":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Order is not pending approval. Current status: {order.status}"
                )
            
        if not approve and not (remarks or "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A reason is required to reject a purchase order"
            )

        # Perform credit check if approving
        if approve and order.payment_method and order.payment_method.lower() == "credit":
            
            po_total = self.db.query(
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
            ).filter(
                PurchasingOrderItems.purchasingorders_id == order_id
            ).scalar() or Decimal("0")
            
            credit_check = supplier_credit_service.check_po_credit(
                self.db, order.first_suppliers_id, po_total, order.payment_method,
                exclude_po_id=order_id
            )
            
            if credit_check["requires_approval"]:
                if remarks:
                    remarks += f" [Credit Limit Exceeded: {credit_check['message']}]"
                else:
                    remarks = f"Credit Limit Exceeded: {credit_check['message']}"

        # Update Approval Record in approvals table
        if order.approval_id:
            # Lock the approval record to prevent concurrent updates
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == order.approval_id
            ).with_for_update().first()
            if approval_record:
                # If approval record exists, update it
                if approval_record.status == ApprovalStatus.PENDING:
                    approval_record.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
                    approval_record.status_changed_by = user_id
                    approval_record.remark = remarks or f"{'Approved' if approve else 'Rejected'} by user {user_id}"
        
        # Update PO Status
        if approve:
            order.status = PurchaseOrderStatus.APPROVED
            self._recalculate_expected_delivery(order)
        else:
            self._release_quote_items(order)
            order.status = PurchaseOrderStatus.REJECTED

        log_audit(
            self.db,
            user_id=user_id,
            action="approve" if approve else "reject",
            entity_type="purchase_order",
            entity_id=order.id,
            changes={"status": str(order.status), "remarks": remarks},
        )
        self.db.commit()
        self.db.refresh(order)
        return order

def _check_quote_item_open(quote_item, quantity: int) -> None:
    """A quotation line can be (partly) ordered while it is still open and has units left."""
    if quote_item.item_status in ("itn_created", "so_created", "completed", "cancelled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Quotation item {quote_item.id} cannot be ordered (status: {quote_item.item_status}).",
        )
    remaining = quote_item.quantity - (quote_item.converted_qty or 0)
    if remaining <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Quotation item {quote_item.id} already has a purchase order for its full quantity.",
        )
    if quantity > remaining:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Quotation item {quote_item.id} only has {remaining} unit(s) left to procure, but {quantity} were requested.",
        )


class ProcurementQueueService:
    """
    Backs the central "TOP" page: quotation items with a supplier already
    chosen (via the Sales Quotation page's supplier-selection dialog) but no
    Purchase Order created for them yet. Rows are plain queue entries — no
    approval/daily-limit/credit logic lives here, that all still happens in
    PurchasingOrderService.create_order_batch when the queued items are
    actually turned into POs.
    """

    def __init__(self, db: Session):
        self.db = db

    def add_to_queue(
        self,
        items: List[schemas.ProcurementQueueItemCreate],
        added_by: int = 0,
        allowed_branches: Optional[List[str]] = None,
    ) -> List[models.ProcurementQueueItem]:
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem, QuoteStatus

        result: List[models.ProcurementQueueItem] = []

        for item in items:
            quote_item = self.db.query(SalesQuoteItem).filter(
                SalesQuoteItem.id == item.quote_item_id
            ).with_for_update().first()
            if not quote_item:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Quotation item with id {item.quote_item_id} not found"
                )
            quote = self.db.query(SalesQuote).filter(SalesQuote.id == quote_item.quote_id).first()
            if allowed_branches is not None and (not quote or quote.branch_code not in allowed_branches):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied to this quotation's branch",
                )
            if not quote or not quote.approval or quote.status in (
                QuoteStatus.REJECTED.value, QuoteStatus.CANCELLED.value, QuoteStatus.REVISED.value,
                QuoteStatus.EXPIRED.value, QuoteStatus.COMPLETED.value,
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="The quotation is not approved or is closed; its items cannot be queued for procurement.",
                )
            _check_quote_item_open(quote_item, item.quantity)
            if item.unit_price > quote_item.selling_price:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unit price {item.unit_price} is higher than the quotation selling price {quote_item.selling_price}.",
                )

            supplier_repo = repository.SupplierRepository(self.db)
            supplier_repo.lock_for_document(item.supplier_id)
            supplier = supplier_repo.get_by_id(item.supplier_id)
            if not supplier:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Supplier with id {item.supplier_id} not found"
                )
            if not supplier.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{supplier.company_name}' is inactive."
                )

            existing = self.db.query(models.ProcurementQueueItem).filter(
                models.ProcurementQueueItem.quote_item_id == item.quote_item_id
            ).first()
            if existing:
                existing.supplier_id = item.supplier_id
                existing.quantity = item.quantity
                existing.unit_price = item.unit_price
                result.append(existing)
            else:
                queued = models.ProcurementQueueItem(
                    quote_item_id=item.quote_item_id,
                    supplier_id=item.supplier_id,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    added_date=tz.now(),
                    created_by=added_by,
                )
                self.db.add(queued)
                result.append(queued)

        self.db.commit()
        for row in result:
            self.db.refresh(row)
        return result

    def list_queue(self, branch_codes: Optional[List[str]] = None) -> List[schemas.ProcurementQueueItem]:
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        from app.modules.products.models import Product
        from app.modules.inventory.models import SalesStock

        query = (
            self.db.query(models.ProcurementQueueItem, SalesQuoteItem, SalesQuote, Product, models.Supplier)
            .join(SalesQuoteItem, models.ProcurementQueueItem.quote_item_id == SalesQuoteItem.id)
            .join(SalesQuote, SalesQuoteItem.quote_id == SalesQuote.id)
            .join(Product, SalesQuoteItem.product_id == Product.id)
            .join(models.Supplier, models.ProcurementQueueItem.supplier_id == models.Supplier.id)
        )
        if branch_codes is not None:
            query = query.filter(SalesQuote.branch_code.in_(branch_codes))

        rows = query.order_by(models.ProcurementQueueItem.added_date.asc()).all()
        if not rows:
            return []

        # Batch-compute "already available at this branch" per (product,
        # branch) pair, and "already ordered" per quote item — avoids an
        # available/ordered query per row.
        product_branch_pairs = {(quote_item.product_id, quote.branch_code) for _, quote_item, quote, _, _ in rows}
        product_ids = {p for p, _ in product_branch_pairs}
        branch_codes_in_rows = {b for _, b in product_branch_pairs}
        available_map: Dict[tuple, int] = {}
        if product_ids:
            stock_rows = (
                self.db.query(SalesStock.product_id, SalesStock.branch_code, func.count(SalesStock.id))
                .filter(
                    SalesStock.product_id.in_(product_ids),
                    SalesStock.branch_code.in_(branch_codes_in_rows),
                    SalesStock.status == StockStatus.AVAILABLE,
                    SalesStock.is_active == True,
                )
                .group_by(SalesStock.product_id, SalesStock.branch_code)
                .all()
            )
            available_map = {(p, b): c for p, b, c in stock_rows}

        quote_item_ids = {quote_item.id for _, quote_item, _, _, _ in rows}
        ordered_map: Dict[int, int] = {}
        if quote_item_ids:
            ordered_rows = (
                self.db.query(models.PurchasingOrderItems.quote_item_id, func.coalesce(func.sum(models.PurchasingOrderItems.quantity), 0))
                .filter(models.PurchasingOrderItems.quote_item_id.in_(quote_item_ids))
                .group_by(models.PurchasingOrderItems.quote_item_id)
                .all()
            )
            ordered_map = {qid: int(qty) for qid, qty in ordered_rows}

        result = []
        for queue_item, quote_item, quote, product, supplier in rows:
            required_qty = max(quote_item.quantity - (quote_item.converted_qty or 0), 0)
            available_qty = available_map.get((quote_item.product_id, quote.branch_code), 0)
            ordered_qty = ordered_map.get(quote_item.id, 0)
            to_purchase_qty = max(required_qty - available_qty - ordered_qty, 0)
            result.append(
                schemas.ProcurementQueueItem(
                    id=queue_item.id,
                    quote_item_id=quote_item.id,
                    quote_id=quote.id,
                    quote_no=quote.quote_no,
                    branch_code=quote.branch_code,
                    supplier_id=queue_item.supplier_id,
                    supplier_name=supplier.company_name,
                    product_id=product.id,
                    product_name=product.name,
                    quantity=queue_item.quantity,
                    unit_price=queue_item.unit_price,
                    added_date=queue_item.added_date,
                    required_quantity=required_qty,
                    available_quantity=available_qty,
                    ordered_quantity=ordered_qty,
                    to_purchase_quantity=to_purchase_qty,
                )
            )
        return result

    def remove_from_queue(self, queue_item_id: int, allowed_branches: Optional[List[str]] = None) -> None:
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem

        entry = self.db.query(models.ProcurementQueueItem).filter(
            models.ProcurementQueueItem.id == queue_item_id
        ).with_for_update().first()
        if not entry:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Procurement queue item with id {queue_item_id} not found"
            )
        if allowed_branches is not None:
            branch = (
                self.db.query(SalesQuote.branch_code)
                .join(SalesQuoteItem, SalesQuoteItem.quote_id == SalesQuote.id)
                .filter(SalesQuoteItem.id == entry.quote_item_id)
                .scalar()
            )
            if branch not in allowed_branches:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this queue entry's branch")
        self.db.delete(entry)
        self.db.commit()


class PurchasingReturnService:
    def __init__(self, db: Session):
        self.repo = repository.PurchasingReturnRepository(db)
        self.db = db

    def validate_barcode_for_return(
        self, 
        barcode: str, 
        grn_id: int, 
        branch_code: str
    ) -> schemas.BarcodeValidationResponse:

        from app.modules.inventory.models import SalesStock
        from app.modules.products.models import Product
        stock_item = self.db.query(SalesStock).filter(
            SalesStock.barcode == barcode
        ).first()
        
        if not stock_item:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="Barcode not found in sales stock. This item was never received.",
                sales_stock_id=None,
                product_id=None,
                product_name=None,
                purchasing_price=None,
                status=None
            )

        if stock_item.status == "returned_to_supplier":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item has already been returned to supplier.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status == "return_pending":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item is already pending return approval.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status == "sold":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item has been sold and cannot be returned to supplier.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status in ("transferred", "damaged"):
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item has status '{stock_item.status}' and cannot be returned.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.status != StockStatus.AVAILABLE:
            # Only on-hand units can go back to the supplier (same rule as
            # validate_lot_for_return); reserved / in-transit / cancelled /
            # customer-returned units are refused (QA F2).
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item has status '{stock_item.status}' and cannot be returned.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if not stock_item.is_active:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message="This item is no longer active in stock.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.good_received_note_id != grn_id:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item belongs to a different GRN (ID: {stock_item.good_received_note_id}), not the selected one.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        if stock_item.branch_code != branch_code:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=barcode,
                message=f"This item belongs to branch '{stock_item.branch_code}', not '{branch_code}'.",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                product_name=None,
                purchasing_price=None,
                status=stock_item.status
            )

        product = self.db.query(Product).filter(Product.id == stock_item.product_id).first()
        product_name = product.name if product else "Unknown"

        po_item = self.db.query(models.PurchasingOrderItems).filter(
            models.PurchasingOrderItems.id == stock_item.purchasing_order_items_id
        ).first()
        purchasing_price = po_item.unit_price if po_item else None

        # Warranty check
        warranty_month = stock_item.warranty_month
        warranty_expired = False
        warranty_expiry_date = None
        if warranty_month:
            try:
                from dateutil.relativedelta import relativedelta
                months = int(warranty_month)
                received_date = stock_item.added_date
                if received_date:
                    expiry = received_date + relativedelta(months=months)
                    warranty_expiry_date = expiry.strftime("%Y-%m-%d")
                    warranty_expired = tz.now() > expiry
            except (ValueError, TypeError):
                pass

        return schemas.BarcodeValidationResponse(
            valid=True,
            barcode=barcode,
            message="Barcode is valid for return.",
            sales_stock_id=stock_item.id,
            product_id=stock_item.product_id,
            product_name=product_name,
            purchasing_price=purchasing_price,
            status=stock_item.status,
            warranty_month=warranty_month,
            warranty_expired=warranty_expired,
            warranty_expiry_date=warranty_expiry_date,
        )
    
    def validate_lot_for_return(self, grn_id: int, sales_stock_id: int, quantity: int, lock: bool = False):
        """Validate returning `quantity` units of a batch/none lot row to the
        supplier. Returns (response, row); `row` is the (optionally locked)
        sales_stock lot, or None when invalid."""
        from app.modules.inventory.models import SalesStock
        from app.modules.products.models import Product

        query = self.db.query(SalesStock).filter(SalesStock.id == sales_stock_id)
        row = (query.with_for_update() if lock else query).first()

        def bad(message, available=0):
            return schemas.LotReturnValidationResponse(
                valid=False, message=message, sales_stock_id=sales_stock_id, available_quantity=available
            ), None

        if not row or row.good_received_note_id != grn_id:
            return bad("This stock lot was not received on the selected GRN.")
        if row.barcode:
            return bad("This is a serial-tracked unit; return it by barcode.")
        if row.status != "available" or not row.is_active:
            return bad(f"This lot is not available for return (status: {row.status}).")
        if quantity < 1 or quantity > row.quantity:
            return bad(f"Only {row.quantity} unit(s) of this lot are available to return.", row.quantity)

        product = self.db.query(Product).filter(Product.id == row.product_id).first()
        po_item = self.db.query(models.PurchasingOrderItems).filter(
            models.PurchasingOrderItems.id == row.purchasing_order_items_id
        ).first()
        return schemas.LotReturnValidationResponse(
            valid=True,
            message="Valid - lot can be returned",
            sales_stock_id=row.id,
            product_id=row.product_id,
            product_name=product.name if product else None,
            batch_no=row.batch_no,
            available_quantity=row.quantity,
            purchasing_price=po_item.unit_price if po_item else None,
        ), row

    def _open_return_ids_for_unit(self, sales_stock_id: int, exclude_return_id: Optional[int] = None) -> List[int]:
        """Ids of pending/approved purchase returns already holding this stock row."""
        q = (
            self.db.query(models.PurchasingReturn.id)
            .join(models.PurchasingReturnItems, models.PurchasingReturnItems.purchasingreturn_id == models.PurchasingReturn.id)
            .filter(
                models.PurchasingReturnItems.sales_stock_id == sales_stock_id,
                models.PurchasingReturn.status.in_([DocumentStatus.PENDING, DocumentStatus.APPROVED]),
            )
        )
        if exclude_return_id is not None:
            q = q.filter(models.PurchasingReturn.id != exclude_return_id)
        return [r[0] for r in q.distinct().all()]

    def _check_lot_return_within_received(self, grn, po_item_id: int, qty: int, pending_in_request: int = 0) -> None:
        """Pending + approved returns of a GRN line can never exceed what was received on it."""
        from app.modules.inventory.models import SalesStock

        received = (
            self.db.query(func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0))
            .filter(
                models.GoodReceivedItems.good_received_note == grn.good_received_no,
                models.GoodReceivedItems.purchasing_order_items_id == po_item_id,
                models.GoodReceivedItems.active == True,  # noqa: E712
            )
            .scalar()
        ) or 0
        if not received:
            # Legacy / imported stock with no GRN item rows: the locked lot's own
            # quantity (validate_lot_for_return) is the only bound we have.
            return
        already = (
            self.db.query(func.coalesce(func.sum(models.PurchasingReturnItems.quantity), 0))
            .join(models.PurchasingReturn, models.PurchasingReturn.id == models.PurchasingReturnItems.purchasingreturn_id)
            .join(SalesStock, SalesStock.id == models.PurchasingReturnItems.sales_stock_id)
            .filter(
                models.PurchasingReturn.goodreceivednote_id == grn.id,
                models.PurchasingReturn.status.in_([DocumentStatus.PENDING, DocumentStatus.APPROVED]),
                SalesStock.purchasing_order_items_id == po_item_id,
            )
            .scalar()
        ) or 0
        if int(already) + int(pending_in_request) + int(qty) > int(received):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot return {qty} unit(s): {int(received)} received on this GRN line, "
                    f"{int(already) + int(pending_in_request)} already on pending/approved returns."
                ),
            )

    def create_return(
        self,
        return_data: schemas.PurchasingReturnCreate,
        user_id: Optional[int] = None,
    ) -> models.PurchasingReturn:

        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock
        from datetime import datetime
        import uuid

        grn = self.db.query(models.GoodReceivedNote).filter(
            models.GoodReceivedNote.id == return_data.goodreceivednote_id
        ).first()
        
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN {return_data.goodreceivednote_id} not found"
            )

        from app.modules.inventory.lots import split_lot

        if grn.status == "cancelled":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="This GRN was cancelled; nothing can be returned against it."
            )

        validated_items = []
        seen_stock_ids = set()
        lot_qty_in_request: Dict[int, int] = {}
        for item in return_data.items:
            if not item.barcode:
                # Batch/none lot: lock the lot, then split off just the
                # returned units so they follow the normal return status flow.
                if not item.sales_stock_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="A barcode (serial items) or a stock lot (batch/none items) is required.",
                    )
                lot_validation, lot_row = self.validate_lot_for_return(
                    return_data.goodreceivednote_id, item.sales_stock_id, item.quantity, lock=True
                )
                if not lot_validation.valid:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Lot validation failed: {lot_validation.message}",
                    )
                po_item_id = lot_row.purchasing_order_items_id
                if po_item_id:
                    self._check_lot_return_within_received(
                        grn, po_item_id, item.quantity, lot_qty_in_request.get(po_item_id, 0)
                    )
                    lot_qty_in_request[po_item_id] = lot_qty_in_request.get(po_item_id, 0) + item.quantity
                piece = split_lot(self.db, lot_row, item.quantity)
                lot_validation.sales_stock_id = piece.id
                validated_items.append((item, lot_validation))
                continue
            # Lock the unit BEFORE validating so two concurrent returns of the
            # same serial (double-clicked Save) serialise here; populate_existing
            # re-reads the row so the second request sees the first's
            # 'return_pending' status after it commits (QA F2).
            self.db.query(SalesStock).filter(
                SalesStock.barcode == item.barcode
            ).with_for_update().populate_existing().all()
            validation = self.validate_barcode_for_return(
                item.barcode,
                return_data.goodreceivednote_id,
                return_data.branch_code
            )
            if not validation.valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Barcode validation failed: {validation.message}"
                )
            if validation.sales_stock_id in seen_stock_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Barcode {item.barcode} appears more than once on this return.",
                )
            open_returns = self._open_return_ids_for_unit(validation.sales_stock_id)
            if open_returns:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Barcode {item.barcode} is already on purchase return #{open_returns[0]}.",
                )
            seen_stock_ids.add(validation.sales_stock_id)
            validated_items.append((item, validation))

        return_no = return_data.purchasing_return_no
        if not return_no:
            return_no = f"PR-{uuid.uuid4().hex[:8].upper()}"

        initial_status = DocumentStatus.PENDING if return_data.require_approval else DocumentStatus.APPROVED
        stock_status = "return_pending" if return_data.require_approval else "returned_to_supplier"

        now = tz.now()
        db_return = models.PurchasingReturn(
            purchasing_return_no=return_no,
            branch_code=return_data.branch_code,
            remark=return_data.remark,
            status=initial_status,
            added_date=now.date(),
            approved_date=now if not return_data.require_approval else None,
            goodreceivednote_id=return_data.goodreceivednote_id
        )
        self.db.add(db_return)
        self.db.flush() 
        
        for item, validation in validated_items:
            db_item = models.PurchasingReturnItems(
                purchasing_price=item.purchasing_price,
                return_price=item.return_price,
                barcode=item.barcode or None,
                quantity=item.quantity,
                branch_code=return_data.branch_code,
                added_date=now,
                product_id=item.product_id,
                purchasingreturn_id=db_return.id,
                sales_stock_id=validation.sales_stock_id
            )
            self.db.add(db_item)

            # Lock the stock row to prevent concurrent status changes
            stock_item = self.db.query(SalesStock).filter(
                SalesStock.id == validation.sales_stock_id
            ).with_for_update().first()
            if stock_item:
                stock_item.status = stock_status
                stock_item.purchase_return_id = db_return.id
                if not return_data.require_approval:
                    stock_item.is_active = False
                    stock_item.returned_date = now
        
        # Create approval record for purchase returns that require approval
        if return_data.require_approval:
            approval_record = approval_service.create_approval_request(
                db=self.db,
                approval_type=ApprovalType.PURCHASE_RETURN,
                reference_id=db_return.id,
                reference_no=return_no,
                branch_code=return_data.branch_code,
                requested_by=user_id or 0,  # 0 = system / unauthenticated context
                remarks=f"Purchase return pending approval.",
                approval_group="purchasing_approvers"
            )
            db_return.approval_id = approval_record.id
        
        log_audit(
            self.db,
            user_id=user_id or 0,
            action="create",
            entity_type="purchase_return",
            entity_id=db_return.id,
            changes={"return_no": return_no, "require_approval": return_data.require_approval},
        )
        self.db.commit()
        self.db.refresh(db_return)

        if not return_data.require_approval:
            po = self.db.query(models.PurchasingOrder).filter(
                models.PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if po and po.first_suppliers_id:
                credit_service = SupplierCreditService()
                credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
                self.db.commit()

            # ── GL + Cashbook Hook (posted and committed together) ──
            self._post_approved_return(db_return, user_id=user_id or 0)

        return db_return
    
    def approve_return(self, return_id: int, approve: bool, remarks: Optional[str] = None, user_id: int = 0) -> models.PurchasingReturn:
        """
        Approve or reject a purchase return through the centralized approval system.
        Uses SELECT FOR UPDATE to prevent double-approval race conditions.
        """
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock
        from app.modules.common.models import Approvals
        
        # Lock the return row to prevent concurrent approval processing
        return_record = self.db.query(models.PurchasingReturn).filter(
            models.PurchasingReturn.id == return_id
        ).with_for_update().first()
        if not return_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase return with id {return_id} not found"
            )
        
        if return_record.status != DocumentStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Return is not pending approval. Current status: {return_record.status}"
            )

        if approve:
            # QA F2: every unit must still be held by THIS return - not sold,
            # restocked, or already approved on another (duplicate) return.
            for item in return_record.items:
                if not item.sales_stock_id:
                    continue
                unit = self.db.query(SalesStock).filter(
                    SalesStock.id == item.sales_stock_id
                ).with_for_update().populate_existing().first()
                holder = getattr(unit, "purchase_return_id", None) if unit else None
                if (
                    not unit
                    or unit.status != StockStatus.RETURN_PENDING
                    or (holder is not None and holder != return_record.id)
                ):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Stock unit {item.barcode or item.sales_stock_id} is no longer pending return "
                            f"on this return (status: {getattr(unit, 'status', 'missing')}); it cannot be approved."
                        ),
                    )
                other_approved = (
                    self.db.query(models.PurchasingReturn.id)
                    .join(models.PurchasingReturnItems, models.PurchasingReturnItems.purchasingreturn_id == models.PurchasingReturn.id)
                    .filter(
                        models.PurchasingReturnItems.sales_stock_id == item.sales_stock_id,
                        models.PurchasingReturn.status == DocumentStatus.APPROVED,
                        models.PurchasingReturn.id != return_record.id,
                    )
                    .first()
                )
                if other_approved:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Stock unit {item.barcode or item.sales_stock_id} was already returned on "
                            f"purchase return #{other_approved[0]}."
                        ),
                    )

        now = tz.now()

        # Update approval record
        if return_record.approval_id:
            # Lock the approval record to prevent concurrent updates
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == return_record.approval_id
            ).with_for_update().first()
            if approval_record:
                if approval_record.status != ApprovalStatus.PENDING:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                approval_record.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
                approval_record.status_changed_by = user_id
                approval_record.remark = remarks or f"{'Approved' if approve else 'Rejected'} by user {user_id}"
        
        if approve:
            return_record.status = DocumentStatus.APPROVED
            return_record.approved_date = now
            if remarks:
                return_record.remark = (return_record.remark or "") + f" | Approval note: {remarks}"
            
            for item in return_record.items:
                if item.sales_stock_id:
                    # Lock the stock item row before updating
                    stock_item = self.db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                    if stock_item:
                        stock_item.status = "returned_to_supplier"
                        stock_item.is_active = False
                        stock_item.returned_date = now

            grn = return_record.good_received_note
            if grn:
                po = self.db.query(models.PurchasingOrder).filter(
                    models.PurchasingOrder.id == grn.purchasingorders_id
                ).first()
                if po and po.first_suppliers_id:
                    credit_service = SupplierCreditService()
                    credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)
        else:
            return_record.status = DocumentStatus.REJECTED
            if remarks:
                return_record.remark = (return_record.remark or "") + f" | Rejection reason: {remarks}"

            for item in return_record.items:
                if item.sales_stock_id:
                    # Lock the stock item row before updating
                    stock_item = self.db.query(SalesStock).filter(
                        SalesStock.id == item.sales_stock_id
                    ).with_for_update().first()
                    if stock_item:
                        stock_item.status = StockStatus.AVAILABLE
                        stock_item.purchase_return_id = None
        
        log_audit(
            self.db,
            user_id=user_id,
            action="approve" if approve else "reject",
            entity_type="purchase_return",
            entity_id=return_record.id,
            changes={"status": str(return_record.status), "remarks": remarks},
        )
        self.db.commit()
        self.db.refresh(return_record)

        # ── GL + Cashbook Hook (posted and committed together) ──
        if approve and return_record.status == "approved":
            self._post_approved_return(return_record, user_id=user_id)

        return return_record

    def _post_approved_return(self, purchase_return: models.PurchasingReturn, user_id: int = 0) -> None:
        """Post an approved return's JE + cashbook money-in, then COMMIT (QA F1).

        ``post_purchase_return_to_gl`` only flushes and neither ``get_db`` nor
        ``ApprovalService._dispatch_approve`` commits afterwards, so this hook
        must commit itself or the JE is discarded when the session closes.
        The cashbook entry runs in a savepoint so a cashbook failure cannot
        discard the JE. On any failure: rollback + durable failure record.
        """
        import logging
        log = logging.getLogger(__name__)
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            PurchaseExpensePayrollGL(self.db).post_purchase_return_to_gl(purchase_return, user_id=user_id)
            self._ensure_cashbook_entry_for_purchase_return(purchase_return)
            self.db.commit()
        except Exception as e:
            log.warning(f"Purchase return GL posting failed: {e}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="PurchaseReturn",
                reference_id=purchase_return.id,
                reference_no=getattr(purchase_return, "purchasing_return_no", None),
                transaction_type="Purchase",
                description=f"Purchase return GL posting failed (#{purchase_return.id})",
                error=e,
                user_id=user_id,
            )
    
    def _ensure_cashbook_entry_for_purchase_return(self, purchase_return: models.PurchasingReturn) -> None:
        """Create a cashbook money-in entry for an approved purchase return.

        Only paid (cash/bank/cheque...) purchases produce an actual refund
        (money-in). Does NOT commit: the caller (``_post_approved_return``)
        commits together with the JE; the insert runs in a savepoint so its
        failure leaves the JE intact. Credit purchases reduce Trade Creditors (GL Dr 2010) and advance
        purchases restore the supplier advance (GL Dr 2020) — no money moves,
        so recording cashbook money-in for those would break the day-end
        cashbook ↔ GL (1010+1020) reconciliation identity.
        """
        if purchase_return.status != "approved":
            return

        try:
            from app.modules.finance.models import CashbookEntryRecord
            from sqlalchemy import text

            # Mirror the GL branching in post_purchase_return_to_gl: only
            # cash/bank/cheque POs put money back into cash/bank.
            grn = purchase_return.good_received_note
            po_payment_method = ""
            if grn:
                po = self.db.query(models.PurchasingOrder).filter(
                    models.PurchasingOrder.id == grn.purchasingorders_id
                ).first()
                po_payment_method = (getattr(po, "payment_method", "") or "").lower()
            from app.modules.finance.purchase_expense_payroll_gl import (
                ACCT_CASH_ON_HAND, ACCT_BANK_ACCOUNT, po_settlement_account,
            )
            settlement_account = po_settlement_account(po_payment_method)
            if settlement_account not in (ACCT_CASH_ON_HAND, ACCT_BANK_ACCOUNT):
                return  # credit / advance return → no cash movement
            cashbook_method = (
                "CASH" if settlement_account == ACCT_CASH_ON_HAND
                else ("CHEQUE" if po_payment_method == "cheque" else "BANK")
            )

            existing = self.db.query(CashbookEntryRecord.id).filter(
                CashbookEntryRecord.source_table == "purchasing_returns",
                CashbookEntryRecord.source_id == purchase_return.id,
            ).first()
            if existing:
                return

            # Calculate total return amount
            total_amount = Decimal("0")
            for item in (purchase_return.items or []):
                total_amount += Decimal(str(item.return_price or item.purchasing_price or 0)) * (item.quantity or 1)

            if total_amount <= 0:
                return

            # Resolve supplier name via GRN → PO → supplier
            supplier_name = "Supplier"
            grn = purchase_return.good_received_note
            if grn and grn.purchasing_order and grn.purchasing_order.first_supplier:
                supplier_name = grn.purchasing_order.first_supplier.company_name or supplier_name

            return_no = purchase_return.purchasing_return_no or f"PR-{purchase_return.id}"

            # Savepoint: a cashbook failure must not discard the caller's JE.
            savepoint = self.db.begin_nested()
            try:
                self.db.execute(
                    text("""
                        SELECT fn_insert_cashbook_entry(
                            :entry_type, :transaction_date, :source_table, :source_id,
                            :reference_no, :description, :party_name, :payment_method,
                            :money_in, :money_out, :branch_code
                        )
                    """),
                    {
                        "entry_type": "purchase_return",
                        "transaction_date": datetime.combine(
                            purchase_return.approved_date or purchase_return.added_date or tz.today(),
                            datetime.min.time()
                        ),
                        "source_table": "purchasing_returns",
                        "source_id": purchase_return.id,
                        "reference_no": return_no,
                        "description": f"Purchase Return {return_no} - refund from supplier",
                        "party_name": supplier_name,
                        "payment_method": cashbook_method,
                        "money_in": total_amount,
                        "money_out": Decimal("0"),
                        "branch_code": purchase_return.branch_code,
                    },
                )
                savepoint.commit()
            except Exception:
                savepoint.rollback()
                raise
        except Exception as cashbook_err:
            import logging
            logging.getLogger(__name__).warning(
                f"Cashbook posting for purchase return {purchase_return.purchasing_return_no} failed (non-blocking): {cashbook_err}"
            )

    def get_return(self, return_id: int) -> models.PurchasingReturn:
        return_record = self.repo.get_by_id(return_id)
        if not return_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase return with id {return_id} not found"
            )
        return return_record
    
    def list_returns(self, skip: int = 0, limit: int = 100, status_filter: Optional[str] = None) -> List[models.PurchasingReturn]:
        query = self.db.query(models.PurchasingReturn)
        if status_filter:
            query = query.filter(models.PurchasingReturn.status == status_filter)
        return query.order_by(models.PurchasingReturn.added_date.desc()).offset(skip).limit(limit).all()

class GoodReceivedNoteService:
    def __init__(self, db: Session):
        self.repo = repository.GoodReceivedNoteRepository(db)
        self.db = db
    
    def create(
        self,
        grn: schemas.GoodReceivedNoteCreate,
        allow_credit_override: bool = False,
        created_by: Optional[int] = None,
    ) -> models.GoodReceivedNote:
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.common.models import Locations
        from decimal import Decimal
        
        po = self._validate_receipt_header(grn, allow_credit_override)

        import uuid
        from sqlalchemy.exc import IntegrityError

        def _new_grn_no() -> str:
            return f"GRN-{uuid.uuid4().hex[:8].upper()}"
        working_grn = grn
        if not getattr(working_grn, "good_received_no", None):
            working_grn = working_grn.model_copy(update={"good_received_no": _new_grn_no()})

        created_grn = None
        for _ in range(5):
            try:
                created_grn = self.repo.create(working_grn)
                break
            except IntegrityError as e:
                import logging
                logging.error(f"IntegrityError creating GRN: {str(e)}")
                self.db.rollback()
                working_grn = working_grn.model_copy(update={"good_received_no": _new_grn_no()})

        if created_grn is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GRN number conflict. Please retry."
            )

        po_status = self._determine_po_completion_status(po.id)
        po.status = po_status
        
        self._sync_quote_items_on_completion(po, po_status)
        
        # Update credit balance in the same transaction for atomicity
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, po.first_suppliers_id)

        actor_user_id = created_by or getattr(grn, "created_by", None)
        
        # Cash supplier payments are posted manually from Supplier Payments.

        # Try auto-application at GRN create time as well (usually no-op until GRN items exist).
        self._auto_apply_advances_to_grn(created_grn.id, created_by=actor_user_id)
        
        self.db.commit()
        self.db.refresh(created_grn)
        
        # ── GL Auto-Posting: Scenario 31 – GRN Received ────────────────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_grn_to_gl(created_grn, user_id=actor_user_id or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for GRN {created_grn.good_received_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="GRN",
                reference_id=created_grn.id,
                reference_no=created_grn.good_received_no,
                transaction_type="Purchase",
                description=f"GRN GL commit failed ({created_grn.good_received_no})",
                error=gl_err,
                user_id=actor_user_id or 0,
            )
        # ────────────────────────────────────────────────────────────────

        log_audit(
            self.db,
            user_id=actor_user_id or 0,
            action="create",
            entity_type="good_received_note",
            entity_id=created_grn.id,
            changes={"grn_no": created_grn.good_received_no},
        )
        self.db.commit()

        return created_grn

    def _validate_receipt_header(self, grn, allow_credit_override: bool = False):
        """Shared pre-checks for any receipt: location, PO state (locked), active
        suppliers, duplicate supplier invoice, credit limit. Returns the locked PO."""
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.common.models import Locations
        from decimal import Decimal

        # Validate Location exists
        location = self.db.query(Locations).filter(Locations.id == grn.good_received_locations_id).first()
        if not location:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Location with id {grn.good_received_locations_id} not found"
            )
        
        # Lock the PO row to prevent concurrent GRN creations from racing on status update
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == grn.purchasingorders_id
        ).with_for_update().first()
        
        if not po:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchase order {grn.purchasingorders_id} not found"
            )

        if po.status not in ("approved", "partially_completed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create GRN: purchase order {po.purchasing_order_no} is '{po.status}', not approved."
            )

        repository.SupplierRepository(self.db).lock_for_document(po.first_suppliers_id, po.second_suppliers_id)
        first_supplier = self.db.query(models.Supplier).filter(
            models.Supplier.id == po.first_suppliers_id
        ).first()
        
        if first_supplier and not first_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create GRN: Supplier '{first_supplier.company_name}' is inactive. Please reactivate the supplier first."
            )
        
        second_supplier = self.db.query(models.Supplier).filter(
            models.Supplier.id == po.second_suppliers_id
        ).first()
        
        if second_supplier and not second_supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create GRN: Supplier '{second_supplier.company_name}' is inactive. Please reactivate the supplier first."
            )

        normalized_invoice_no = (grn.supplier_invoice_no or "").strip().lower()
        if normalized_invoice_no:
            # with_for_update ensures that two concurrent GRNs for the same
            # supplier invoice number do not both pass this check simultaneously.
            duplicate_invoice_grn = (
                self.db.query(models.GoodReceivedNote)
                .join(
                    models.PurchasingOrder,
                    models.GoodReceivedNote.purchasingorders_id == models.PurchasingOrder.id,
                )
                .filter(
                    func.lower(func.trim(models.GoodReceivedNote.supplier_invoice_no))
                    == normalized_invoice_no,
                    models.PurchasingOrder.first_suppliers_id == po.first_suppliers_id,
                )
                .with_for_update(skip_locked=False)
                .first()
            )
            if duplicate_invoice_grn:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Supplier invoice number '{grn.supplier_invoice_no}' already exists "
                        f"for this supplier (GRN: {duplicate_invoice_grn.good_received_no})."
                    ),
                )

        if po.payment_method and po.payment_method.lower() == "credit":

            po_items = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.purchasingorders_id == po.id
            ).all()
            
            po_total = sum(
                Decimal(str(item.quantity)) * item.unit_price 
                for item in po_items
            ) if po_items else Decimal("0")
            
            credit_service = SupplierCreditService()
            credit_check = credit_service.check_grn_credit(
                self.db, po.first_suppliers_id, po_total, po.id, allow_credit_override
            )
            
            if not credit_check["can_post"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot post GRN: {credit_check['message']}. Current outstanding: Rs. {credit_check['credit_check']['current_outstanding']:,.2f}, Credit limit: Rs. {credit_check['credit_check']['max_credit_limit']:,.2f}. Contact manager for override."
                )

        return po

    def _sync_quote_items_on_completion(self, po, po_status: str) -> None:
        # If PO is linked to a sales quote and is completed, update linked quote items to 'po_created'
        if po_status == "completed" and po.sales_quote_id:
            try:
                from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem, QuoteStatus
                linked_quote = self.db.query(SalesQuote).filter(SalesQuote.id == po.sales_quote_id).first()
                if linked_quote:
                    # Get PO item product_ids
                    from app.modules.purchasing.models import PurchasingOrderItems
                    po_product_ids = {pi.product_id for pi in self.db.query(PurchasingOrderItems).filter(
                        PurchasingOrderItems.purchasingorders_id == po.id
                    ).all()}
                    # Update matching quote items that are in 'procurement' state
                    for qi in self.db.query(SalesQuoteItem).filter(
                        SalesQuoteItem.quote_id == linked_quote.id,
                        SalesQuoteItem.product_id.in_(po_product_ids),
                        SalesQuoteItem.item_status == "procurement"
                    ).all():
                        qi.item_status = "po_created"
                        qi.stock_status = "in_stock"
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Failed to update linked quote items on GRN: {e}")

    def receive(
        self,
        payload: schemas.GoodReceivedNoteReceive,
        created_by: Optional[int] = None,
        allow_credit_override: bool = False,
    ) -> dict:
        """Post a whole receipt - header, accepted lines (serial / batch / none), stock
        rows and rejected quantities - in ONE transaction: either everything is saved
        or nothing is. Rejected goods never enter stock and do not count against the PO."""
        import logging
        from sqlalchemy import text as sa_text
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock, CompanyAssets
        from app.modules.inventory import schemas as inv_schemas
        from app.modules.inventory.service import SalesStockService
        from app.modules.products.models import Product

        def bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST):
            return HTTPException(status_code=code, detail=detail)

        header = schemas.GoodReceivedNoteCreate(**payload.model_dump(exclude={"lines"}))
        po = self._validate_receipt_header(header, allow_credit_override)

        # ---- lines ----------------------------------------------------------------------------
        ids = [l.purchasing_order_items_id for l in payload.lines]
        if len(ids) != len(set(ids)):
            raise bad("Each purchase order line may appear only once in a receipt.")
        po_items = {
            pi.id: pi
            for pi in self.db.query(models.PurchasingOrderItems)
            .filter(models.PurchasingOrderItems.id.in_(ids))
            .with_for_update()
            .all()
        }
        for pid in ids:
            if pid not in po_items or po_items[pid].purchasingorders_id != po.id:
                raise bad(f"Purchase order line {pid} does not belong to this purchase order.")
        tracking = dict(
            self.db.query(Product.id, Product.tracking_type)
            .filter(Product.id.in_({pi.product_id for pi in po_items.values()}))
            .all()
        )
        names = dict(
            self.db.query(Product.id, Product.name)
            .filter(Product.id.in_({pi.product_id for pi in po_items.values()}))
            .all()
        )
        received_so_far = dict(
            self.db.query(
                models.GoodReceivedItems.purchasing_order_items_id,
                func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0),
            )
            .filter(
                models.GoodReceivedItems.purchasing_order_items_id.in_(ids),
                models.GoodReceivedItems.active.is_(True),
            )
            .group_by(models.GoodReceivedItems.purchasing_order_items_id)
            .all()
        )

        from .receipt_rules import receipt_limits

        tolerance = {
            r.id: (r.over_receipt_tolerance_pct, r.under_receipt_tolerance_pct)
            for r in self.db.query(
                Product.id, Product.over_receipt_tolerance_pct, Product.under_receipt_tolerance_pct
            ).filter(Product.id.in_({pi.product_id for pi in po_items.values()})).all()
        }
        plan = []  # (line, po_item, tracking_type, accepted, batch_no, codes)
        all_codes: List[str] = []
        for line in payload.lines:
            pi = po_items[line.purchasing_order_items_id]
            trk = tracking.get(pi.product_id) or "serial"
            label = names.get(pi.product_id) or f"product {pi.product_id}"
            codes: List[str] = []
            batch_no = (line.batch_no or "").strip() or None
            if trk == "serial":
                if line.quantity:
                    raise bad(f"'{label}' is serial-tracked: list its units by barcode, not a quantity.")
                if batch_no or line.expiry_date:
                    raise bad(f"Batch details are not allowed for serial-tracked '{label}'.")
                codes = [u.barcode.strip() for u in line.units]
                if any(not c for c in codes):
                    raise bad(f"Blank barcode for '{label}'.")
                accepted = len(codes)
            else:
                if line.units:
                    raise bad(f"'{label}' is {trk}-tracked: enter a quantity, not barcodes.")
                accepted = line.quantity
                if trk == "batch" and accepted > 0 and not batch_no:
                    raise bad(f"A batch number is required for '{label}'.")
                if trk == "none" and (batch_no or line.expiry_date):
                    raise bad(f"Batch details are not allowed for '{label}'.")
            rejected = line.rejected_quantity
            if rejected and len((line.rejection_reason or "").strip()) < 3:
                raise bad(f"Enter a reason for the rejected '{label}'.")
            if rejected > pi.quantity:
                raise bad(f"Rejected quantity for '{label}' exceeds the ordered quantity.")
            already = int(received_so_far.get(pi.id, 0) or 0)
            max_receivable, _ = receipt_limits(pi.quantity, tolerance.get(pi.product_id, (0, 0))[0], 0)
            if already + accepted > max_receivable:
                allowed = (
                    f"{pi.quantity} ordered" if max_receivable == pi.quantity
                    else f"{pi.quantity} ordered, up to {max_receivable} with the over-receipt tolerance"
                )
                raise bad(
                    f"Cannot receive {accepted} unit(s) of '{label}': {already} of {allowed} "
                    f"are already received."
                )
            all_codes.extend(codes)
            plan.append((line, pi, trk, accepted, batch_no, codes))

        total_accepted = sum(p[3] for p in plan)
        total_rejected = sum(p[0].rejected_quantity for p in plan)
        if total_accepted == 0 and total_rejected == 0:
            raise bad("Nothing to receive: enter accepted or rejected quantities.")

        # ---- barcode uniqueness (whole receipt, in bulk) ---------------------------------------
        if len(all_codes) != len(set(all_codes)):
            dupes = sorted({c for c in all_codes if all_codes.count(c) > 1})
            raise bad(f"Duplicate barcode(s) in this receipt: {', '.join(dupes[:10])}")
        if all_codes:
            # Same advisory-lock key as GoodReceivedNoteService.create_item, taken in sorted order.
            self.db.execute(
                sa_text(
                    "SELECT count(pg_advisory_xact_lock(hashtext('grn_item_barcode:' || c))) "
                    "FROM (SELECT c FROM unnest(CAST(:codes AS text[])) AS c ORDER BY c) q"
                ),
                {"codes": sorted(all_codes)},
            )
            existing: set = set()
            for col in (models.GoodReceivedItems.barcode, SalesStock.barcode, CompanyAssets.barcode):
                existing.update(r[0] for r in self.db.query(col).filter(col.in_(all_codes)).all())
            if existing:
                raise bad(f"Barcode(s) already exist: {', '.join(sorted(existing)[:10])}")

        # ---- header (the repo numbers it; retry on a number collision) -------------------------
        header_in = header
        if not (header_in.received_by or "").strip() and created_by:
            from app.auth.models import User
            who = self.db.query(User.first_name, User.last_name).filter(User.id == created_by).first()
            if who:
                header_in = header_in.model_copy(update={"received_by": f"{who.first_name} {who.last_name}".strip()})
        if header_in.supplier_invoice_date is None:
            header_in = header_in.model_copy(update={"supplier_invoice_date": header_in.good_received_date})
        # The numbering takes a transaction-scoped advisory lock, so no collision retry is needed.
        created_grn = self.repo.create(header_in)
        if created_by and not created_grn.created_by:
            created_grn.created_by = created_by

        # ---- accepted lines -> good_received_items + sales_stock -----------------------------------
        now, today = tz.now(), tz.today()
        stock_svc = SalesStockService(self.db)
        for line, pi, trk, accepted, batch_no, codes in plan:
            if accepted:
                if trk == "serial":
                    for unit in line.units:
                        code = unit.barcode.strip()
                        self.db.add(models.GoodReceivedItems(
                            good_received_note=created_grn.good_received_no, barcode=code, quantity=1,
                            branch_code=header.branch_code, active=True, created_date=today,
                            purchasing_order_items_id=pi.id, added_date=now, created_by=created_by,
                        ))
                        stock_svc.create_in_txn(inv_schemas.SalesStockCreate(
                            product_id=pi.product_id, barcode=code, branch_code=header.branch_code,
                            location_id=header.good_received_locations_id,
                            good_received_note_id=created_grn.id, purchasing_order_items_id=pi.id,
                            warranty_month=unit.warranty_month or line.warranty_month or pi.warrenty_month,
                            status=StockStatus.AVAILABLE,
                        ), check_duplicates=False, trusted=True)
                else:
                    self.db.add(models.GoodReceivedItems(
                        good_received_note=created_grn.good_received_no, barcode=None, quantity=accepted,
                        batch_no=batch_no, expiry_date=line.expiry_date if trk == "batch" else None,
                        branch_code=header.branch_code, active=True, created_date=today,
                        purchasing_order_items_id=pi.id, added_date=now, created_by=created_by,
                    ))
                    stock_svc.create_in_txn(inv_schemas.SalesStockCreate(
                        product_id=pi.product_id, barcode=None, quantity=accepted, batch_no=batch_no,
                        expiry_date=line.expiry_date if trk == "batch" else None,
                        branch_code=header.branch_code, location_id=header.good_received_locations_id,
                        good_received_note_id=created_grn.id, purchasing_order_items_id=pi.id,
                        warranty_month=line.warranty_month or pi.warrenty_month,
                        status=StockStatus.AVAILABLE,
                    ), check_duplicates=False, trusted=True)
            if line.rejected_quantity:
                self.db.add(models.GoodReceivedRejection(
                    good_received_note_id=created_grn.id, purchasing_order_items_id=pi.id,
                    quantity=line.rejected_quantity, reason=(line.rejection_reason or "").strip(),
                    created_by=created_by,
                ))
        self.db.flush()

        # ---- PO status, quotation links, supplier balance - same transaction ----------------------
        po_status = self._determine_po_completion_status(po.id)
        po.status = po_status
        self._sync_quote_items_on_completion(po, po_status)
        SupplierCreditService().update_supplier_credit_balance(self.db, po.first_suppliers_id)
        log_audit(
            self.db, user_id=created_by or 0, action="create", entity_type="good_received_note",
            entity_id=created_grn.id,
            changes={"grn_no": created_grn.good_received_no, "units_received": total_accepted,
                     "units_rejected": total_rejected},
        )
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise bad(f"Could not save the receipt (a barcode may have just been used): {integrity_error_detail(exc)}",
                      status.HTTP_409_CONFLICT)
        self.db.refresh(created_grn)

        # Advance-payment application is non-blocking and runs after the receipt is safely saved.
        try:
            if self._auto_apply_advances_to_grn(created_grn.id, created_by=created_by) > Decimal("0"):
                self.db.commit()
        except Exception as exc:  # noqa: BLE001
            logging.getLogger(__name__).warning("Advance auto-apply failed for GRN %s: %s", created_grn.good_received_no, exc)
            self.db.rollback()

        # GL Auto-Posting: Scenario 31 - GRN Received (Dr 1210 Inventory / Cr 2010, 1020 or 2020 per PO
        # payment method). Without this, sales post COGS (Cr 1210) against an inventory account that
        # never receives a debit. Non-blocking: a failure is recorded in gl_posting_failures for retry.
        actor_user_id = created_by or getattr(created_grn, "created_by", None)
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            PurchaseExpensePayrollGL(self.db).post_grn_to_gl(created_grn, user_id=actor_user_id or 0)
            self.db.commit()
        except Exception as gl_err:  # noqa: BLE001
            logging.getLogger(__name__).warning(
                "GL posting for GRN %s failed (non-blocking): %s", created_grn.good_received_no, gl_err
            )
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="GRN",
                reference_id=created_grn.id,
                reference_no=created_grn.good_received_no,
                transaction_type="Purchase",
                description=f"GRN GL commit failed ({created_grn.good_received_no})",
                error=gl_err,
                user_id=actor_user_id or 0,
            )
        return {"grn": created_grn, "units_received": total_accepted, "units_rejected": total_rejected}

    def cancel(self, grn_id: int, reason: str, user_id: int) -> models.GoodReceivedNote:
        """Reverse a posted GRN: its stock is withdrawn, the PO line reopens. Refused when
        any received unit has moved on, or money / documents depend on the GRN."""
        from app.modules.purchasing.credit_service import SupplierCreditService
        from app.modules.inventory.models import SalesStock, CompanyAssets

        grn = self.db.query(models.GoodReceivedNote).filter(models.GoodReceivedNote.id == grn_id).with_for_update().first()
        if not grn:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GRN not found")
        if grn.status == "cancelled":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This GRN is already cancelled.")
        po = self.db.query(models.PurchasingOrder).filter(models.PurchasingOrder.id == grn.purchasingorders_id).with_for_update().first()

        blockers: List[str] = []
        if self.db.query(models.PurchasingReturn.id).filter(
            models.PurchasingReturn.goodreceivednote_id == grn.id,
            models.PurchasingReturn.status != DocumentStatus.REJECTED,
        ).first():
            blockers.append("it has purchase returns")
        if self.db.query(models.SupplierCreditsSettleTransaction.id).filter(
            models.SupplierCreditsSettleTransaction.good_received_id == grn.id
        ).first():
            blockers.append("a supplier credit settlement references it")
        if self.db.query(models.SupplierAdvanceApplication.id).filter(
            models.SupplierAdvanceApplication.grn_id == grn.id
        ).first():
            blockers.append("a supplier advance was applied to it")
        if self.db.query(PurchaseInvoiceItem.id).join(
            PurchaseInvoice, PurchaseInvoiceItem.purchase_invoice_id == PurchaseInvoice.id
        ).filter(PurchaseInvoiceItem.grn_id == grn.id, PurchaseInvoice.status != "cancelled").first():
            blockers.append("it is on a purchase invoice")
        if po and self.db.query(models.SupplierPayment.id).filter(
            models.SupplierPayment.purchasing_order_id == po.id,
            models.SupplierPayment.status != "cancelled",
        ).first():
            blockers.append("a supplier payment was recorded against its purchase order")
        if self.db.query(CompanyAssets.id).filter(CompanyAssets.good_received_note_id == grn.id).first():
            blockers.append("some of its units were saved as company assets")
        if self.db.query(models.LandedCostVoucher.id).filter(
            models.LandedCostVoucher.good_received_note_id == grn.id,
            models.LandedCostVoucher.status == "posted",
        ).first():
            blockers.append("it has landed cost vouchers (cancel them first)")

        stock_rows = self.db.query(SalesStock).filter(SalesStock.good_received_note_id == grn.id).with_for_update().all()
        moved: Dict[str, int] = {}
        for row in stock_rows:
            if row.status != StockStatus.AVAILABLE or not row.is_active:
                key = str(getattr(row.status, "value", row.status))
                moved[key] = moved.get(key, 0) + row.quantity
        if moved:
            detail = ", ".join(f"{n} {st}" for st, n in sorted(moved.items()))
            blockers.append(f"some received units are no longer available in stock ({detail})")
        if blockers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot cancel this GRN: " + "; ".join(blockers) + ".",
            )

        now = tz.now()
        for row in stock_rows:
            row.status = StockStatus.CANCELLED
            row.is_active = False
        for item in self.db.query(models.GoodReceivedItems).filter(
            models.GoodReceivedItems.good_received_note == grn.good_received_no
        ).all():
            item.active = False
        grn.status = "cancelled"
        grn.cancelled_at = now
        grn.cancelled_by = user_id
        grn.cancel_reason = reason
        self.db.flush()
        if po:
            po.status = self._determine_po_completion_status(po.id)
            SupplierCreditService().update_supplier_credit_balance(self.db, po.first_suppliers_id)
        log_audit(
            self.db, user_id=user_id, action="cancel", entity_type="good_received_note", entity_id=grn.id,
            changes={"grn_no": grn.good_received_no, "reason": reason},
        )
        self.db.commit()
        self.db.refresh(grn)

        # Reverse the GRN's inventory/creditor entry (non-blocking; failures are retryable).
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            PurchaseExpensePayrollGL(self.db).post_grn_cancel_to_gl(grn, user_id=user_id or 0)
            self.db.commit()
        except Exception as gl_err:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).warning("GL reversal for cancelled GRN %s failed: %s", grn.good_received_no, gl_err)
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="GRN",
                reference_id=grn.id,
                reference_no=grn.good_received_no,
                transaction_type="Purchase",
                marker="Cancel",
                description=f"GRN cancel GL commit failed ({grn.good_received_no})",
                error=gl_err,
                user_id=user_id or 0,
            )
        return grn

    def list_rejections(self, grn_id: int) -> List[dict]:
        from app.modules.products.models import Product

        rows = (
            self.db.query(models.GoodReceivedRejection, Product.name)
            .join(models.PurchasingOrderItems, models.PurchasingOrderItems.id == models.GoodReceivedRejection.purchasing_order_items_id)
            .join(Product, Product.id == models.PurchasingOrderItems.product_id)
            .filter(models.GoodReceivedRejection.good_received_note_id == grn_id)
            .order_by(models.GoodReceivedRejection.id)
            .all()
        )
        return [
            {"id": r.id, "purchasing_order_items_id": r.purchasing_order_items_id, "quantity": r.quantity,
             "reason": r.reason, "product_name": name}
            for r, name in rows
        ]

    def _auto_apply_advances_to_grn(self, grn_id: int, created_by: Optional[int] = None) -> Decimal:
        grn = self.db.query(models.GoodReceivedNote).filter(
            models.GoodReceivedNote.id == grn_id
        ).first()
        if not grn:
            return Decimal("0")

        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        if not po:
            return Decimal("0")

        if not po.payment_method or po.payment_method.lower() != "advance":
            return Decimal("0")

        grn_total = self.db.query(
            func.coalesce(func.sum(models.PurchasingOrderItems.unit_price * models.GoodReceivedItems.quantity), 0)
        ).join(
            models.GoodReceivedItems,
            models.GoodReceivedItems.purchasing_order_items_id == models.PurchasingOrderItems.id
        ).filter(
            models.PurchasingOrderItems.purchasingorders_id == po.id,
            models.GoodReceivedItems.good_received_note == grn.good_received_no,
            models.GoodReceivedItems.active == True
        ).scalar() or Decimal("0")

        if grn_total <= Decimal("0"):
            return Decimal("0")

        already_applied = self.db.query(
            func.coalesce(func.sum(models.SupplierAdvanceApplication.applied_amount), 0)
        ).filter(
            models.SupplierAdvanceApplication.grn_id == grn.id
        ).scalar() or Decimal("0")

        remaining_to_apply = grn_total - Decimal(str(already_applied))
        if remaining_to_apply <= Decimal("0"):
            return Decimal("0")

        advance_ids = self.db.query(models.SupplierAdvancePayment.id).filter(
            models.SupplierAdvancePayment.supplier_id == po.first_suppliers_id,
            models.SupplierAdvancePayment.is_fully_applied == False,
            models.SupplierAdvancePayment.remaining_amount > 0,
            (models.SupplierAdvancePayment.purchasing_order_id == None) |
            (models.SupplierAdvancePayment.purchasing_order_id == po.id)
        ).order_by(
            models.SupplierAdvancePayment.payment_date.asc(),
            models.SupplierAdvancePayment.id.asc()
        ).all()
        advance_ids = [row[0] for row in advance_ids]

        created_applications: List[models.SupplierAdvanceApplication] = []
        target_apply_amount = remaining_to_apply

        for advance_id in advance_ids:
            if remaining_to_apply <= Decimal("0"):
                break

            advance = self.db.query(models.SupplierAdvancePayment).filter(
                models.SupplierAdvancePayment.id == advance_id
            ).with_for_update().first()

            if not advance or advance.is_fully_applied:
                continue

            available = Decimal(str(advance.remaining_amount))
            apply_amount = min(available, remaining_to_apply)
            if apply_amount <= Decimal("0"):
                continue

            application = models.SupplierAdvanceApplication(
                advance_id=advance.id,
                grn_id=grn.id,
                applied_amount=apply_amount,
                application_date=tz.today(),
                remarks=f"Auto-applied during GRN {grn.good_received_no} receiving"
            )
            self.db.add(application)

            advance.applied_amount = Decimal(str(advance.applied_amount)) + apply_amount
            advance.remaining_amount = Decimal(str(advance.original_amount)) - Decimal(str(advance.applied_amount))
            if advance.remaining_amount <= Decimal("0"):
                advance.remaining_amount = Decimal("0")
                advance.is_fully_applied = True

            remaining_to_apply -= apply_amount
            created_applications.append(application)

        applied_total = target_apply_amount - remaining_to_apply
        if applied_total > Decimal("0"):
            import logging
            logging.getLogger(__name__).info(
                f"Auto-applied Rs. {applied_total:,.2f} from supplier advances to GRN {grn.good_received_no}"
            )
            try:
                self.db.flush()
                from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
                gl_adv_service = PurchaseExpensePayrollGL(self.db)
                for app_record in created_applications:
                    gl_adv_service.post_advance_application_to_gl(app_record, user_id=created_by or 0)
            except Exception as gl_adv_err:
                logging.getLogger(__name__).warning(
                    f"GL posting for auto advance applications on GRN {grn.good_received_no} failed (non-blocking): {gl_adv_err}"
                )
                # Loop-level failure — key the record on the GRN (individual
                # application ids are not reliably known at this point).
                record_gl_commit_failure(
                    self.db,
                    reference_type="AdvanceApplication",
                    reference_id=grn.id,
                    reference_no=grn.good_received_no,
                    transaction_type="Purchase",
                    description=f"Auto advance-application GL failed on GRN {grn.good_received_no}",
                    error=gl_adv_err,
                    user_id=created_by or 0,
                )

        return applied_total
    
    def _determine_po_completion_status(self, po_id: int) -> str:
        po_items = self.db.query(models.PurchasingOrderItems).filter(
            models.PurchasingOrderItems.purchasingorders_id == po_id
        ).all()
        
        if not po_items:
            return "completed"

        all_fully_received = True
        any_received = False
        
        for po_item in po_items:
            # A line counts as fully received once ordered - under-receipt tolerance has arrived.
            from app.modules.products.models import Product
            from .receipt_rules import receipt_limits
            under_pct = self.db.query(Product.under_receipt_tolerance_pct).filter(
                Product.id == po_item.product_id
            ).scalar() or 0
            _, ordered_qty = receipt_limits(po_item.quantity, 0, under_pct)
            
            received_qty = self.db.query(
                func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0)
            ).filter(
                models.GoodReceivedItems.purchasing_order_items_id == po_item.id,
                models.GoodReceivedItems.active == True
            ).scalar() or 0
            
            if received_qty > 0:
                any_received = True
            
            if received_qty < ordered_qty:
                all_fully_received = False
        
        if all_fully_received and any_received:
            return "completed"
        elif any_received:
            return "partially_completed"
        else:
            return "approved"
    
    def get_by_id(self, grn_id: int) -> models.GoodReceivedNote:
        grn = self.repo.get_by_id(grn_id)
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN with id {grn_id} not found"
            )
        return grn
    
    def list_grns(self, filters: schemas.GoodReceivedNoteListFilter) -> List[models.GoodReceivedNote]:
        return self.repo.get_all(filters)
    
    def update(self, grn_id: int, grn: schemas.GoodReceivedNoteCreate) -> models.GoodReceivedNote:
        existing_grn = self.repo.get_by_id(grn_id)
        if not existing_grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN with id {grn_id} not found"
            )
        
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == existing_grn.purchasingorders_id
        ).first()
        
        if po and po.status == "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit GRN for fully completed purchase orders. Only partially received GRNs can be edited."
            )
        
        updated = self.repo.update(grn_id, grn)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN with id {grn_id} not found"
            )
        return updated
    
    def get_items(self, grn_id: int) -> List[models.GoodReceivedItems]:
        return self.repo.get_items(grn_id)
    
    def get_items_with_details(self, grn_id: int) -> List[dict]:
        from app.modules.inventory.models import SalesStock, CompanyAssets
        from app.modules.products.models import Product
        
        items = self.repo.get_items(grn_id)
        grn = self.repo.get_by_id(grn_id)
        if not grn:
            return []
        
        if not items:
            return []
        
        # Batch-load all PO items for these GRN items in one query
        po_item_ids = [item.purchasing_order_items_id for item in items if item.purchasing_order_items_id]
        po_items_map = {}
        if po_item_ids:
            po_items = self.db.query(models.PurchasingOrderItems).filter(
                models.PurchasingOrderItems.id.in_(po_item_ids)
            ).all()
            po_items_map = {pi.id: pi for pi in po_items}
        
        # Batch-load all products referenced by PO items in one query
        product_ids = [pi.product_id for pi in po_items_map.values() if pi.product_id]
        products_map = {}
        if product_ids:
            products = self.db.query(Product).filter(Product.id.in_(product_ids)).all()
            products_map = {p.id: p.name for p in products}
        
        # Batch-load barcodes that exist in sales stock for this GRN
        all_barcodes = [item.barcode for item in items if item.barcode]
        stock_barcodes = set(
            row[0] for row in self.db.query(SalesStock.barcode).filter(
                SalesStock.good_received_note_id == grn_id,
                SalesStock.barcode.in_(all_barcodes)
            ).all()
        )
        
        # Batch-load barcodes that exist in company assets for this GRN
        asset_barcodes = set(
            row[0] for row in self.db.query(CompanyAssets.barcode).filter(
                CompanyAssets.good_received_note_id == grn_id,
                CompanyAssets.barcode.in_(all_barcodes)
            ).all()
        )
        
        # Batch/none receipts carry no barcode, so match their stock/asset
        # rows by PO line within this GRN instead.
        stock_po_items = set(
            row[0] for row in self.db.query(SalesStock.purchasing_order_items_id).filter(
                SalesStock.good_received_note_id == grn_id,
                SalesStock.barcode.is_(None),
            ).all()
        )

        result = []
        for item in items:
            po_item = po_items_map.get(item.purchasing_order_items_id)
            product_id = po_item.product_id if po_item else None
            product_name = products_map.get(product_id) if product_id else None
            
            result.append({
                "id": item.id,
                "good_received_note": item.good_received_note,
                "barcode": item.barcode,
                "quantity": item.quantity,
                "batch_no": item.batch_no,
                "expiry_date": item.expiry_date,
                "branch_code": item.branch_code,
                "active": item.active,
                "created_date": item.created_date,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "added_date": item.added_date,
                "product_id": product_id,
                "product_name": product_name,
                "saved_to_sales_stock": (
                    item.barcode in stock_barcodes
                    if item.barcode
                    else item.purchasing_order_items_id in stock_po_items
                ),
                "saved_to_company_assets": bool(item.barcode) and item.barcode in asset_barcodes,
            })
        
        return result
    
    def generate_barcodes(self, count: int, prefix: Optional[str] = None) -> List[str]:
        """Return `count` new barcodes that exist in none of good_received_items,
        sales_stock or company_assets. Not reserved: the caller must save them
        (the per-table duplicate checks still run on save)."""
        import secrets
        from app.modules.inventory.models import SalesStock, CompanyAssets

        prefix = (prefix or "").upper()
        generated: List[str] = []
        while len(generated) < count:
            candidates = {
                f"{prefix}{secrets.token_hex(5).upper()}" for _ in range(count - len(generated))
            } - set(generated)
            taken = set()
            for col in (models.GoodReceivedItems.barcode, SalesStock.barcode, CompanyAssets.barcode):
                taken.update(r[0] for r in self.db.query(col).filter(col.in_(candidates)).all())
            generated.extend(sorted(candidates - taken))
        return generated[:count]

    def barcode_exists(self, barcode: str) -> bool:
        if not barcode:
            return False
        return self.db.query(models.GoodReceivedItems).filter(
            models.GoodReceivedItems.barcode == barcode
        ).first() is not None
    
    def get_items_by_po(self, po_id: int) -> List[models.GoodReceivedItems]:
        """Get all GRN items for a specific Purchase Order"""
        # Get all GRN items that belong to this PO's items
        return self.db.query(models.GoodReceivedItems).join(
            models.PurchasingOrderItems,
            models.GoodReceivedItems.purchasing_order_items_id == models.PurchasingOrderItems.id
        ).filter(
            models.PurchasingOrderItems.purchasingorders_id == po_id
        ).all()
    
    @staticmethod
    def _normalise_item_for_tracking(item: schemas.GoodReceivedItemCreate, tracking_type: str) -> schemas.GoodReceivedItemCreate:
        """Validate a received line against the product's tracking type and
        strip fields that don't apply to it."""
        barcode = (item.barcode or "").strip() or None
        batch_no = (item.batch_no or "").strip() or None
        if tracking_type == "serial":
            if not barcode:
                raise ValueError("A barcode is required for serial-tracked products.")
            if item.quantity != 1:
                raise ValueError("Serial-tracked products are received one unit per barcode.")
            if batch_no or item.expiry_date:
                raise ValueError("Batch details are not allowed for serial-tracked products.")
            return item.model_copy(update={"barcode": barcode, "batch_no": None, "expiry_date": None})
        if barcode:
            raise ValueError(f"Barcodes are not used for '{tracking_type}'-tracked products.")
        if tracking_type == "batch":
            if not batch_no:
                raise ValueError("A batch number is required for batch-tracked products.")
            return item.model_copy(update={"barcode": None, "batch_no": batch_no})
        # tracking_type == "none"
        if batch_no or item.expiry_date:
            raise ValueError("Batch details are not allowed for products without tracking.")
        return item.model_copy(update={"barcode": None, "batch_no": None, "expiry_date": None})

    def create_item(self, item: schemas.GoodReceivedItemCreate) -> models.GoodReceivedItems:
        from app.modules.products.models import Product

        # Over-receipt prevention: never let received units for a PO line
        # exceed what was actually ordered. Lock the PO item row so two
        # concurrent receipts can't both pass this check for the last
        # remaining unit. (Locked first so the lock order is the same for
        # every tracking type.)
        po_item = self.db.query(models.PurchasingOrderItems).filter(
            models.PurchasingOrderItems.id == item.purchasing_order_items_id
        ).with_for_update().first()
        if not po_item:
            raise ValueError(f"Purchase order item {item.purchasing_order_items_id} not found")

        # The PO must be receivable and the GRN must belong to it. Lock the PO
        # row so a concurrent cancel/short-close can't slip in between this
        # check and the status update below.
        po = self.db.query(models.PurchasingOrder).filter(
            models.PurchasingOrder.id == po_item.purchasingorders_id
        ).with_for_update().first()
        if not po:
            raise ValueError(f"Purchase order {po_item.purchasingorders_id} not found")
        if po.status not in RECEIVABLE_PO_STATUSES:
            raise ValueError(
                f"Goods cannot be received against purchase order {po.purchasing_order_no}: "
                f"its status is '{po.status}' (only approved or partially completed orders can be received)."
            )
        grn_row = self.db.query(models.GoodReceivedNote).filter(
            models.GoodReceivedNote.good_received_no == item.good_received_note
        ).first()
        if not grn_row:
            raise ValueError(f"Goods received note '{item.good_received_note}' not found")
        if grn_row.purchasingorders_id != po.id:
            raise ValueError(
                f"Goods received note '{item.good_received_note}' does not belong to purchase order "
                f"{po.purchasing_order_no}."
            )

        tracking_type = self.db.query(Product.tracking_type).filter(
            Product.id == po_item.product_id
        ).scalar() or "serial"
        item = self._normalise_item_for_tracking(item, tracking_type)

        if item.barcode:
            # Serialise concurrent inserts of the SAME barcode: the existence
            # check below is check-then-insert, and good_received_items.barcode
            # has no unique constraint, so two simultaneous requests could both
            # pass the check and create a duplicate physical unit. The advisory
            # lock is transaction-scoped (auto-released on commit/rollback).
            from sqlalchemy import text as sa_text
            self.db.execute(
                sa_text("SELECT pg_advisory_xact_lock(hashtext(:bc))"),
                {"bc": f"grn_item_barcode:{item.barcode}"},
            )
            if self.barcode_exists(item.barcode):
                raise ValueError(f"Barcode '{item.barcode}' already exists in Good Received Items")

        already_received = self.db.query(
            func.coalesce(func.sum(models.GoodReceivedItems.quantity), 0)
        ).filter(
            models.GoodReceivedItems.purchasing_order_items_id == po_item.id,
            models.GoodReceivedItems.active.is_(True),
        ).scalar() or 0
        from .receipt_rules import receipt_limits
        over_pct = self.db.query(Product.over_receipt_tolerance_pct).filter(Product.id == po_item.product_id).scalar() or 0
        max_receivable, _ = receipt_limits(po_item.quantity, over_pct, 0)
        if already_received + item.quantity > max_receivable:
            raise ValueError(
                f"Cannot receive {item.quantity} more unit(s) for this line: {already_received} of "
                f"{po_item.quantity} ordered units already received."
            )

        created_item = self.repo.create_item(item)

        # Update PO status after creating GRN item
        po_status = self._determine_po_completion_status(po_item.purchasingorders_id)
        # PO row is already locked above; only receivable statuses reach here.
        if po.status in RECEIVABLE_PO_STATUSES:
            po.status = po_status
        self.db.commit()

        grn = self.db.query(models.GoodReceivedNote).filter(
            models.GoodReceivedNote.good_received_no == created_item.good_received_note
        ).first()
        if grn:
            applied_amount = self._auto_apply_advances_to_grn(grn.id)
            if applied_amount > Decimal("0"):
                self.db.commit()
        
        return created_item


class SupplierCreditsSettleService:
    def __init__(self, db: Session):
        self.repo = repository.SupplierCreditsSettleRepository(db)
        self.db = db
    
    def create(self, settle: schemas.SupplierCreditsSettleCreate, created_by: Optional[int] = None) -> models.SupplierCreditsSettle:

        from app.modules.purchasing.credit_service import SupplierCreditService

        # Lock supplier row to prevent concurrent credit balance overwrites
        self.db.query(models.Supplier).filter(
            models.Supplier.id == settle.suppliers_id
        ).with_for_update().first()

        created_settle = self.repo.create(settle)

        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, settle.suppliers_id)
        log_audit(
            self.db,
            user_id=created_by or 0,
            action="create",
            entity_type="credit_settlement",
            entity_id=created_settle.id,
            changes={"settle_no": created_settle.supplier_credits_settle_no, "supplier_id": settle.suppliers_id},
        )
        self.db.commit()
        
        return created_settle
    
    def get_by_id(self, settle_id: int) -> models.SupplierCreditsSettle:
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        return settle
    
    def list_settlements(self, skip: int = 0, limit: int = 100) -> List[models.SupplierCreditsSettle]:
        return self.repo.get_all(skip, limit)
    
    def list_settlements_with_transactions(self, skip: int = 0, limit: int = 100) -> List[schemas.SupplierCreditsSettleWithTransactions]:
        """List settlements with eagerly loaded transactions (batch query, no N+1)."""
        settlements = self.repo.get_all(skip, limit)
        if not settlements:
            return []
        
        settle_ids = [s.id for s in settlements]
        
        # Batch-load all transactions for all settlements in one query
        all_transactions = self.db.query(models.SupplierCreditsSettleTransaction).filter(
            models.SupplierCreditsSettleTransaction.supplier_credit_settle_id.in_(settle_ids)
        ).all()
        
        # Batch-load all GRNs referenced by transactions
        grn_ids = list(set(t.good_received_id for t in all_transactions if t.good_received_id))
        grns_map = {}
        if grn_ids:
            grns = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id.in_(grn_ids)
            ).all()
            grns_map = {g.id: g for g in grns}
        
        # Batch-load all POs referenced by GRNs
        po_ids = list(set(g.purchasingorders_id for g in grns_map.values() if g.purchasingorders_id))
        pos_map = {}
        if po_ids:
            pos = self.db.query(models.PurchasingOrder).filter(
                models.PurchasingOrder.id.in_(po_ids)
            ).all()
            pos_map = {p.id: p for p in pos}
        
        # Group transactions by settlement ID
        txns_by_settle = {}
        for t in all_transactions:
            txns_by_settle.setdefault(t.supplier_credit_settle_id, []).append(t)
        
        results = []
        for settle in settlements:
            enriched_transactions = []
            for t in txns_by_settle.get(settle.id, []):
                grn = grns_map.get(t.good_received_id)
                grn_no = grn.good_received_no if grn else None
                po = pos_map.get(grn.purchasingorders_id) if grn and grn.purchasingorders_id else None
                po_no = po.purchasing_order_no if po else None
                invoice_no = po.purchasing_invoice_no if po else None
                
                enriched_transactions.append(schemas.SupplierCreditsSettleTransaction(
                    id=t.id,
                    payment_method=t.payment_method,
                    cheque_date=t.cheque_date,
                    payment_amount=t.payment_amount,
                    payment_method_number=t.payment_method_number,
                    remarks=t.remarks,
                    created_date=t.created_date,
                    good_received_id=t.good_received_id,
                    supplier_credit_settle_id=t.supplier_credit_settle_id,
                    grn_no=grn_no,
                    po_no=po_no,
                    invoice_no=invoice_no
                ))
            
            results.append(schemas.SupplierCreditsSettleWithTransactions(
                id=settle.id,
                supplier_credits_settle_no=settle.supplier_credits_settle_no,
                branch_code=settle.branch_code,
                created_date=settle.created_date,
                suppliers_id=settle.suppliers_id,
                status=settle.status,
                verified_by=settle.verified_by,
                verified_date=settle.verified_date,
                transactions=enriched_transactions
            ))
        
        return results
    
    def get_by_supplier(self, supplier_id: int) -> List[models.SupplierCreditsSettle]:
        return self.repo.get_by_supplier(supplier_id)
    
    def get_with_transactions(self, settle_id: int) -> schemas.SupplierCreditsSettleWithTransactions:
        settle = self.get_by_id(settle_id)
        transactions = self.repo.get_transactions(settle_id)

        enriched_transactions = []
        for t in transactions:
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == t.good_received_id
            ).first()
            
            grn_no = None
            po_no = None
            invoice_no = None
            
            if grn:
                grn_no = grn.good_received_no
                po = self.db.query(models.PurchasingOrder).filter(
                    models.PurchasingOrder.id == grn.purchasingorders_id
                ).first()
                if po:
                    po_no = po.purchasing_order_no
                    invoice_no = po.purchasing_invoice_no
            
            enriched_transactions.append(schemas.SupplierCreditsSettleTransaction(
                id=t.id,
                payment_method=t.payment_method,
                cheque_date=t.cheque_date,
                payment_amount=t.payment_amount,
                payment_method_number=t.payment_method_number,
                remarks=t.remarks,
                created_date=t.created_date,
                good_received_id=t.good_received_id,
                supplier_credit_settle_id=t.supplier_credit_settle_id,
                grn_no=grn_no,
                po_no=po_no,
                invoice_no=invoice_no
            ))
        
        return schemas.SupplierCreditsSettleWithTransactions(
            id=settle.id,
            supplier_credits_settle_no=settle.supplier_credits_settle_no,
            branch_code=settle.branch_code,
            created_date=settle.created_date,
            suppliers_id=settle.suppliers_id,
            status=settle.status,
            verified_by=settle.verified_by,
            verified_date=settle.verified_date,
            transactions=enriched_transactions
        )
    
    def delete(self, settle_id: int) -> bool:

        from app.modules.purchasing.credit_service import SupplierCreditService
        
        settle = self.repo.get_by_id(settle_id)
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        supplier_id = settle.suppliers_id
        result = self.repo.delete(settle_id)
        
        credit_service = SupplierCreditService()
        credit_service.update_supplier_credit_balance(self.db, supplier_id)
        self.db.commit()
        
        return result
    
    def verify_settlement(self, settle_id: int, verified_by: int = None) -> models.SupplierCreditsSettle:
        """Verify a credit settlement"""
        # Lock the settlement row to prevent concurrent verification
        settle = self.db.query(models.SupplierCreditsSettle).filter(
            models.SupplierCreditsSettle.id == settle_id
        ).with_for_update().first()
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        if settle.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only pending settlements can be verified. Current status: {settle.status}"
            )
        
        from datetime import datetime
        settle.status = "verified"
        settle.verified_by = verified_by
        settle.verified_date = tz.now()
        log_audit(
            self.db,
            user_id=verified_by or 0,
            action="verify",
            entity_type="credit_settlement",
            entity_id=settle.id,
            changes={"settle_no": settle.supplier_credits_settle_no, "status": "verified"},
        )
        self.db.commit()
        self.db.refresh(settle)
        
        # ── GL Auto-Posting: Scenario 31 – Credit Settlement Verified ──
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_credit_settlement_to_gl(settle, user_id=verified_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for credit settlement {settle.supplier_credits_settle_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="CreditSettle",
                reference_id=settle.id,
                reference_no=settle.supplier_credits_settle_no,
                transaction_type="Payment",
                description=f"Credit settlement GL commit failed ({settle.supplier_credits_settle_no})",
                error=gl_err,
                user_id=verified_by or 0,
            )
        # ────────────────────────────────────────────────────────────────
        
        return settle
    
    def cancel_settlement(self, settle_id: int, verified_by: int = None) -> models.SupplierCreditsSettle:
        """Cancel a credit settlement"""
        # Lock the row to prevent two concurrent cancellation requests from
        # both passing the status check.
        settle = (
            self.db.query(models.SupplierCreditsSettle)
            .filter(models.SupplierCreditsSettle.id == settle_id)
            .with_for_update()
            .first()
        )
        if not settle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement with id {settle_id} not found"
            )
        
        if settle.status not in ["pending", "verified"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Settlement cannot be cancelled. Current status: {settle.status}"
            )
        
        from datetime import datetime
        settle.status = DocumentStatus.CANCELLED
        settle.verified_by = verified_by
        settle.verified_date = tz.now()
        log_audit(
            self.db,
            user_id=verified_by or 0,
            action="cancel",
            entity_type="credit_settlement",
            entity_id=settle.id,
            changes={"settle_no": settle.supplier_credits_settle_no, "status": "cancelled"},
        )
        self.db.commit()
        self.db.refresh(settle)
        
        return settle


class SupplierPaymentService:
    
    def __init__(self, db: Session):
        self.repo = repository.SupplierPaymentRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
        self.order_repo = repository.PurchasingOrderRepository(db)
        self.db = db

    def _ensure_cashbook_entry_for_verified_payment(self, payment: models.SupplierPayment) -> None:
        if payment.status != "verified":
            return

        try:
            from app.modules.finance.models import CashbookEntryRecord

            existing_entry = self.db.query(CashbookEntryRecord.id).filter(
                CashbookEntryRecord.source_table == "supplier_payments",
                CashbookEntryRecord.source_id == payment.id,
            ).first()
            if existing_entry:
                return

            supplier_name = None
            if payment.supplier:
                supplier_name = payment.supplier.company_name
            if not supplier_name:
                supplier_name = f"Supplier #{payment.supplier_id}"

            description = f"Direct Payment {payment.payment_no}"
            if payment.purchasing_order_id is not None:
                description = f"{description} - PO #{payment.purchasing_order_id}"
            if payment.payment_for:
                description = f"{description} ({payment.payment_for})"

            self.db.execute(
                text(
                    """
                    SELECT fn_insert_cashbook_entry(
                        :entry_type,
                        :transaction_date,
                        :source_table,
                        :source_id,
                        :reference_no,
                        :description,
                        :party_name,
                        :payment_method,
                        :money_in,
                        :money_out,
                        :branch_code
                    )
                    """
                ),
                {
                    "entry_type": "supplier_payment",
                    "transaction_date": datetime.combine(payment.payment_date, datetime.min.time()),
                    "source_table": "supplier_payments",
                    "source_id": payment.id,
                    "reference_no": payment.payment_no,
                    "description": description,
                    "party_name": supplier_name,
                    "payment_method": payment.payment_method,
                    "money_in": Decimal("0"),
                    "money_out": Decimal(str(payment.payment_amount)),
                    "branch_code": payment.branch_code,
                },
            )
            self.db.commit()
        except Exception as cashbook_err:
            import logging
            logging.getLogger(__name__).warning(
                f"Cashbook posting for supplier payment {payment.payment_no} failed (non-blocking): {cashbook_err}"
            )
            self.db.rollback()
    
    def create_payment(self, payment: schemas.SupplierPaymentCreate, created_by: int = None) -> models.SupplierPayment:
        # Lock order must match GRN creation / PO approval, which lock the PO
        # first and the supplier second. Locking the supplier first here and
        # then touching the PO (the payment's FK to it) would deadlock with a
        # concurrent GRN on the same PO.
        if payment.purchasing_order_id:
            self.db.query(models.PurchasingOrder.id).filter(
                models.PurchasingOrder.id == payment.purchasing_order_id
            ).with_for_update().first()
        self.supplier_repo.lock_for_document(payment.supplier_id)
        supplier = self.supplier_repo.get_by_id(payment.supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {payment.supplier_id} not found"
            )
        if not supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supplier '{supplier.company_name}' is inactive. Please reactivate the supplier before creating a payment."
            )

        if payment.purchasing_order_id:
            order = self.order_repo.get_by_id(payment.purchasing_order_id)
            if not order:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Purchase order with id {payment.purchasing_order_id} not found"
                )

            if order.first_suppliers_id != payment.supplier_id and order.second_suppliers_id != payment.supplier_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Purchase order does not belong to this supplier"
                )
        
        created_payment = self.repo.create(payment, created_by)
        log_audit(
            self.db,
            user_id=created_by or 0,
            action="create",
            entity_type="supplier_payment",
            entity_id=created_payment.id,
            changes={"payment_no": created_payment.payment_no, "amount": str(payment.payment_amount), "supplier_id": payment.supplier_id},
        )
        self.db.commit()
        return created_payment
    
    def get_payment(self, payment_id: int) -> schemas.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )

        supplier_name = None
        po_no = None
        
        if payment.supplier:
            supplier_name = payment.supplier.company_name
        
        if payment.purchasing_order:
            po_no = payment.purchasing_order.purchasing_order_no
        
        return schemas.SupplierPayment(
            id=payment.id,
            payment_no=payment.payment_no,
            supplier_id=payment.supplier_id,
            purchasing_order_id=payment.purchasing_order_id,
            payment_date=payment.payment_date,
            payment_method=payment.payment_method,
            payment_amount=payment.payment_amount,
            reference_number=payment.reference_number,
            bank_name=payment.bank_name,
            branch_code=payment.branch_code,
            payment_for=payment.payment_for,
            invoice_reference=payment.invoice_reference,
            remarks=payment.remarks,
            status=payment.status,
            verified_by=payment.verified_by,
            verified_date=payment.verified_date,
            created_date=payment.created_date,
            created_by=payment.created_by,
            supplier_name=supplier_name,
            po_no=po_no
        )
    
    def list_payments(self, filters: schemas.SupplierPaymentListFilter) -> List[schemas.SupplierPayment]:
        payments = self.repo.get_all(filters)
        
        result = []
        for payment in payments:
            supplier_name = None
            po_no = None
            
            if payment.supplier:
                supplier_name = payment.supplier.company_name
            
            if payment.purchasing_order:
                po_no = payment.purchasing_order.purchasing_order_no
            
            result.append(schemas.SupplierPayment(
                id=payment.id,
                payment_no=payment.payment_no,
                supplier_id=payment.supplier_id,
                purchasing_order_id=payment.purchasing_order_id,
                payment_date=payment.payment_date,
                payment_method=payment.payment_method,
                payment_amount=payment.payment_amount,
                reference_number=payment.reference_number,
                bank_name=payment.bank_name,
                branch_code=payment.branch_code,
                payment_for=payment.payment_for,
                invoice_reference=payment.invoice_reference,
                remarks=payment.remarks,
                status=payment.status,
                verified_by=payment.verified_by,
                verified_date=payment.verified_date,
                created_date=payment.created_date,
                created_by=payment.created_by,
                supplier_name=supplier_name,
                po_no=po_no
            ))
        
        return result
    
    def update_payment(self, payment_id: int, payment_update: schemas.SupplierPaymentUpdate) -> models.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update payment with status '{payment.status}'"
            )
        
        return self.repo.update(payment_id, payment_update)
    
    def verify_payment(self, payment_id: int, verified_by: int) -> models.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot verify payment with status '{payment.status}'"
            )
        
        result = self.repo.verify(payment_id, verified_by)
        
        log_audit(
            self.db,
            user_id=verified_by or 0,
            action="verify",
            entity_type="supplier_payment",
            entity_id=result.id,
            changes={"payment_no": result.payment_no, "status": "verified"},
        )
        self.db.commit()

        # ── GL Auto-Posting: Scenario 31 – Supplier Payment Verified ──
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_supplier_payment_to_gl(result, user_id=verified_by)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for supplier payment {result.payment_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="SupplierPayment",
                reference_id=result.id,
                reference_no=result.payment_no,
                transaction_type="Payment",
                description=f"Supplier payment GL commit failed ({result.payment_no})",
                error=gl_err,
                user_id=verified_by,
            )
        # ────────────────────────────────────────────────────────────────

        self._ensure_cashbook_entry_for_verified_payment(result)
        
        return result
    
    def cancel_payment(self, payment_id: int, remarks: str = None, cancelled_by: Optional[int] = None) -> models.SupplierPayment:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot cancel payment with status '{payment.status}'"
            )

        # Reverse any PurchaseInvoicePayment allocations so that the linked
        # invoices are restored to their pre-payment state.
        allocations = (
            self.db.query(PurchaseInvoicePayment)
            .filter(PurchaseInvoicePayment.supplier_payment_id == payment_id)
            .all()
        )
        if allocations:
            for alloc in allocations:
                invoice = (
                    self.db.query(PurchaseInvoice)
                    .filter(PurchaseInvoice.id == alloc.purchase_invoice_id)
                    .with_for_update()
                    .first()
                )
                if not invoice:
                    continue

                # Reverse the allocation
                invoice.paid_amount = max(
                    Decimal("0"),
                    (invoice.paid_amount or Decimal("0")) - alloc.allocated_amount,
                )
                invoice.balance_due = invoice.total_amount - invoice.paid_amount

                # Restore invoice status
                if invoice.balance_due <= Decimal("0"):
                    # Still fully covered by other payments (shouldn't happen
                    # for a pending-only payment, but guard anyway)
                    invoice.balance_due = Decimal("0")
                    invoice.payment_status = "paid"
                    invoice.status = "paid"
                elif invoice.paid_amount > Decimal("0"):
                    invoice.payment_status = "partial"
                    invoice.status = "partially_paid"
                else:
                    invoice.payment_status = "unpaid"
                    invoice.status = "unpaid"

            # Delete the allocation records now that they are reversed
            for alloc in allocations:
                self.db.delete(alloc)

            # Recompute supplier credit via the single authoritative calculator
            # now that all reversed invoice balances are final (no bespoke math).
            self.db.flush()
            from app.modules.purchasing.credit_service import SupplierCreditService
            SupplierCreditService().update_supplier_credit_balance(self.db, payment.supplier_id)

        cancelled_payment = self.repo.cancel(payment_id, remarks=remarks)
        log_audit(
            self.db,
            user_id=cancelled_by or 0,
            action="cancel",
            entity_type="supplier_payment",
            entity_id=payment_id,
            changes={"remarks": remarks},
        )
        self.db.commit()
        return cancelled_payment
    
    def delete_payment(self, payment_id: int) -> bool:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment with id {payment_id} not found"
            )
        
        if payment.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete payment with status '{payment.status}'. Only pending payments can be deleted."
            )
        
        return self.repo.delete(payment_id)
    
    def get_supplier_payments(self, supplier_id: int, skip: int = 0, limit: int = 100) -> List[models.SupplierPayment]:
        return self.repo.get_by_supplier(supplier_id, skip, limit)


class SupplierAdvancePaymentService:
    """
    Service for Supplier Advance Payments
    
    ERP Best Practice Workflow:
    1. Create advance payment when paying supplier before goods received
    2. Track available balance per supplier
    3. Apply advances against GRNs when goods are received
    4. Delete unused advances if needed
    """
    
    def __init__(self, db: Session):
        self.db = db
        self.repo = repository.SupplierAdvancePaymentRepository(db)
        self.application_repo = repository.SupplierAdvanceApplicationRepository(db)
        self.supplier_repo = repository.SupplierRepository(db)
        self.order_repo = repository.PurchasingOrderRepository(db)
    
    def create_advance(self, data: schemas.SupplierAdvancePaymentCreate, created_by: Optional[int] = None) -> models.SupplierAdvancePayment:
        # Validate supplier exists and is active. PO first, then supplier —
        # same lock order as GRN creation / PO approval (see create_payment).
        if data.purchasing_order_id:
            self.db.query(models.PurchasingOrder.id).filter(
                models.PurchasingOrder.id == data.purchasing_order_id
            ).with_for_update().first()
        self.supplier_repo.lock_for_document(data.supplier_id)
        supplier = self.supplier_repo.get_by_id(data.supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {data.supplier_id} not found"
            )
        if not supplier.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supplier '{supplier.company_name}' is inactive. Please reactivate the supplier before creating an advance payment."
            )

        if data.purchasing_order_id:
            order = self.order_repo.get_by_id(data.purchasing_order_id)
            if not order:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Purchase order with id {data.purchasing_order_id} not found"
                )

            if order.first_suppliers_id != data.supplier_id and order.second_suppliers_id != data.supplier_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Purchase order does not belong to this supplier"
                )

            if (order.status or "").lower() != "approved":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Advance payment can only be created for approved purchase orders"
                )

            if (order.payment_method or "").lower() == "credit":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Advance payment is only allowed for non-credit purchase orders"
                )

            has_grn = self.db.query(models.GoodReceivedNote.id).filter(
                models.GoodReceivedNote.purchasingorders_id == order.id
            ).first()
            if has_grn:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Advance payment cannot be created after GRN is generated for this purchase order"
                )
        
        advance = self.repo.create(data, created_by)
        
        # ── GL Auto-Posting: Scenario 31 – Supplier Advance Created ───
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_supplier_advance_to_gl(advance, user_id=created_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for advance {advance.advance_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="SupplierAdvance",
                reference_id=advance.id,
                reference_no=advance.advance_no,
                transaction_type="Payment",
                description=f"Supplier advance GL commit failed ({advance.advance_no})",
                error=gl_err,
                user_id=created_by or 0,
            )
        # ────────────────────────────────────────────────────────────────
        
        log_audit(
            self.db,
            user_id=created_by or 0,
            action="create",
            entity_type="supplier_advance",
            entity_id=advance.id,
            changes={"advance_no": advance.advance_no, "amount": str(advance.original_amount), "supplier_id": advance.supplier_id},
        )
        self.db.commit()

        return advance
    
    def get_advance(self, advance_id: int) -> models.SupplierAdvancePayment:
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        return advance
    
    def list_advances(self, filters: schemas.SupplierAdvancePaymentListFilter) -> List[models.SupplierAdvancePayment]:
        return self.repo.get_all(filters)
    
    def get_supplier_balance(self, supplier_id: int) -> schemas.SupplierAdvanceBalanceSummary:
        """Get advance payment balance summary for a supplier"""
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier with id {supplier_id} not found"
            )
        
        # Get all active advances
        active_advances = self.repo.get_active_by_supplier(supplier_id)
        
        # Calculate totals
        total_advances = sum(float(a.original_amount) for a in active_advances)
        total_applied = sum(float(a.applied_amount) for a in active_advances)
        available_balance = sum(float(a.remaining_amount) for a in active_advances)
        
        return schemas.SupplierAdvanceBalanceSummary(
            supplier_id=supplier_id,
            supplier_name=supplier.company_name,
            total_advances=total_advances,
            total_applied=total_applied,
            available_balance=available_balance,
            active_advance_count=len(active_advances),
            advances=active_advances
        )
    
    def update_advance(self, advance_id: int, data: schemas.SupplierAdvancePaymentUpdate) -> models.SupplierAdvancePayment:
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        
        if advance.is_fully_applied:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot update fully applied advance payment"
            )
        
        updated = self.repo.update(advance_id, data)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update advance payment"
            )
        return updated
    
    def return_advance(
        self,
        advance_id: int,
        data: schemas.SupplierAdvanceReturnCreate,
        user_id: Optional[int] = None,
    ) -> models.SupplierAdvancePayment:
        """Return (refund) unused advance amount from supplier."""
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found",
            )

        if advance.is_fully_applied:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot return a fully applied advance payment",
            )

        remaining = float(advance.remaining_amount)
        return_amount = float(data.return_amount)

        if return_amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Return amount must be greater than zero",
            )

        if return_amount > remaining + 0.001:  # small tolerance for rounding
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Return amount ({return_amount:.2f}) exceeds remaining balance ({remaining:.2f})",
            )

        # Update advance record
        from decimal import Decimal as D
        advance.returned_amount = D(str(float(advance.returned_amount or 0) + return_amount))
        advance.remaining_amount = D(str(max(0.0, remaining - return_amount)))
        advance.return_date = data.return_date
        advance.return_method = data.return_method
        if data.return_reference:
            advance.return_reference = data.return_reference
        if data.return_remarks:
            advance.return_remarks = data.return_remarks

        # If remaining is now 0, mark as fully applied
        if float(advance.remaining_amount) <= 0.001:
            advance.remaining_amount = D("0")
            advance.is_fully_applied = True

        self.db.flush()

        # GL entry: Dr Bank/Cash, Cr Supplier Advances
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_supplier_advance_return_to_gl(
                advance,
                return_amount=D(str(return_amount)),
                return_date=data.return_date,
                return_method=data.return_method,
                user_id=user_id or 0,
            )
            # Keep the materialized cashbook in sync with the GL cash/bank debit so
            # the day-end cashbook ↔ GL (1010+1020) reconciliation stays balanced.
            self._ensure_cashbook_entry_for_advance_return(
                advance,
                return_amount=D(str(return_amount)),
                return_date=data.return_date,
                return_method=data.return_method,
            )
            log_audit(
                self.db,
                user_id=user_id or 0,
                action="return",
                entity_type="supplier_advance",
                entity_id=advance.id,
                changes={"advance_no": advance.advance_no, "return_amount": str(return_amount)},
            )
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(
                f"GL posting for advance return {advance.advance_no} failed (non-blocking): {gl_err}"
            )
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="SupplierAdvanceReturn",
                reference_id=advance.id,
                reference_no=advance.advance_no,
                transaction_type="Payment",
                description=f"Supplier advance return GL commit failed ({advance.advance_no})",
                error=gl_err,
                user_id=user_id or 0,
            )
            # Re-apply the data change without GL
            advance.returned_amount = D(str(float(advance.returned_amount)))
            advance.remaining_amount = D(str(max(0.0, remaining - return_amount)))
            if float(advance.remaining_amount) <= 0.001:
                advance.remaining_amount = D("0")
                advance.is_fully_applied = True
            self.db.commit()

        self.db.refresh(advance)
        return advance

    def _ensure_cashbook_entry_for_advance_return(
        self,
        advance: models.SupplierAdvancePayment,
        return_amount: Decimal,
        return_date,
        return_method: Optional[str],
    ) -> None:
        """Record a cashbook money-in entry for a supplier advance return.

        When a supplier refunds an unused advance, cash/bank increases
        (GL Dr 1010/1020). The advance-payment INSERT trigger only records the
        original money-out on creation; returns are UPDATEs and therefore fire no
        trigger, so the money-in must be inserted explicitly. Without this, the
        day-end cashbook ↔ GL reconciliation would understate the inflow.

        Does NOT commit — runs inside the return_advance transaction so the
        cashbook entry is atomic with the GL posting.
        """
        amount = Decimal(str(return_amount or 0))
        if amount <= 0:
            return

        supplier_name = None
        if advance.supplier:
            supplier_name = advance.supplier.company_name
        if not supplier_name:
            supplier_name = f"Supplier #{advance.supplier_id}"

        self.db.execute(
            text(
                """
                SELECT fn_insert_cashbook_entry(
                    :entry_type, :transaction_date, :source_table, :source_id,
                    :reference_no, :description, :party_name, :payment_method,
                    :money_in, :money_out, :branch_code
                )
                """
            ),
            {
                "entry_type": "supplier_advance_return",
                "transaction_date": datetime.combine(
                    return_date or tz.today(), datetime.min.time()
                ),
                "source_table": "supplier_advance_payment",
                "source_id": advance.id,
                "reference_no": advance.advance_no,
                "description": f"Supplier Advance Return {advance.advance_no} - refund from supplier",
                "party_name": supplier_name,
                "payment_method": return_method or advance.payment_method,
                "money_in": amount,
                "money_out": Decimal("0"),
                "branch_code": advance.branch_code,
            },
        )

    def delete_advance(self, advance_id: int) -> bool:
        """Delete an advance payment (only if no applications)"""
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        
        if float(advance.applied_amount) > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete advance payment that has applications"
            )
        
        return self.repo.delete(advance_id)
    
    def create_application(self, data: schemas.SupplierAdvanceApplicationCreate, created_by: Optional[int] = None) -> models.SupplierAdvanceApplication:
        """
        Create an application to apply advance against a GRN
        This reduces the advance remaining balance and marks the corresponding GRN as partially/fully paid
        """
        # Validate advance exists and is not fully applied
        advance = self.repo.get_by_id(data.advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {data.advance_id} not found"
            )
        
        if advance.is_fully_applied:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot apply from a fully applied advance payment"
            )
        
        # Check sufficient balance
        if float(data.applied_amount) > float(advance.remaining_amount):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Application amount ({data.applied_amount}) exceeds available balance ({advance.remaining_amount})"
            )
        
        # Lock and update the advance balance FIRST (apply_to_grn re-validates
        # under the row lock and raises if the balance was already consumed by
        # a concurrent application). Only once that succeeds do we create the
        # audit row below — creating it first and validating after would leave
        # an orphaned application record with no matching deduction if a
        # concurrent request wins the race.
        try:
            self.repo.apply_to_grn(data.advance_id, float(data.applied_amount))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

        # Create the application
        application = self.application_repo.create(data, created_by)
        
        # ── GL Auto-Posting: Scenario 31 – Advance Applied to GRN ─────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_advance_application_to_gl(application, user_id=created_by or 0)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for advance application failed (non-blocking): {gl_err}")
            self.db.rollback()
            record_gl_commit_failure(
                self.db,
                reference_type="AdvanceApplication",
                reference_id=application.id,
                transaction_type="Purchase",
                description=f"Advance-application GL commit failed (#{application.id})",
                error=gl_err,
                user_id=created_by or 0,
            )
        # ────────────────────────────────────────────────────────────────
        
        log_audit(
            self.db,
            user_id=created_by or 0,
            action="apply",
            entity_type="supplier_advance_application",
            entity_id=application.id,
            changes={"advance_id": data.advance_id, "applied_amount": str(data.applied_amount)},
        )
        self.db.commit()

        return application
    
    def get_applications_by_advance(self, advance_id: int) -> List[schemas.SupplierAdvanceApplication]:
        """Get all applications for an advance with enriched GRN details"""
        applications = self.application_repo.get_by_advance(advance_id)
        result = []
        for app in applications:
            # Get GRN number
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == app.grn_id
            ).first()
            grn_no = grn.good_received_no if grn else None
            
            # Get Advance number
            advance = self.repo.get_by_id(app.advance_id)
            advance_no = advance.advance_no if advance else None
            
            result.append(schemas.SupplierAdvanceApplication(
                id=app.id,
                advance_id=app.advance_id,
                grn_id=app.grn_id,
                applied_amount=app.applied_amount,
                application_date=app.application_date,
                remarks=app.remarks,
                created_at=app.created_at,
                updated_at=app.updated_at,
                grn_no=grn_no,
                advance_no=advance_no,
            ))
        return result
    
    def get_applications_by_grn(self, grn_id: int) -> List[schemas.SupplierAdvanceApplication]:
        """Get all applications for a GRN with enriched advance details"""
        applications = self.application_repo.get_by_grn(grn_id)
        result = []
        for app in applications:
            # Get GRN number
            grn = self.db.query(models.GoodReceivedNote).filter(
                models.GoodReceivedNote.id == app.grn_id
            ).first()
            grn_no = grn.good_received_no if grn else None
            
            # Get Advance number
            advance = self.repo.get_by_id(app.advance_id)
            advance_no = advance.advance_no if advance else None
            
            result.append(schemas.SupplierAdvanceApplication(
                id=app.id,
                advance_id=app.advance_id,
                grn_id=app.grn_id,
                applied_amount=app.applied_amount,
                application_date=app.application_date,
                remarks=app.remarks,
                created_at=app.created_at,
                updated_at=app.updated_at,
                grn_no=grn_no,
                advance_no=advance_no,
            ))
        return result
    
    def get_total_advance_applied_to_grn(self, grn_id: int) -> float:
        """Get total advance applications applied to a GRN"""
        return self.application_repo.get_total_by_grn(grn_id)


# ─────────────────────────────────────────────────────────────────────────────
# Purchasing Statistics (dashboard)
# ─────────────────────────────────────────────────────────────────────────────
def get_purchasing_statistics(db: Session, branch_codes: Optional[List[str]] = None):
    """Return aggregated purchasing statistics for the dashboard."""
    from dateutil.relativedelta import relativedelta
    from datetime import timedelta

    today = tz.today()
    current_month_start = today.replace(day=1)
    last_month_start = (today - relativedelta(months=1)).replace(day=1)
    last_month_end = current_month_start - timedelta(days=1)

    # ── helpers ────────────────────────────────────────────────────────
    def po_base():
        q = db.query(models.PurchasingOrder)
        if branch_codes:
            q = q.filter(models.PurchasingOrder.branch_code.in_(branch_codes))
        return q

    def grn_base():
        q = db.query(models.GoodReceivedNote)
        if branch_codes:
            q = q.filter(models.GoodReceivedNote.branch_code.in_(branch_codes))
        return q

    def ret_base():
        q = db.query(models.PurchasingReturn)
        if branch_codes:
            q = q.filter(models.PurchasingReturn.branch_code.in_(branch_codes))
        return q

    # ── Suppliers ──────────────────────────────────────────────────────
    total_suppliers = db.query(func.count(models.Supplier.id)).scalar() or 0
    active_suppliers = db.query(func.count(models.Supplier.id)).filter(models.Supplier.active == True).scalar() or 0

    # ── Purchase Orders – counts ──────────────────────────────────────
    total_pos = po_base().with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
    current_month_pos = po_base().filter(
        models.PurchasingOrder.purchasing_order_date >= current_month_start
    ).with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
    last_month_pos = po_base().filter(
        models.PurchasingOrder.purchasing_order_date >= last_month_start,
        models.PurchasingOrder.purchasing_order_date <= last_month_end,
    ).with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0

    # PO status breakdown
    pending_pos = po_base().filter(models.PurchasingOrder.status.in_(["pending", "draft"])).with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
    approved_pos = po_base().filter(models.PurchasingOrder.status == "approved").with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
    completed_pos = po_base().filter(models.PurchasingOrder.status == "completed").with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
    rejected_pos = po_base().filter(models.PurchasingOrder.status == "rejected").with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0

    # ── Purchase Order value (sum of items) ───────────────────────────
    po_items_q = db.query(
        func.coalesce(func.sum(models.PurchasingOrderItems.unit_price * models.PurchasingOrderItems.quantity), 0)
    ).join(models.PurchasingOrder, models.PurchasingOrderItems.purchasingorders_id == models.PurchasingOrder.id)
    if branch_codes:
        po_items_q = po_items_q.filter(models.PurchasingOrder.branch_code.in_(branch_codes))
    total_po_value = float(po_items_q.scalar() or 0)

    # Current month PO value
    cm_po_val_q = po_items_q.filter(models.PurchasingOrder.purchasing_order_date >= current_month_start)
    current_month_po_value = float(cm_po_val_q.scalar() or 0)

    # Last month PO value
    lm_po_val_q = db.query(
        func.coalesce(func.sum(models.PurchasingOrderItems.unit_price * models.PurchasingOrderItems.quantity), 0)
    ).join(models.PurchasingOrder, models.PurchasingOrderItems.purchasingorders_id == models.PurchasingOrder.id)
    if branch_codes:
        lm_po_val_q = lm_po_val_q.filter(models.PurchasingOrder.branch_code.in_(branch_codes))
    lm_po_val_q = lm_po_val_q.filter(
        models.PurchasingOrder.purchasing_order_date >= last_month_start,
        models.PurchasingOrder.purchasing_order_date <= last_month_end,
    )
    last_month_po_value = float(lm_po_val_q.scalar() or 0)

    # ── GRNs ──────────────────────────────────────────────────────────
    total_grns = grn_base().with_entities(func.count(models.GoodReceivedNote.id)).scalar() or 0
    current_month_grns = grn_base().filter(
        models.GoodReceivedNote.good_received_date >= current_month_start
    ).with_entities(func.count(models.GoodReceivedNote.id)).scalar() or 0

    # ── Returns ───────────────────────────────────────────────────────
    total_returns = ret_base().with_entities(func.count(models.PurchasingReturn.id)).scalar() or 0
    pending_returns = ret_base().filter(
        models.PurchasingReturn.status.in_(["draft", "pending"])
    ).with_entities(func.count(models.PurchasingReturn.id)).scalar() or 0

    # ── Daily PO count – last 7 days ──────────────────────────────────
    daily_orders = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        cnt = po_base().filter(models.PurchasingOrder.purchasing_order_date == d).with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
        daily_orders.append({"date": d.strftime("%b %d"), "orders": cnt})

    # ── Monthly spending – last 6 months ──────────────────────────────
    monthly_spending = []
    for i in range(5, -1, -1):
        m_start = (today - relativedelta(months=i)).replace(day=1)
        if i == 0:
            m_end = today
        else:
            m_end = (today - relativedelta(months=i - 1)).replace(day=1) - timedelta(days=1)
        m_val_q = db.query(
            func.coalesce(func.sum(models.PurchasingOrderItems.unit_price * models.PurchasingOrderItems.quantity), 0)
        ).join(models.PurchasingOrder, models.PurchasingOrderItems.purchasingorders_id == models.PurchasingOrder.id)
        if branch_codes:
            m_val_q = m_val_q.filter(models.PurchasingOrder.branch_code.in_(branch_codes))
        m_val_q = m_val_q.filter(
            models.PurchasingOrder.purchasing_order_date >= m_start,
            models.PurchasingOrder.purchasing_order_date <= m_end,
        )
        m_cnt = po_base().filter(
            models.PurchasingOrder.purchasing_order_date >= m_start,
            models.PurchasingOrder.purchasing_order_date <= m_end,
        ).with_entities(func.count(models.PurchasingOrder.id)).scalar() or 0
        monthly_spending.append({
            "month": m_start.strftime("%b"),
            "value": float(m_val_q.scalar() or 0),
            "orders": m_cnt,
        })

    # ── Top 5 suppliers by PO value ───────────────────────────────────
    top_suppliers_raw = (
        db.query(
            models.Supplier.company_name,
            func.count(models.PurchasingOrder.id).label("order_count"),
            func.coalesce(func.sum(models.PurchasingOrderItems.unit_price * models.PurchasingOrderItems.quantity), 0).label("total_value"),
        )
        .join(models.PurchasingOrder, models.PurchasingOrder.first_suppliers_id == models.Supplier.id)
        .join(models.PurchasingOrderItems, models.PurchasingOrderItems.purchasingorders_id == models.PurchasingOrder.id)
    )
    if branch_codes:
        top_suppliers_raw = top_suppliers_raw.filter(models.PurchasingOrder.branch_code.in_(branch_codes))
    top_suppliers_raw = (
        top_suppliers_raw.group_by(models.Supplier.id, models.Supplier.company_name)
        .order_by(func.sum(models.PurchasingOrderItems.unit_price * models.PurchasingOrderItems.quantity).desc())
        .limit(5)
        .all()
    )
    top_suppliers = [
        {"name": s.company_name or "Unknown", "orders": s.order_count, "value": float(s.total_value or 0)}
        for s in top_suppliers_raw
    ]

    # ── Payment method breakdown ──────────────────────────────────────
    payment_methods_raw = (
        po_base()
        .with_entities(
            models.PurchasingOrder.payment_method,
            func.count(models.PurchasingOrder.id).label("count"),
        )
        .group_by(models.PurchasingOrder.payment_method)
        .all()
    )
    payment_methods = {r.payment_method: r.count for r in payment_methods_raw}

    # ── Recent 5 POs ──────────────────────────────────────────────────
    recent_pos_raw = po_base().order_by(models.PurchasingOrder.added_date.desc()).limit(5).all()
    recent_pos = []
    for po in recent_pos_raw:
        supplier = db.query(models.Supplier.company_name).filter(models.Supplier.id == po.first_suppliers_id).scalar()
        recent_pos.append({
            "id": po.id,
            "po_no": po.purchasing_order_no,
            "date": po.purchasing_order_date.isoformat() if po.purchasing_order_date else None,
            "status": po.status,
            "supplier": supplier or "Unknown",
        })

    # ── Recent 5 GRNs ─────────────────────────────────────────────────
    recent_grns_raw = grn_base().order_by(models.GoodReceivedNote.added_date.desc()).limit(5).all()
    recent_grns = []
    for grn in recent_grns_raw:
        recent_grns.append({
            "id": grn.id,
            "grn_no": grn.good_received_no,
            "date": grn.good_received_date.isoformat() if grn.good_received_date else None,
            "po_id": grn.purchasingorders_id,
        })

    return {
        "total_suppliers": total_suppliers,
        "active_suppliers": active_suppliers,
        "total_pos": total_pos,
        "current_month_pos": current_month_pos,
        "last_month_pos": last_month_pos,
        "total_po_value": total_po_value,
        "current_month_po_value": current_month_po_value,
        "last_month_po_value": last_month_po_value,
        "pending_pos": pending_pos,
        "approved_pos": approved_pos,
        "completed_pos": completed_pos,
        "rejected_pos": rejected_pos,
        "total_grns": total_grns,
        "current_month_grns": current_month_grns,
        "total_returns": total_returns,
        "pending_returns": pending_returns,
        "daily_orders": daily_orders,
        "monthly_spending": monthly_spending,
        "top_suppliers": top_suppliers,
        "payment_methods": payment_methods,
        "recent_pos": recent_pos,
        "recent_grns": recent_grns,
    }

