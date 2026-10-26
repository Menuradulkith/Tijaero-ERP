"""Peek: read-only related-record popups for users who cannot open the full page."""

import pytest

PEEK = "/api/v1/peek"


@pytest.fixture
def purchaser(make_user, make_branch):
    """Can create POs but holds none of suppliers:view / products:view / quotations:view."""
    branch = make_branch()
    user, token = make_user(permissions=[("purchase_orders", "view"), ("purchase_orders", "create")], branches=[branch])
    return user, token, branch


def _labels(body):
    return {f["label"]: f["value"] for f in body["fields"]}


class TestSupplierPeek:
    def test_purchaser_sees_what_the_suppliers_page_shows_without_suppliers_view(self, db, api, purchaser, make_supplier):
        _, token, _ = purchaser
        supplier = make_supplier()
        r = api(token).get(f"{PEEK}/supplier/{supplier.id}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kind"] == "supplier" and body["title"] == supplier.company_name
        detail = body["supplier"]
        for key in ("company_name", "credit_days", "max_credit_limit", "billing_address_line1", "email", "lead_time_days"):
            assert key in detail
        assert isinstance(body["contact_persons"], list)
        assert "payment_methods" not in body  # bank / payment details never leave the Suppliers page
        assert detail["company_registration_number"] is None and detail["tax_registration_number"] is None
        assert "can_open_full_page" not in body  # a peek never leads to the full page

    def test_grn_and_return_users_see_the_supplier_without_credit_terms(self, db, api, make_user, make_supplier):
        supplier = make_supplier()
        for perm in (("grn", "view"), ("purchase_returns", "view")):
            _, token = make_user(permissions=[perm])
            r = api(token).get(f"{PEEK}/supplier/{supplier.id}")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["show_payment"] is False
            for key in ("credit_days", "max_credit_limit", "initial_credit_amount", "left_credit_amount"):
                assert key not in body["supplier"]
            assert body["supplier"]["company_name"] == supplier.company_name and "email" in body["supplier"]

    def test_user_with_no_related_permission_is_refused(self, db, api, make_user, make_supplier):
        _, token = make_user(permissions=[("expenses", "view")])
        assert api(token).get(f"{PEEK}/supplier/{make_supplier().id}").status_code == 403

    def test_peek_is_read_only(self, db, api, purchaser, make_supplier):
        _, token, _ = purchaser
        assert api(token).patch(f"{PEEK}/supplier/{make_supplier().id}", json={"company_name": "x"}).status_code in (404, 405)

    def test_missing_record_is_404_and_unknown_type_is_404(self, db, superclient):
        assert superclient.get(f"{PEEK}/supplier/2147483000").status_code == 404
        assert superclient.get(f"{PEEK}/nonsense/1").status_code == 404


class TestProductPeek:
    def test_purchaser_sees_the_page_data_but_no_pricing(self, db, api, purchaser, make_product):
        _, token, _ = purchaser
        product = make_product()
        body = api(token).get(f"{PEEK}/product/{product.id}").json()
        assert body["kind"] == "product" and body["show_pricing"] is False
        detail = body["product"]
        assert detail["item_code"] == product.item_code and "tracking_type" in detail
        for hidden in ("cost_price", "selling_price", "website_price", "minimum_selling_price", "price_tiers"):
            assert hidden not in detail
        assert isinstance(body["suppliers"], list)

    def test_pricing_shown_with_products_view(self, db, api, make_user, make_product):
        _, token = make_user(permissions=[("products", "view")])
        body = api(token).get(f"{PEEK}/product/{make_product().id}").json()
        assert body["show_pricing"] is True
        assert "cost_price" in body["product"] and "selling_price" in body["product"]


class TestQuotationPeek:
    def _quote(self, db, make_branch, make_customer, make_product, branch=None):
        from datetime import date, datetime, timedelta
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem

        branch = branch or make_branch()
        q = SalesQuote(
            quote_no=f"QT-PEEK-{id(branch)}", branch_code=branch.branch_code, customer_id=make_customer().id,
            created_date=date.today(), created_date_time=datetime.now(), valid_until=date.today() + timedelta(days=7),
            status="approved", total_amount=1234,
        )
        db.add(q)
        db.flush()
        db.add(SalesQuoteItem(
            quote_id=q.id, product_id=make_product().id, quantity=3, selling_price=500, minimum_selling_price=400,
            warrenty_month="12", created_date=datetime.now(),
        ))
        db.flush()
        return q

    def test_purchaser_sees_items_and_procurement_but_no_prices(self, db, api, purchaser, make_branch, make_customer, make_product):
        _, token, branch = purchaser
        q = self._quote(db, make_branch, make_customer, make_product, branch)
        body = api(token).get(f"{PEEK}/quotation/{q.id}").json()
        assert body["kind"] == "quotation" and body["title"] == q.quote_no and body["show_pricing"] is False
        quote = body["quote"]
        assert "total_amount" not in quote and "tax_rate" not in quote
        item = quote["items"][0]
        assert item["quantity"] == 3 and item["product_name"]
        for hidden in ("selling_price", "minimum_selling_price", "discount_percentage"):
            assert hidden not in item
        assert isinstance(body["procurement"], list) and isinstance(body["related_purchase_orders"], list)

    def test_quotations_view_user_sees_prices(self, db, api, make_user, make_branch, make_customer, make_product):
        branch = make_branch()
        _, token = make_user(permissions=[("quotations", "view")], branches=[branch])
        q = self._quote(db, make_branch, make_customer, make_product, branch)
        body = api(token).get(f"{PEEK}/quotation/{q.id}").json()
        assert body["show_pricing"] is True
        assert body["quote"]["total_amount"] == 1234 and body["quote"]["items"][0]["selling_price"] == 500

    def test_other_branch_is_refused(self, db, api, purchaser, make_branch, make_customer, make_product):
        _, token, _ = purchaser
        q = self._quote(db, make_branch, make_customer, make_product)  # a different branch
        assert api(token).get(f"{PEEK}/quotation/{q.id}").status_code == 403


class TestSupplierLookupEndpoints:
    """PO / GRN users without suppliers:view can use the supplier pickers, with a trimmed record."""

    def test_purchaser_gets_a_trimmed_supplier_list(self, db, api, purchaser, make_supplier):
        _, token, _ = purchaser
        supplier = make_supplier()
        supplier.company_registration_number = "REG-123"
        supplier.tax_registration_number = "TAX-9"
        db.flush()
        r = api(token).get("/api/v1/purchasing/suppliers")
        assert r.status_code == 200, r.text
        row = next(x for x in r.json() if x["id"] == supplier.id)
        assert row["company_name"] == supplier.company_name and "credit_days" in row
        assert row["company_registration_number"] is None and row["tax_registration_number"] is None
        assert row["logo_path"] is None and row["shipping_address_line1"] is None

    def test_trimming_never_writes_to_the_database(self, db, api, purchaser, make_supplier):
        _, token, _ = purchaser
        supplier = make_supplier()
        supplier.company_registration_number = "REG-KEEP"
        db.flush()
        api(token).get("/api/v1/purchasing/suppliers")
        db.expire_all()
        assert db.get(type(supplier), supplier.id).company_registration_number == "REG-KEEP"

    def test_suppliers_view_user_still_gets_the_full_record(self, db, api, make_user, make_supplier):
        _, token = make_user(permissions=[("suppliers", "view")])
        supplier = make_supplier()
        supplier.company_registration_number = "REG-FULL"
        db.flush()
        row = next(x for x in api(token).get("/api/v1/purchasing/suppliers").json() if x["id"] == supplier.id)
        assert row["company_registration_number"] == "REG-FULL"

    def test_unrelated_user_is_refused(self, db, api, make_user):
        _, token = make_user(permissions=[("expenses", "view")])
        assert api(token).get("/api/v1/purchasing/suppliers").status_code == 403

    def test_purchaser_can_read_supplier_and_product_side_cost_lists(self, db, api, purchaser, make_supplier, make_product):
        _, token, _ = purchaser
        supplier, product = make_supplier(), make_product()
        assert api(token).get(f"/api/v1/purchasing/suppliers/{supplier.id}/products").status_code == 200
        assert api(token).get(f"/api/v1/inventory/products/{product.id}/suppliers").status_code == 200

    def test_payment_methods_stay_behind_suppliers_view(self, db, api, purchaser, make_supplier):
        _, token, _ = purchaser
        assert api(token).get(f"/api/v1/purchasing/suppliers/{make_supplier().id}/payment-methods").status_code == 403


class TestCustomerPeek:
    @pytest.fixture
    def salesperson(self, make_user, make_branch):
        """Can create quotations but holds no customers:view."""
        user, token = make_user(permissions=[("quotations", "view"), ("quotations", "create")], branches=[make_branch()])
        return token

    def _customer(self, db, make_customer):
        customer = make_customer()
        customer.id_card_number = "123456789V"
        customer.tax_registration_number = "TAX-C-1"
        db.flush()
        return customer

    def test_salesperson_sees_the_page_data_without_sensitive_or_bank_fields(self, db, api, salesperson, make_customer):
        customer = self._customer(db, make_customer)
        r = api(salesperson).get(f"{PEEK}/customer/{customer.id}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kind"] == "customer" and body["show_sensitive"] is False
        detail = body["customer"]
        assert detail["customer_no"] == customer.customer_no and "credit_days" in detail
        assert detail["id_card_number"] is None and detail["tax_registration_number"] is None
        assert not any(k.startswith("bank") for k in detail)
        assert isinstance(body["contact_persons"], list)

    def test_customers_view_user_also_gets_identity_numbers_but_never_bank(self, db, api, make_user, make_customer):
        _, token = make_user(permissions=[("customers", "view")])
        customer = self._customer(db, make_customer)
        body = api(token).get(f"{PEEK}/customer/{customer.id}").json()
        assert body["show_sensitive"] is True
        assert body["customer"]["id_card_number"] == "123456789V"
        assert not any(k.startswith("bank") for k in body["customer"])

    def test_unrelated_user_is_refused(self, db, api, make_user, make_customer):
        _, token = make_user(permissions=[("expenses", "view")])
        assert api(token).get(f"{PEEK}/customer/{make_customer().id}").status_code == 403


class TestPurchaseOrderPeek:
    @pytest.fixture
    def storekeeper(self, make_user, make_branch):
        """Receives goods (GRN) but cannot open the Purchase Orders page."""
        branch = make_branch()
        user, token = make_user(permissions=[("grn", "view"), ("grn", "create")], branches=[branch])
        return token, branch

    def _po(self, db, branch, make_supplier, make_product):
        from datetime import date
        from decimal import Decimal
        from app.modules.purchasing import schemas, service

        order = service.PurchasingOrderService(db).create_order(
            schemas.PurchasingOrderCreate(
                branch_code=branch.branch_code, payment_method="non_credit",
                purchasing_order_date=date.today(), good_received_note_date=date.today(),
                first_suppliers_id=make_supplier().id,
                items=[schemas.PurchasingOrderItemCreate(
                    product_id=make_product().id, quantity=4, unit_price=Decimal("75.00"), warrenty_month="12")],
            ),
            created_by=1,
        )
        return order

    def test_storekeeper_sees_the_po_but_no_prices(self, db, api, storekeeper, make_supplier, make_product):
        token, branch = storekeeper
        order = self._po(db, branch, make_supplier, make_product)
        body = api(token).get(f"{PEEK}/purchase-order/{order.id}").json()
        assert body["kind"] == "purchase-order" and body["show_pricing"] is False
        detail = body["order"]
        assert detail["purchasing_order_no"] == order.purchasing_order_no and detail["supplier_name"]
        assert "total_amount" not in detail and "paid_amount" not in detail
        item = detail["items"][0]
        assert item["quantity"] == 4 and item["product_name"] and "unit_price" not in item

    def test_purchase_orders_view_user_sees_prices(self, db, api, make_user, make_branch, make_supplier, make_product):
        branch = make_branch()
        _, token = make_user(permissions=[("purchase_orders", "view")], branches=[branch])
        order = self._po(db, branch, make_supplier, make_product)
        body = api(token).get(f"{PEEK}/purchase-order/{order.id}").json()
        assert body["show_pricing"] is True
        assert float(body["order"]["items"][0]["unit_price"]) == 75.0

    def test_other_branch_is_refused(self, db, api, storekeeper, make_branch, make_supplier, make_product):
        token, _ = storekeeper
        order = self._po(db, make_branch(), make_supplier, make_product)  # a different branch
        assert api(token).get(f"{PEEK}/purchase-order/{order.id}").status_code == 403
