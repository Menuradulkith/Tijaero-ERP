"""Regression tests for the 2026-11-03 QA audit: Support / Reporting / Common / Chat / Notifications /
Peek (docs/qa/2026-11-03/report-misc.md) plus the shared location rules (WH-09 / WH-10)."""

from datetime import date

import pytest

from app.auth.rbac import Permissions as P

API = "/api/v1"


def _support_ticket(db, branch_code, user_id, **kw):
    from app.modules.support.models import CustomerSupport

    t = CustomerSupport(
        job_number=kw.get("job_number", f"TKT-T-{branch_code}"), job_type="repair", date=date.today(),
        contact_person="QA", branch_code=branch_code, assigned_user_id=user_id,
    )
    db.add(t)
    db.flush()
    return t


# --------------------------------------------------------------------------- #
# MSC-01 reference data
# --------------------------------------------------------------------------- #
def test_reference_data_lists_need_a_permission(make_user, api, make_product):
    make_product()
    _u, token = make_user()
    r = api(token).get(f"{API}/common/reference-data",
                       params={"include": "branches,products,customers,suppliers,employees,sales_stock"})
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("products", "customers", "suppliers", "employees", "sales_stock"):
        assert body[key] == [], key
    assert body["branches"] is not None


def test_reference_data_pricing_only_with_products_view(make_user, api, make_product):
    make_product(cost_price=123)
    _u, token = make_user(permissions=[P.QUOTATION_VIEW])
    products = api(token).get(f"{API}/common/reference-data", params={"include": "products"}).json()["products"]
    assert products
    assert all(p["cost_price"] is None and p["minimum_price"] is None and p["price_tiers"] == [] for p in products)

    _u, token = make_user(permissions=[P.PRODUCT_VIEW])
    products = api(token).get(f"{API}/common/reference-data", params={"include": "products"}).json()["products"]
    assert any(p["cost_price"] is not None for p in products)


# --------------------------------------------------------------------------- #
# MSC-02 activity log
# --------------------------------------------------------------------------- #
def test_activity_log_needs_entity_view_permission(make_user, api, make_supplier):
    supplier = make_supplier()
    _u, token = make_user()
    r = api(token).get(f"{API}/common/activity-log", params={"entity_type": "supplier", "entity_id": supplier.id})
    assert r.status_code == 403
    _u, token = make_user(permissions=[P.SUPPLIER_VIEW])
    r = api(token).get(f"{API}/common/activity-log", params={"entity_type": "supplier", "entity_id": supplier.id})
    assert r.status_code == 200, r.text


def test_activity_log_branch_scoped(db, make_user, api, make_branch, make_sales_stock):
    other = make_branch()
    stock = make_sales_stock(branch=other)
    _u, token = make_user(permissions=[P.SALES_STOCK_VIEW], branches=[make_branch()])
    r = api(token).get(f"{API}/common/activity-log", params={"entity_type": "sales_stock", "entity_id": stock.id})
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# MSC-03 / MSC-05 approvals
# --------------------------------------------------------------------------- #
def test_approval_detail_hidden_for_other_branch(db, make_user, api, make_branch):
    from app.modules.common.models import Approvals
    from app.modules.warehouse.models import ItemTransferNote

    itn = db.query(ItemTransferNote).first()
    if itn is None:
        pytest.skip("no item transfer note in the dev database")
    approval = Approvals(approval_for=f"item_transfer:{itn.id}:X", status="pending")
    db.add(approval)
    db.flush()
    _u, token = make_user(permissions=[P.COMMON_VIEW], branches=[make_branch()])
    c = api(token)
    assert c.get(f"{API}/common/approvals/{approval.id}").status_code == 404
    pending = c.get(f"{API}/common/approvals/pending", params={"limit": 1000}).json()
    assert approval.id not in {a["id"] for a in pending}


def test_create_approval_is_always_pending_and_typed(make_user, api):
    _u, token = make_user(permissions=[P.COMMON_CREATE])
    c = api(token)
    assert c.post(f"{API}/common/approvals", json={"approval_for": "expense:1:X", "status": "approved"}).status_code == 400
    assert c.post(f"{API}/common/approvals", json={"approval_for": "anything", "status": "pending"}).status_code == 400


# --------------------------------------------------------------------------- #
# WH-09 / WH-10 / MSC-06 locations
# --------------------------------------------------------------------------- #
def test_location_write_is_branch_scoped(make_user, api, make_branch, make_location):
    own, other = make_branch(), make_branch()
    _u, token = make_user(permissions=[P.COMMON_CREATE, P.COMMON_UPDATE, P.COMMON_DELETE], branches=[own])
    c = api(token)
    assert c.post(f"{API}/common/locations", json={"name": "X", "branch_code": other.branch_code}).status_code == 403
    loc = make_location(branch=other)
    assert c.put(f"{API}/common/locations/{loc.id}", json={"name": "Y", "branch_code": own.branch_code}).status_code == 403
    assert c.delete(f"{API}/common/locations/{loc.id}").status_code == 403


def test_location_in_use_cannot_move_or_be_deleted(superclient, make_branch, make_location, make_sales_stock):
    branch = make_branch()
    loc = make_location(branch=branch)
    make_sales_stock(branch=branch, location=loc)
    r = superclient.delete(f"{API}/common/locations/{loc.id}")
    assert r.status_code == 400 and "in use" in r.json()["detail"]
    r = superclient.put(f"{API}/common/locations/{loc.id}", json={"name": loc.name, "branch_code": make_branch().branch_code})
    assert r.status_code == 400 and "in use" in r.json()["detail"]


# --------------------------------------------------------------------------- #
# SUP-01..05 support
# --------------------------------------------------------------------------- #
SUPPORT_PERMS = [P.SUPPORT_TICKET_VIEW, P.SUPPORT_TICKET_CREATE, P.SUPPORT_TICKET_UPDATE, P.SUPPORT_TICKET_DELETE,
                 P.JOB_ITEM_VIEW, P.JOB_ITEM_CREATE, P.CALL_LOG_VIEW, P.CALL_LOG_CREATE, P.WARRANTY_CLAIM_VIEW]


def test_support_is_branch_scoped(db, make_user, api, make_branch):
    own, other = make_branch(), make_branch()
    user, token = make_user(permissions=SUPPORT_PERMS, branches=[own])
    foreign = _support_ticket(db, other.branch_code, user.id)
    mine = _support_ticket(db, own.branch_code, user.id)
    c = api(token)
    assert c.get(f"{API}/support/tickets/{foreign.id}").status_code == 404
    assert c.get(f"{API}/support/tickets/{foreign.id}/job-items").status_code == 404
    ids = {t["id"] for t in c.get(f"{API}/support/tickets", params={"limit": 1000}).json()}
    assert mine.id in ids and foreign.id not in ids
    payload = {"job_type": "repair", "date": str(date.today()), "contact_person": "QA",
               "branch_code": other.branch_code, "assigned_user_id": user.id}
    assert c.post(f"{API}/support/tickets", json=payload).status_code == 403
    assert c.post(f"{API}/support/tickets", json={**payload, "branch_code": "NO-SUCH-BR"}).status_code == 400
    r = c.post(f"{API}/support/tickets", json={**payload, "branch_code": own.branch_code})
    assert r.status_code == 201, r.text
    assert r.json()["job_number"].startswith(f"TKT-{own.branch_code}-")
    log = {"customer_support_id": foreign.id, "comment": "x"}
    assert c.post(f"{API}/support/call-logs", json=log).status_code == 404


def test_support_input_validation(db, superclient, superuser):
    user, _ = superuser
    assert superclient.get(f"{API}/support/tickets", params={"date_from": "notadate"}).status_code == 422
    assert superclient.get(f"{API}/support/warranty-claims", params={"date_to": "notadate"}).status_code == 422
    payload = {"job_type": "  ", "date": str(date.today()), "contact_person": "QA", "branch_code": "HQ",
               "assigned_user_id": user.id}
    assert superclient.post(f"{API}/support/tickets", json=payload).status_code == 422
    assert superclient.get(f"{API}/support/tickets/2147483000/job-items").status_code == 404
    item = {"fault_type": "x", "job_status": "whatever", "quantity": 1, "customer_support_id": 1, "product_id": 1}
    assert superclient.post(f"{API}/support/job-items", json=item).status_code == 422
    assert superclient.post(f"{API}/support/job-items", json={**item, "job_status": "pending", "quantity": -5}).status_code == 422


def test_ticket_with_children_cannot_be_deleted_and_orphan_log_reads(db, superclient, superuser, make_branch):
    from app.modules.support.models import CustomerCallLog
    from app.core import timezone as tz

    user, _ = superuser
    ticket = _support_ticket(db, make_branch().branch_code, user.id)
    db.add(CustomerCallLog(date=tz.now(), comment="c", customer_support_id=ticket.id))
    orphan = CustomerCallLog(date=tz.now(), comment="orphan", customer_support_id=None)
    db.add(orphan)
    db.flush()
    r = superclient.delete(f"{API}/support/tickets/{ticket.id}")
    assert r.status_code == 400 and "call logs" in r.json()["detail"]
    r = superclient.get(f"{API}/support/call-logs/{orphan.id}")
    assert r.status_code == 200 and r.json()["customer_support_id"] is None


# --------------------------------------------------------------------------- #
# RPT-01 / RPT-03 legacy reporting
# --------------------------------------------------------------------------- #
def test_dashboard_scoped_and_cached_per_scope(db, superclient, make_user, api, make_branch, superuser):
    other = make_branch()
    _support_ticket(db, other.branch_code, superuser[0].id)
    everyone = superclient.get(f"{API}/reporting/dashboard").json()  # fills the cache for "all branches"
    assert everyone["open_support_tickets"] >= 1
    _u, token = make_user(permissions=[P.DASHBOARD_VIEW], branches=[make_branch()])
    mine = api(token).get(f"{API}/reporting/dashboard").json()
    assert mine["open_support_tickets"] == 0
    assert mine["total_orders_month"] == 0 and mine["pending_approvals"] == 0
    stats = api(token).get(f"{API}/reporting/quick-stats", params={"period": "year"}).json()
    assert stats["sales"]["total_orders"] == 0


def test_reports_branch_scope_and_validation(make_user, api, make_branch):
    own, other = make_branch(), make_branch()
    _u, token = make_user(
        permissions=[P.REPORTING_SALES_VIEW, P.REPORTING_BRANCH_SUMMARY_VIEW,
                     P.REPORTING_BRANCH_SUMMARY_GENERATE],
        branches=[own],
    )
    c = api(token)
    span = {"start_date": "2020-01-01", "end_date": str(date.today())}

    def run_sales(params):
        return c.post(f"{API}/reporting/center/reports/sales.summary/run", json={"params": params})

    center_span = {"date_from": span["start_date"], "date_to": span["end_date"]}
    r = run_sales(center_span)
    assert r.status_code == 200, r.text
    orders = next(m["value"] for m in r.json()["metrics"] if m["label"] == "Orders")
    assert orders == 0
    assert run_sales({**center_span, "branch_code": other.branch_code}).status_code == 403
    assert run_sales({"date_from": "2026-02-01", "date_to": "2026-01-01"}).status_code == 422
    assert {b["branch_code"] for b in c.get(f"{API}/reporting/branches").json()} <= {own.branch_code}
    r = c.get(f"{API}/reporting/branch-summary", params={**span, "branch_codes": other.branch_code})
    assert r.status_code == 403
    r = c.get(f"{API}/reporting/branch-summary", params=span)
    assert r.status_code == 200 and {b.get("branch_code") for b in r.json()} <= {own.branch_code}


def test_custom_remarks_bounded(superclient):
    r = superclient.get(f"{API}/reporting/documents/invoice/1", params={"custom_remarks": "x" * 2001})
    assert r.status_code == 422


def test_print_template_names_unique(superclient):
    body = {"name": "QA dup template", "document_type": "quotation"}
    first = superclient.post(f"{API}/reporting/print-templates", json=body)
    assert first.status_code == 201, first.text
    assert superclient.post(f"{API}/reporting/print-templates", json={**body, "name": "qa DUP template"}).status_code == 409


def test_saved_report_refuses_inaccessible_branch(make_user, api, make_branch):
    from app.reporting.center import REGISTRY

    report = next((r for r in REGISTRY.values() if any(p.type == "branch" for p in r.params)), None)
    if report is None:
        pytest.skip("no report with a branch filter")
    branch_param = next(p for p in report.params if p.type == "branch")
    _u, token = make_user(permissions=[report.permission], branches=[make_branch()])
    r = api(token).post(f"{API}/reporting/center/saved", json={
        "report_key": report.key, "name": "QA saved", "params": {branch_param.key: make_branch().branch_code},
    })
    assert r.status_code == 403, r.text


# --------------------------------------------------------------------------- #
# COM-01..03 email
# --------------------------------------------------------------------------- #
def test_every_email_document_type_has_a_print_type():
    from typing import get_args

    from app.core.email import PRINT_DOCUMENT_TYPE
    from app.modules.communication.schemas import DocumentType
    from app.reporting.print_templates import DOCUMENT_TYPES

    for t in get_args(DocumentType):
        assert PRINT_DOCUMENT_TYPE[t] in DOCUMENT_TYPES


def test_email_send_permission_first_and_single_line_subject(make_user, api):
    _u, token = make_user()
    assert api(token).post(f"{API}/communication/email/send", json={}).status_code == 403
    _u, token = make_user(permissions=[P.QUOTATION_VIEW])
    r = api(token).post(f"{API}/communication/email/send", json={
        "document_type": "quotation", "document_id": 1, "display_id": "Q1", "to_email": "a@example.com",
        "subject": "Hello\r\nBcc: x@example.com", "body": "b",
    })
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# CHAT-01 / CHAT-02 / NTF-01 / PEEK-01
# --------------------------------------------------------------------------- #
def test_chat_agent_bounds(superclient):
    assert superclient.get(f"{API}/chat-agent/conversations", params={"limit": -5}).status_code == 422
    r = superclient.post(f"{API}/chat-agent/chat", json={"conversation_id": 99999999999, "message": "hi"})
    assert r.status_code == 422


def test_notification_payload_validation(superclient):
    base = {"title": "QA", "message": "m", "user_ids": [1]}
    assert superclient.post(f"{API}/notifications", json={**base, "action_url": "javascript:alert(1)"}).status_code == 422
    assert superclient.post(f"{API}/notifications", json={**base, "title": "  "}).status_code == 422
    assert superclient.post(f"{API}/notifications", json={**base, "message": "x" * 5001}).status_code == 422
    r = superclient.post(f"{API}/notifications", json={"title": "QA", "message": "m", "branch_codes": ["NO-SUCH-BR"]})
    assert r.status_code == 400


def test_peek_other_branch_is_not_found(db, make_user, api, make_branch):
    from app.modules.purchasing.models import PurchasingOrder

    po = db.query(PurchasingOrder).first()
    if po is None:
        pytest.skip("no purchase order in the dev database")
    _u, token = make_user(permissions=[P.PURCHASE_ORDER_VIEW], branches=[make_branch()])
    assert api(token).get(f"{API}/peek/purchase-order/{po.id}").status_code == 404
