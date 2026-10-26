"""Security review fixes: register escalation, cross-branch print/payment/ITN access, peek costs."""

import uuid
from datetime import date, datetime

from app.auth.models import Group, Permission

GOOD_PW = "Qa!Pass#2026"


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _perm(db, resource, action):
    p = db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
    if p is None:
        p = Permission(name=f"{resource}.{action}.{_u()}", resource=resource, action=action)
        db.add(p)
        db.flush()
    return p


def _group(db, *perms):
    g = Group(name=f"QA-Role-{_u()}")
    g.permissions = [_perm(db, r, a) for r, a in perms]
    db.add(g)
    db.flush()
    return g


def _po(db, branch, supplier, status="approved"):
    from app.modules.purchasing.models import PurchasingOrder

    po = PurchasingOrder(
        purchasing_order_no=f"PO-{_u()}", branch_code=branch.branch_code, payment_method="cash",
        purchasing_order_date=date.today(), good_received_note_date=date.today(), created_date=date.today(),
        first_suppliers_id=supplier.id, added_date=datetime.utcnow(), status=status,
    )
    db.add(po)
    db.flush()
    return po


class TestRegisterEscalation:
    def _body(self, branch, group):
        u = _u()
        return {
            "username": f"qa_{u}", "email": f"qa.{u}@example.com", "first_name": "QA", "last_name": "Tester",
            "password": GOOD_PW, "employee_id": f"QA{u}", "branch_ids": [branch.id], "group_ids": [group.id],
        }

    def test_user_creator_cannot_hand_out_a_stronger_role(self, db, api, make_user, make_branch):
        branch = make_branch()
        _, token = make_user(permissions=[("users", "create")], branches=[branch])
        admin_like = _group(db, ("users", "create"), ("finance", "approve"))
        r = api(token).post("/api/v1/auth/register", json=self._body(branch, admin_like))
        assert r.status_code == 403, r.text

    def test_user_creator_cannot_grant_a_branch_they_do_not_have(self, db, api, make_user, make_branch):
        mine, other = make_branch(), make_branch()
        _, token = make_user(permissions=[("users", "create")], branches=[mine])
        r = api(token).post("/api/v1/auth/register", json=self._body(other, _group(db, ("users", "create"))))
        assert r.status_code == 403, r.text


class TestPrintBranchScope:
    def test_other_branch_purchase_order_print_is_404(self, db, api, make_user, make_branch, make_supplier):
        mine, other = make_branch(), make_branch()
        po = _po(db, other, make_supplier())
        _, token = make_user(permissions=[("purchase_orders", "view")], branches=[mine])
        r = api(token).get(f"/api/v1/reporting/documents/purchase-order/{po.id}")
        assert r.status_code == 404, r.text

    def test_guard_lets_the_own_branch_through(self, db, make_user, make_branch, make_supplier):
        from app.common.document_guard import ensure_document_printable

        branch = make_branch()
        po = _po(db, branch, make_supplier())
        user, _ = make_user(permissions=[("purchase_orders", "view")], branches=[branch])
        ensure_document_printable(db, "purchase-order", po.id, user)  # no exception


class TestSupplierPaymentBranchScope:
    def test_list_only_returns_own_branches(self, db, api, make_user, make_branch, make_supplier):
        from app.modules.purchasing.models import SupplierPayment

        mine, other = make_branch(), make_branch()
        supplier = make_supplier()
        for b in (mine, other):
            db.add(SupplierPayment(
                payment_no=f"SP-{_u()}", branch_code=b.branch_code, supplier_id=supplier.id,
                payment_date=date.today(), payment_method="cash", payment_amount=100, payment_for="grn",
                status="pending", created_date=datetime.utcnow(),
            ))
        db.flush()
        _, token = make_user(permissions=[("supplier_payments", "view")], branches=[mine])
        r = api(token).get("/api/v1/purchasing/supplier-payments")
        assert r.status_code == 200, r.text
        assert {p["branch_code"] for p in r.json()} <= {mine.branch_code}
        assert api(token).get(f"/api/v1/purchasing/supplier-payments?branch_code={other.branch_code}").status_code == 403


class TestPeekSupplierCosts:
    def test_sales_user_does_not_see_supplier_cost(self, db, api, make_user, make_product, make_supplier):
        from app.modules.purchasing.models import SupplierProduct

        product = make_product()
        db.add(SupplierProduct(supplier_id=make_supplier().id, product_id=product.id, cost_price=777, is_preferred=False, active=True))
        db.flush()
        _, token = make_user(permissions=[("quotations", "view")])
        body = api(token).get(f"/api/v1/peek/product/{product.id}").json()
        assert body["show_supplier_costs"] is False
        assert body["suppliers"] and all("cost_price" not in s for s in body["suppliers"])

    def test_purchaser_still_sees_supplier_cost(self, db, api, make_user, make_product, make_supplier):
        from app.modules.purchasing.models import SupplierProduct

        product = make_product()
        db.add(SupplierProduct(supplier_id=make_supplier().id, product_id=product.id, cost_price=777, is_preferred=False, active=True))
        db.flush()
        _, token = make_user(permissions=[("purchase_orders", "view")])
        body = api(token).get(f"/api/v1/peek/product/{product.id}").json()
        assert body["show_supplier_costs"] is True
        assert body["suppliers"][0]["cost_price"] is not None
