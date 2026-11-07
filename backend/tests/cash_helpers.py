"""Put cash in a branch's till for tests.

Paying an expense in cash, or banking cash, is refused when the branch's Cash on
Hand is short. Tests where cash is the point seed it here: a balanced opening
entry (Dr the branch's cash account / Cr 3900 Opening Balance Equity) posted
through the normal GL service, so the cashbook row is written too and
cashbook <-> GL and the day-end still reconcile.
"""

import uuid
from datetime import date
from decimal import Decimal


def give_branch_cash(db, branch_code: str, amount="1000.00") -> None:
    from app.modules.finance.gl_posting_service import GLPostingService
    from app.modules.finance.posting_rules import resolve_account

    cash = resolve_account(db, "CASH", branch_code=branch_code)
    amount = Decimal(str(amount))
    res = GLPostingService(db).post(
        reference_type="TestOpeningCash",
        reference_id=int(uuid.uuid4().int % 10**8),
        lines=[
            {"account_code": cash, "debit": amount, "credit": Decimal("0")},
            {"account_code": "3900", "debit": Decimal("0"), "credit": amount},
        ],
        entry_date=date.today(),
        description="Test opening cash",
        branch_code=branch_code,
        user_id=0,
        record_failure=False,
    )
    assert res.posted, res.error_message
    db.flush()
