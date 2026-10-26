"""Document print templates (Settings → Print Templates).

* the default lookup: branch default, then company default, then the built-in layout;
* layout settings change how a document looks, never what it says (texts are escaped,
  the logo and colour are format-checked, the print-preview toggles still win);
* custom HTML needs its own permission, must print the document's key fields, runs in a
  sandbox, and falls back to the built-in layout when it fails;
* every save is versioned and can be restored; one default per document type and branch.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.modules.purchasing import schemas as po_schemas
from app.modules.purchasing import service as po_service
from app.modules.reporting.models import DocumentTemplate

BASE = "/api/v1/reporting/print-templates"
PO_FIELDS = "{{ po.purchasing_order_no }} {{ po.purchasing_order_date }} {{ subtotal }}"


@pytest.fixture(autouse=True)
def _no_existing_templates(db):
    """Start from the built-in layouts whatever the dev database holds (rolled back after)."""
    db.query(DocumentTemplate).delete()
    db.flush()


@pytest.fixture
def approved_po(db, make_branch, make_supplier, make_product):
    branch, supplier, product = make_branch(), make_supplier(), make_product()
    svc = po_service.PurchasingOrderService(db)
    order = svc.create_order(
        po_schemas.PurchasingOrderCreate(
            branch_code=branch.branch_code, payment_method="non_credit",
            purchasing_order_date=date.today(), good_received_note_date=date.today(),
            first_suppliers_id=supplier.id,
            items=[po_schemas.PurchasingOrderItemCreate(
                product_id=product.id, quantity=2, unit_price=Decimal("150.00"), warrenty_month="12")],
        ),
        created_by=1,
    )
    svc.approve_order(order.id, True, user_id=1)
    return order, branch


def _create(client, **overrides):
    body = {"document_type": "purchase-order", "name": "Standard", "is_default": True, "settings": {}}
    body.update(overrides)
    r = client.post(BASE, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _print(client, order, **params):
    return client.get(f"/api/v1/reporting/documents/purchase-order/{order.id}", params=params)


class TestDefaultLookup:
    def test_without_templates_the_built_in_layout_prints(self, superclient, approved_po):
        order, _ = approved_po
        r = _print(superclient, order)
        assert r.status_code == 200
        assert "X-Print-Template" not in r.headers
        assert order.purchasing_order_no in r.text

    def test_company_default_applies(self, superclient, approved_po):
        order, _ = approved_po
        t = _create(superclient, settings={"primary_color": "#aa0000", "footer_text": "Thank you for your business"})
        r = _print(superclient, order)
        assert r.headers["X-Print-Template"] == f"{t['id']}:1"
        assert "--doc-primary:#aa0000" in r.text
        assert "Thank you for your business" in r.text

    def test_branch_default_beats_company_default(self, superclient, approved_po):
        order, branch = approved_po
        _create(superclient, name="Company", settings={"footer_text": "COMPANY FOOTER"})
        b = _create(superclient, name="Branch", branch_code=branch.branch_code, settings={"footer_text": "BRANCH FOOTER"})
        r = _print(superclient, order)
        assert r.headers["X-Print-Template"].startswith(f"{b['id']}:")
        assert "BRANCH FOOTER" in r.text and "COMPANY FOOTER" not in r.text

    def test_explicit_template_must_match_the_document_type(self, superclient, approved_po):
        order, _ = approved_po
        other = _create(superclient, document_type="grn", name="GRN layout",
                        custom_html=None, is_default=False)
        assert _print(superclient, order, template_id=other["id"]).status_code == 404

    def test_preview_toggles_override_the_template(self, superclient, approved_po):
        order, _ = approved_po
        _create(superclient, settings={"show_signatures": False})
        hidden = _print(superclient, order).text
        shown = _print(superclient, order, show_signatures=True).text
        assert len(shown) > len(hidden)

    def test_only_one_default_per_type_and_branch(self, superclient, db):
        first = _create(superclient, name="One")
        second = _create(superclient, name="Two")
        db.expire_all()
        assert db.get(DocumentTemplate, first["id"]).is_default is False
        assert db.get(DocumentTemplate, second["id"]).is_default is True


class TestDocumentHeader:
    """No placeholder header: the built-in layouts used to print the invoice stationery
    image as a "logo" plus a default address / Tel / E-mail line."""

    def test_built_in_layout_has_no_placeholder_header(self, superclient, approved_po):
        order, _ = approved_po
        html = _print(superclient, order, show_header=True).text
        assert 'class="logo"' not in html
        assert "Tel / Fax" not in html and 'class="addr"' not in html
        assert "data:image/jpeg" not in html

    def test_template_logo_and_contact_details_still_print(self, superclient, approved_po):
        order, _ = approved_po
        logo = "data:image/png;base64,iVBORw0KGgo="
        _create(superclient, settings={"logo": logo, "company_address": "12 Main Street", "company_phone": "011 222 3333"})
        html = _print(superclient, order).text
        assert f'src="{logo}"' in html
        assert "12 Main Street" in html and "Tel: 011 222 3333" in html

    def test_header_switch_still_hides_it(self, superclient, approved_po):
        order, _ = approved_po
        _create(superclient, settings={"company_address": "12 Main Street"})
        assert "12 Main Street" not in _print(superclient, order, show_header=False).text


class TestLayoutSafety:
    def test_texts_are_escaped(self, superclient, approved_po):
        order, _ = approved_po
        _create(superclient, settings={"terms": "<script>alert(1)</script>"})
        text = _print(superclient, order).text
        assert "<script>alert(1)</script>" not in text
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in text

    @pytest.mark.parametrize("logo", [
        "https://evil.example/logo.png",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,AAAA';alert(1);'",
    ])
    def test_logo_must_be_an_inline_raster_image(self, superclient, logo):
        r = superclient.post(BASE, json={"document_type": "invoice", "name": "x", "settings": {"logo": logo}})
        assert r.status_code == 422

    def test_colour_must_be_a_hex_value(self, superclient):
        r = superclient.post(BASE, json={"document_type": "invoice", "name": "x", "settings": {"primary_color": "red;}body{display:none"}})
        assert r.status_code == 422

    def test_unknown_settings_are_rejected(self, superclient):
        r = superclient.post(BASE, json={"document_type": "invoice", "name": "x", "settings": {"grand_total": 0}})
        assert r.status_code == 422


class TestCustomHtml:
    def test_requires_the_edit_html_permission(self, api, make_user):
        _, token = make_user(permissions=[("print_templates", "view"), ("print_templates", "create")])
        r = api(token).post(BASE, json={"document_type": "purchase-order", "name": "x",
                                        "custom_html": f"<p>{PO_FIELDS}</p>"})
        assert r.status_code == 403

    def test_layout_only_editors_can_still_save_other_changes(self, api, make_user, superclient):
        t = _create(superclient, custom_html=f"<p>{PO_FIELDS}</p>", is_default=False)
        _, token = make_user(permissions=[("print_templates", "update")])
        body = {"name": "Renamed", "custom_html": t["custom_html"], "settings": {}}
        r = api(token).put(f"{BASE}/{t['id']}", json=body)
        assert r.status_code == 200 and r.json()["name"] == "Renamed"

    def test_must_print_the_key_fields(self, superclient):
        r = superclient.post(BASE, json={"document_type": "purchase-order", "name": "x",
                                         "custom_html": "<p>{{ po.purchasing_order_no }}</p>"})
        assert r.status_code == 422 and "subtotal" in r.json()["detail"]

    def test_syntax_errors_are_rejected(self, superclient):
        r = superclient.post(BASE, json={"document_type": "purchase-order", "name": "x",
                                         "custom_html": "{% if %}" + PO_FIELDS})
        assert r.status_code == 422 and "syntax" in r.json()["detail"].lower()

    def test_custom_html_prints_with_a_strict_csp(self, superclient, approved_po):
        order, _ = approved_po
        _create(superclient, custom_html=f"<html><head></head><body><h1>MY LAYOUT</h1>{PO_FIELDS}</body></html>")
        r = _print(superclient, order)
        assert "MY LAYOUT" in r.text and order.purchasing_order_no in r.text
        assert "script-src 'none'" in r.headers["Content-Security-Policy"]

    def test_sandbox_escape_falls_back_to_the_built_in_layout(self, superclient, approved_po):
        order, _ = approved_po
        _create(superclient, custom_html="{{ po.__class__.__mro__[1].__subclasses__() }}" + PO_FIELDS)
        r = _print(superclient, order)
        assert r.status_code == 200
        assert r.headers.get("X-Print-Template-Fallback") == "1"
        assert "Content-Security-Policy" not in r.headers
        assert "subclasses" not in r.text


class TestVersions:
    def test_every_save_is_versioned_and_restorable(self, superclient):
        t = _create(superclient, settings={"footer_text": "v1"})
        body = {"name": "Standard", "settings": {"footer_text": "v2"}, "expected_version": 1}
        r = superclient.put(f"{BASE}/{t['id']}", json=body)
        assert r.status_code == 200 and r.json()["version"] == 2

        versions = superclient.get(f"{BASE}/{t['id']}/versions").json()
        assert [v["version"] for v in versions] == [2, 1]

        r = superclient.post(f"{BASE}/{t['id']}/versions/1/restore")
        assert r.status_code == 200
        assert r.json()["version"] == 3 and r.json()["settings"]["footer_text"] == "v1"

    def test_stale_saves_are_refused(self, superclient):
        t = _create(superclient)
        superclient.put(f"{BASE}/{t['id']}", json={"name": "A", "settings": {}, "expected_version": 1})
        r = superclient.put(f"{BASE}/{t['id']}", json={"name": "B", "settings": {}, "expected_version": 1})
        assert r.status_code == 409


class TestAccess:
    def test_viewing_templates_needs_permission(self, api, make_user):
        _, token = make_user(permissions=[("settings", "view")])
        assert api(token).get(BASE).status_code == 403

    def test_branch_templates_need_branch_access(self, api, make_user, make_branch):
        _, token = make_user(permissions=[("print_templates", "create")], branches=[make_branch()])
        other = make_branch()
        r = api(token).post(BASE, json={"document_type": "invoice", "name": "x", "branch_code": other.branch_code})
        assert r.status_code == 403

    def test_preview_renders_a_draft_without_saving(self, superclient, approved_po, db):
        order, _ = approved_po
        before = db.query(DocumentTemplate).count()
        r = superclient.post(f"{BASE}/preview", json={
            "document_type": "purchase-order", "document_id": order.id,
            "settings": {"header_text": "DRAFT HEADER"},
        })
        assert r.status_code == 200 and "DRAFT HEADER" in r.text
        assert db.query(DocumentTemplate).count() == before

    def test_preview_respects_the_print_gate(self, superclient, db, make_branch, make_supplier, make_product):
        branch, supplier, product = make_branch(), make_supplier(), make_product()
        pending = po_service.PurchasingOrderService(db).create_order(
            po_schemas.PurchasingOrderCreate(
                branch_code=branch.branch_code, payment_method="non_credit",
                purchasing_order_date=date.today(), good_received_note_date=date.today(),
                first_suppliers_id=supplier.id,
                items=[po_schemas.PurchasingOrderItemCreate(
                    product_id=product.id, quantity=1, unit_price=Decimal("10.00"), warrenty_month="12")],
            ),
            created_by=1,
        )
        r = superclient.post(f"{BASE}/preview", json={"document_type": "purchase-order", "document_id": pending.id})
        assert r.status_code == 400

    def test_every_document_type_has_a_pdf(self, superclient, approved_po):
        order, _ = approved_po
        _create(superclient, paper_size="A5", orientation="landscape")
        try:
            r = superclient.get(f"/api/v1/reporting/documents/purchase-order/{order.id}/pdf")
        except Exception as exc:  # pragma: no cover - environment without Chromium
            pytest.skip(f"Chromium not available: {exc}")
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/pdf"
        assert r.content.startswith(b"%PDF")

    def test_print_dialog_gets_the_documents_templates(self, superclient, approved_po, api, make_user):
        order, branch = approved_po
        company = _create(superclient, name="Company", settings={"show_signatures": False})
        mine = _create(superclient, name="Branch", branch_code=branch.branch_code, is_default=False)
        r = superclient.get(f"{BASE}/for-document", params={"document_type": "purchase-order", "document_id": order.id})
        assert r.status_code == 200
        data = r.json()
        assert data["default_template_id"] == company["id"] and data["show_signatures"] is False
        assert {t["id"] for t in data["templates"]} >= {company["id"], mine["id"]}

        _, token = make_user(permissions=[("print_templates", "view")])
        r = api(token).get(f"{BASE}/for-document", params={"document_type": "purchase-order", "document_id": order.id})
        assert r.status_code == 403

    def test_unknown_document_type_is_404(self, superclient):
        assert superclient.get("/api/v1/reporting/documents/not-a-doc/1").status_code == 404


def test_payroll_summary_prints(superclient):
    r = superclient.get("/api/v1/reporting/documents/payroll")
    assert r.status_code == 200 and "<html" in r.text.lower()
