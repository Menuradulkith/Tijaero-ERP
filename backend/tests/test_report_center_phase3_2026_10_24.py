"""Report Center phase 3: aging, stock valuation, stock movement, VAT summary, GL detail.

Each report is checked against an independent source rather than against itself:
aging against the outstanding-documents reports, valuation against the inventory Stock
Summary, GL detail against the trial balance. Every report also runs and exports through
the generic test in test_report_center_2026_10_24.py.
"""

from decimal import Decimal

import pytest

from app.reporting.center.aging import bucket_for

BASE = "/api/v1/reporting/center"


def _run(client, key, params=None):
    r = client.post(f"{BASE}/reports/{key}/run", json={"params": params or {}})
    assert r.status_code == 200, r.text
    return r.json()


def _metric(result, label):
    return Decimal(str(next(m["value"] for m in result["metrics"] if m["label"] == label)))


class TestAging:
    @pytest.mark.parametrize("days,bucket", [
        (-5, "current"), (0, "current"), (1, "d1_30"), (30, "d1_30"), (31, "d31_60"),
        (60, "d31_60"), (61, "d61_90"), (90, "d61_90"), (91, "d90_plus"), (400, "d90_plus"),
    ])
    def test_bucket_boundaries(self, days, bucket):
        assert bucket_for(days) == bucket

    @pytest.mark.parametrize("aging,outstanding", [
        ("customers.aging", "customers.outstanding"),
        ("suppliers.aging", "suppliers.outstanding"),
    ])
    def test_total_matches_the_outstanding_report(self, superclient, aging, outstanding):
        a = _run(superclient, aging)
        o = _run(superclient, outstanding)
        assert _metric(a, "Total outstanding") == _metric(o, "Outstanding")
        buckets = [m for m in a["metrics"] if m["label"] != "Total outstanding"]
        assert sum(Decimal(str(m["value"])) for m in buckets) == _metric(a, "Total outstanding")

    def test_age_by_document_date(self, superclient):
        r = _run(superclient, "suppliers.aging", {"age_by": "document_date"})
        assert r["tables"][1]["columns"][4]["label"] == "Age (days)"

    def test_age_by_must_be_a_known_option(self, superclient):
        r = superclient.post(f"{BASE}/reports/suppliers.aging/run", json={"params": {"age_by": "whenever"}})
        assert r.status_code == 422


class TestStock:
    def test_valuation_matches_the_stock_summary(self, superclient, db):
        from app.modules.inventory.service import SalesStockService

        summary = SalesStockService(db).get_stock_summary(limit=1_000_000)
        expected = sum((Decimal(str(i["total_value"])) for i in summary["items"]), Decimal("0"))
        assert _metric(_run(superclient, "inventory.valuation"), "Stock value") == expected

    @pytest.mark.parametrize("group_by", ["product", "product_branch", "category", "brand", "branch"])
    def test_every_grouping_gives_the_same_total(self, superclient, group_by):
        base = _metric(_run(superclient, "inventory.valuation"), "Stock value")
        assert _metric(_run(superclient, "inventory.valuation", {"group_by": group_by}), "Stock value") == base

    def test_movement_adds_up(self, superclient):
        r = _run(superclient, "inventory.movement", {"date_from": "2000-01-01"})
        summary, lines = r["tables"]
        for row in summary["rows"]:
            assert row["opening"] == 0  # nothing before 2000
            moved_in = row["k0"] + row["k1"] + row["k2"]
            moved_out = row["k3"] + row["k4"] + row["k5"]
            assert row["closing"] == moved_in - moved_out
        assert sum(l["qty_in"] for l in lines["rows"]) == _metric(r, "Units in")

    def test_transfers_net_to_zero_across_all_branches(self, superclient):
        r = _run(superclient, "inventory.movement", {"date_from": "2000-01-01"})
        lines = [l for l in r["tables"][1]["rows"] if l["kind"].startswith("Transfer")]
        # Only fully received transfers balance; in-flight ones are out but not yet in.
        assert sum(l["qty_in"] for l in lines) <= sum(l["qty_out"] for l in lines)

    def test_product_filter(self, superclient, db):
        from app.modules.inventory.models import SalesStock

        pid = db.query(SalesStock.product_id).first()
        if pid is None:
            pytest.skip("no stock in this database")
        r = _run(superclient, "inventory.movement", {"date_from": "2000-01-01", "product_id": pid[0]})
        assert len(r["tables"][0]["rows"]) <= 1


class TestLedger:
    def test_gl_detail_closing_matches_the_trial_balance(self, superclient, db):
        from app.core import timezone as tz
        from app.modules.finance.accounting_service import GeneralLedgerService

        r = _run(superclient, "finance.gl_detail", {"date_from": "2000-01-01", "date_to": "2100-12-31"})
        tb = GeneralLedgerService(db).get_trial_balance(fiscal_year=tz.today().year)
        balances = {a.account_code: Decimal(str(a.net_balance)) for a in tb.accounts}
        for acc in r["tables"][0]["rows"]:
            if acc["account_code"] in balances and acc["account_code"][0] in "123":  # balance-sheet accounts
                assert Decimal(str(acc["closing"])) == pytest.approx(balances[acc["account_code"]], rel=Decimal("1e-12"))

    def test_gl_detail_for_one_account_has_a_running_balance(self, superclient):
        r = _run(superclient, "finance.gl_detail", {"date_from": "2000-01-01", "account_code": "1010"})
        rows = r["tables"][1]["rows"]
        assert all(row["account_code"] == "1010" for row in rows)
        if len(rows) > 1:
            assert rows[0]["description"] == "Opening balance"

    def test_unknown_account_is_rejected(self, superclient):
        r = superclient.post(f"{BASE}/reports/finance.gl_detail/run", json={"params": {"account_code": "9999X"}})
        assert r.status_code == 422
        r = superclient.post(f"{BASE}/reports/finance.gl_detail/run", json={"params": {"account_code": "1010'; --"}})
        assert r.status_code == 422

    def test_vat_summary_adds_up(self, superclient):
        r = _run(superclient, "finance.vat_summary", {"date_from": "2000-01-01"})
        assert _metric(r, "Net output tax") == _metric(r, "Output tax") - _metric(r, "Tax refunded")
        assert _metric(r, "Net VAT payable") == _metric(r, "Net output tax") - _metric(r, "Input tax")
        output = r["tables"][0]
        assert Decimal(str(output["totals"]["tax"])) == _metric(r, "Output tax")


class TestLookups:
    def test_account_and_product_pickers(self, superclient):
        accounts = superclient.get(f"{BASE}/lookup/account", params={"q": "cash"}).json()
        assert all(isinstance(a["value"], str) for a in accounts)
        products = superclient.get(f"{BASE}/lookup/product", params={"q": "a"}).json()
        assert all(isinstance(p["value"], int) for p in products)

    def test_pickers_need_a_report_that_uses_them(self, api, make_user, make_branch):
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[make_branch()])
        assert api(token).get(f"{BASE}/lookup/account").status_code == 403
        assert api(token).get(f"{BASE}/lookup/customer").status_code == 200
