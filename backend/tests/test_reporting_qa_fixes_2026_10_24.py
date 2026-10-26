"""Regressions from the reporting QA pass (docs/qa/reporting-2026-10-24.md).

* id filters beyond the int4 range were sent to Postgres and failed with a 500;
* the inventory summary's stock value summed one unit cost per product, and its
  low-stock threshold was ignored;
* a name of only spaces passed validation and was saved as "".
"""

from decimal import Decimal

import pytest

CENTER = "/api/v1/reporting/center"
INT4_MAX = 2_147_483_647


def _run(client, key, params):
    return client.post(f"{CENTER}/reports/{key}/run", json={"params": params})


def _metric(body, label):
    return Decimal(str(next(m["value"] for m in body["metrics"] if m["label"] == label)))


class TestIdOverflow:
    @pytest.mark.parametrize("key,param", [
        ("customers.payments", "customer_id"),
        ("suppliers.payments", "supplier_id"),
        ("inventory.movement", "product_id"),
    ])
    @pytest.mark.parametrize("value", [INT4_MAX + 1, 2 ** 40, -(2 ** 40)])
    def test_out_of_range_ids_are_rejected(self, superclient, key, param, value):
        r = _run(superclient, key, {param: value})
        assert r.status_code == 422, r.text

    def test_largest_int4_id_runs(self, superclient):
        assert _run(superclient, "customers.payments", {"customer_id": INT4_MAX}).status_code == 200

    @pytest.mark.parametrize("value", [1.5, True, "12abc"])
    def test_non_integers_are_rejected(self, superclient, value):
        assert _run(superclient, "customers.payments", {"customer_id": value}).status_code == 422

    def test_whole_number_floats_are_accepted(self, superclient):
        assert _run(superclient, "hr.birthdays", {"days": 30.0}).status_code == 200

    def test_lookup_ignores_out_of_range_ids(self, superclient):
        r = superclient.get(f"{CENTER}/lookup/customer", params={"ids": f"{2 ** 40},{INT4_MAX + 1}"})
        assert r.status_code == 200 and r.json() == []

    def test_legacy_inventory_report_with_huge_category(self, superclient):
        r = superclient.post("/api/v1/reporting/inventory", json={"category": str(2 ** 40)})
        assert r.status_code == 200 and r.json()["total_products"] == 0


class TestInventorySummary:
    def test_stock_value_matches_the_valuation_report(self, superclient):
        summary = _run(superclient, "inventory.summary", {}).json()
        valuation = _run(superclient, "inventory.valuation", {}).json()
        assert _metric(summary, "Stock value") == _metric(valuation, "Stock value")

    def test_threshold_changes_the_low_stock_list(self, superclient, make_product):
        make_product()  # at least one active product with 0 units available
        none = _run(superclient, "inventory.summary", {"low_stock_threshold": 0}).json()
        many = _run(superclient, "inventory.summary", {"low_stock_threshold": 100000}).json()
        assert _metric(many, "Low-stock items") >= _metric(none, "Low-stock items")
        assert _metric(many, "Low-stock items") == _metric(many, "Products")  # every product has <= 100000 units
        for row in none["tables"][0]["rows"]:
            assert row["available_quantity"] == 0

    @pytest.mark.parametrize("threshold", [-1, 1_000_001])
    def test_legacy_endpoint_bounds_the_threshold(self, superclient, threshold):
        r = superclient.post("/api/v1/reporting/inventory", json={"low_stock_threshold": threshold})
        assert r.status_code == 422


class TestBlankNames:
    @pytest.mark.parametrize("name", ["", "   ", "\t\n"])
    def test_saved_report_name(self, superclient, name):
        r = superclient.post(f"{CENTER}/saved", json={"report_key": "hr.headcount", "name": name})
        assert r.status_code == 422

    def test_saved_report_name_is_trimmed(self, superclient):
        r = superclient.post(f"{CENTER}/saved", json={"report_key": "hr.headcount", "name": "  QA headcount  "})
        assert r.status_code == 201 and r.json()["name"] == "QA headcount"
        r = superclient.put(f"{CENTER}/saved/{r.json()['id']}", json={"name": "   ", "params": {}})
        assert r.status_code == 422

    @pytest.mark.parametrize("name", ["", "   "])
    def test_print_template_name(self, superclient, name):
        r = superclient.post("/api/v1/reporting/print-templates", json={"document_type": "grn", "name": name, "settings": {}})
        assert r.status_code == 422

    def test_print_template_name_is_trimmed(self, superclient, db):
        from app.modules.reporting.models import DocumentTemplate

        db.query(DocumentTemplate).delete()
        r = superclient.post("/api/v1/reporting/print-templates", json={"document_type": "grn", "name": " GRN A4 ", "settings": {}})
        assert r.status_code == 201 and r.json()["name"] == "GRN A4"
