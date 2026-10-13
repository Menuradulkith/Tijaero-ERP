"""Regression tests for the Low findings of the 2026-10-11 masters API QA (#7-#17, #25)."""
import io
import struct
import uuid
import zlib
from pathlib import Path

import pytest

from app.core.config import settings
from app.core.password_policy import validate_password_strength

S = "/api/v1/purchasing"
C = "/api/v1/customers"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _supplier_body(**kw):
    return {"company_name": f"QA Sup {_u()}", "mobile_contact_number": "+94771234567",
            "billing_address_line1": "1 Road", **kw}


def _cust(**kw):
    u = _u()
    b = {"customer_type": "individual", "customer_name": f"QA Cust {u}", "title": "Mr", "gender": "m",
         "civil_status": "single", "no_of_kids": "0", "mobile_contact_number": "+94771234567",
         "email": f"qa.{u}@example.com"}
    b.update(kw)
    return b


@pytest.fixture
def supplier(superclient):
    r = superclient.post(f"{S}/suppliers", json=_supplier_body())
    assert r.status_code == 201, r.text
    return r.json()


def _png() -> bytes:
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    raw = b"\x00\xff\x00\x00"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class TestSupplierFindings:
    def test_mapping_on_inactive_supplier_is_400(self, superclient, supplier):  # #7
        sid = supplier["id"]
        assert superclient.patch(f"{S}/suppliers/{sid}", json={"active": False}).status_code == 200
        r = superclient.post(f"{S}/suppliers/{sid}/products", json={"product_id": 1, "cost_price": 1})
        assert r.status_code == 400 and "inactive" in r.json()["detail"]

    @pytest.mark.parametrize("body,field", [
        ({"company_name": None}, "company_name"), ({"mobile_contact_number": None}, "mobile_contact_number"),
        ({"mobile_contact_number": ""}, "mobile_contact_number"), ({"billing_address_line1": None}, "billing_address_line1"),
        ({"active": None}, "active"),
    ])
    def test_patch_null_required_is_422_with_field(self, superclient, supplier, body, field):  # #8
        r = superclient.patch(f"{S}/suppliers/{supplier['id']}", json=body)
        assert r.status_code == 422, r.text
        assert any(field in m["field"] for m in r.json()["messages"])

    def test_contact_and_mapping_null_is_422(self, superclient, supplier):  # #8
        sid = supplier["id"]
        c = superclient.post(f"{S}/suppliers/{sid}/contact-persons",
                             json={"title": "Mr", "full_name": "QA P", "phone": "+94771234500"}).json()
        r = superclient.patch(f"{S}/suppliers/{sid}/contact-persons/{c['id']}", json={"full_name": None})
        assert r.status_code == 422 and any("full_name" in m["field"] for m in r.json()["messages"])
        r = superclient.patch(f"{S}/suppliers/{sid}/products/1", json={"cost_price": None})
        assert r.status_code == 422 and any("cost_price" in m["field"] for m in r.json()["messages"])

    @pytest.mark.parametrize("body", [{"title": None}, {"title": ""}, {"phone": None}, {"phone": ""}])
    def test_contact_update_requires_title_and_phone(self, superclient, supplier, body):  # #9
        sid = supplier["id"]
        c = superclient.post(f"{S}/suppliers/{sid}/contact-persons",
                             json={"title": "Mr", "full_name": "QA P", "phone": "+94771234500"}).json()
        assert superclient.patch(f"{S}/suppliers/{sid}/contact-persons/{c['id']}", json=body).status_code == 422
        assert superclient.patch(f"{S}/suppliers/{sid}/contact-persons/{c['id']}", json={"occupation": "x"}).status_code == 200

    def test_currency_must_be_active(self, superclient, db):  # #25
        from app.modules.settings.models import Currency
        code = "QZX"
        if not db.query(Currency).filter(Currency.code == code).first():
            db.add(Currency(code=code, name="QA inactive", symbol="q", is_active=False))
            db.flush()
        r = superclient.post(f"{S}/suppliers", json=_supplier_body(default_currency=code))
        assert r.status_code == 400 and "active" in r.json()["detail"]


class TestPasswordPolicy:  # #10
    @pytest.mark.parametrize("pw", ["Password123!", "Admin123!", "WELCOME1!", "Qauserx#2026!"])
    def test_rejected(self, pw):
        with pytest.raises(ValueError):
            validate_password_strength(pw, "qauserx")

    def test_short_username_not_checked_and_good_password_ok(self):
        assert validate_password_strength("Zq9!kLm#2026", "zq") == "Zq9!kLm#2026"
        assert validate_password_strength("Zq9!kLm#2026", "qauserx")


class TestCustomerFindings:
    def test_export_has_new_columns(self, superclient):  # #12
        r = superclient.post(f"{C}/", json=_cust(bank_name="QA Bank", bank_swift_code="QAQAQAQA", default_currency="LKR"))
        assert r.status_code in (201, 400), r.text  # 400 only if LKR is not an active currency here
        if r.status_code == 400:
            r = superclient.post(f"{C}/", json=_cust(bank_name="QA Bank", bank_swift_code="QAQAQAQA"))
            assert r.status_code == 201, r.text
        text = superclient.get(f"{C}/export-csv").text
        header = text.splitlines()[0]
        for col in ("Customer No", "Bank Account Name", "Bank Name", "Bank Account No", "Bank Branch",
                    "Bank Branch Code", "Bank SWIFT Code", "Billing Country", "Shipping Country", "Currency"):
            assert col in header
        assert header.split(",")[0] == "Title" and header.split(",")[23] == "Updated At"
        assert "QAQAQAQA" in text

    def test_business_to_individual_with_contacts_is_400(self, superclient):  # #14
        c = superclient.post(f"{C}/", json=_cust(customer_type="business", company_name=f"QA Co {_u()}",
                                                 title=None, gender=None, civil_status=None, no_of_kids=None)).json()
        assert superclient.post(f"{C}/{c['id']}/contact-persons",
                                json={"title": "Mr", "full_name": "QA P", "phone": "+94771234500"}).status_code == 201
        r = superclient.put(f"{C}/{c['id']}", json={"customer_type": "individual", "title": "Mr", "gender": "m",
                                                    "civil_status": "single", "no_of_kids": "0"})
        assert r.status_code == 400 and "contact persons" in r.json()["detail"]


class TestCrossCutting:
    def test_openapi_json_is_200(self, client):  # #16
        r = client.get("/api/v1/openapi.json")
        assert r.status_code == 200 and "paths" in r.json()
        assert client.get("/docs").status_code == 200

    def test_security_headers_on_authenticated_api(self, superclient):  # #17
        r = superclient.get(f"{C}/")
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["cache-control"] == "no-store"

    def test_docs_not_touched(self, client):
        assert "x-frame-options" not in client.get("/docs").headers


class TestProfilePictureFiles:  # #15
    def test_replacing_picture_leaves_one_file(self, superclient, make_user):
        user, _ = make_user()
        root = Path(settings.UPLOAD_DIR)
        paths = []
        for _i in range(3):
            r = superclient.post(f"/api/v1/users/{user.id}/profile-picture",
                                 files={"file": ("a.png", io.BytesIO(_png()), "image/png")})
            assert r.status_code == 200, r.text
            paths.append(r.json()["profile_picture_path"])
        assert (root / paths[-1]).is_file()
        assert not any((root / p).exists() for p in paths[:-1])
        assert superclient.delete(f"/api/v1/users/{user.id}/profile-picture").status_code == 200
        assert not (root / paths[-1]).exists()

    def test_file_removed_when_db_write_fails(self, superclient, make_user, monkeypatch):
        user, _ = make_user()
        root = Path(settings.UPLOAD_DIR) / "users"
        before = set(root.glob("*")) if root.exists() else set()
        from sqlalchemy.orm import Session

        def boom(self, *a, **k):
            raise RuntimeError("db down")
        monkeypatch.setattr(Session, "commit", boom)
        try:
            superclient.post(f"/api/v1/users/{user.id}/profile-picture",
                             files={"file": ("a.png", io.BytesIO(_png()), "image/png")})
        except RuntimeError:
            pass
        monkeypatch.undo()
        after = set(root.glob("*")) if root.exists() else set()
        assert after == before
