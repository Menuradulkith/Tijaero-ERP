"""Validation fixes from the API audit (2026-11-02).

Commissions, supplier payments / advances / credit settlements, fixed assets and
recurring journals: bad input is refused with a 4xx and a plain message instead
of being saved (or crashing with a 500).
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.customers import commission_schemas as cs
from app.modules.customers.commission_service import commission_service
from app.modules.finance.accounting_models import AssetClass, ChartOfAccounts
from tests.integration.test_workflows.test_commission_flow import _invoice, _pay
from tests.integration.test_workflows.test_grn_receive_cancel import P, _uid, world  # noqa: F401
from tests.test_finance_period_end_2026_11_01 import _asset

A = "/api/v1/finance/accounting"
TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)


# ═══════════════════════════════════ commissions ═══════════════════════════════════
@pytest.fixture
def com(db, make_branch, make_customer):
    branch = make_branch()
    agent = make_customer(is_customer_agent=True)
    customer = make_customer()
    inv = _invoice(db, branch, customer, subtotal="600.00")
    return branch, agent, customer, inv


def _create(db, com, **over):
    _, agent, customer, inv = com
    body = dict(invoice_id=inv.id, customer_agent_id=agent.id, represented_customer_id=customer.id,
                invoice_amount=Decimal("600"), commission_type="PERCENT", commission_rate=Decimal("5"),
                commission_amount=Decimal("30"))
    body.update(over)
    return commission_service.create_commission(db, cs.CustomerAgentCommissionCreate(**body))


def _err(fn, *a, **k) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*a, **k)
    return e.value


class TestCommissionValidation:
    def test_invoice_amount_comes_from_the_invoice(self, db, com):
        c = _create(db, com, invoice_amount=Decimal("99999"))
        assert Decimal(str(c.invoice_amount)) == Decimal("600.00")

    def test_amount_cannot_exceed_the_invoice(self, db, com):
        e = _err(_create, db, com, commission_type="AMOUNT", commission_rate=None, commission_amount=Decimal("700"))
        assert e.status_code == 400 and "more than the invoice amount" in e.detail

    def test_percent_and_amount_must_agree(self, db, com):
        e = _err(_create, db, com, commission_rate=Decimal("10"), commission_amount=Decimal("30"))
        assert e.status_code == 400 and "should be 60.00" in e.detail

    def test_only_one_live_commission_per_invoice_and_agent(self, db, com):
        first = _create(db, com)
        e = _err(_create, db, com)
        assert e.status_code == 400 and "already has a commission" in e.detail
        commission_service.decline_commission(db, first.id, declined_by=0)
        assert _create(db, com).id != first.id  # a cancelled one doesn't count

    def test_update_rechecks_the_amount(self, db, com):
        c = _create(db, com)
        e = _err(commission_service.update_commission, db, c.id,
                 cs.CustomerAgentCommissionUpdate(commission_amount=Decimal("45")))
        assert e.status_code == 400

    def test_decline_with_a_payment_is_refused(self, db, com):
        branch, agent, _, _ = com
        c = _create(db, com)
        commission_service.approve_commission(db, c.id, approved_by=0)
        commission_service.create_payment(db, _pay(agent, c, amount="30.00", branch_code=branch.branch_code), created_by=0)
        e = _err(commission_service.decline_commission, db, c.id, declined_by=0)
        assert e.status_code == 400 and "Cancel that payment" in e.detail


# ═══════════════════════════════════ supplier payments ═══════════════════════════════════
def _payment(w, **over):
    return {"supplier_id": w["po"].first_suppliers_id, "payment_date": str(TODAY), "payment_method": "cash",
            "payment_amount": 10, "branch_code": w["branch"].branch_code, "payment_for": "advance", **over}


def _adv(w, **over):
    return {"supplier_id": w["po"].first_suppliers_id, "payment_date": str(TODAY), "payment_method": "cash",
            "original_amount": 10, "branch_code": w["branch"].branch_code, **over}


def _settle(w, **over):
    return {"supplier_credits_settle_no": _uid("CS"), "branch_code": w["branch"].branch_code,
            "suppliers_id": w["po"].first_suppliers_id,
            "transactions": [{"payment_method": "cash", "cheque_date": str(TODAY), "payment_amount": 1,
                              "good_received_id": 1}], **over}


class TestSupplierPaymentValidation:
    @pytest.mark.parametrize("po", [0, -1])
    def test_purchase_order_id_must_be_positive(self, superclient, world, po):  # noqa: F811
        assert superclient.post(f"{P}/supplier-payments", json=_payment(world, purchasing_order_id=po)).status_code == 422
        assert superclient.post(f"{P}/supplier-advances", json=_adv(world, purchasing_order_id=po)).status_code == 422

    def test_unknown_purchase_order_is_404(self, superclient, world):  # noqa: F811
        assert superclient.post(f"{P}/supplier-payments", json=_payment(world, purchasing_order_id=2**30)).status_code == 404

    def test_future_dates_are_refused(self, superclient, world):  # noqa: F811
        r = superclient.post(f"{P}/supplier-payments", json=_payment(world, payment_date=str(TOMORROW)))
        assert r.status_code == 400 and "future" in r.json()["detail"]
        r = superclient.post(f"{P}/supplier-advances", json=_adv(world, payment_date=str(TOMORROW)))
        assert r.status_code == 400 and "future" in r.json()["detail"]

    def test_advance_return_in_the_future_is_refused(self, superclient, world):  # noqa: F811
        r = superclient.post(f"{P}/supplier-advances", json=_adv(world))
        assert r.status_code == 201, r.text
        r = superclient.post(f"{P}/supplier-advances/{r.json()['id']}/return", json={
            "return_amount": 5, "return_date": str(TOMORROW), "return_method": "cash"})
        assert r.status_code == 400 and "future" in r.json()["detail"]

    @pytest.mark.parametrize("over", [{"transactions": []}, {"supplier_credits_settle_no": "   "}])
    def test_settlement_needs_lines_and_a_number(self, superclient, world, over):  # noqa: F811
        assert superclient.post(f"{P}/credit-settlements", json=_settle(world, **over)).status_code == 422

    def test_duplicate_settlement_number_is_refused(self, superclient, db, world):  # noqa: F811
        from app.modules.purchasing.models import SupplierCreditsSettle

        existing = db.query(SupplierCreditsSettle).first()
        if existing is None:
            pytest.skip("no supplier settlement in the dev DB")
        r = superclient.post(f"{P}/credit-settlements",
                             json=_settle(world, supplier_credits_settle_no=existing.supplier_credits_settle_no))
        assert r.status_code == 400 and "already used" in r.json()["detail"]


# ═══════════════════════════════════ fixed assets ═══════════════════════════════════
class TestFixedAssetValidation:
    def _base(self, db, **over):
        equip = db.query(AssetClass).filter(AssetClass.code == "EQUIP").one()
        return {"name": "x", "asset_class_id": equip.id, "acquisition_date": str(TODAY), "cost": "100",
                "funding": "existing", **over}

    def test_depreciation_start_not_before_purchase(self, db, superclient):
        r = superclient.post(f"{A}/fixed-assets", json=self._base(db, depreciation_start=str(TODAY - timedelta(days=40))))
        assert r.status_code == 422 and "before the asset was bought" in r.json()["detail"]

    def test_unknown_depreciation_method(self, db, superclient):
        r = superclient.post(f"{A}/fixed-assets", json=self._base(db, depreciation_method="magic"))
        assert r.status_code == 422 and "straight_line" in r.json()["detail"]

    def test_funded_purchase_in_the_future_is_400(self, db, superclient):
        r = superclient.post(f"{A}/fixed-assets", json=self._base(db, funding="bank", acquisition_date=str(TOMORROW)))
        assert r.status_code == 400

    def test_disposal_rules(self, db, superclient):
        a = _asset(superclient, db, cost="500")
        url = f"{A}/fixed-assets/{a['id']}/dispose"
        r = superclient.post(url, json={"kind": "scrapped", "proceeds": "50"})
        assert r.status_code == 422 and "scrapped asset brings in no money" in r.json()["detail"]
        r = superclient.post(url, json={"kind": "sold", "proceeds": "50", "received_into": "pocket"})
        assert r.status_code == 422 and "bank or cash" in r.json()["detail"]
        r = superclient.post(url, json={"kind": "sold", "proceeds": "50", "disposal_date": str(TOMORROW)})
        assert r.status_code == 400 and "future" in r.json()["detail"]
        r = superclient.post(url, json={"kind": "sold", "proceeds": "50", "received_into": "cash"})
        assert r.status_code == 200 and r.json()["status"] == "sold"

    @pytest.mark.parametrize("code", ["1010", "1020", "1330"])
    def test_class_account_must_be_a_fixed_asset_account(self, db, superclient, code):
        acc = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).one()
        r = superclient.post(f"{A}/asset-classes", json={
            "code": f"T{uuid.uuid4().hex[:5]}", "name": "Bad class", "asset_account_id": acc.id,
            "useful_life_months": 12})
        assert r.status_code == 422 and "not a fixed-asset account" in r.json()["detail"]

    def test_class_with_equipment_account_is_fine(self, db, superclient):
        acc = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1310").one()
        r = superclient.post(f"{A}/asset-classes", json={
            "code": f"T{uuid.uuid4().hex[:5]}", "name": "Tools", "asset_account_id": acc.id, "useful_life_months": 12})
        assert r.status_code == 201, r.text


# ═══════════════════════════════════ recurring journals ═══════════════════════════════════
class TestRecurringEndDate:
    def test_end_date_before_next_date_is_refused(self, db, superclient):
        rent = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5120").one()
        cash = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1010").one()
        body = {"name": "Rent", "description": "Shop rent", "next_date": str(TODAY),
                "lines": [{"account_id": rent.id, "debit_amount": "100"}, {"account_id": cash.id, "credit_amount": "100"}]}
        r = superclient.post(f"{A}/recurring-journals", json={**body, "end_date": str(TODAY - timedelta(days=1))})
        assert r.status_code == 422 and "can't be before" in r.json()["detail"]
        r = superclient.post(f"{A}/recurring-journals", json=body)
        assert r.status_code == 201, r.text
        r = superclient.put(f"{A}/recurring-journals/{r.json()['id']}", json={"end_date": str(TODAY - timedelta(days=1))})
        assert r.status_code == 422
