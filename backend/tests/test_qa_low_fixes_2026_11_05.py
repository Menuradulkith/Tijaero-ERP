"""Low-severity QA fixes 2026-11-05 (docs/qa/deep-ui-2026-11-05.md, docs/qa/full-audit-2026-11-05.md).

S12 current minimum price is 200/null; S15 return errors name the product; S18-S20 gift voucher
invoice / code / amount checks; S26 sales-return maker-checker; P4 supplier contact ID card;
P18 GRN vehicle no; P23 supplier invoice date; P26 purchase return comment; F1/F11 payment
references; F14/F41 inverted date ranges; F19 account code charset; F24 advance clean-up
migration; F29 write-off response names; F39 cheque date window; F42 readable posting failures;
audit #14 description caps; audit #15 blank text on updates.
"""
from __future__ import annotations

import importlib.util
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.sales.models import SaleReturn
from app.modules.sales.service import sales_service
from tests.integration.test_workflows.test_sales_guardrails import (
    _invoice,
    _invoice_item,
    _location,
    _return_create,
    _voucher,
)

TODAY = date.today()
D = Decimal


def _uid(p="QA"):
    return f"{p}{uuid.uuid4().hex[:10].upper()}"


# ═══════════════════════════════════════ S12 minimum price ═══════════════════════════════════════
def test_current_minimum_price_without_one_is_200_null(superclient, make_product):
    product = make_product()
    r = superclient.get(f"/api/v1/inventory/products/{product.id}/minimum-prices/current")
    assert r.status_code == 200, r.text
    assert r.json() is None


# ═══════════════════════════════════════ S15 return error text ═══════════════════════════════════════
def test_return_price_error_names_the_product(db, make_branch, make_customer, make_product, make_user):
    branch, customer = make_branch(), make_customer()
    product = make_product(name=_uid("QA Widget "))
    user, _ = make_user(branches=[branch])
    invoice = _invoice(db, branch, customer, subtotal="600.00")
    item = _invoice_item(db, invoice, product, qty=2, price="300.00")
    data = _return_create(invoice, _location(db, branch), item, price=999.0)
    with pytest.raises(HTTPException) as exc:
        sales_service.create_sale_return(db, data, user_id=user.id)
    assert exc.value.status_code == 400
    assert product.name in exc.value.detail
    assert "invoice item #" not in exc.value.detail


# ═══════════════════════════════════════ S18-S20 gift vouchers ═══════════════════════════════════════
class TestGiftVoucherInputs:
    def _create(self, **over):
        from app.modules.customers import schemas as cs
        body = {"barcode_no": _uid("GV-"), "amount": "100.00", "payment_method": "cash"}
        body.update(over)
        return cs.GiftVoucherCreate(**body)

    def test_unknown_linked_invoice_rejected_on_create(self, db):
        from app.modules.customers.service import voucher_service
        with pytest.raises(HTTPException) as exc:
            voucher_service.create_voucher(db, self._create(purchased_invoice_no="INV-NOPE-1"))
        assert exc.value.status_code == 400
        assert "INV-NOPE-1" in exc.value.detail

    def test_known_linked_invoice_accepted_on_create(self, db, make_branch, make_customer):
        from app.modules.customers.service import voucher_service
        inv = _invoice(db, make_branch(), make_customer())
        v = voucher_service.create_voucher(db, self._create(purchased_invoice_no=inv.invoice_no))
        assert v.purchased_invoice_no == inv.invoice_no

    def test_unknown_linked_invoice_rejected_on_update(self, db):
        from app.modules.customers import schemas as cs
        from app.modules.customers.service import voucher_service
        v = _voucher(db)
        with pytest.raises(HTTPException) as exc:
            voucher_service.update_voucher(db, v.id, cs.GiftVoucherUpdate(purchased_invoice_no="INV-NOPE-2"))
        assert exc.value.status_code == 400

    @pytest.mark.parametrize("code", ["QA GV 1", "QA<b>1</b>", "A&B", "x'y"])
    def test_code_outside_barcode_charset_rejected(self, code):
        with pytest.raises(ValidationError):
            self._create(barcode_no=code)

    @pytest.mark.parametrize("code", ["GV-2026/001", "abc.DEF_12", "123456"])
    def test_barcode_codes_accepted(self, code):
        assert self._create(barcode_no=code).barcode_no == code

    @pytest.mark.parametrize("amount", ["0.005", "0.001", "10.123", 0.004])
    def test_sub_cent_amount_rejected(self, amount):
        with pytest.raises(ValidationError):
            self._create(amount=amount)

    def test_two_decimal_amount_and_float_noise_accepted(self):
        assert self._create(amount="0.01").amount == D("0.01")
        assert self._create(amount=0.1 + 0.2).amount == D("0.30")


# ═══════════════════════════════════════ S26 return maker-checker ═══════════════════════════════════════
def test_creator_cannot_approve_own_sales_return(db, make_branch, make_customer, make_user):
    branch, customer = make_branch(), make_customer()
    maker, _ = make_user(branches=[branch])
    invoice = _invoice(db, branch, customer)
    sr = SaleReturn(
        sale_return_no=_uid("QASR"), branch_code=branch.branch_code, added_date=TODAY,
        good_received_locations_id=_location(db, branch).id, invoice_id=invoice.id, cheque_date=TODAY,
        payment_method="cash", status="pending", subtotal=0, tax_refund=0, total_refund=0,
        refund_status="pending", refund_amount=0, created_by=maker.id,
    )
    db.add(sr)
    db.flush()
    with pytest.raises(HTTPException) as exc:
        sales_service.approve_sale_return(db, sr.id, maker.id)
    assert exc.value.status_code == 403
    assert exc.value.detail == "You cannot approve a return you created"


# ═══════════════════════════════════════ purchasing schemas ═══════════════════════════════════════
class TestPurchasingInputs:
    @pytest.mark.parametrize("field", ["id_card_number", "passport_no"])
    def test_supplier_contact_id_numbers_validated(self, field):
        from app.modules.purchasing import schemas as ps
        base = {"title": "Mr", "full_name": "QA Person", "phone": "0771234567"}
        with pytest.raises(ValidationError):
            ps.SupplierContactPersonCreate(**base, **{field: "123"})
        with pytest.raises(ValidationError):
            ps.SupplierContactPersonUpdate(**{field: "12<b>34"})
        assert getattr(ps.SupplierContactPersonCreate(**base, **{field: "199012345678"}), field) == "199012345678"
        assert getattr(ps.SupplierContactPersonUpdate(**{field: "  "}), field) is None

    def _grn(self, **over):
        from app.modules.purchasing import schemas as ps
        body = {"good_received_date": TODAY, "branch_code": "B1", "good_received_locations_id": 1,
                "purchasingorders_id": 1}
        body.update(over)
        return ps.GoodReceivedNoteCreate(**body)

    def test_grn_vehicle_no_pattern(self):
        assert self._grn(vehicle_no=" WP CAB-1234 ").vehicle_no == "WP CAB-1234"
        assert self._grn(vehicle_no="   ").vehicle_no is None
        for bad in ("<b>WP CAB-1234</b>", "X" * 51, "WP/CAB"):
            with pytest.raises(ValidationError):
                self._grn(vehicle_no=bad)

    def test_supplier_invoice_date_not_in_future(self):
        from app.modules.purchasing.invoice_schemas import PurchaseInvoiceCreate, PurchaseInvoiceUpdate
        body = {"supplier_invoice_no": "SI-1", "supplier_id": 1, "branch_code": "B1",
                "received_date": TODAY, "due_date": TODAY, "items": []}
        with pytest.raises(ValidationError):
            PurchaseInvoiceCreate(**body, supplier_invoice_date=date(2030, 12, 31))
        with pytest.raises(ValidationError):
            PurchaseInvoiceUpdate(supplier_invoice_date=TODAY + timedelta(days=5))
        assert PurchaseInvoiceCreate(**body, supplier_invoice_date=TODAY).supplier_invoice_date == TODAY

    def test_purchase_return_comment_capped(self):
        from app.modules.purchasing import schemas as ps
        body = {"branch_code": "B1", "goodreceivednote_id": 1,
                "items": [{"product_id": 1, "purchasing_price": 10, "return_price": 10, "barcode": "B1"}]}
        with pytest.raises(ValidationError):
            ps.PurchasingReturnCreate(**body, remark="x" * 2001)
        assert len(ps.PurchasingReturnCreate(**body, remark="x" * 2000).remark) == 2000

    @pytest.mark.parametrize("method", ["bank_transfer", "Bank Transfer", "cheque"])
    def test_supplier_payment_reference_required_for_bank_and_cheque(self, method):
        from app.modules.purchasing import schemas as ps
        from app.modules.purchasing.invoice_schemas import PaymentWithAllocationsCreate
        body = {"supplier_id": 1, "payment_date": TODAY, "payment_method": method, "payment_amount": 10,
                "branch_code": "B1"}
        with pytest.raises(ValidationError):
            ps.SupplierPaymentCreate(**body, payment_for="po", reference_number="     ")
        with pytest.raises(ValidationError):
            PaymentWithAllocationsCreate(**body, allocations=[], reference_number="   ")
        ok = ps.SupplierPaymentCreate(**body, payment_for="po", reference_number="  TRX-1  ")
        assert ok.reference_number == "TRX-1"

    def test_cash_supplier_payment_needs_no_reference(self):
        from app.modules.purchasing import schemas as ps
        p = ps.SupplierPaymentCreate(supplier_id=1, payment_date=TODAY, payment_method="cash", payment_amount=10,
                                     branch_code="B1", payment_for="po", reference_number="  ")
        assert p.reference_number is None


# ═══════════════════════════════════════ finance schemas ═══════════════════════════════════════
class TestFinanceInputs:
    @pytest.mark.parametrize("method", ["bank_transfer", "cheque", "Bank Transfer"])
    def test_expense_payment_reference_required(self, method):
        from app.modules.finance.schemas import ExpensePayment
        with pytest.raises(ValidationError):
            ExpensePayment(payment_method=method)
        with pytest.raises(ValidationError):
            ExpensePayment(payment_method=method, payment_reference="   ")
        assert ExpensePayment(payment_method=method, payment_reference=" REF-1 ").payment_reference == "REF-1"

    def test_cash_expense_payment_needs_no_reference(self):
        from app.modules.finance.schemas import ExpensePayment
        assert ExpensePayment(payment_method="cash").payment_reference is None

    def _cheque(self, **over):
        from app.modules.finance.schemas import ChequePaymentCreate
        body = {"cheque_number": "000123", "branch_code": "B1", "from": "QA", "bank": "BOC", "amount": 10,
                "cheque_date": TODAY, "deposit_date": TODAY}
        body.update(over)
        return ChequePaymentCreate(**body)

    def test_cheque_dates_within_a_year(self):
        assert self._cheque(cheque_date=TODAY + timedelta(days=180)).cheque_date == TODAY + timedelta(days=180)
        assert self._cheque(cheque_date=TODAY - timedelta(days=90)).cheque_date == TODAY - timedelta(days=90)
        for field in ("cheque_date", "deposit_date"):
            for bad in (date(9999, 12, 31), TODAY + timedelta(days=400), TODAY - timedelta(days=400)):
                with pytest.raises(ValidationError):
                    self._cheque(**{field: bad})

    @pytest.mark.parametrize("code", ["ABC-<x>", "10 10", "A&B", "x'1", '1"2'])
    def test_account_code_charset(self, code):
        from app.modules.finance.accounting_schemas import ChartOfAccountCreate
        with pytest.raises(ValidationError):
            ChartOfAccountCreate(account_code=code, account_name="QA", account_type="Asset", normal_balance="Debit")

    @pytest.mark.parametrize("code", ["1010", "1010.01", "AR-01"])
    def test_account_code_legit_formats(self, code):
        from app.modules.finance.accounting_schemas import ChartOfAccountCreate
        a = ChartOfAccountCreate(account_code=code, account_name="QA", account_type="Asset", normal_balance="Debit")
        assert a.account_code == code

    def test_description_caps(self):
        from app.modules.finance import accounting_schemas as acs
        from app.modules.sales.schemas import PaymentCardCreate, PaymentCardUpdate
        long = "x" * 10_000
        with pytest.raises(ValidationError):
            acs.ChartOfAccountCreate(account_code="1", account_name="QA", account_type="Asset",
                                     normal_balance="Debit", description=long)
        with pytest.raises(ValidationError):
            acs.ChartOfAccountUpdate(description=long)
        with pytest.raises(ValidationError):
            acs.CashFlowCategoryCreate(category_code="X", category_name="X", section="Operating", line_item="X",
                                       display_order=1, is_inflow=True, description=long)
        with pytest.raises(ValidationError):
            acs.CashFlowCategoryUpdate(description=long)
        with pytest.raises(ValidationError):
            PaymentCardCreate(card_name="Visa", card_type="credit", description=long)
        with pytest.raises(ValidationError):
            PaymentCardUpdate(description=long)

    def test_blank_text_on_bank_accounts_and_fixed_assets(self):
        from app.modules.finance import accounting_schemas as acs
        for bad in ({"name": "   "}, {"name": None}):
            with pytest.raises(ValidationError):
                acs.BankAccountUpdate(**bad)
        with pytest.raises(ValidationError):
            acs.BankAccountCreate(name="   ")
        u = acs.BankAccountUpdate(name="  Main  ", bank_name="  ", notes=" ")
        assert (u.name, u.bank_name, u.notes) == ("Main", None, None)
        with pytest.raises(ValidationError):
            acs.FixedAssetCreate(name="   ", asset_class_id=1, acquisition_date=TODAY, cost=10)
        fa = acs.FixedAssetCreate(name=" Van ", asset_class_id=1, acquisition_date=TODAY, cost=10,
                                  serial_no="  ", location=" ", notes="  ")
        assert (fa.name, fa.serial_no, fa.location, fa.notes) == ("Van", None, None, None)
        with pytest.raises(ValidationError):
            acs.AssetClassUpdate(name="  ")

    def test_blank_branch_address_becomes_none(self):
        from app.modules.branches.schemas import BranchUpdate
        u = BranchUpdate(address="   ", city=" ", address_line1="  Main St ")
        assert (u.address, u.city, u.address_line1) == (None, None, "Main St")
        with pytest.raises(ValidationError):
            BranchUpdate(branch_name="   ")


# ═══════════════════════════════════════ F14 / F41 inverted ranges ═══════════════════════════════════════
@pytest.mark.parametrize("url", [
    "/api/v1/finance/cashbook",
    "/api/v1/finance/cashbook/summary",
    "/api/v1/finance/cashbook/export-csv",
    "/api/v1/finance/accounting/reports/income-statement?fiscal_year=2026",
    "/api/v1/finance/accounting/general-ledger",
])
def test_from_after_to_rejected(superclient, url):
    sep = "&" if "?" in url else "?"
    r = superclient.get(f"{url}{sep}date_from=2026-12-31&date_to=2026-01-01")
    assert r.status_code == 422, r.text
    assert "From date must be on or before To date" in r.text


# ═══════════════════════════════════════ F24 migration ═══════════════════════════════════════
def test_s128_deactivates_nonpositive_advances(db, make_branch, make_customer, monkeypatch):
    from sqlalchemy import text

    from app.modules.customers.models import CustomerAdvancePayments

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "s128_deactivate_nonpositive_customer_advances.py"
    spec = importlib.util.spec_from_file_location("s128", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    assert mig.down_revision == "s127_cancelled_invoice_transfers"

    branch, customer = make_branch(), make_customer()

    def _adv(amount):
        a = CustomerAdvancePayments(
            advance_payments_no=_uid("QAADV"), payment_method="cash", branch_code=branch.branch_code,
            payment_amount=D(amount), applied_amount=0, remaining_amount=D(amount), is_fully_applied=False,
            created_date=TODAY, customer_id=customer.id, cheque_date=TODAY, active=True,
        )
        db.add(a)
        return a

    neg, zero, pos = _adv("-5.00"), _adv("0.00"), _adv("10.00")
    db.flush()
    monkeypatch.setattr(mig.op, "execute", lambda sql: db.execute(text(sql)), raising=False)
    mig.upgrade()
    for a in (neg, zero, pos):
        db.refresh(a)
    assert (neg.active, zero.active, pos.active) == (False, False, True)


# ═══════════════════════════════════════ F29 write-off response ═══════════════════════════════════════
def test_write_off_response_fills_invoice_and_customer(db, make_branch, make_customer):
    from app.modules.finance.accounting_models import CustomerWriteOff
    from app.modules.finance.write_off_service import WriteOffService

    customer = make_customer()
    inv = _invoice(db, make_branch(), customer)
    wo = CustomerWriteOff(id=0, write_off_no="WO-QA", invoice_id=inv.id, customer_id=customer.id,
                          write_off_date=TODAY, amount=D("1.00"), reason="small_balance", status="posted")
    r = WriteOffService(db).response(wo)
    assert r.invoice_no == inv.invoice_no
    assert r.customer_name == customer.customer_name


# ═══════════════════════════════════════ F42 posting failure text ═══════════════════════════════════════
RAW_DB_ERROR = (
    "(psycopg.errors.StringDataRightTruncation) value too long for type character varying(355)\n"
    "[SQL: INSERT INTO item_receive_note (item_transfer_note_id, remark) VALUES (%(a)s, %(b)s)]\n"
    "[parameters: {'a': 1, 'b': 'xxx'}]\n"
    "(Background on this error at: https://sqlalche.me/e/20/9h9h)"
)


class TestPostingFailureText:
    def test_sanitize(self):
        from app.common.db_errors import sanitize_db_error
        assert sanitize_db_error(RAW_DB_ERROR) == "value too long for type character varying(355)"
        assert sanitize_db_error("Debits (50.00) != credits (100.00); diff=-50.00") == \
            "Debits (50.00) != credits (100.00); diff=-50.00"
        assert sanitize_db_error(None) is None

    def test_recorded_failure_is_stored_sanitized(self, db):
        from app.modules.finance.accounting_models import GLPostingFailure
        from app.modules.finance.gl_posting_service import GLPostingService

        ref_id = 900_000_000 + uuid.uuid4().int % 1_000_000
        fid = GLPostingService(db).record_post_commit_failure(
            reference_type="QA-F42", reference_id=ref_id, error_message=RAW_DB_ERROR)
        assert fid
        row = db.query(GLPostingFailure).filter(GLPostingFailure.id == fid).one()
        assert row.error_message == "value too long for type character varying(355)"

    def test_legacy_row_is_sanitized_on_read(self):
        from app.modules.finance.accounting_schemas import GLPostingFailureResponse
        r = GLPostingFailureResponse(id=1, reference_type="X", reference_id=1, source_module="x",
                                     error_code="commit_failed", error_message=RAW_DB_ERROR, status="pending")
        assert "[SQL:" not in r.error_message and "psycopg" not in r.error_message
