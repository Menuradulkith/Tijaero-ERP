"""GL postings for manufacturing (standard costing through Work in Progress).

    material issue / backflush   Dr 1230 WIP                 Cr 1210 Inventory
    material return              Dr 1210 Inventory           Cr 1230 WIP
    job-card time                Dr 1230 WIP                 Cr 5040 Labour & Overhead Absorbed
    output receipt               Dr 1210 Inventory           Cr 1230 WIP      (standard unit cost)
    order close                  Dr/Cr 5030 Production Variance  Cr/Dr 1230 WIP  (what is left in WIP)

Every hook derives its lines from the source document, so the regenerators in
app.modules.finance.gl_regenerators can rebuild a failed posting.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.modules.finance.accounting_models import JournalEntry
from app.modules.finance.gl_posting_service import GLPostingService

logger = logging.getLogger(__name__)

ACCT_INVENTORY = "1210"
ACCT_WIP = "1230"
ACCT_PRODUCTION_VARIANCE = "5030"
ACCT_ABSORBED = "5040"

REF_MATERIAL = "MfgMaterialTxn"
REF_TIME = "MfgTimeLog"
REF_OUTPUT = "MfgOutput"
REF_ORDER = "ProductionOrder"
VARIANCE_MARKER = "Production Variance"


def _pair(debit_code: str, credit_code: str, amount: Decimal, description: str) -> List[dict]:
    return [
        {"account_code": debit_code, "debit": amount, "credit": 0, "description": description},
        {"account_code": credit_code, "debit": 0, "credit": amount, "description": description},
    ]


class ManufacturingGL:
    def __init__(self, db: Session):
        self.db = db
        self._gl = GLPostingService(db)

    def _post(self, *, reference_type: str, reference_id: int, reference_no: str, lines: List[dict],
              entry_date, description: str, branch_code: str, user_id: int,
              marker: Optional[str] = None) -> Optional[JournalEntry]:
        result = self._gl.post(
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            lines=lines,
            entry_date=entry_date,
            description=description,
            branch_code=branch_code,
            user_id=user_id,
            transaction_type="Production",
            je_prefix="JE-MFG",
            source_module="manufacturing",
            marker=marker,
        )
        if result.failed:
            logger.error("GL posting failed for %s#%s (%s): %s",
                         reference_type, reference_id, result.error_code, result.error_message)
        return result.journal_entry

    def post_material_transaction(self, txn, user_id: int) -> Optional[JournalEntry]:
        amount = Decimal(str(txn.total_cost or 0))
        if amount <= 0:
            return None
        order_no = txn.order.order_no
        if txn.transaction_type == "return":
            desc = f"Material returned from {order_no}"
            lines = _pair(ACCT_INVENTORY, ACCT_WIP, amount, desc)
        else:
            desc = f"Material {'backflushed' if txn.transaction_type == 'backflush' else 'issued'} to {order_no}"
            lines = _pair(ACCT_WIP, ACCT_INVENTORY, amount, desc)
        return self._post(
            reference_type=REF_MATERIAL, reference_id=txn.id, reference_no=order_no, lines=lines,
            entry_date=txn.transaction_date.date(), description=f"{desc} | MfgMaterialTxn ID: {txn.id}",
            branch_code=txn.branch_code, user_id=user_id,
        )

    def post_time_log(self, log, user_id: int) -> Optional[JournalEntry]:
        amount = Decimal(str(log.labor_cost or 0)) + Decimal(str(log.overhead_cost or 0))
        if amount <= 0:
            return None
        order = log.order
        desc = f"Labour & overhead absorbed by {order.order_no} ({log.operation.name})"
        entry_date = (log.end_time or log.created_at).date()
        return self._post(
            reference_type=REF_TIME, reference_id=log.id, reference_no=order.order_no,
            lines=_pair(ACCT_WIP, ACCT_ABSORBED, amount, desc), entry_date=entry_date,
            description=f"{desc} | MfgTimeLog ID: {log.id}", branch_code=order.branch_code, user_id=user_id,
        )

    def post_output(self, output, user_id: int) -> Optional[JournalEntry]:
        amount = Decimal(str(output.total_value or 0))
        if amount <= 0:
            return None
        order = output.order
        desc = f"Finished goods received from {order.order_no}"
        return self._post(
            reference_type=REF_OUTPUT, reference_id=output.id, reference_no=order.order_no,
            lines=_pair(ACCT_INVENTORY, ACCT_WIP, amount, desc), entry_date=output.receipt_date.date(),
            description=f"{desc} | MfgOutput ID: {output.id}", branch_code=order.branch_code, user_id=user_id,
        )

    def post_variance(self, order, user_id: int) -> Optional[JournalEntry]:
        amount = Decimal(str(order.variance_amount or 0))
        if amount == 0:
            return None
        desc = f"Production variance on close of {order.order_no}"
        if amount > 0:  # cost more than the standard value of the output
            lines = _pair(ACCT_PRODUCTION_VARIANCE, ACCT_WIP, amount, desc)
        else:
            lines = _pair(ACCT_WIP, ACCT_PRODUCTION_VARIANCE, -amount, desc)
        return self._post(
            reference_type=REF_ORDER, reference_id=order.id, reference_no=order.order_no, lines=lines,
            entry_date=order.closed_at.date(), description=desc, branch_code=order.branch_code,
            user_id=user_id, marker=VARIANCE_MARKER,
        )
