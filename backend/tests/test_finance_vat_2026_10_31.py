"""VAT: tax codes, tax ledger, supplier-invoice VAT and the VAT return (2026-10-31, blueprint phase B).

1. A taxed sale writes an output-VAT row; a return writes a negative one.
2. A supplier invoice posts Dr Input VAT / Cr Trade Creditors (+ discount received)
   and an input-VAT row; editing re-posts it, cancelling takes it off the return.
3. Reversing a journal entry by hand negates its tax rows.
4. The VAT return nets output - input and agrees with the GL; settling clears both
   into 2220 and marks the rows settled.
5. Tax code validation.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func

from app.modules.finance.accounting_models import JournalEntry, TaxCode, TaxTransaction
from app.modules.finance.accounting_service import JournalEntryService
from tests.integration.test_workflows.test_grn_receive_cancel import P, _body, _uid, world  # noqa: F401
from tests.money_invariants import Books
from tests.test_sales_return_money_2026_10_12 import _place, _return, shop  # noqa: F401

A = "/api/v1/finance/accounting"
D = Decimal
TODAY = str(date.today())


def _tax_rows(db, reference_type, reference_id):
    return db.query(TaxTransaction).filter(
        TaxTransaction.reference_type == reference_type, TaxTransaction.reference_id == reference_id
    ).all()


def _net(rows):
    return sum((D(str(r.tax_amount)) for r in rows), D("0"))


# ═══════════════════════════════════ 1. sales ═══════════════════════════════════
class TestSalesVat:
    def test_taxed_sale_and_return_feed_the_tax_ledger(self, db, superclient, superuser, shop):  # noqa: F811
        user = superuser[0]
        inv, item = _place(superclient, db, shop, user.id, 1, 105.0, is_tax_invoice=True, tax_rate=5, cash_amount=105.0)
        rows = _tax_rows(db, "Invoice", inv.id)
        assert len(rows) == 1, rows
        r = rows[0]
        assert (r.direction, D(str(r.tax_amount)), D(str(r.base_amount))) == ("output", D("5.00"), D("100.00"))
        assert D(str(r.tax_rate)) == D("5") and r.tax_code  # no 5% code -> default sales code, rate kept

        ret = _return(db, shop, user, inv, item, 1)
        ret_rows = _tax_rows(db, "SaleReturn", ret.id)
        assert _net(ret_rows) == D("-5.00"), [(x.tax_amount, x.base_amount) for x in ret_rows]
        assert D(str(ret_rows[0].base_amount)) < 0

    def test_untaxed_sale_writes_no_tax_row(self, db, superclient, superuser, shop):  # noqa: F811
        inv, _ = _place(superclient, db, shop, superuser[0].id, 1, 50.0, cash_amount=50.0)
        assert _tax_rows(db, "Invoice", inv.id) == []


# ═══════════════════════════════════ 2. supplier invoices ═══════════════════════════════════
@pytest.fixture
def credit_world(world, db):  # noqa: F811
    world["po"].payment_method = "credit"
    db.flush()
    from app.modules.purchasing.models import Supplier

    sup = db.query(Supplier).filter(Supplier.id == world["po"].first_suppliers_id).one()
    sup.max_credit_limit = 1_000_000
    db.flush()
    return world


def _receive(client, w, qty=10):
    r = client.post(f"{P}/grn/receive", json=_body(
        w, [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": qty}], supplier_invoice_no=_uid("INV")))
    assert r.status_code == 201, r.text
    return r.json()["grn"]


def _invoice(client, w, grn, *, tax=0.0, discount=0.0, qty=10, price=10.0, tax_code=None):
    sub = qty * price
    body = {
        "supplier_invoice_no": _uid("S"), "supplier_invoice_date": TODAY, "supplier_id": w["po"].first_suppliers_id,
        "branch_code": w["branch"].branch_code, "received_date": TODAY, "due_date": str(date.today() + timedelta(days=30)),
        "payment_type": "credit", "subtotal": sub, "tax_amount": tax, "discount_amount": discount,
        "total_amount": sub + tax - discount,
        "items": [{"grn_id": grn["id"], "purchasing_order_id": w["po"].id, "product_id": w["products"]["none"].id,
                   "quantity": qty, "unit_price": price, "line_total": sub, "tax_amount": tax}],
    }
    if tax_code:
        body["tax_code"] = tax_code
    return client.post(f"{P}/invoices", json=body)


class TestSupplierInvoiceVat:
    def test_vat_and_discount_post_with_the_invoice(self, db, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w)  # 100 owed at the GRN
        r = _invoice(superclient, w, grn, tax=18.0, discount=5.0)
        assert r.status_code == 201, r.text
        inv = r.json()
        assert inv["tax_code"] == "VAT"
        je = Books(db).entries_for("PurchaseInvoice", inv["id"])
        assert je["1140"] == (D("18.00"), D("0")), je
        assert je["4110"] == (D("0"), D("5.00")), je
        assert je["2010"] == (D("5.00"), D("18.00")), je
        # Trade creditors for this supplier = GRN 100 + VAT 18 - discount 5 = invoice total 113
        grn_je = Books(db).entries_for("GRN", grn["id"])
        owed = (grn_je["2010"][1] - grn_je["2010"][0]) + (je["2010"][1] - je["2010"][0])
        assert owed == D("113.00")

        rows = _tax_rows(db, "PurchaseInvoice", inv["id"])
        assert [(x.direction, D(str(x.tax_amount)), D(str(x.base_amount))) for x in rows] == [("input", D("18.00"), D("100.00"))]
        voucher = db.query(JournalEntry.voucher_type).filter(JournalEntry.id == rows[0].journal_entry_id).scalar()
        assert voucher == "PINV"

    def test_no_vat_no_discount_posts_nothing(self, db, superclient, credit_world):
        w = credit_world
        inv = _invoice(superclient, w, _receive(superclient, w)).json()
        assert Books(db).entries_for("PurchaseInvoice", inv["id"]) == {}

    def test_cancel_takes_vat_off_the_return(self, db, superclient, credit_world):
        w = credit_world
        inv = _invoice(superclient, w, _receive(superclient, w), tax=18.0).json()
        r = superclient.post(f"{P}/invoices/{inv['id']}/cancel")
        assert r.status_code == 200, r.text
        assert _net(_tax_rows(db, "PurchaseInvoice", inv["id"])) == D("0")
        je = Books(db).entries_for("PurchaseInvoice", inv["id"])
        assert je["1140"][0] - je["1140"][1] == D("0"), je
        # the reversal's ledger rows keep the invoice reference too (not just its journal lines)
        from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
        gl = (db.query(func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0))
              .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
              .filter(ChartOfAccounts.account_code == "1140", GeneralLedger.reference_type == "PurchaseInvoice",
                      GeneralLedger.reference_id == inv["id"]).scalar())
        assert D(str(gl)) == 0

    def test_edit_reposts_the_vat(self, db, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w)
        inv = _invoice(superclient, w, grn, tax=18.0).json()
        # VAT lives on the lines (an edit is checked like a new invoice), so the edit sends them.
        items = [{"grn_id": grn["id"], "purchasing_order_id": w["po"].id, "product_id": w["products"]["none"].id,
                  "quantity": 10, "unit_price": 10.0, "line_total": 100.0, "tax_amount": 10.0}]
        r = superclient.patch(f"{P}/invoices/{inv['id']}", json={"tax_amount": 10.0, "total_amount": 110.0, "items": items})
        assert r.status_code == 200, r.text
        assert _net(_tax_rows(db, "PurchaseInvoice", inv["id"])) == D("10.00")
        je = Books(db).entries_for("PurchaseInvoice", inv["id"])
        assert je["1140"][0] - je["1140"][1] == D("10.00"), je

    def test_unknown_or_sales_only_tax_code_is_refused(self, db, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w)
        assert _invoice(superclient, w, grn, tax=18.0, tax_code="NOPE").status_code == 400
        db.add(TaxCode(code=_uid("SO")[:20], name="sales only", rate=8, tax_type="standard", applies_to="sales"))
        db.flush()
        code = db.query(TaxCode.code).filter(TaxCode.applies_to == "sales").order_by(TaxCode.id.desc()).scalar()
        assert _invoice(superclient, w, grn, tax=8.0, tax_code=code).status_code == 400


# ═══════════════════════════════════ 3. manual reversal ═══════════════════════════════════
class TestReversal:
    def test_reversing_the_invoice_je_negates_tax_rows(self, db, superclient, credit_world):
        w = credit_world
        inv = _invoice(superclient, w, _receive(superclient, w), tax=18.0).json()
        je_id = _tax_rows(db, "PurchaseInvoice", inv["id"])[0].journal_entry_id
        # Auto entries can't be reversed by hand any more (FIN-06); the source document reverses them
        assert superclient.post(f"{A}/journal-entries/{je_id}/reverse", json={"reason": "test"}).status_code == 400
        JournalEntryService(db).reverse_journal_entry(je_id, reversed_by=0, reason="test", commit=False)
        db.flush()
        assert _net(_tax_rows(db, "PurchaseInvoice", inv["id"])) == D("0")


# ═══════════════════════════════════ 4. VAT return + settlement ═══════════════════════════════════
class TestVatReturn:
    def test_return_nets_output_and_input_and_matches_gl(self, db, superclient, superuser, shop, credit_world):  # noqa: F811
        before = superclient.get(f"{A}/reports/vat-return", params={"date_from": TODAY, "date_to": TODAY}).json()
        _place(superclient, db, shop, superuser[0].id, 1, 105.0, is_tax_invoice=True, tax_rate=5, cash_amount=105.0)
        w = credit_world
        assert _invoice(superclient, w, _receive(superclient, w), tax=18.0).status_code == 201
        after = superclient.get(f"{A}/reports/vat-return", params={"date_from": TODAY, "date_to": TODAY})
        assert after.status_code == 200, after.text
        a = after.json()
        assert D(str(a["output_tax"])) - D(str(before["output_tax"])) == D("5.00")
        assert D(str(a["input_tax"])) - D(str(before["input_tax"])) == D("18.00")
        assert D(str(a["net_tax"])) == D(str(a["output_tax"])) - D(str(a["input_tax"]))
        # the ledger agrees with the GL for what this test added
        assert D(str(a["gl_output_tax"])) - D(str(before["gl_output_tax"])) == D("5.00")
        assert D(str(a["gl_input_tax"])) - D(str(before["gl_input_tax"])) == D("18.00")

        txns = superclient.get(f"{A}/reports/vat-return/transactions",
                               params={"date_from": TODAY, "date_to": TODAY, "direction": "input"}).json()
        assert txns["total"] >= 1 and all(t["direction"] == "input" for t in txns["items"])

    def test_settlement_clears_vat_to_2220(self, db, superclient, credit_world):
        w = credit_world
        inv = _invoice(superclient, w, _receive(superclient, w), tax=18.0).json()
        unsettled = db.query(func.coalesce(func.sum(TaxTransaction.tax_amount), 0)).filter(
            TaxTransaction.settlement_id.is_(None), TaxTransaction.direction == "output").scalar()
        unsettled_in = db.query(func.coalesce(func.sum(TaxTransaction.tax_amount), 0)).filter(
            TaxTransaction.settlement_id.is_(None), TaxTransaction.direction == "input").scalar()
        r = superclient.post(f"{A}/vat-settlements", json={"date_to": TODAY})
        assert r.status_code == 201, r.text
        s = r.json()
        assert D(str(s["output_tax"])) == D(str(unsettled)) and D(str(s["input_tax"])) == D(str(unsettled_in))
        assert D(str(s["net_tax"])) == D(str(unsettled)) - D(str(unsettled_in))
        assert all(x.settlement_id == s["id"] for x in _tax_rows(db, "PurchaseInvoice", inv["id"]))
        je = Books(db).entries_for("TaxSettlement", s["id"])
        net_2220 = je.get("2220", (D("0"), D("0")))
        assert net_2220[1] - net_2220[0] == D(str(s["net_tax"])), je
        # nothing left to settle
        assert superclient.post(f"{A}/vat-settlements", json={"date_to": TODAY}).status_code == 422


# ═══════════════════════════════════ 5. tax codes ═══════════════════════════════════
class TestTaxCodes:
    def test_seeded_codes_and_one_default(self, superclient):
        codes = superclient.get(f"{A}/tax-codes").json()
        assert {"VAT", "ZERO", "EXEMPT"} <= {c["code"] for c in codes}
        assert sum(c["is_default_sales"] for c in codes) == 1
        assert sum(c["is_default_purchases"] for c in codes) == 1

    def test_create_and_switch_default(self, superclient):
        code = _uid("V")[:12].upper()
        r = superclient.post(f"{A}/tax-codes", json={
            "code": code, "name": "New VAT", "rate": 15, "tax_type": "standard", "is_default_sales": True})
        assert r.status_code == 201, r.text
        codes = superclient.get(f"{A}/tax-codes").json()
        assert [c["code"] for c in codes if c["is_default_sales"]] == [code]

    @pytest.mark.parametrize("body", [
        {"tax_type": "zero_rated", "rate": 5},
        {"tax_type": "standard", "rate": 0},
        {"tax_type": "weird", "rate": 5},
        {"tax_type": "standard", "rate": 5, "applies_to": "purchases", "is_default_sales": True},
    ])
    def test_invalid_codes_are_refused(self, superclient, body):
        r = superclient.post(f"{A}/tax-codes", json={"code": _uid("X")[:12], "name": "x", **body})
        assert r.status_code == 422, r.text

    def test_used_code_rate_is_locked(self, db, superclient, credit_world):
        w = credit_world
        _invoice(superclient, w, _receive(superclient, w), tax=18.0)
        vat = db.query(TaxCode).filter(TaxCode.code == "VAT").one()
        r = superclient.put(f"{A}/tax-codes/{vat.id}", json={"rate": 15})
        assert r.status_code == 422 and "already used" in r.text
