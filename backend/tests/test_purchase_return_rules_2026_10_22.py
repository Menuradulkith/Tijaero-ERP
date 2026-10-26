"""Purchase returns: at least one item, price capped at the purchase price, branch-scoped list, warranty 0."""
from datetime import datetime, timedelta

import pytest

RET = "/api/v1/purchasing/returns"


@pytest.fixture
def world(db, make_branch, make_product, make_sales_stock):
    branch, other = make_branch(), make_branch()
    product = make_product()
    mine = make_sales_stock(product=product, branch=branch, barcode="QR-A-001")
    mine2 = make_sales_stock(product=product, branch=branch, barcode="QR-A-002")
    theirs = make_sales_stock(product=product, branch=other, barcode="QR-B-001")
    return {"branch": branch, "other": other, "product": product, "mine": mine, "mine2": mine2, "theirs": theirs}


def _body(stock, branch, **item):
    line = {"product_id": stock.product_id, "purchasing_price": 100, "return_price": 100, "barcode": stock.barcode}
    line.update(item)
    return {"branch_code": branch.branch_code, "goodreceivednote_id": stock.good_received_note_id,
            "reason": "Quality issue", "remark": "x", "require_approval": True, "items": [line]}


class TestItemsRequired:
    def test_return_without_items_is_refused(self, superclient, world):
        body = _body(world["mine"], world["branch"])
        body["items"] = []
        r = superclient.post(RET, json=body)
        assert r.status_code == 422, r.text

    def test_return_with_an_item_is_created(self, superclient, world):
        r = superclient.post(RET, json=_body(world["mine"], world["branch"]))
        assert r.status_code == 201, r.text


class TestReturnPrice:
    def test_price_above_the_purchase_price_is_refused(self, superclient, world):
        r = superclient.post(RET, json=_body(world["mine"], world["branch"], return_price=500))
        assert r.status_code == 400, r.text
        assert "higher than its purchase price" in r.text

    def test_a_forged_purchasing_price_does_not_raise_the_limit(self, superclient, world):
        r = superclient.post(RET, json=_body(world["mine"], world["branch"], purchasing_price=9999, return_price=500))
        assert r.status_code == 400, r.text

    def test_stored_purchasing_price_is_the_real_one(self, superclient, world):
        r = superclient.post(RET, json=_body(world["mine"], world["branch"], purchasing_price=1, return_price=80))
        assert r.status_code == 201, r.text
        assert float(r.json()["items"][0]["purchasing_price"]) == 100.0
        assert float(r.json()["items"][0]["return_price"]) == 80.0

    def test_price_equal_to_the_purchase_price_is_fine(self, superclient, world):
        assert superclient.post(RET, json=_body(world["mine"], world["branch"], return_price=100)).status_code == 201


class TestReturnListBranchScope:
    def test_branch_user_sees_only_their_branch(self, superclient, api, make_user, world):
        mine = superclient.post(RET, json=_body(world["mine"], world["branch"])).json()
        theirs = superclient.post(RET, json=_body(world["theirs"], world["other"])).json()
        _user, token = make_user(permissions=[("purchase_returns", "view")], branches=[world["branch"]])
        c = api(token)
        ids = {r["id"] for r in c.get(f"{RET}?limit=500").json()}
        assert mine["id"] in ids and theirs["id"] not in ids

    def test_branch_filter_for_a_foreign_branch_is_forbidden(self, api, make_user, world):
        _user, token = make_user(permissions=[("purchase_returns", "view")], branches=[world["branch"]])
        c = api(token)
        assert c.get(f"{RET}?branch_code={world['other'].branch_code}").status_code == 403
        assert c.get(f"{RET}?branch_code={world['branch'].branch_code}").status_code == 200

    def test_superuser_still_sees_every_branch_and_can_filter(self, superclient, world):
        a = superclient.post(RET, json=_body(world["mine"], world["branch"])).json()
        b = superclient.post(RET, json=_body(world["theirs"], world["other"])).json()
        ids = {r["id"] for r in superclient.get(f"{RET}?limit=500").json()}
        assert {a["id"], b["id"]} <= ids
        only_b = {r["id"] for r in superclient.get(f"{RET}?branch_code={world['other'].branch_code}&limit=500").json()}
        assert b["id"] in only_b and a["id"] not in only_b


class TestWarranty:
    def _validate(self, superclient, stock, branch):
        r = superclient.post(f"{RET}/validate-barcode", json={
            "barcode": stock.barcode, "grn_id": stock.good_received_note_id, "branch_code": branch.branch_code})
        assert r.status_code == 200, r.text
        return r.json()

    def test_zero_months_is_not_expired(self, db, superclient, world):
        unit = world["mine"]
        unit.warranty_month = "0"
        unit.added_date = datetime.utcnow() - timedelta(days=30)
        db.flush()
        v = self._validate(superclient, unit, world["branch"])
        assert v["valid"] and v["warranty_expired"] is False

    def test_real_warranty_still_expires(self, db, superclient, world):
        unit = world["mine2"]
        unit.warranty_month = "12"
        unit.added_date = datetime.utcnow() - timedelta(days=800)
        db.flush()
        v = self._validate(superclient, unit, world["branch"])
        assert v["warranty_expired"] is True

    def test_warranty_inside_the_period_is_not_expired(self, db, superclient, world):
        unit = world["mine"]
        unit.warranty_month = "12"
        unit.added_date = datetime.utcnow() - timedelta(days=30)
        db.flush()
        assert self._validate(superclient, unit, world["branch"])["warranty_expired"] is False
