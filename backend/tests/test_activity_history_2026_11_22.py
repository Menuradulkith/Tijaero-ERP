"""Activity history (2026-11-22): no phantom entries on unchanged saves, stored values logged,
names instead of ids, side changes (contacts, links, minimum prices, price tiers) and the
product documents (design brief / detail / BOM) recorded."""
import random
import uuid
from datetime import datetime

from tests.test_product_design_brief_2026_11_20 import make_item  # noqa: F401

API = "/api/v1"
INV = f"{API}/inventory"


def _u():
    return uuid.uuid4().hex[:8]


def _history(c, entity_type, entity_id):
    r = c.get(f"{API}/common/activity-log", params={"entity_type": entity_type, "entity_id": entity_id})
    assert r.status_code == 200, r.text
    return r.json()


def _phone():
    return "+9477" + "".join(random.choices("0123456789", k=7))


def _supplier(c):
    r = c.post(f"{API}/purchasing/suppliers", json={
        "company_name": f"QA Hist Sup {_u()}", "mobile_contact_number": _phone(), "tax_area": "domestic_standard",
        "default_currency": "LKR", "incoterm": "FOB", "shipment_method": "sea", "billing_address_line1": "1 Main St"})
    assert r.status_code == 201, r.text
    return r.json()


def test_unchanged_product_save_with_cent_prices_adds_no_entry(superclient, make_product):
    p = make_product()
    url = f"{INV}/products/{p.id}"
    assert superclient.put(url, json={"cost_price": 10.10, "selling_price": 20.20}).status_code == 200
    n = len(_history(superclient, "product", p.id))
    cur = superclient.get(url).json()
    r = superclient.put(url, json={"cost_price": cur["cost_price"], "selling_price": cur["selling_price"],
                                   "description": cur.get("description")})
    assert r.status_code == 200, r.text
    assert len(_history(superclient, "product", p.id)) == n  # 10.10 == Decimal('10.10'): nothing to log


def test_ids_are_shown_as_names(superclient, make_product, db):
    from app.modules.products.models import Category

    p = make_product()
    other = Category(name=f"QA Hist Cat {_u()}", category_code=f"QH{_u()[:6]}", active=True,
                     created_date=datetime.utcnow())
    db.add(other)
    db.flush()
    old_name = db.get(Category, p.category_id).name
    assert superclient.put(f"{INV}/products/{p.id}", json={"category_id": other.id}).status_code == 200
    entry = _history(superclient, "product", p.id)[0]
    assert "category" in entry["changes"]["fields"] and "category_id" not in entry["changes"]["fields"]
    assert entry["changes"]["values"]["category"] == {"old": old_name, "new": other.name}


def test_customer_logs_the_address_that_was_stored(superclient):
    body = {"customer_type": "individual", "customer_name": f"QA Hist {_u()}", "title": "mr", "gender": "m",
            "civil_status": "single", "no_of_kids": "0", "mobile_contact_number": _phone(), "customer_category": "customer",
            "tax_area": "domestic_standard", "accounting_group": "local_trade", "vat_registration_number": "VAT-QA"}
    cid = superclient.post(f"{API}/customers/", json=body).json()["id"]
    r = superclient.put(f"{API}/customers/{cid}", json={"billing_address_line1": "12 Lake Rd", "billing_city": "Kandy",
                                                         "payment_address": "something else"})
    assert r.status_code == 200, r.text
    values = _history(superclient, "customer", cid)[0]["changes"]["values"]
    assert values["payment_address"]["new"] == r.json()["payment_address"] == "12 Lake Rd, Kandy"


def test_side_changes_are_in_the_parent_history(superclient, make_item, make_product):
    body = {"customer_type": "business", "company_name": f"QA Co {_u()}", "customer_name": f"QA Co {_u()}",
            "mobile_contact_number": _phone(), "customer_category": "customer", "tax_area": "domestic_standard",
            "accounting_group": "local_trade", "vat_registration_number": "VAT-QA-1"}
    cust = superclient.post(f"{API}/customers/", json=body)
    assert cust.status_code == 201, cust.text
    cc = superclient.post(f"{API}/customers/{cust.json()['id']}/contact-persons",
                          json={"full_name": "Ann QA", "title": "Ms", "phone": _phone()})
    assert cc.status_code == 201, cc.text
    assert _history(superclient, "customer", cust.json()["id"])[0]["action"] == "contact_added"

    s = _supplier(superclient)
    item = make_item()
    c = superclient.post(f"{API}/purchasing/suppliers/{s['id']}/contact-persons",
                         json={"full_name": "Jane QA", "title": "Ms", "phone": _phone()})
    assert c.status_code == 201, c.text
    entry = _history(superclient, "supplier", s["id"])[0]
    assert entry["action"] == "contact_added" and entry["changes"]["summary"] == "Contact person: Jane QA"
    assert superclient.patch(f"{API}/purchasing/suppliers/{s['id']}/contact-persons/{c.json()['id']}",
                             json={"full_name": "Jane QA2"}).status_code == 200
    entry = _history(superclient, "supplier", s["id"])[0]
    assert entry["action"] == "contact_updated" and entry["changes"]["values"]["full_name"] == {"old": "Jane QA", "new": "Jane QA2"}

    # an item link shows on both the supplier and the item
    link = superclient.post(f"{API}/materials/items/{item.id}/suppliers", json={"supplier_id": s["id"], "cost_price": 5})
    assert link.status_code == 201, link.text
    assert _history(superclient, "material", item.id)[0]["action"] == "supplier_link_added"
    assert _history(superclient, "supplier", s["id"])[0]["changes"]["summary"].startswith("Item: ")

    assert superclient.post(f"{API}/materials/items/{item.id}/minimum-prices", json={"minimum_price": 12}).status_code == 201
    entry = _history(superclient, "material", item.id)[0]
    assert entry["action"] == "minimum_price_set" and entry["changes"]["values"]["minimum_price"]["new"] == 12

    p = make_product()
    superclient.post(f"{INV}/products/{p.id}/price-tiers",
                     json={"cost_price": 100, "selling_price": 160, "minimum_selling_price": 130, "remark": "Retail"})
    t = superclient.post(f"{INV}/products/{p.id}/price-tiers",
                         json={"cost_price": 100, "selling_price": 150, "minimum_selling_price": 120, "remark": "Wholesale"})
    assert t.status_code == 201, t.text
    assert _history(superclient, "product", p.id)[0]["changes"]["summary"] == "Price tier: Wholesale"
    assert superclient.delete(f"{INV}/products/{p.id}/price-tiers/{t.json()['id']}").status_code == 200
    assert _history(superclient, "product", p.id)[0]["action"] == "price_tier_removed"


def test_design_brief_save_confirm_and_reject_are_logged(superclient, make_product, make_item):
    p = make_product()
    a, b = make_item(), make_item()
    url = f"{INV}/products/{p.id}/design-brief"
    v = superclient.put(url, json={"expected_version": None, "lines": [{"material_id": a.id, "brief": "x"}]}).json()["version"]
    v = superclient.put(url, json={"expected_version": v, "notes": "N",
                                   "lines": [{"material_id": a.id, "brief": "y"}, {"material_id": b.id}]}).json()["version"]
    rej = superclient.post(f"{url}/reject", json={"expected_version": v, "reason": "Wrong tag"})
    assert rej.status_code == 200
    hist = _history(superclient, "product_design_brief", p.id)
    assert [e["action"] for e in hist] == ["reject", "update", "create"]
    assert hist[0]["changes"]["values"]["reason"]["new"] == "Wrong tag"
    update = hist[1]["changes"]
    assert update["values"]["notes"] == {"old": None, "new": "N"}
    actions = {c["product_name"].split(" - ")[0]: c["action"] for c in update["item_changes"]}
    assert actions == {a.item_code: "changed", b.item_code: "added"}
    # an unchanged save from the rejected state only records Rejected -> Draft
    v = superclient.get(url).json()["version"]
    superclient.put(url, json={"expected_version": v, "notes": "N",
                               "lines": [{"material_id": a.id, "brief": "y"}, {"material_id": b.id}]})
    last = _history(superclient, "product_design_brief", p.id)[0]["changes"]
    assert last["fields"] == ["status"] and last["values"]["status"] == {"old": "Rejected", "new": "Draft"}
