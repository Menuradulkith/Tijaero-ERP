"""Setup screens for posting rules and voucher types (Finance > Accounting Setup)."""
from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth.models import Branch

from . import accounting_schemas as schemas
from .accounting_models import ChartOfAccounts, JournalEntry, PostingRule, PostingRuleDetail, VoucherType
from .posting_rules import (
    CONTROL_BRANCH,
    CONTROL_EXPENSE_CATEGORY,
    CONTROL_NONE,
    CONTROL_TYPES,
    EXPENSE_CATEGORY_DEFAULTS,
    POSTING_TYPES,
    normalize_expense_category,
)


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def _account_ref(account: Optional[ChartOfAccounts]) -> Optional[dict]:
    if account is None:
        return None
    return {"id": account.id, "account_code": account.account_code, "account_name": account.account_name}


class PostingRuleService:
    def __init__(self, db: Session):
        self.db = db

    # ─── Read ─────────────────────────────────────────────────────────────
    def _accounts_by_code(self, codes) -> Dict[str, ChartOfAccounts]:
        rows = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code.in_(set(codes))).all()
        return {a.account_code: a for a in rows}

    def list_rules(self) -> schemas.PostingRuleSetup:
        rules = {
            r.posting_type: r
            for r in self.db.query(PostingRule)
            .options(joinedload(PostingRule.account), joinedload(PostingRule.details).joinedload(PostingRuleDetail.account))
            .all()
        }
        defaults = self._accounts_by_code(
            [t.default_account for t in POSTING_TYPES.values()] + list(EXPENSE_CATEGORY_DEFAULTS.values())
        )
        items = []
        for t in POSTING_TYPES.values():
            rule = rules.get(t.code)
            items.append({
                "code": t.code,
                "name": t.name,
                "group": t.group,
                "description": t.description,
                "account_types": list(t.account_types),
                "control_types": list(t.control_types),
                "default_account": _account_ref(defaults.get(t.default_account))
                or {"id": None, "account_code": t.default_account, "account_name": "(missing from chart of accounts)"},
                "is_customized": rule is not None,
                "control_type": rule.control_type if rule else CONTROL_NONE,
                "account": _account_ref(rule.account) if rule else None,
                "details": [
                    {"control_value": d.control_value, "account": _account_ref(d.account)}
                    for d in sorted(rule.details, key=lambda d: d.control_value)
                ] if rule else [],
                "notes": rule.notes if rule else None,
                "updated_at": rule.updated_at if rule else None,
            })
        branches = self.db.query(Branch.branch_code, Branch.branch_name).filter(Branch.active.is_(True)).order_by(Branch.branch_name).all()
        return schemas.PostingRuleSetup(
            posting_types=items,
            control_types=[{"code": c, **v} for c, v in CONTROL_TYPES.items()],
            branches=[{"value": b.branch_code, "label": b.branch_name} for b in branches],
            expense_categories=[
                {
                    "value": key,
                    "label": key.replace("_", " ").title(),
                    "default_account": _account_ref(defaults.get(code))
                    or {"id": None, "account_code": code, "account_name": ""},
                }
                for key, code in EXPENSE_CATEGORY_DEFAULTS.items()
            ],

        )

    # ─── Write ────────────────────────────────────────────────────────────
    def _postable_account(self, account_id: int, allowed_types, label: str) -> ChartOfAccounts:
        account = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.id == account_id).first()
        if account is None:
            raise _bad(f"{label}: account not found.")
        if not account.is_active:
            raise _bad(f"{label}: account {account.account_code} is inactive.")
        has_children = self.db.query(ChartOfAccounts.id).filter(
            ChartOfAccounts.parent_account_id == account.id, ChartOfAccounts.is_active.is_(True)
        ).first()
        if has_children:
            raise _bad(
                f"{label}: {account.account_code} {account.account_name} is a heading account. "
                "Choose one of the accounts under it."
            )
        if account.account_type not in allowed_types:
            raise _bad(
                f"{label}: {account.account_code} is a {account.account_type} account; "
                f"this posting needs {' or '.join(allowed_types)}."
            )
        return account

    def save_rule(self, posting_type: str, data: schemas.PostingRuleUpdate, user_id: int) -> schemas.PostingRuleSetup:
        ptype = POSTING_TYPES.get(posting_type)
        if ptype is None:
            raise HTTPException(status_code=404, detail=f"Unknown posting type {posting_type}")
        control = data.control_type or CONTROL_NONE
        if control not in ptype.control_types:
            raise _bad(f"{ptype.name} cannot be split by {CONTROL_TYPES.get(control, {}).get('name', control)}.")
        if control == CONTROL_NONE and data.details:
            raise _bad("Remove the per-branch / per-category accounts, or choose how to split them.")
        if data.account_id is None and not data.details:
            raise _bad("Choose an account, or reset the posting to its default.")

        if data.account_id is not None:
            self._postable_account(data.account_id, ptype.account_types, ptype.name)

        details: Dict[str, int] = {}
        valid_values = None
        if control == CONTROL_BRANCH:
            valid_values = {c for (c,) in self.db.query(Branch.branch_code).all()}
        for d in data.details:
            value = (d.control_value or "").strip()
            if control == CONTROL_EXPENSE_CATEGORY:
                value = normalize_expense_category(value)
            if not value:
                raise _bad("Every row needs a branch or category.")
            if valid_values is not None and value not in valid_values:
                raise _bad(f"Unknown branch {value}.")
            if value in details:
                raise _bad(f"{value} is listed twice.")
            self._postable_account(d.account_id, ptype.account_types, f"{ptype.name} ({value})")
            details[value] = d.account_id

        rule = self.db.query(PostingRule).filter(PostingRule.posting_type == posting_type).with_for_update().first()
        if rule is None:
            rule = PostingRule(posting_type=posting_type, created_by=user_id)
            self.db.add(rule)
        rule.control_type = control
        rule.account_id = data.account_id
        rule.notes = data.notes
        rule.updated_by = user_id
        rule.details.clear()
        self.db.flush()  # delete old details before re-inserting the same control values
        for value, account_id in details.items():
            rule.details.append(PostingRuleDetail(control_value=value, account_id=account_id, created_by=user_id))
        self.db.commit()
        return self.list_rules()

    def reset_rule(self, posting_type: str) -> schemas.PostingRuleSetup:
        if posting_type not in POSTING_TYPES:
            raise HTTPException(status_code=404, detail=f"Unknown posting type {posting_type}")
        rule = self.db.query(PostingRule).filter(PostingRule.posting_type == posting_type).first()
        if rule is not None:
            self.db.delete(rule)
            self.db.commit()
        return self.list_rules()


class VoucherTypeService:
    def __init__(self, db: Session):
        self.db = db

    def list_types(self) -> List[schemas.VoucherTypeResponse]:
        counts = dict(
            self.db.query(JournalEntry.voucher_type, func.count(JournalEntry.id))
            .group_by(JournalEntry.voucher_type)
            .all()
        )
        return [
            schemas.VoucherTypeResponse(
                id=v.id, code=v.code, name=v.name, description=v.description,
                source_module=v.source_module, is_manual=v.is_manual, is_active=v.is_active,
                entry_count=int(counts.get(v.code, 0)),
            )
            for v in self.db.query(VoucherType).order_by(VoucherType.is_manual.desc(), VoucherType.name).all()
        ]
