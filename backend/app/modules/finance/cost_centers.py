"""
Cost centers (finance blueprint phase D, IFS code part B).

Only income and expense lines carry a cost center; balance-sheet lines never do.
Which one a line gets:
    1. the one the line names (a manual journal line, an expense's cost center)
    2. the default cost center of the entry's branch
    3. none
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Optional, Union

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import accounting_schemas as schemas
from .accounting_models import ChartOfAccounts, CostCenter, GeneralLedger

PL_TYPES = ("Revenue", "Expense")


def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


class CostCenterResolver:
    """Per-request cache of cost centers and branch defaults."""

    def __init__(self, db: Session):
        self.db = db
        self._loaded = False
        self._by_code: Dict[str, int] = {}
        self._active: set = set()
        self._branch_default: Dict[str, int] = {}

    def _load(self) -> None:
        if self._loaded:
            return
        for cc in self.db.query(CostCenter).all():
            self._by_code[cc.code.upper()] = cc.id
            if cc.is_active:
                self._active.add(cc.id)
                if cc.is_branch_default and cc.branch_code:
                    self._branch_default[cc.branch_code] = cc.id
        self._loaded = True

    def for_line(self, account_type: Optional[str], explicit: Union[int, str, None], branch_code: Optional[str]) -> Optional[int]:
        if account_type not in PL_TYPES:
            return None
        self._load()
        if explicit not in (None, ""):
            cc_id = explicit if isinstance(explicit, int) else self._by_code.get(str(explicit).strip().upper())
            if cc_id in self._active:
                return cc_id
        return self._branch_default.get(branch_code) if branch_code else None


class CostCenterService:
    def __init__(self, db: Session):
        self.db = db

    def list_centers(self, active_only: bool = False) -> List[CostCenter]:
        q = self.db.query(CostCenter)
        if active_only:
            q = q.filter(CostCenter.is_active.is_(True))
        return q.order_by(CostCenter.is_active.desc(), CostCenter.code).all()

    def _check_default(self, cc: CostCenter) -> None:
        if cc.is_branch_default:
            if not cc.branch_code:
                raise _bad("Choose the branch this cost center is the default for.")
            others = self.db.query(CostCenter).filter(CostCenter.branch_code == cc.branch_code)
            if cc.id is not None:
                others = others.filter(CostCenter.id != cc.id)
            others.update({CostCenter.is_branch_default: False}, synchronize_session=False)

    def create(self, data: schemas.CostCenterCreate, user_id: int) -> CostCenter:
        code = data.code.strip().upper()
        if not code or not data.name.strip():
            raise _bad("A cost center needs a code and a name.")
        if self.db.query(CostCenter.id).filter(func.upper(CostCenter.code) == code).first():
            raise _bad(f"Cost center {code} already exists.")
        cc = CostCenter(code=code, name=data.name.strip(), branch_code=data.branch_code or None,
                        is_branch_default=bool(data.is_branch_default), description=data.description,
                        is_active=True, created_by=user_id)
        # Clear the branch's old default before inserting (one default per branch is a unique index).
        self._check_default(cc)
        self.db.add(cc)
        self.db.commit()
        self.db.refresh(cc)
        return cc

    def update(self, cc_id: int, data: schemas.CostCenterUpdate, user_id: int) -> CostCenter:
        cc = self.db.query(CostCenter).filter(CostCenter.id == cc_id).first()
        if cc is None:
            raise _bad("Cost center not found", status.HTTP_404_NOT_FOUND)
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(cc, k, v.strip() if isinstance(v, str) else v)
        if cc.branch_code == "":
            cc.branch_code = None
        if not cc.is_active:
            cc.is_branch_default = False
        self._check_default(cc)
        cc.updated_by = user_id
        self.db.commit()
        self.db.refresh(cc)
        return cc

    def profit_by_cost_center(self, date_from, date_to, branch_code: Optional[str] = None) -> schemas.CostCenterProfitReport:
        """Income, costs and profit per cost center (closing entries excluded)."""
        q = (
            self.db.query(
                GeneralLedger.cost_center_id,
                ChartOfAccounts.account_type,
                func.coalesce(func.sum(GeneralLedger.credit_amount - GeneralLedger.debit_amount), 0),
            )
            .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
            .filter(
                ChartOfAccounts.account_type.in_(PL_TYPES),
                GeneralLedger.transaction_date.between(date_from, date_to),
                func.coalesce(GeneralLedger.transaction_type, "") != "Closing",
            )
        )
        if branch_code:
            q = q.filter(GeneralLedger.branch_code == branch_code)
        rows = q.group_by(GeneralLedger.cost_center_id, ChartOfAccounts.account_type).all()
        names = {c.id: c for c in self.db.query(CostCenter).all()}
        agg: Dict[Optional[int], Dict[str, Decimal]] = {}
        for cc_id, acc_type, net in rows:
            a = agg.setdefault(cc_id, {"income": Decimal("0"), "costs": Decimal("0")})
            if acc_type == "Revenue":
                a["income"] += Decimal(net)
            else:
                a["costs"] += -Decimal(net)
        lines = []
        for cc_id, a in sorted(agg.items(), key=lambda kv: (kv[0] is None, names[kv[0]].code if kv[0] in names else "")):
            cc = names.get(cc_id)
            lines.append(schemas.CostCenterProfitLine(
                cost_center_id=cc_id, code=cc.code if cc else None,
                name=cc.name if cc else "No cost center",
                income=a["income"], costs=a["costs"], profit=a["income"] - a["costs"],
            ))
        return schemas.CostCenterProfitReport(
            date_from=date_from, date_to=date_to, branch_code=branch_code, lines=lines,
            income=sum((l.income for l in lines), Decimal("0")),
            costs=sum((l.costs for l in lines), Decimal("0")),
            profit=sum((l.profit for l in lines), Decimal("0")),
        )
