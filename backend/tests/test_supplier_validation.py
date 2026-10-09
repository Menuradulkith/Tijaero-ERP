"""Suppliers: field validation (422 not 500), trimming, paging, sub-resource rules."""
import uuid

import pytest

B = "/api/v1/purchasing"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _body(**kw):
    u = _u()
    return {
        "company_name": f"QA Sup {u}", "mobile_contact_number": "+94771234567",
        "billing_address_line1": "1 Road", "credit_days": 30, "max_credit_limit": 1000, **kw,
    }


@pytest.fixture
def supplier(superclient):
    r = superclient.post(f"{B}/suppliers", json=_body())
    assert r.status_code == 201, r.text
    return r.json()


class TestCreateValidation:
    @pytest.mark.parametrize("field,value", [
        ("company_name", "N" * 256), ("company_name", "   "), ("company_name", ""),
        ("company_registration_number", "R" * 256), ("tax_registration_number", "T" * 256),
        ("company_website", "http://x.com/" + "a" * 200), ("company_website", "javascript:alert(1)"),
        ("billing_address_line1", "A" * 256), ("billing_city", "C" * 121), ("billing_postal_code", "1" * 21),
        ("email", "a" * 70 + "@x.com"), ("credit_days", -1), ("credit_days", 2 ** 40),
        ("max_credit_limit", -1), ("max_credit_limit", 1e30), ("max_credit_limit", 10.555),
        ("lead_time_days", 2 ** 40), ("country_id", 2 ** 40), ("country_id", 0), ("default_currency", "usdx"),
    ])
    def test_rejected_with_422(self, superclient, field, value):
        r = superclient.post(f"{B}/suppliers", json=_body(**{field: value}))
        assert r.status_code == 422, (field, value, r.text[:200])

    def test_names_are_trimmed(self, superclient):
        r = superclient.post(f"{B}/suppliers", json=_body(company_name=f"  Trim {_u()}  "))
        assert r.status_code == 201
        assert r.json()["company_name"] == r.json()["company_name"].strip()

    def test_currency_must_be_configured_and_is_uppercased(self, superclient):
        assert superclient.post(f"{B}/suppliers", json=_body(default_currency="ZZZ")).status_code == 400
        ok = superclient.post(f"{B}/suppliers", json=_body(default_currency="lkr"))
        assert ok.status_code in (201, 400)  # 201 when LKR is configured in this DB
        if ok.status_code == 201:
            assert ok.json()["default_currency"] == "LKR"

    def test_blank_optional_text_becomes_null(self, superclient):
        r = superclient.post(f"{B}/suppliers", json=_body(billing_city="   ", company_website=""))
        assert r.status_code == 201
        assert r.json()["billing_city"] is None and r.json()["company_website"] is None


class TestUpdateValidation:
    @pytest.mark.parametrize("body", [
        {"company_name": "   "}, {"company_name": "N" * 256}, {"credit_days": -1},
        {"max_credit_limit": -5}, {"company_website": "ftp://x"},
    ])
    def test_rejected(self, superclient, supplier, body):
        assert superclient.patch(f"{B}/suppliers/{supplier['id']}", json=body).status_code == 422

    def test_ids_are_bounded(self, superclient):
        assert superclient.get(f"{B}/suppliers/{2 ** 31}").status_code == 422
        assert superclient.patch(f"{B}/suppliers/{2 ** 40}", json={"credit_days": 1}).status_code == 422
        assert superclient.get(f"{B}/suppliers/0").status_code == 422
        assert superclient.get(f"{B}/suppliers", params={"country_id": 2 ** 40}).status_code == 422


class TestListAndPaging:
    def test_search_is_literal(self, superclient, supplier):
        assert superclient.get(f"{B}/suppliers", params={"search": "%"}).json() == []
        assert superclient.get(f"{B}/suppliers", params={"search": "_"}).json() == []

    def test_paged_totals_search_sort(self, superclient):
        tag = _u()
        for i in range(5):
            assert superclient.post(f"{B}/suppliers", json=_body(company_name=f"PG {tag} {i}")).status_code == 201
        p = superclient.get(f"{B}/suppliers/paged", params={"q": tag, "size": 2, "page": 0}).json()
        assert p["total"] == 5 and p["pages"] == 3 and len(p["items"]) == 2
        names = []
        for pg in range(3):
            names += [x["company_name"] for x in superclient.get(f"{B}/suppliers/paged", params={"q": tag, "size": 2, "page": pg}).json()["items"]]
        assert names == sorted(names) and len(set(names)) == 5
        d = superclient.get(f"{B}/suppliers/paged", params={"q": tag, "sort_by": "company_name", "order": "desc", "size": 1}).json()
        assert d["items"][0]["company_name"].endswith("4")
        assert superclient.get(f"{B}/suppliers/paged", params={"sort_by": "x; drop table supplier"}).status_code == 200
        assert superclient.get(f"{B}/suppliers/paged", params={"size": 0}).status_code == 422

    def test_unfiltered_total_matches_list(self, superclient, supplier):
        full = superclient.get(f"{B}/suppliers", params={"limit": 100000}).json()
        assert superclient.get(f"{B}/suppliers/paged", params={"size": 1}).json()["total"] == len(full)

    def test_sort_by_country_name_works(self, superclient, supplier):
        assert superclient.get(f"{B}/suppliers/paged", params={"sort_by": "country_name"}).status_code == 200


class TestSubResources:
    @pytest.mark.parametrize("body", [
        {"full_name": "  "}, {"full_name": "N" * 256}, {"title": "T" * 31}, {"id_card_number": "9" * 13},
        {"birthdate": "1800-01-01"}, {"birthdate": "2999-01-01"},
    ])
    def test_contact_rejected(self, superclient, supplier, body):
        r = superclient.post(f"{B}/suppliers/{supplier['id']}/contact-persons", json={"full_name": "Ok", **body})
        assert r.status_code == 422, r.text[:200]

    @pytest.mark.parametrize("body", [
        {"method_type": "bank_transfer"},
        {"method_type": "bank_transfer", "bank_name": "B", "account_number": "abc!!"},
        {"method_type": "bank_transfer", "bank_name": "B", "account_number": "9" * 300},
        {"method_type": "bank_transfer", "bank_name": "B", "account_number": "123456", "swift_code": "zz"},
        {"method_type": "credit_card", "card_last4": "1111", "card_expiry": "01/2001"},
        {"method_type": "credit_card", "card_last4": "1111", "card_expiry": "99/9999"},
        {"method_type": "letter_of_credit", "lc_number": "L1", "lc_issue_date": "2026-05-01", "lc_expiry_date": "2026-01-01"},
        {"method_type": "letter_of_credit", "lc_number": "L1", "lc_amount": 1e30},
        {"method_type": "letter_of_credit", "lc_number": "L1", "lc_currency": "zz"},
        {"method_type": "digital_wallet", "wallet_provider": "paypal"},
    ])
    def test_payment_method_rejected(self, superclient, supplier, body):
        r = superclient.post(f"{B}/suppliers/{supplier['id']}/payment-methods", json=body)
        assert r.status_code == 422, (body, r.text[:200])

    def test_payment_method_update_revalidated_against_stored_row(self, superclient, supplier):
        sid = supplier["id"]
        m = superclient.post(f"{B}/suppliers/{sid}/payment-methods", json={"method_type": "cash"}).json()
        # switching a cash method to bank_transfer without bank details is invalid
        r = superclient.patch(f"{B}/suppliers/{sid}/payment-methods/{m['id']}", json={"method_type": "bank_transfer"})
        assert r.status_code == 422

    def test_valid_methods_still_work(self, superclient, supplier):
        sid = supplier["id"]
        for body in (
            {"method_type": "cash"}, {"method_type": "cheque"},
            {"method_type": "bank_transfer", "bank_name": "B", "account_number": "LK12 3456-7890", "swift_code": "ABCDLKLX"},
            {"method_type": "credit_card", "card_last4": "1111", "card_expiry": "12/2099"},
        ):
            assert superclient.post(f"{B}/suppliers/{sid}/payment-methods", json=body).status_code == 201, body

    def test_cannot_add_to_inactive_supplier(self, superclient, supplier):
        sid = supplier["id"]
        assert superclient.patch(f"{B}/suppliers/{sid}", json={"active": False}).status_code == 200
        assert superclient.post(f"{B}/suppliers/{sid}/contact-persons", json={"title": "Mr", "full_name": "X", "phone": "+94771234500"}).status_code == 400
        assert superclient.post(f"{B}/suppliers/{sid}/payment-methods", json={"method_type": "cash"}).status_code == 400

    def test_supplier_product_bounds(self, superclient, supplier):
        sid = supplier["id"]
        for body in ({"product_id": 2 ** 40, "cost_price": 1}, {"product_id": 1, "cost_price": 1e30},
                     {"product_id": 1, "cost_price": 1, "supplier_sku": "s" * 256}):
            assert superclient.post(f"{B}/suppliers/{sid}/products", json=body).status_code == 422
