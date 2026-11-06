"""Regression tests for the "Remaining modules" findings of docs/qa/deep-ui-2026-11-05.md
(CORS on 500s, report-center branches, receive-note uniqueness, support references, input bounds)."""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from tests.integration.test_workflows.test_sales_guardrails import _invoice, _invoice_item

API = "/api/v1"


# --------------------------------------------------------------------------- #
# X1: an unhandled error still carries the CORS headers
# --------------------------------------------------------------------------- #
def test_unhandled_error_500_has_cors_headers(client):
    from app.core.config import settings
    from app.main import app

    fastapi_app = getattr(app, "app", app)
    origin = settings.BACKEND_CORS_ORIGINS[0]

    @fastapi_app.get("/__qa_boom_cors")
    def _boom():
        raise RuntimeError("boom")

    try:
        r = client.get("/__qa_boom_cors", headers={"Origin": origin})
        assert r.status_code == 500
        assert r.headers.get("access-control-allow-origin") == origin
    finally:
        fastapi_app.router.routes[:] = [rt for rt in fastapi_app.router.routes if getattr(rt, "path", "") != "/__qa_boom_cors"]


# --------------------------------------------------------------------------- #
# R1 / R2: XLSX export dependency, unknown branch in the report center
# --------------------------------------------------------------------------- #
def test_openpyxl_is_installed():
    import openpyxl  # noqa: F401


def test_report_center_rejects_unknown_branch(superclient):
    from app.reporting.center import REGISTRY

    report = next((r for r in REGISTRY.values() if any(p.type == "branch" for p in r.params)), None)
    if report is None:
        pytest.skip("no report with a branch filter")
    key = next(p.key for p in report.params if p.type == "branch")
    params = {"date_from": "2026-01-01", "date_to": "2026-01-31", key: "NO-SUCH-BRANCH"}
    r = superclient.post(f"{API}/reporting/center/reports/{report.key}/run", json={"params": params})
    assert r.status_code == 422, r.text
    assert "NO-SUCH-BRANCH" in r.text


# --------------------------------------------------------------------------- #
# W1: one receive note per transfer note
# --------------------------------------------------------------------------- #
def test_receive_note_is_unique_per_transfer_note():
    from app.modules.warehouse.models import ItemReceiveNote

    assert ItemReceiveNote.__table__.c.item_transfer_note_id.unique


# --------------------------------------------------------------------------- #
# SP: support ticket references, dates, call logs, warranty claims
# --------------------------------------------------------------------------- #
def _ticket(branch, user_id, **over):
    return {"job_type": "repair", "date": str(date.today()), "contact_person": "QA",
            "branch_code": branch.branch_code, "assigned_user_id": user_id, **over}


def test_ticket_refuses_unknown_references(superclient, superuser, make_branch, make_customer):
    user, _ = superuser
    branch = make_branch()
    c = superclient
    r = c.post(f"{API}/support/tickets", json=_ticket(branch, 2_147_000_000))
    assert r.status_code == 400 and "Assigned user" in r.json()["detail"]
    r = c.post(f"{API}/support/tickets", json=_ticket(branch, user.id, customer_id=2_147_000_000))
    assert r.status_code == 400 and "Customer" in r.json()["detail"]
    r = c.post(f"{API}/support/tickets", json=_ticket(branch, user.id, invoice_id=2_147_000_000))
    assert r.status_code == 400 and "Invoice" in r.json()["detail"]
    r = c.post(f"{API}/support/tickets", json=_ticket(branch, user.id, customer_id=make_customer().id))
    assert r.status_code == 201, r.text


def test_ticket_invoice_must_match_branch_and_customer(db, superclient, superuser, make_branch, make_customer):
    user, _ = superuser
    branch, other = make_branch(), make_branch()
    owner, stranger = make_customer(), make_customer()
    inv = _invoice(db, other, owner)
    r = superclient.post(f"{API}/support/tickets", json=_ticket(branch, user.id, invoice_id=inv.id))
    assert r.status_code == 400 and "belongs to branch" in r.json()["detail"]
    r = superclient.post(f"{API}/support/tickets", json=_ticket(other, user.id, invoice_id=inv.id, customer_id=stranger.id))
    assert r.status_code == 400 and "another customer" in r.json()["detail"]
    r = superclient.post(f"{API}/support/tickets", json=_ticket(other, user.id, invoice_id=inv.id, customer_id=owner.id))
    assert r.status_code == 201, r.text


def test_ticket_date_window():
    from app.modules.support.schemas import CustomerSupportCreate

    base = {"job_type": "repair", "contact_person": "QA", "branch_code": "HQ", "assigned_user_id": 1}
    with pytest.raises(ValidationError, match="future"):
        CustomerSupportCreate(**base, date=date.today() + timedelta(days=1))
    with pytest.raises(ValidationError, match="too far in the past"):
        CustomerSupportCreate(**base, date=date(1999, 12, 31))
    CustomerSupportCreate(**base, date=date.today())


def test_blank_call_log_is_refused():
    from app.modules.support.schemas import CustomerCallLogCreate

    with pytest.raises(ValidationError, match="contact person or a comment"):
        CustomerCallLogCreate(customer_support_id=1, contact_person="   ", comment="  ")
    log = CustomerCallLogCreate(customer_support_id=1, contact_person="  Ann ", comment=" ")
    assert log.contact_person == "Ann" and log.comment is None


def test_job_item_refuses_unknown_product(superclient, superuser, make_branch):
    user, _ = superuser
    ticket = superclient.post(f"{API}/support/tickets", json=_ticket(make_branch(), user.id)).json()
    item = {"fault_type": "screen", "job_status": "pending", "quantity": 1,
            "customer_support_id": ticket["id"], "product_id": 2_147_000_000}
    r = superclient.post(f"{API}/support/job-items", json=item)
    assert r.status_code == 400 and "Product" in r.json()["detail"]


def test_warranty_type_and_status_lists():
    from app.modules.support.schemas import WarrantyClaimCreate

    base = {"product_barcode_old_code": "X1", "order_id": 1}
    claim = WarrantyClaimCreate(**base, warranty_type="Repair", warranty_status="In Progress")
    assert (claim.warranty_type, claim.warranty_status) == ("repair", "in_progress")
    with pytest.raises(ValidationError, match="must be one of"):
        WarrantyClaimCreate(**base, warranty_type="magic", warranty_status="open")
    with pytest.raises(ValidationError, match="must be one of"):
        WarrantyClaimCreate(**base, warranty_type="repair", warranty_status="lost")


def test_warranty_barcode_must_be_on_the_order(db, superclient, make_branch, make_customer, make_product):
    product = make_product()
    inv = _invoice(db, make_branch(), make_customer())
    _invoice_item(db, inv, product, qty=1)
    body = {"warranty_type": "repair", "warranty_status": "open", "order_id": inv.id}
    r = superclient.post(f"{API}/support/warranty-claims", json={**body, "product_barcode_old_code": "NOT-SOLD-HERE"})
    assert r.status_code == 400 and "was not sold" in r.json()["detail"]
    r = superclient.post(f"{API}/support/warranty-claims", json={**body, "product_barcode_old_code": product.item_code})
    assert r.status_code == 201, r.text


def test_reference_employees_carry_user_id(superclient):
    r = superclient.get(f"{API}/common/reference-data", params={"include": "employees"})
    if r.status_code == 404:
        pytest.skip("reference-data endpoint not mounted under this path")
    assert r.status_code == 200, r.text
    rows = r.json().get("employees") or []
    assert all("user_id" in e for e in rows)


# --------------------------------------------------------------------------- #
# M2 / AD1 / W6: manufacturing plan dates, company website, lookup bounds
# --------------------------------------------------------------------------- #
def test_production_plan_window():
    from app.modules.manufacturing.schemas import ProductionOrderUpdate

    today = date.today()
    with pytest.raises(ValidationError, match="a year in the past"):
        ProductionOrderUpdate(planned_start_date=today - timedelta(days=400))
    with pytest.raises(ValidationError, match="two years ahead"):
        ProductionOrderUpdate(planned_end_date=today + timedelta(days=800))
    with pytest.raises(ValidationError, match="before the planned start"):
        ProductionOrderUpdate(planned_start_date=today, planned_end_date=today - timedelta(days=1))
    ProductionOrderUpdate(planned_start_date=today, planned_end_date=today + timedelta(days=30))


def test_company_website_needs_scheme():
    from app.modules.settings.schemas import CompanySettingsUpdate

    with pytest.raises(ValidationError, match="http"):
        CompanySettingsUpdate(company_website="javascript:alert(1)")
    with pytest.raises(ValidationError, match="http"):
        CompanySettingsUpdate(company_website="<script>alert(1)</script>")
    assert CompanySettingsUpdate(company_website="https://tijaero.lk").company_website == "https://tijaero.lk"
    assert CompanySettingsUpdate(company_website="www.tijaero.lk").company_website == "https://www.tijaero.lk"


def test_warehouse_lookup_bounds():
    from app.modules.warehouse.schemas import BarcodeValidationRequest, LotValidationRequest

    with pytest.raises(ValidationError):
        BarcodeValidationRequest(barcode="", from_location_id=1, branch_code="HQ")
    with pytest.raises(ValidationError):
        BarcodeValidationRequest(barcode="X", from_location_id=2_147_483_648, branch_code="HQ")
    with pytest.raises(ValidationError):
        LotValidationRequest(product_id=1, from_location_id=1, quantity=0)
