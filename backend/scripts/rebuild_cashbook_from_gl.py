"""Rebuild cashbook_entries from the General Ledger.

The cashbook is GL-driven (migration s104): one row per journal entry that
moves cash (1010), bank (1020) or cheques in hand (1040), written by
``record_cashbook_from_gl``. This script replays that writer over the whole
ledger in date order, so it can (re)build the cashbook of an existing database,
then recomputes running balances per branch.

Usage (from backend/):
    python scripts/rebuild_cashbook_from_gl.py            # dry run: counts only
    python scripts/rebuild_cashbook_from_gl.py --apply    # replace the cashbook

Journal entries whose cash lines exceed the cashbook's NUMERIC(15,2) are
skipped and listed (e.g. QA rows); a same-day voided pair nets to zero anyway.
"""
import sys
from collections import defaultdict
from decimal import Decimal

sys.path.insert(0, ".")

import app.main  # noqa: E402,F401  (registers every model)
from sqlalchemy import text  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.modules.finance.gl_posting_service import (  # noqa: E402
    CASHBOOK_ACCOUNT_CODES,
    record_cashbook_from_gl,
)

CASHBOOK_MAX = Decimal("9999999999999.99")  # NUMERIC(15,2)


def main(apply: bool) -> None:
    db = SessionLocal()
    rows = db.execute(text("""
        SELECT g.journal_entry_id, g.reference_type, g.reference_id, g.reference_no,
               g.posting_date, g.branch_code, je.description AS je_description,
               c.account_code, g.debit_amount, g.credit_amount, g.description
        FROM general_ledger g
        JOIN chart_of_accounts c ON c.id = g.account_id
        JOIN journal_entries je ON je.id = g.journal_entry_id
        WHERE c.account_code = ANY(:codes)
        ORDER BY g.posting_date, g.journal_entry_id, g.id
    """), {"codes": list(CASHBOOK_ACCOUNT_CODES)}).all()
    by_je = defaultdict(list)
    for r in rows:
        by_je[r.journal_entry_id].append(r)

    skipped = [je for je, lines in by_je.items()
               if any(max(l.debit_amount, l.credit_amount) > CASHBOOK_MAX for l in lines)]
    before = db.execute(text("SELECT count(*) FROM cashbook_entries")).scalar()
    print(f"{'APPLY' if apply else 'dry run'}: {len(by_je)} cash/bank journal entries, "
          f"{before} cashbook rows today, {len(skipped)} skipped (out of range): {skipped}")
    if not apply:
        db.close()
        return

    db.execute(text("DELETE FROM cashbook_entries"))
    for je_id, lines in by_je.items():
        if je_id in skipped:
            continue
        head = lines[0]
        # A reversal or manual JE is keyed on the JE itself; documents on their id.
        ref_id = je_id if head.reference_type == "JE" else head.reference_id
        record_cashbook_from_gl(
            db, reference_type=head.reference_type, reference_id=ref_id,
            reference_no=head.reference_no, entry_date=head.posting_date,
            branch_code=head.branch_code, description=head.je_description,
            lines=[{"account_code": l.account_code, "debit": l.debit_amount,
                    "credit": l.credit_amount, "description": l.description} for l in lines],
        )
    db.execute(text("""
        UPDATE cashbook_entries c SET running_balance = x.rb
        FROM (SELECT id, SUM(money_in - money_out) OVER (
                  PARTITION BY branch_code ORDER BY transaction_date, id) AS rb
              FROM cashbook_entries) x
        WHERE x.id = c.id
    """))
    db.commit()
    after = db.execute(text("SELECT count(*) FROM cashbook_entries")).scalar()
    print(f"rebuilt: {after} cashbook rows")
    db.close()


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
