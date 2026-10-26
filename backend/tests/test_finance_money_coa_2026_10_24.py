"""Finance money bounds / chart-of-accounts fixes (2026-10-24).

1. Money inputs are bounded (1e30 credit notes, vouchers, advances are a 422, never a GL post).
2. Supplier Advances 2020 is a prepayment asset (seed + migration s100).
3. Expense categories post to leaf accounts, never to the 5100 header.
4. Re-recording a posted expense to another account reclassifies it in the GL.
+  A GRN whose receipt JE was already reversed is not reversed a second time on cancel.
"""

from __future__ import annotations

import importlib.util
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from tests.integration.test_workflows.test_grn_receive_cancel import (  # noqa: F401  (fixtures + helpers)
    P,
    _body,
    _uid,
    world,
)
from tests.money_invariants import Books, D

F = "/api/v1/finance"
C = "/api/v1/customers"
HUGE = "1e30"


# ═══════════════════════════════════════ 1. money bounds ═══════════════════════════════════════
class TestMoneyBounds:
    def test_huge_credit_note_is_rejected(self, superclient, make_customer):
        r = superclient.post(F + "/credit-notes", json={
            "customer_id": make_customer().id, "amount": HUGE, "remark": "x"})
        assert r.status_code == 422, r.text

    def test_huge_customer_advance_is_rejected(self, superclient, make_customer, make_branch):
        r = superclient.post(F + "/advance-payments", json={
            "customer_id": make_customer().id, "payment_method": "cash",
            "branch_code": make_branch().branch_code, "payment_amount": HUGE,
            "cheque_date": str(date.today())})
        assert r.status_code == 422, r.text

    def test_huge_gift_voucher_is_rejected(self, superclient, make_branch):
        r = superclient.post(C + "/vouchers/", json={
            "barcode_no": _uid("GV"), "amount": HUGE, "branch_code": make_branch().branch_code})
        assert r.status_code == 422, r.text

    @pytest.mark.parametrize("value", [HUGE, "NaN", "Infinity", "-1"])
    def test_finance_input_schemas_reject_out_of_range(self, value):
        from app.modules.finance import schemas as fs
        with pytest.raises(ValidationError):
            fs.CustomerCreditNoteCreate(customer_id=1, amount=value, remark="x")
        with pytest.raises(ValidationError):
            fs.ExpenseCreate(expense_category="utilities", expenses_method="cash",
                             expense_amount=value, branch_code="B")

    def test_usage_schemas_are_bounded(self):
        from app.modules.customers import schemas as cs
        with pytest.raises(ValidationError):
            cs.VoucherUsageCreate(voucher_id=1, invoice_id=1, amount_used=HUGE)
        with pytest.raises(ValidationError):
            cs.CouponUsageCreate(coupon_id=1, customer_id=1, invoice_id=1, discount_amount=HUGE)
        with pytest.raises(ValidationError):
            cs.LineItemForCoupon(product_id=1, quantity=0, selling_price="1.00")
        assert cs.VoucherUsageCreate(voucher_id=1, invoice_id=1, amount_used="10.50").amount_used == D("10.50")

    def test_purchasing_quantities_are_bounded(self):
        from app.modules.purchasing import schemas as ps
        with pytest.raises(ValidationError):
            ps.GoodReceivedItemCreate(good_received_note="G", branch_code="B",
                                      purchasing_order_items_id=1, quantity=3_000_000_000)
        with pytest.raises(ValidationError):
            ps.PurchasingReturnItemCreate(product_id=1, purchasing_price="1", return_price="1",
                                          quantity=3_000_000_000)

    def test_response_schemas_stay_lenient(self):
        from app.modules.finance import schemas as fs
        # A legacy row above the cap must still serialise.
        assert fs.CustomerCreditNoteBase(customer_id=1, amount=Decimal("1e12"), remark="x").amount == Decimal("1e12")


# ═════════════════════════════════════ 2. supplier advances ═════════════════════════════════════
def _load_s100():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "s100_supplier_advances_asset.py"
    spec = importlib.util.spec_from_file_location("s100_supplier_advances_asset", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestSupplierAdvancesAccount:
    def test_seed_classifies_2020_as_current_asset(self):
        from scripts.seed_chart_of_accounts import COA_DATA
        row = next(r for r in COA_DATA if r[0] == "2020")
        _, _, acc_type, category, normal, _, _, parent = row
        assert (acc_type, normal) == ("Asset", "Debit")
        assert category not in ("Fixed Asset", "Non-Current Asset", "Intangible Asset", "Other Asset")
        parent_row = next(r for r in COA_DATA if r[0] == parent)
        assert parent_row[2] == "Asset"

    def test_migration_upgrade_downgrade_idempotent(self, db):
        from app.modules.finance.accounting_models import ChartOfAccounts
        mod = _load_s100()
        assert mod.revision == "s100_supplier_advances_asset"
        assert mod.down_revision == "s99_general_ledger_order_indexes"
        acct = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "2020").one()
        parent = lambda code: db.query(ChartOfAccounts.id).filter(ChartOfAccounts.account_code == code).scalar()

        for _ in range(2):  # idempotent
            db.execute(mod._SET, mod.UPGRADE_PARAMS)
        db.refresh(acct)
        assert (acct.account_type, acct.account_category, acct.normal_balance) == ("Asset", "Prepayment", "Debit")
        assert acct.parent_account_id == parent("1100")

        for _ in range(2):
            db.execute(mod._SET, mod.DOWNGRADE_PARAMS)
        db.refresh(acct)
        assert (acct.account_type, acct.normal_balance) == ("Liability", "Credit")
        assert acct.parent_account_id == parent("2000")

    def test_advance_is_a_positive_current_asset_on_the_balance_sheet(self, db, superclient, world):
        from app.modules.finance.accounting_service import GeneralLedgerService
        mod = _load_s100()
        db.execute(mod._SET, mod.UPGRADE_PARAMS)
        db.flush()

        def bs_2020():
            bs = GeneralLedgerService(db).get_balance_sheet(fiscal_year=date.today().year, as_of_date=date.today())
            liab = [i for i in bs.current_liabilities.items if i.account_code == "2020"] if hasattr(bs, "current_liabilities") else []
            assert not liab, "2020 must not be reported as a liability"
            rows = [i for i in bs.current_assets.items if i.account_code == "2020"]
            assert len(rows) == 1, bs.current_assets
            return rows[0].amount

        before = bs_2020()
        w = world
        r = superclient.post(f"{P}/supplier-advances", json={
            "supplier_id": w["po"].first_suppliers_id, "payment_date": str(date.today()), "payment_method": "cash",
            "original_amount": "500.00", "branch_code": w["branch"].branch_code})
        assert r.status_code in (200, 201), r.text
        assert bs_2020() - before == D("500.00")


# ═══════════════════════════════════════ 3. leaf accounts ═══════════════════════════════════════
class TestExpenseLeafAccounts:
    def _leaf_codes(self):
        from scripts.seed_chart_of_accounts import COA_DATA
        parents = {r[7] for r in COA_DATA if r[7]}
        return {r[0] for r in COA_DATA} - parents

    @pytest.mark.parametrize("category,expected", [
        ("office_supplies", "5180"), ("Office Supplies", "5180"),
        ("maintenance", "5181"), ("maintenance_repairs", "5181"), ("Maintenance & Repairs", "5181"),
        ("marketing", "5182"), ("marketing_advertising", "5182"),
        ("insurance", "5183"), ("miscellaneous", "5190"), ("something_unknown", "5190"), (None, "5190"),
        ("travel_transportation", "5140"), ("utilities", "5130"),
    ])
    def test_category_maps_to_leaf(self, category, expected):
        from app.modules.finance.purchase_expense_payroll_gl import expense_account_for_category
        assert expense_account_for_category(category) == expected

    def test_every_hard_coded_account_is_a_seeded_leaf(self):
        from app.modules.finance import purchase_expense_payroll_gl as g
        leaves = self._leaf_codes()
        codes = {v for k, v in vars(g).items() if k.startswith("ACCT_") and isinstance(v, str)}
        codes |= set(g.EXPENSE_CATEGORY_MAP.values())
        assert codes - leaves == set(), codes - leaves

    def test_paid_office_supplies_expense_posts_to_5180(self, db, superclient, make_branch):
        eid = _paid_expense(superclient, make_branch(), "office_supplies", "250.00")
        je = Books(db).entries_for("Expense", eid)
        assert je.get("5180") == (D("250.00"), D("0")), je
        assert "5100" not in je, je


# ═════════════════════════════════════ 4. expense reclass ═════════════════════════════════════
def _paid_expense(client, branch, category, amount):
    e = client.post(F + "/expenses", json={
        "expense_category": category, "expenses_method": "cash", "expense_amount": amount,
        "branch_code": branch.branch_code, "description": "test"})
    assert e.status_code in (200, 201), e.text
    eid = e.json()["id"]
    for step, body in (("submit", None), ("approve", {}), ("process-payment", {"payment_method": "cash"})):
        r = client.post(f"{F}/expenses/{eid}/{step}", json=body) if body is not None else client.post(f"{F}/expenses/{eid}/{step}")
        assert r.status_code in (200, 201), (step, r.text)
    return eid


class TestExpenseReclass:
    def test_record_to_other_account_moves_gl(self, db, superclient, make_branch):
        eid = _paid_expense(superclient, make_branch(), "miscellaneous", "400.00")
        assert Books(db).entries_for("Expense", eid)["5190"] == (D("400.00"), D("0"))
        r = superclient.post(f"{F}/expenses/{eid}/record", json={"account_code": "5130"})
        assert r.status_code == 200, r.text
        assert r.json()["account_code"] == "5130"
        b = Books(db)
        je = b.entries_for("Expense", eid)
        assert je["5130"][0] - je["5130"][1] == D("400.00"), je
        assert je["5190"][0] - je["5190"][1] == D("0"), je
        assert sum(dr for dr, _ in je.values()) == sum(cr for _, cr in je.values()), je

    def test_record_to_same_account_posts_nothing(self, db, superclient, make_branch):
        eid = _paid_expense(superclient, make_branch(), "utilities", "90.00")
        before = Books(db).entries_for("Expense", eid)
        r = superclient.post(f"{F}/expenses/{eid}/record", json={"account_code": "5130"})
        assert r.status_code == 200, r.text
        assert Books(db).entries_for("Expense", eid) == before

    @pytest.mark.parametrize("code", ["5100", "1010", "NOPE-999"])
    def test_record_to_header_non_expense_or_unknown_account_is_400(self, db, superclient, make_branch, code):
        eid = _paid_expense(superclient, make_branch(), "utilities", "90.00")
        r = superclient.post(f"{F}/expenses/{eid}/record", json={"account_code": code})
        assert r.status_code == 400, r.text
        je = Books(db).entries_for("Expense", eid)
        assert je["5130"] == (D("90.00"), D("0")), je


# ═════════════════════════════ GRN cancel after a manual reversal ═════════════════════════════
def _lines(w):
    return [
        {"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 10, "batch_no": "B-1"},
        {"purchasing_order_items_id": w["items"]["none"].id, "quantity": 5},
    ]


def _gl_net(db, code):
    """Debit - credit for an account straight from general_ledger (a reversed JE keeps its GL rows,
    the reversal adds the mirror rows), so the figure is what every report shows."""
    from sqlalchemy import text
    return D(str(db.execute(text(
        "SELECT COALESCE(SUM(g.debit_amount - g.credit_amount), 0) FROM general_ledger g "
        "JOIN chart_of_accounts a ON a.id = g.account_id WHERE a.account_code = :c"), {"c": code}).scalar()))


class TestGrnCancelAfterReversal:
    def test_reversed_receipt_is_not_mirrored_again(self, db, superclient, superuser, world):
        from app.modules.finance.accounting_models import JournalEntry, JournalEntryLine
        from app.modules.finance.accounting_service import JournalEntryService
        w = world
        w["po"].payment_method = "credit"
        db.flush()
        inv0, cred0 = _gl_net(db, "1210"), _gl_net(db, "2010")
        r = superclient.post(f"{P}/grn/receive", params={"allow_credit_override": True}, json=_body(w, _lines(w)))
        assert r.status_code == 201, r.text
        grn_id = r.json()["grn"]["id"]
        received = _gl_net(db, "1210") - inv0
        assert received > 0
        je_id = (
            db.query(JournalEntry.id)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .filter(JournalEntryLine.reference_type == "GRN", JournalEntryLine.reference_id == grn_id,
                    JournalEntry.entry_type == "Auto")
            .first()[0]
        )
        JournalEntryService(db).reverse_journal_entry(je_id, reversed_by=superuser[0].id, reason="test", commit=False)
        db.flush()
        assert _gl_net(db, "1210") == inv0
        c = superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"})
        assert c.status_code == 200, c.text
        # Before the fix the cancel mirrored the already-reversed receipt: inventory went negative.
        assert (_gl_net(db, "1210"), _gl_net(db, "2010")) == (inv0, cred0)
