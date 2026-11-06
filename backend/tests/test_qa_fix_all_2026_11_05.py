"""Regression tests for the fixes of docs/qa/full-audit-2026-11-05.md and docs/qa/deep-ui-2026-11-05.md
(branch scope, validation 500s, coupon uniqueness, maker-checker, deposits, unhandled errors)."""

from datetime import date, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.auth.rbac import Permissions as P

API = "/api/v1"


def _approved_po(db, branch, supplier, product, unit_price=100):
    from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems

    po = PurchasingOrder(
        purchasing_order_no=f"PO-T-{branch.branch_code}",
        branch_code=branch.branch_code,
        payment_method="cash",
        purchasing_order_date=date.today(),
        good_received_note_date=date.today(),
        created_date=date.today(),
        first_suppliers_id=supplier.id,
        added_date=datetime.utcnow(),
        status="approved",
    )
    db.add(po)
    db.flush()
    db.add(PurchasingOrderItems(
        quantity=1, unit_price=unit_price, warrenty_month="12", created_date=date.today(),
        product_id=product.id, purchasingorders_id=po.id, added_date=datetime.utcnow(), tax_rate=None,
    ))
    db.flush()
    return po


def _supplier_payment(db, branch, supplier, created_by, amount=50):
    from app.modules.purchasing.models import SupplierPayment

    p = SupplierPayment(
        payment_no=f"SPAY-T-{branch.branch_code}", supplier_id=supplier.id, payment_date=date.today(),
        payment_method="cash", payment_amount=amount, branch_code=branch.branch_code, payment_for="grn",
        status="pending", created_date=datetime.utcnow(), created_by=created_by,
    )
    db.add(p)
    db.flush()
    return p


# --------------------------------------------------------------------------- #
# Audit #2 / #3: branch scope of supplier money lists and HR commission summaries
# --------------------------------------------------------------------------- #
def test_eligible_advance_pos_are_branch_scoped(db, make_user, api, make_branch, make_supplier, make_product):
    own, other = make_branch(), make_branch()
    supplier, product = make_supplier(), make_product()
    own_po = _approved_po(db, own, supplier, product)
    other_po = _approved_po(db, other, supplier, product)
    _u, token = make_user(permissions=[P.SUPPLIER_ADVANCE_VIEW], branches=[own])
    r = api(token).get(f"{API}/purchasing/eligible-advance-pos")
    assert r.status_code == 200, r.text
    ids = {row["po_id"] for row in r.json()}
    # A line with no tax rate still counts at its price.
    assert own_po.id in ids
    assert other_po.id not in ids


def test_supplier_money_lists_are_branch_scoped(db, make_user, api, make_branch, make_supplier):
    own, other = make_branch(), make_branch()
    supplier = make_supplier()
    _supplier_payment(db, other, supplier, created_by=None)
    _u, token = make_user(permissions=[P.SUPPLIER_PAYMENT_VIEW, P.SUPPLIER_ADVANCE_VIEW], branches=[own])
    c = api(token)

    report = c.get(f"{API}/purchasing/payments/report")
    assert report.status_code == 200, report.text
    assert all(i["branch_code"] == own.branch_code for i in report.json()["items"])
    assert c.get(f"{API}/purchasing/payments/report", params={"branch_code": other.branch_code}).status_code == 403

    docs = c.get(f"{API}/purchasing/outstanding-documents")
    assert docs.status_code == 200, docs.text
    assert all(i["branch_code"] == own.branch_code for i in docs.json()["items"])

    for path in ("/purchasing/credit-settlements", "/purchasing/supplier-advances"):
        r = c.get(f"{API}{path}")
        assert r.status_code == 200, (path, r.text)
        assert all(row["branch_code"] == own.branch_code for row in r.json()), path
    assert c.get(f"{API}/purchasing/supplier-advances", params={"branch_code": other.branch_code}).status_code == 403


def test_commission_summaries_are_branch_scoped(db, make_user, api, make_branch):
    from app.modules.hr.sales_commission_models import MonthlyBranchSalesSummary

    own, other = make_branch(), make_branch()
    foreign = MonthlyBranchSalesSummary(
        branch_code=other.branch_code, fiscal_year=2026, fiscal_month=1, month_name="January 2026",
        period_start_date=date(2026, 1, 1), period_end_date=date(2026, 1, 31),
    )
    db.add(foreign)
    db.flush()
    _u, token = make_user(permissions=[P.HR_SALES_COMMISSION_VIEW], branches=[own])
    c = api(token)
    rows = c.get(f"{API}/hr/sales-commissions/summaries", params={"limit": 5000}).json()
    assert foreign.id not in {r["id"] for r in rows}
    assert c.get(f"{API}/hr/sales-commissions/summaries/{foreign.id}").status_code == 404
    r = c.get(f"{API}/hr/sales-commissions/summaries", params={"branch_code": other.branch_code})
    assert r.status_code == 403


def test_posting_failures_are_branch_scoped(db, make_user, api, make_branch):
    from app.modules.finance.accounting_models import GLPostingFailure

    own, other = make_branch(), make_branch()
    failure = GLPostingFailure(reference_type="Invoice", reference_id=1, source_module="sales",
                               branch_code=other.branch_code, status="pending",
                               error_code="TEST", error_message="test")
    db.add(failure)
    db.flush()
    _u, token = make_user(permissions=[P.GENERAL_LEDGER_VIEW], branches=[own])
    body = api(token).get(f"{API}/finance/accounting/posting-failures", params={"limit": 1000}).json()
    assert failure.id not in {i["id"] for i in body["items"]}


# --------------------------------------------------------------------------- #
# Audit #5 / #6: malformed query params are 422, returns search works
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("path", [
    "/purchasing/grn", "/purchasing/invoices", "/purchasing/supplier-advances",
    "/purchasing/supplier-payments", "/warehouse/transfer-notes", "/inventory/sales-stock/paginated",
])
def test_bad_dates_are_422(superclient, path):
    r = superclient.get(f"{API}{path}", params={"date_from": "' OR 1=1 --"})
    assert r.status_code == 422, (path, r.status_code, r.text[:200])


def test_sale_returns_search_by_invoice_no(superclient):
    r = superclient.get(f"{API}/sales/returns/list", params={"search": "INV"})
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- #
# Audit #7: coupon codes are unique regardless of case
# --------------------------------------------------------------------------- #
def test_coupon_code_unique_ignoring_case(db):
    from app.modules.customers.models import CustomerCuponCodes

    def coupon(code):
        return CustomerCuponCodes(cupon_code=code, discount_type="PERCENT", discount_value=5,
                                  limit_by_usage=10, limit_for_customer=1, valid_until_date=date.today(),
                                  active=True)

    db.add(coupon("QA-CI-X1"))
    db.flush()
    nested = db.begin_nested()
    db.add(coupon("qa-ci-x1"))
    with pytest.raises(IntegrityError):
        db.flush()
    nested.rollback()


# --------------------------------------------------------------------------- #
# Schema-level validation
# --------------------------------------------------------------------------- #
def test_warranty_months_validated():
    from app.modules.purchasing.schemas import GRNReceiveUnit

    assert GRNReceiveUnit(barcode="B1", warranty_month=" 012 ").warranty_month == "12"
    assert GRNReceiveUnit(barcode="B1", warranty_month="").warranty_month is None
    for bad in ("-3", "abc", "99999", "1.5"):
        with pytest.raises(ValidationError):
            GRNReceiveUnit(barcode="B1", warranty_month=bad)


def test_expense_vendor_name_cannot_be_blank():
    from app.modules.finance.schemas import ExpenseCreate

    base = dict(expense_category="office", expenses_method="cash", expense_amount=10, branch_code="X")
    with pytest.raises(ValidationError):
        ExpenseCreate(**base, vendor_name="     ")
    assert ExpenseCreate(**base, vendor_name="  ACME ").vendor_name == "ACME"
    assert ExpenseCreate(**base).vendor_name is None


def test_gift_voucher_update_keeps_invoice_no():
    from app.modules.customers.schemas import GiftVoucherUpdate

    assert GiftVoucherUpdate(purchased_invoice_no=" INV-1 ").model_dump(exclude_unset=True) == {"purchased_invoice_no": "INV-1"}


def test_hr_phone_and_nic_reject_non_strings():
    from app.modules.hr_core.schemas import _nic, _phone

    for fn in (_phone, _nic):
        with pytest.raises(ValueError):
            fn({"x": 1})


# --------------------------------------------------------------------------- #
# F36 / F38: maker-checker and cash on hand
# --------------------------------------------------------------------------- #
def test_supplier_payment_maker_checker(db, make_user, api, make_branch, make_supplier):
    branch = make_branch()
    user, token = make_user(permissions=[P.SUPPLIER_PAYMENT_UPDATE], branches=[branch])
    payment = _supplier_payment(db, branch, make_supplier(), created_by=user.id)
    r = api(token).post(f"{API}/purchasing/supplier-payments/{payment.id}/verify")
    assert r.status_code == 403, r.text
    assert "you created" in r.json()["detail"]


def test_bank_deposit_unknown_branch_and_cash_limit(superclient, make_branch):
    r = superclient.post(f"{API}/finance/bank-deposits", json={"deposits_amount": 10, "branch_code": "ZZQA-NOPE"})
    assert r.status_code == 404, r.text
    branch = make_branch()
    r = superclient.post(f"{API}/finance/bank-deposits", json={
        "deposits_amount": 999_999_999, "branch_code": branch.branch_code, "payment_for": "Cash Deposit",
    })
    assert r.status_code == 400, r.text
    assert "cash on hand" in r.json()["detail"]


# --------------------------------------------------------------------------- #
# Audit #12: an unhandled error is answered without re-raising
# --------------------------------------------------------------------------- #
def test_unhandled_error_returns_json_500(client):
    from app.main import app

    fastapi_app = getattr(app, "app", app)

    @fastapi_app.get("/__qa_boom")
    def _boom():
        raise RuntimeError("boom")

    try:
        r = client.get("/__qa_boom")
        assert r.status_code == 500
        assert "internal server" in r.json()["detail"]
    finally:
        fastapi_app.router.routes[:] = [rt for rt in fastapi_app.router.routes if getattr(rt, "path", "") != "/__qa_boom"]
