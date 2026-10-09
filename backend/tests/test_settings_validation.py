"""Settings: profile / preferences / company / currencies / email templates — validation and access."""
import pytest

S = "/api/v1/settings"
C = "/api/v1/communication"


# ================================================================ profile
class TestProfile:
    def test_response_never_contains_the_password_hash(self, superclient):
        r = superclient.put(f"{S}/profile", json={})
        assert r.status_code == 200
        body = r.json()
        assert "hashed_password" not in body and "permissions" not in body and "is_superuser" not in body
        assert set(body) <= {"id", "username", "first_name", "middle_name", "last_name", "gender", "date_joined", "birthdate"}

    @pytest.mark.parametrize("body", [
        {"first_name": "   "}, {"first_name": None}, {"first_name": "N" * 31}, {"last_name": "L" * 31}, {"gender": "g" * 31},
        {"birthdate": "2026-02-30"}, {"birthdate": "yesterday"}, {"birthdate": "2999-01-01"}, {"birthdate": "1800-01-01"},
        {"date_joined": "nope"}, {"date_joined": "2999-01-01"},
    ])
    def test_rejected(self, superclient, body):
        assert superclient.put(f"{S}/profile", json=body).status_code == 422

    def test_valid_update_and_blank_optionals(self, superclient):
        r = superclient.put(f"{S}/profile", json={"first_name": "  Ada ", "middle_name": "", "birthdate": "1990-05-04", "date_joined": ""})
        assert r.status_code == 200, r.text
        assert r.json()["first_name"] == "Ada" and r.json()["middle_name"] is None and r.json()["birthdate"] == "1990-05-04"

    def test_extra_fields_are_ignored(self, superclient):
        r = superclient.put(f"{S}/profile", json={"is_superuser": False, "username": "hacker", "email": "h@x.com"})
        assert r.status_code == 200 and r.json()["username"] != "hacker"


# ================================================================ preferences
class TestPreferences:
    @pytest.mark.parametrize("body", [
        {"theme": "neon"}, {"theme": None}, {"items_per_page": None}, {"items_per_page": 0}, {"items_per_page": -5},
        {"items_per_page": 10 ** 9}, {"items_per_page": 2 ** 40}, {"language": "x" * 11}, {"timezone": "Mars/Base"},
        {"timezone": "x" * 51}, {"default_branch": "b" * 201}, {"default_branch": "NO_SUCH_BRANCH_XYZ"},
        {"date_format": "<b>"}, {"date_format": "x" * 21}, {"currency_format": "x" * 11},
    ])
    def test_rejected(self, superclient, body):
        assert superclient.put(f"{S}/preferences", json=body).status_code in (400, 422)

    def test_valid_roundtrip_and_get_still_works(self, superclient):
        ok = {"theme": "dark", "items_per_page": 50, "timezone": "Asia/Colombo", "date_format": "DD/MM/YYYY", "currency_format": "lkr", "default_branch": "  "}
        r = superclient.put(f"{S}/preferences", json=ok)
        assert r.status_code == 200, r.text
        assert r.json()["currency_format"] == "LKR" and r.json()["default_branch"] is None
        assert superclient.get(f"{S}/preferences").status_code == 200

    def test_legacy_null_row_does_not_break_get(self, superclient, db):
        from app.modules.settings.models import UserPreferences

        assert superclient.get(f"{S}/preferences").status_code == 200
        row = db.query(UserPreferences).first()
        row.theme = None
        row.items_per_page = None
        db.flush()
        r = superclient.get(f"{S}/preferences")
        assert r.status_code == 200, r.text


# ================================================================ company settings
class TestCompanySettings:
    @pytest.mark.parametrize("body", [
        {"company_name": "   "}, {"company_name": None}, {"company_name": "N" * 256}, {"company_address": ""},
        {"company_email": ""}, {"company_email": "not-an-email"}, {"company_email": "a" * 250 + "@x.co"},
        {"company_fax_number": "1" * 13}, {"company_fax_number": "abc"},
        {"depreciation_rate": -5}, {"depreciation_rate": 1000}, {"default_tax_rate": -1}, {"default_tax_rate": 150},
        {"amex_card_surcharge": -3}, {"visa_card_surcharge": 500}, {"master_card_surcharge": None},
        {"number_of_annual_leaves": -1}, {"number_of_annual_leaves": 99999}, {"number_of_casual_leaves": 2 ** 40},
        {"fiscal_year_start": "hello"}, {"fiscal_year_start": "13-45"}, {"fiscal_year_start": "02-30"}, {"fiscal_year_start": "x" * 11},
        {"default_currency": "LKRR"}, {"default_currency": "12"}, {"default_timezone": "Mars/Base"},
        {"tax_registration_number": "T" * 51}, {"company_logo_id": -1}, {"company_logo_id": 2 ** 40},
        {"passcode_expiry_days": 0}, {"passcode_expiry_days": 31},
    ])
    def test_rejected(self, superclient, body):
        assert superclient.put(f"{S}/company", json=body).status_code in (400, 422), body

    def test_default_currency_must_be_a_configured_active_currency(self, superclient):
        r = superclient.put(f"{S}/company", json={"default_currency": "QQQ"})
        assert r.status_code == 400

    def test_valid_update_is_trimmed_and_visible(self, superclient):
        before = superclient.get(f"{S}/company").json()
        r = superclient.put(f"{S}/company", json={"company_name": "  Tijaero QA  ", "default_tax_rate": 12.5, "fiscal_year_start": "04-01"})
        assert r.status_code == 200, r.text
        assert r.json()["company_name"] == "Tijaero QA" and r.json()["default_tax_rate"] == 12.5
        superclient.put(f"{S}/company", json={"company_name": before["company_name"], "default_tax_rate": before["default_tax_rate"], "fiscal_year_start": before["fiscal_year_start"]})


# ================================================================ currencies
class TestCurrencies:
    def test_create_rules(self, superclient):
        post = lambda b: superclient.post(f"{S}/currencies", json=b).status_code
        assert post({"code": "123", "name": "digits", "symbol": "1"}) == 422
        assert post({"code": "!@#", "name": "sym", "symbol": "x"}) == 422
        assert post({"code": "QAB", "name": "  ", "symbol": "x"}) == 422
        assert post({"code": "QAC", "name": "N" * 101, "symbol": "x"}) == 422
        assert post({"code": "QAD", "name": "x", "symbol": ""}) == 422
        assert post({"code": "QAE", "name": "x", "symbol": "S" * 11}) == 422
        assert post({"code": "AB", "name": "x", "symbol": "x"}) == 422

    def test_code_is_uppercased_and_duplicates_are_400(self, superclient):
        r = superclient.post(f"{S}/currencies", json={"code": "qaq", "name": " QA Cur ", "symbol": "Q"})
        assert r.status_code == 200, r.text
        assert r.json()["code"] == "QAQ" and r.json()["name"] == "QA Cur"
        assert superclient.post(f"{S}/currencies", json={"code": "QAQ", "name": "dup", "symbol": "Q"}).status_code == 400
        cid = r.json()["id"]
        assert superclient.put(f"{S}/currencies/{cid}", json={"name": " "}).status_code == 422
        assert superclient.put(f"{S}/currencies/{cid}", json={"name": None}).status_code == 422
        assert superclient.put(f"{S}/currencies/{cid}", json={"is_active": None}).status_code == 422
        assert superclient.delete(f"{S}/currencies/{cid}").status_code == 200

    def test_active_currency_cannot_be_deactivated_or_deleted(self, superclient):
        active = superclient.get(f"{S}/company").json()["default_currency"]
        row = next(c for c in superclient.get(f"{S}/currencies").json() if c["code"] == active)
        assert superclient.put(f"{S}/currencies/{row['id']}", json={"is_active": False}).status_code == 400
        assert superclient.delete(f"{S}/currencies/{row['id']}").status_code == 400

    def test_ids_are_bounded(self, superclient):
        assert superclient.put(f"{S}/currencies/{2 ** 40}", json={"name": "x"}).status_code == 422
        assert superclient.delete(f"{S}/currencies/{2 ** 40}").status_code == 422
        assert superclient.put(f"{S}/currencies/active/{'A' * 300}").status_code == 422


# ================================================================ notifications
def test_notification_ids_and_paging_are_bounded(superclient):
    assert superclient.put(f"{S}/notifications/{2 ** 40}/read").status_code == 422
    assert superclient.delete(f"{S}/notifications/{2 ** 40}").status_code == 422
    assert superclient.get(f"{S}/notifications", params={"skip": 2 ** 40}).status_code == 422
    assert superclient.get(f"{S}/notifications", params={"limit": 100000}).status_code == 422
    assert superclient.get(f"{S}/notifications", params={"limit": 50}).status_code == 200


# ================================================================ email templates / logs / draft
class TestEmailTemplates:
    @pytest.fixture
    def template(self, superclient):
        t = superclient.get(f"{C}/email/templates").json()[0]
        yield t
        superclient.put(f"{C}/email/templates/{t['id']}", json={"subject_template": t["subject_template"], "body_template": t["body_template"]})

    @pytest.mark.parametrize("body", [
        {"subject_template": "   "}, {"body_template": ""}, {"subject_template": "S" * 256}, {"body_template": "B" * 20001},
        {"subject_template": "Hi {nonexistent}"}, {"subject_template": "Hi {title"}, {"body_template": "Dear {name}}"},
    ])
    def test_rejected(self, superclient, template, body):
        assert superclient.put(f"{C}/email/templates/{template['id']}", json=body).status_code == 422

    def test_known_tags_accepted_and_id_bounded(self, superclient, template):
        ok = {"subject_template": "Doc #{document_id}", "body_template": "Dear {title} {name}, from {company_name}"}
        assert superclient.put(f"{C}/email/templates/{template['id']}", json=ok).status_code == 200
        assert superclient.put(f"{C}/email/templates/{2 ** 40}", json=ok).status_code == 422


class TestEmailAccess:
    def test_user_without_settings_permission_is_refused(self, api, make_user):
        _u, token = make_user(permissions=[])
        c = api(token)
        assert c.get(f"{C}/email/logs").status_code == 403
        assert c.get(f"{C}/email/templates").status_code == 403
        assert c.put(f"{C}/email/templates/1", json={"subject_template": "x"}).status_code == 403

    def test_view_permission_cannot_edit_templates(self, api, make_user):
        _u, token = make_user(permissions=[("settings", "view")])
        c = api(token)
        assert c.get(f"{C}/email/templates").status_code == 200
        assert c.put(f"{C}/email/templates/1", json={"subject_template": "x"}).status_code == 403

    def test_draft_and_send_need_the_document_permission(self, api, make_user):
        _u, token = make_user(permissions=[])
        c = api(token)
        assert c.get(f"{C}/email-draft/invoice/1").status_code == 403
        body = {"document_type": "invoice", "document_id": 1, "display_id": "INV-1", "to_email": "a@b.co", "subject": "s", "body": "b"}
        assert c.post(f"{C}/email/send", json=body, headers={"Authorization": f"Bearer {token}"}).status_code == 403

    def test_draft_input_bounds(self, superclient):
        assert superclient.get(f"{C}/email-draft/bogus/1").status_code == 422
        assert superclient.get(f"{C}/email-draft/invoice/{2 ** 40}").status_code == 422
        assert superclient.get(f"{C}/email-draft/invoice/999999999").status_code == 404

    def test_send_request_is_bounded(self, superclient):
        base = {"document_type": "invoice", "document_id": 1, "display_id": "INV-1", "to_email": "a@b.co", "subject": "s", "body": "b"}
        for patch in ({"subject": "S" * 256}, {"body": "B" * 50001}, {"display_id": "D" * 201}, {"document_type": "x"}, {"document_id": 2 ** 40}, {"subject": " "}):
            assert superclient.post(f"{C}/email/send", json={**base, **patch}).status_code == 422, patch


def test_full_settings_roundtrip_with_nulls_is_accepted(superclient):
    """Regression: PUT of the whole GET body (nullable fields as null) must work."""
    cur = superclient.get(f"{S}/company").json()
    r = superclient.put(f"{S}/company", json={k: v for k, v in cur.items() if k != "id"})
    assert r.status_code == 200, r.text
