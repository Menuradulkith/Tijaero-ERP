"""Customers: validation, uniqueness, credit-balance integrity, paging, export, contact persons."""
import uuid

import pytest

C = "/api/v1/customers"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _body(**kw):
    u = _u()
    b = {"customer_type": "individual", "customer_name": f"QA Cust {u}", "title": "Mr", "gender": "m", "civil_status": "single",
         "no_of_kids": "0", "mobile_contact_number": "+94771234567", "email": f"qa.{u}@example.com",
         "bank_account_name": "QA", "bank_name": "QA Bank", "bank_account_no": "123456", "credit_days": 30, "max_credit_limit": 1000}
    b.update(kw)
    return b


def _business(**kw):
    u = _u()
    return _body(customer_type="business", company_name=f"QA Co {u}", customer_name=f"QA Co {u}", title=None, gender=None,
                 civil_status=None, no_of_kids=None, **kw)


@pytest.fixture
def customer(superclient):
    r = superclient.post(f"{C}/", json=_body())
    assert r.status_code == 201, r.text
    return r.json()


class TestCreateValidation:
    @pytest.mark.parametrize("field,value", [
        ("customer_name", "   "), ("customer_name", "N" * 256), ("email", "nope"), ("email", "a" * 70 + "@x.com"),
        ("credit_days", -1), ("credit_days", 2 ** 40), ("max_credit_limit", -1), ("max_credit_limit", 2 ** 40), ("max_credit_limit", 10.5),
        ("birthdate", "2999-01-01"), ("birthdate", "1800-01-01"), ("birthdate", "2026-02-30"),
        ("id_card_number", "1" * 13), ("id_card_number", "<b>"), ("passport_no", "P" * 51),
        ("gender", "alien"), ("civil_status", "x" * 31), ("civil_status", "complicated"), ("no_of_kids", "lots"), ("no_of_kids", "-3"),
        ("commission_rate", 101), ("country_id", 2 ** 40), ("country_id", 0),
        ("billing_city", "C" * 121), ("billing_postal_code", "1" * 21), ("payment_address", "A" * 1001),
        ("bank_name", "B" * 256), ("bank_account_no", "9" * 51), ("customer_type", "alien"),
    ])
    def test_rejected(self, superclient, field, value):
        r = superclient.post(f"{C}/", json=_body(**{field: value}))
        assert r.status_code == 422, (field, value, r.text[:200])

    def test_unknown_country_and_currency_are_400(self, superclient):
        assert superclient.post(f"{C}/", json=_body(country_id=99999999)).status_code == 400
        assert superclient.post(f"{C}/", json=_body(billing_country_id=99999999)).status_code == 400
        assert superclient.post(f"{C}/", json=_body(default_currency="ZZZ")).status_code == 400

    def test_trim_and_blank_optionals(self, superclient):
        r = superclient.post(f"{C}/", json=_body(customer_name=f"  Trim {_u()} ", occupation="", birthdate="", billing_city="  "))
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["customer_name"] == j["customer_name"].strip() and j["occupation"] is None and j["birthdate"] is None and j["billing_city"] is None

    def test_business_requires_company(self, superclient):
        b = _business()
        b["company_name"] = ""
        assert superclient.post(f"{C}/", json=b).status_code == 422

    def test_local_domain_email_is_accepted(self, superclient):
        assert superclient.post(f"{C}/", json=_body(email=f"x{_u()}@tijaero.local")).status_code == 201


class TestCreditBalancesAreServerControlled:
    def test_client_cannot_set_left_or_initial_credit(self, superclient):
        r = superclient.post(f"{C}/", json=_body(max_credit_limit=1000, left_credit_amount=999999, initial_credit_amount=999999))
        assert r.status_code == 201
        assert r.json()["left_credit_amount"] == 1000 and r.json()["initial_credit_amount"] == 1000

    def test_update_ignores_client_balances_and_recomputes_on_limit_change(self, superclient, customer):
        cid = customer["id"]
        r = superclient.put(f"{C}/{cid}", json={"left_credit_amount": 5000, "initial_credit_amount": 5000})
        assert r.status_code == 200 and r.json()["left_credit_amount"] == customer["left_credit_amount"]
        r = superclient.put(f"{C}/{cid}", json={"max_credit_limit": 2500})
        assert r.json()["max_credit_limit"] == 2500 and r.json()["initial_credit_amount"] == 2500 and r.json()["left_credit_amount"] == 2500


class TestUniqueness:
    def test_email_is_unique_ignoring_case_and_spaces(self, superclient, customer):
        for variant in (customer["email"].upper(), f" {customer['email']} "):
            assert superclient.post(f"{C}/", json=_body(email=variant)).status_code == 400

    def test_other_identifiers_unique(self, superclient):
        n = _u()
        assert superclient.post(f"{C}/", json=_body(id_card_number=f"NIC{n}")).status_code == 201
        assert superclient.post(f"{C}/", json=_body(id_card_number=f"nic{n}")).status_code == 400
        assert superclient.post(f"{C}/", json=_body(passport_no=f"PP{n}")).status_code == 201
        assert superclient.post(f"{C}/", json=_body(passport_no=f"pp{n}")).status_code == 400
        assert superclient.post(f"{C}/", json=_business(company_registration_number=f"REG{n}")).status_code == 201
        assert superclient.post(f"{C}/", json=_business(company_registration_number=f" reg{n} ")).status_code == 400
        assert superclient.post(f"{C}/", json=_business(tax_registration_number=f"TAX{n}")).status_code == 201
        assert superclient.post(f"{C}/", json=_business(tax_registration_number=f"tax{n}")).status_code == 400

    def test_names_and_phones_may_repeat(self, superclient, customer):
        assert superclient.post(f"{C}/", json=_body(customer_name=customer["customer_name"])).status_code == 201
        assert superclient.post(f"{C}/", json=_body(mobile_contact_number=customer["mobile_contact_number"])).status_code == 201

    def test_update_to_a_taken_email_is_400_and_own_email_is_fine(self, superclient, customer):
        other = superclient.post(f"{C}/", json=_body()).json()
        assert superclient.put(f"{C}/{other['id']}", json={"email": customer["email"].upper()}).status_code == 400
        assert superclient.put(f"{C}/{customer['id']}", json={"email": customer["email"]}).status_code == 200

    def test_database_index_backs_the_rule(self, db):
        from sqlalchemy.exc import IntegrityError

        from app.core import timezone as tz
        from app.modules.customers.models import Customer

        def row(email):
            return Customer(customer_no=_u()[:8], customer_name="X", email=email, credit_days=0, max_credit_limit=0, active=True,
                            date_joined=tz.now(), customer_type="individual")

        e = f"dup{_u()}@example.com"
        db.add(row(e))
        db.flush()
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(row(f" {e.upper()} "))
                db.flush()


class TestUpdateRules:
    @pytest.mark.parametrize("body", [
        {"customer_name": None}, {"customer_name": "  "}, {"customer_name": "N" * 256}, {"email": "x"}, {"credit_days": -1},
        {"max_credit_limit": -1}, {"max_credit_limit": 2 ** 40}, {"active": None}, {"birthdate": "2999-01-01"}, {"country_id": 2 ** 40},
    ])
    def test_rejected(self, superclient, customer, body):
        assert superclient.put(f"{C}/{customer['id']}", json=body).status_code == 422

    def test_cannot_clear_required_data_or_become_business_without_company(self, superclient, customer):
        assert superclient.put(f"{C}/{customer['id']}", json={"mobile_contact_number": ""}).status_code == 422
        assert superclient.put(f"{C}/{customer['id']}", json={"customer_type": "business"}).status_code == 422

    def test_ids_are_bounded(self, superclient):
        assert superclient.get(f"{C}/{2 ** 31}").status_code == 422
        assert superclient.put(f"{C}/{2 ** 40}", json={}).status_code == 422
        assert superclient.patch(f"{C}/1/contact-persons/{2 ** 40}", json={"title": "x"}).status_code == 422

    def test_stale_version_is_409(self, superclient, customer):
        cid = customer["id"]
        assert superclient.put(f"{C}/{cid}", json={"occupation": "a", "expected_version": customer["version"]}).status_code == 200
        r = superclient.put(f"{C}/{cid}", json={"occupation": "b", "expected_version": customer["version"]})
        assert r.status_code == 409


class TestListPagingExport:
    def test_list_is_ordered_and_search_literal(self, superclient, customer):
        names = [c["customer_name"].lower() for c in superclient.get(f"{C}/", params={"limit": 100000}).json()]
        assert names == sorted(names)
        assert superclient.get(f"{C}/search", params={"q": "%"}).json() == []

    def test_paged(self, superclient):
        tag = _u()
        for i in range(5):
            assert superclient.post(f"{C}/", json=_body(customer_name=f"PG {tag} {i}")).status_code == 201
        p = superclient.get(f"{C}/paged", params={"q": tag, "size": 2, "page": 0}).json()
        assert p["total"] == 5 and p["pages"] == 3 and len(p["items"]) == 2
        names = []
        for pg in range(3):
            names += [x["customer_name"] for x in superclient.get(f"{C}/paged", params={"q": tag, "size": 2, "page": pg}).json()["items"]]
        assert names == sorted(names) and len(set(names)) == 5
        d = superclient.get(f"{C}/paged", params={"q": tag, "sort_by": "customer_name", "order": "desc", "size": 1}).json()
        assert d["items"][0]["customer_name"].endswith("4")
        assert superclient.get(f"{C}/paged", params={"q": tag, "active": "false"}).json()["total"] == 0
        assert superclient.get(f"{C}/paged", params={"size": 0}).status_code == 422
        assert superclient.get(f"{C}/paged", params={"sort_by": "x; drop table customers"}).status_code == 200

    def test_unfiltered_total_matches_list(self, superclient, customer):
        full = superclient.get(f"{C}/", params={"limit": 100000}).json()
        assert superclient.get(f"{C}/paged", params={"size": 1}).json()["total"] == len(full)

    def test_export_neutralises_formulas_and_labels_gender(self, superclient):
        n = _u()
        assert superclient.post(f"{C}/", json=_body(customer_name=f'=HYPERLINK("http://x","{n}")', gender="u")).status_code == 201
        ex = superclient.get(f"{C}/export-csv")
        assert ex.status_code == 200
        row = next(line for line in ex.text.splitlines() if n in line)
        assert "'=HYPERLINK" in row and '"=HYPERLINK' not in row
        assert ",Other," in row


class TestContactPersons:
    @pytest.fixture
    def company(self, superclient):
        r = superclient.post(f"{C}/", json=_business())
        assert r.status_code == 201, r.text
        return r.json()

    def cp(self, **kw):
        return {"title": "Mr", "full_name": f"Person {_u()}", "phone": "+94771234500", **kw}

    @pytest.mark.parametrize("body", [{"full_name": "  "}, {"full_name": "N" * 256}, {"title": " "}, {"email": "x"}, {"phone": "abc"}, {"phone": ""}, {"designation": "d" * 256}])
    def test_rejected(self, superclient, company, body):
        assert superclient.post(f"{C}/{company['id']}/contact-persons", json=self.cp(**body)).status_code == 422

    def test_update_cannot_blank_required_fields(self, superclient, company):
        c = superclient.post(f"{C}/{company['id']}/contact-persons", json=self.cp()).json()
        url = f"{C}/{company['id']}/contact-persons/{c['id']}"
        for body in ({"full_name": " "}, {"full_name": None}, {"phone": ""}, {"title": ""}):
            assert superclient.patch(url, json=body).status_code == 422, body

    def test_only_one_primary(self, superclient, company):
        for _ in range(3):
            assert superclient.post(f"{C}/{company['id']}/contact-persons", json=self.cp(is_primary=True)).status_code == 201
        items = superclient.get(f"{C}/{company['id']}/contact-persons").json()
        assert sum(1 for x in items if x["is_primary"]) == 1
        prim = next(x for x in items if x["is_primary"])
        assert superclient.patch(f"{C}/{company['id']}/contact-persons/{prim['id']}", json={"is_primary": False}).status_code == 400
