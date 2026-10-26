"""Ledger-level money invariants shared by the cross-module money audit tests.

Everything here is read-only SQL over the current transaction: it must hold after ANY
business flow, whatever module produced the postings.

* every journal entry balances (lines and header, to the cent);
* no line is negative or debits and credits at once, none points at a missing account;
* the trial balance of posted entries balances;
* (optional) the cashbook and the cash/bank GL accounts agree.
"""

from __future__ import annotations

from collections import defaultdict
import decimal
from decimal import Decimal
from typing import Dict, List, Tuple

from sqlalchemy import text

# Ledger sums can be far wider than Decimal's default 28 digits (QA rows of
# 1e30 sit next to cent amounts); keep the arithmetic exact.
decimal.getcontext().prec = 60

D = Decimal
CASH_BANK_ACCOUNTS = ("1010", "1020", "1030", "1040")


def _d(value) -> Decimal:
    return D(str(value or 0))


class Books:
    """Snapshot of the ledger at construction time."""

    def __init__(self, db):
        self.db = db

    # ---- journal integrity -------------------------------------------------------------------
    def unbalanced_entries(self) -> List[tuple]:
        return self.db.execute(text("""
            SELECT je.id, je.journal_entry_no, je.total_debit, je.total_credit,
                   COALESCE(SUM(l.debit_amount), 0) AS d, COALESCE(SUM(l.credit_amount), 0) AS c
            FROM journal_entries je LEFT JOIN journal_entry_lines l ON l.journal_entry_id = je.id
            GROUP BY je.id
            HAVING ROUND(COALESCE(SUM(l.debit_amount), 0), 2) <> ROUND(COALESCE(SUM(l.credit_amount), 0), 2)
                OR ROUND(je.total_debit, 2) <> ROUND(COALESCE(SUM(l.debit_amount), 0), 2)
                OR ROUND(je.total_credit, 2) <> ROUND(COALESCE(SUM(l.credit_amount), 0), 2)
        """)).all()

    def bad_lines(self) -> List[tuple]:
        return self.db.execute(text("""
            SELECT id, journal_entry_id, account_id, debit_amount, credit_amount FROM journal_entry_lines
            WHERE debit_amount < 0 OR credit_amount < 0
               OR (debit_amount > 0 AND credit_amount > 0)
               OR (COALESCE(debit_amount, 0) = 0 AND COALESCE(credit_amount, 0) = 0)
               OR account_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.id = account_id)
        """)).all()

    # ---- trial balance --------------------------------------------------------------------------
    def balances(self) -> Dict[str, Tuple[Decimal, Decimal]]:
        """{account_code: (total debit, total credit)} over entries that reached the GL.

        A reversed entry keeps its GL rows (its mirror reversal cancels them), so it
        counts alongside posted ones."""
        rows = self.db.execute(text("""
            SELECT a.account_code, COALESCE(SUM(l.debit_amount), 0), COALESCE(SUM(l.credit_amount), 0)
            FROM journal_entry_lines l
            JOIN journal_entries je ON je.id = l.journal_entry_id
            JOIN chart_of_accounts a ON a.id = l.account_id
            WHERE je.status IN ('posted', 'reversed')
            GROUP BY a.account_code
        """)).all()
        return {code: (_d(dr), _d(cr)) for code, dr, cr in rows}

    def net(self, code: str) -> Decimal:
        dr, cr = self.balances().get(code, (D(0), D(0)))
        return dr - cr

    def trial_balance_difference(self) -> Decimal:
        bal = self.balances()
        return sum((dr for dr, _ in bal.values()), D(0)) - sum((cr for _, cr in bal.values()), D(0))

    def unposted_entries(self) -> List[tuple]:
        return self.db.execute(text("SELECT id, journal_entry_no, status FROM journal_entries WHERE status NOT IN ('posted', 'reversed')")).all()

    # ---- document -> journal -----------------------------------------------------------------------
    def entries_for(self, reference_type: str, reference_id: int) -> Dict[str, Tuple[Decimal, Decimal]]:
        rows = self.db.execute(text("""
            SELECT a.account_code, COALESCE(SUM(l.debit_amount), 0), COALESCE(SUM(l.credit_amount), 0)
            FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
            WHERE l.reference_type = :t AND l.reference_id = :i
            GROUP BY a.account_code
        """), {"t": reference_type, "i": reference_id}).all()
        return {code: (_d(dr), _d(cr)) for code, dr, cr in rows}

    # ---- cashbook ------------------------------------------------------------------------------------
    def cashbook_net(self) -> Decimal:
        """Cashbook money in - out, with bank deposits added back: a deposit is
        money leaving the till but not leaving cash+bank (same identity as the
        day-end reconciliation)."""
        return _d(self.db.execute(text(
            "SELECT COALESCE(SUM(money_in - money_out), 0)"
            " + COALESCE(SUM(CASE WHEN entry_type = 'bank_deposit' THEN money_out ELSE 0 END), 0)"
            " FROM cashbook_entries"
        )).scalar())

    def gl_cash_net(self) -> Decimal:
        return sum((self.net(c) for c in CASH_BANK_ACCOUNTS), D(0))

    # ---- the one-call check ----------------------------------------------------------------------------
    def assert_balanced(self, label: str = "") -> None:
        problems = []
        if (u := self.unbalanced_entries()):
            problems.append(f"unbalanced journal entries: {u[:5]}")
        if (b := self.bad_lines()):
            problems.append(f"malformed journal lines: {b[:5]}")
        if (diff := self.trial_balance_difference()) != 0:
            problems.append(f"trial balance out by {diff}")
        assert not problems, f"[{label}] " + "; ".join(problems)
