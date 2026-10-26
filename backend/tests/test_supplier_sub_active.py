"""Supplier contact persons and payment methods: deactivate instead of delete, active-only listing."""
import uuid

import pytest

B = "/api/v1/purchasing"


@pytest.fixture
def supplier(superclient):
    u = uuid.uuid4().hex[:8]
    r = superclient.post(f"{B}/suppliers", json={
        "company_name": f"QA Sup {u}", "mobile_contact_number": "+94771234567",
        "billing_address_line1": "1 Road", "credit_days": 30, "max_credit_limit": 1000,
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_contact_person_deactivate_and_active_only(superclient, supplier):
    sid = supplier["id"]
    url = f"{B}/suppliers/{sid}/contact-persons"
    a = superclient.post(url, json={"title": "Mr", "full_name": "Active One", "phone": "+94771234501"}).json()
    b = superclient.post(url, json={"title": "Mr", "full_name": "Soon Inactive", "phone": "+94771234502"}).json()
    assert a["active"] is True and b["active"] is True

    assert superclient.patch(f"{url}/{b['id']}", json={"active": False}).json()["active"] is False
    assert {c["id"] for c in superclient.get(url).json()} == {a["id"], b["id"]}
    assert [c["id"] for c in superclient.get(url, params={"active_only": True}).json()] == [a["id"]]


def test_payment_method_deactivate_clears_default_and_active_only(superclient, supplier):
    sid = supplier["id"]
    url = f"{B}/suppliers/{sid}/payment-methods"
    m = superclient.post(url, json={"method_type": "cash", "is_default": True}).json()
    assert m["is_default"] is True and m["active"] is True

    r = superclient.patch(f"{url}/{m['id']}", json={"active": False}).json()
    assert r["active"] is False and r["is_default"] is False
    assert superclient.get(url, params={"active_only": True}).json() == []
    assert len(superclient.get(url).json()) == 1


def test_delete_endpoints_are_gone(superclient, supplier):
    sid = supplier["id"]
    c = superclient.post(f"{B}/suppliers/{sid}/contact-persons", json={"title": "Mr", "full_name": "X", "phone": "+94771234503"}).json()
    m = superclient.post(f"{B}/suppliers/{sid}/payment-methods", json={"method_type": "cash"}).json()
    assert superclient.delete(f"{B}/suppliers/{sid}/contact-persons/{c['id']}").status_code == 405
    assert superclient.delete(f"{B}/suppliers/{sid}/payment-methods/{m['id']}").status_code == 405
