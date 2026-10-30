"""Standard document layouts (templates/standard/document.html + app/reporting/documents.py).

* every document type prints with the shared letterhead layout, no made-up company details;
* a tax invoice carries the IRD particulars and its totals foot to the stored figures;
* GRN quantities come from the goods-received lines (a batch row is not "1");
* payroll prints the real payroll run for a month, not a demo calculation;
* company logo / BRN / bank details print; the logo is not part of the settings payload;
* the invoice can still use the pre-printed stationery layout.
"""

from decimal import Decimal

import pytest
from sqlalchemy import func, text

from app.reporting import documents
from app.reporting.document_reports import get_document_report_service
from app.reporting.print_templates import DOCUMENT_TYPES

DOCS = "/api/v1/reporting/documents"
LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


class TestAmountInWords:
    @pytest.mark.parametrize("amount,words", [
        (0, "Rupees Zero Only"),
        (1, "Rupees One Only"),
        (15, "Rupees Fifteen Only"),
        (101, "Rupees One Hundred and One Only"),
        ("1250.50", "Rupees One Thousand Two Hundred and Fifty and Cents Fifty Only"),
        (1_000_000, "Rupees One Million Only"),
        ("2147483647.99", "Rupees Two Billion One Hundred and Forty-Seven Million Four Hundred and Eighty-Three Thousand "
                          "Six Hundred and Forty-Seven and Cents Ninety-Nine Only"),
        (-5, "Minus Rupees Five Only"),
    ])
    def test_lkr(self, amount, words):
        assert documents.amount_in_words(amount, "LKR") == words

    def test_other_currency(self):
        assert documents.amount_in_words("10.05", "USD") == "Dollars Ten and Cents Five Only"


def _sample(db, sql):
    row = db.execute(text(sql)).scalar()
    if row is None:
        pytest.skip("no sample document in this database")
    return row


class TestEveryDocument:
    SAMPLES = {
        "invoice": "select id from invoices where status and approval_status in ('approved','completed') order by id desc limit 1",
        "quotation": "select id from sales_quotes order by id desc limit 1",
        "credit-note": "select id from sale_return where status='processed' order by id desc limit 1",
        "purchase-order": "select id from purchasing_orders order by id desc limit 1",
        "grn": "select id from good_received_note order by id desc limit 1",
        "purchase-return": "select id from purchasing_return order by id desc limit 1",
        "expense": "select id from expenses order by id desc limit 1",
        "item-transfer-note": "select id from item_transfer_note order by id desc limit 1",
        "journal-entry": "select id from journal_entries order by id desc limit 1",
        "voucher": "select id from customer_gift_voucher order by id desc limit 1",
    }

    @pytest.mark.parametrize("key", sorted(SAMPLES))
    def test_prints_with_the_standard_layout(self, db, key):
        doc_id = _sample(db, self.SAMPLES[key])
        html = getattr(get_document_report_service(db), DOCUMENT_TYPES[key].method)(doc_id)
        assert 'class="lh-title"' in html  # shared letterhead layout
        for fake in ("Ground Floor, Galle Road", "0112081667", "info@tijaeroerp.com", "108124245-7000"):
            assert fake not in html

    def test_payroll_period(self, db):
        html = get_document_report_service(db).generate_payroll_report(period="1999-01")
        assert "PAYROLL SUMMARY" in html and "January 1999" in html
        assert "No payroll has been run for this period." in html

    def test_payroll_rejects_a_bad_period(self, superclient):
        assert superclient.get(f"{DOCS}/payroll", params={"period": "2026-13"}).status_code == 422


class TestTaxInvoice:
    def test_particulars_and_totals(self, db):
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        invoices = (
            db.query(Invoice)
            .filter(Invoice.status.is_(True), Invoice.approval_status.in_(("approved", "completed")))
            .order_by(Invoice.id.desc())
            .limit(60)
            .all()
        )
        if not invoices:
            pytest.skip("no invoices")
        company = documents.company_profile(db)
        for inv in invoices:
            customer = db.get(Customer, inv.customer_id) if inv.customer_id else None
            doc = documents.build_invoice(db, inv, customer, company)
            totals = {t["label"]: t["value"] for t in doc["totals"]}
            tax = documents.money(inv.tax_amount)
            if tax > 0:
                assert doc["title"] == "TAX INVOICE"
                assert totals["Value excluding VAT"] == documents.money(inv.subtotal)
                meta = dict(doc["meta"])
                assert "Invoice date" in meta and "Date of supply" in meta
            grand_label = "Amount payable" if "Amount payable" in totals else ("Total including VAT" if doc["title"] == "TAX INVOICE" else "Total")
            assert totals[grand_label] == documents.money(inv.grand_total), inv.invoice_no
            assert doc["amount_in_words"].endswith("Only")

    def test_tin_numbers_print(self, db, superclient):
        from app.modules.settings.models import Settings

        inv_id = _sample(db, "select i.id from invoices i join customers c on c.id=i.customer_id "
                             "where i.status and i.approval_status in ('approved','completed') and i.tax_amount > 0 limit 1")
        settings = db.query(Settings).first()
        settings.tax_registration_number = "123456789"
        db.flush()
        html = superclient.get(f"{DOCS}/invoice/{inv_id}", params={"show_header": True}).text
        assert "TAX INVOICE" in html and "123456789" in html and "Amount in words" in html


class TestGrnQuantities:
    def test_lines_match_goods_received(self, db):
        from app.modules.purchasing.models import GoodReceivedItems, GoodReceivedNote, PurchasingOrder

        grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.status == "posted").order_by(GoodReceivedNote.id.desc()).first()
        if grn is None:
            pytest.skip("no GRN")
        po = db.get(PurchasingOrder, grn.purchasingorders_id)
        expected = db.query(func.coalesce(func.sum(GoodReceivedItems.quantity), 0)).filter(
            GoodReceivedItems.good_received_note == grn.good_received_no).scalar()
        doc = documents.build_grn(db, grn, po, None, documents.branch_profile(db, grn.branch_code), documents.company_profile(db))
        assert sum(r["qty"] for r in doc["lines"]) == expected == doc["column_totals"]["qty"]


class TestCompanyDetails:
    def test_logo_has_its_own_endpoint(self, superclient):
        assert superclient.put("/api/v1/settings/company/logo", json={"logo": LOGO}).status_code == 200
        assert superclient.get("/api/v1/settings/company/logo").json()["logo"] == LOGO
        body = superclient.get("/api/v1/settings/company").json()
        assert body["has_company_logo"] is True and "company_logo" not in body

    @pytest.mark.parametrize("logo", ["data:image/svg+xml;base64,PHN2Zz4=", "https://x/logo.png", "data:image/png;base64,AA';alert(1)"])
    def test_logo_must_be_an_inline_raster_image(self, superclient, logo):
        assert superclient.put("/api/v1/settings/company/logo", json={"logo": logo}).status_code == 422

    def test_logo_needs_settings_update(self, api, make_user):
        _, token = make_user(permissions=[("settings", "view")])
        assert api(token).put("/api/v1/settings/company/logo", json={"logo": LOGO}).status_code == 403

    def test_details_print_on_documents_and_reports(self, superclient, db):
        po_id = _sample(db, "select id from purchasing_orders where status in ('approved','completed','partially_completed') order by id desc limit 1")
        r = superclient.put("/api/v1/settings/company", json={"business_registration_number": "PV 12345", "company_website": "www.example.lk"})
        assert r.status_code == 200
        superclient.put("/api/v1/settings/company/logo", json={"logo": LOGO})
        html = superclient.get(f"{DOCS}/purchase-order/{po_id}", params={"show_header": True}).text
        assert "PV 12345" in html and "www.example.lk" in html and LOGO in html
        export = superclient.post("/api/v1/reporting/center/reports/hr.headcount/export", json={"format": "html"}).text
        assert LOGO in export

    def test_bank_details_print_when_a_balance_is_due(self, superclient, db):
        inv_id = _sample(db, "select id from invoices where status and approval_status in ('approved','completed') and balance_due > 0 limit 1")
        superclient.put("/api/v1/settings/company", json={"bank_account_number": "0012345678", "bank_name": "QA Bank"})
        html = superclient.get(f"{DOCS}/invoice/{inv_id}").text
        assert "Payment details" in html and "0012345678" in html


class TestLayouts:
    def _template(self, client, doc_type, **settings):
        return client.post("/api/v1/reporting/print-templates", json={
            "document_type": doc_type, "name": "QA layout", "is_default": True, "settings": settings})

    def test_invoice_can_use_the_preprinted_stationery(self, superclient, db):
        from app.modules.reporting.models import DocumentTemplate

        db.query(DocumentTemplate).delete()
        inv_id = _sample(db, "select id from invoices where status and approval_status in ('approved','completed') limit 1")
        assert self._template(superclient, "invoice", layout_style="preprinted").status_code == 201
        html = superclient.get(f"{DOCS}/invoice/{inv_id}").text
        assert 'class="invoice-bg"' in html and 'class="lh-title"' not in html

    @pytest.mark.parametrize("doc_type,style", [("purchase-order", "preprinted"), ("invoice", "nope")])
    def test_unknown_layout_is_rejected(self, superclient, doc_type, style):
        assert self._template(superclient, doc_type, layout_style=style).status_code == 422

    def test_custom_html_can_use_the_standard_data(self, superclient, db):
        from app.modules.reporting.models import DocumentTemplate

        db.query(DocumentTemplate).delete()
        po_id = _sample(db, "select id from purchasing_orders where status in ('approved','completed','partially_received','received') limit 1")
        html = "<h1>{{ doc.title }} {{ doc.number }}</h1>{% for t in doc.totals %}<p>{{ t.label }} {{ t.value|money }}</p>{% endfor %}"
        r = superclient.post("/api/v1/reporting/print-templates", json={
            "document_type": "purchase-order", "name": "QA html", "is_default": True, "settings": {}, "custom_html": html})
        assert r.status_code == 201, r.text
        out = superclient.get(f"{DOCS}/purchase-order/{po_id}").text
        assert "PURCHASE ORDER" in out and "Total" in out


class TestPdfOnWindowsDevServer:
    """`uvicorn --reload` on Windows installs the Selector loop policy, under which
    Playwright could not start Chromium: every PDF failed with NotImplementedError."""

    @pytest.mark.skipif(__import__("sys").platform != "win32", reason="Windows event loop policy")
    def test_pdf_under_the_selector_policy(self):
        import asyncio

        from app.reporting.center import exporters

        previous = asyncio.get_event_loop_policy()
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        try:
            pdf = exporters.to_pdf("<html><body><h1>QA</h1></body></html>", landscape=False)
        finally:
            asyncio.set_event_loop_policy(previous)
        assert pdf.startswith(b"%PDF")
        assert isinstance(asyncio.get_event_loop_policy(), type(previous))
