"""
QA test foundation for TijaeroERP.

Strategy
--------
The application runs on a populated PostgreSQL database that depends on
Postgres-specific column types and migration-managed schema, so we do NOT
recreate the schema with SQLite.  Instead every test runs inside an *outer*
transaction that is rolled back on teardown (the classic SQLAlchemy
"join an external transaction" recipe).  Service code is free to call
``db.commit()`` -- a SAVEPOINT is transparently restarted so isolation is
preserved -- yet nothing is ever persisted to the real database.

Key fixtures
------------
``db``           -> isolated SQLAlchemy Session (auto rollback).
``client``       -> FastAPI TestClient whose ``get_db`` is overridden to share
                    the test ``db`` session (unauthenticated).
``make_user``    -> factory: create a User (optionally superuser) with a set of
                    (resource, action) permissions; returns ``(user, token)``.
``make_branch``  -> factory: create a Branch.
``superuser``    -> a ready superuser ``(user, token)``.
``api``          -> helper: preset the bearer token on the shared client.
``superclient``  -> TestClient already authenticated as a superuser.
"""

from __future__ import annotations

import os
import random
import string
import uuid
from datetime import date

os.environ.setdefault("SALES_STATS_CACHE_TTL", "0")  # tests need live numbers
os.environ.setdefault("REPORT_CACHE_TTL", "0")
from typing import Callable, Iterable, Optional, Tuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.orm import Session, sessionmaker

# Register every ORM model on Base.metadata before anything touches the DB.
import app.models  # noqa: F401  (side-effect import)
from app.auth.models import Branch, Permission, User
from app.core.security import (
    create_access_token,
    get_password_hash,
    get_password_marker,
)
from app.db.session import engine as app_engine
from app.db.session import get_db
from app.main import app


# --------------------------------------------------------------------------- #
# Database isolation
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def _connection():
    """A single real DB connection shared across the whole test session."""
    conn = app_engine.connect()
    yield conn
    conn.close()


@pytest.fixture
def db(_connection) -> Session:
    """Function-scoped, fully isolated session bound to an outer transaction.

    The outer transaction is rolled back at the end of each test, so the real
    database is never mutated regardless of how many ``commit()`` calls the
    code under test issues.
    """
    outer = _connection.begin()
    TestingSessionLocal = sessionmaker(
        bind=_connection, autoflush=False, autocommit=False, expire_on_commit=False
    )
    session = TestingSessionLocal()
    # Highest journal / cashbook ids before the test: the ledger checks in
    # tests/money_invariants.py look only at rows written after these.
    session.info["ledger_baseline"] = tuple(session.execute(text(
        "SELECT (SELECT COALESCE(MAX(id), 0) FROM journal_entries),"
        " (SELECT COALESCE(MAX(id), 0) FROM cashbook_entries)"
    )).one())
    session.begin_nested()  # SAVEPOINT

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, transaction):  # pragma: no cover - plumbing
        if transaction.nested and not transaction._parent.nested:
            sess.begin_nested()

    try:
        yield session
    finally:
        event.remove(session, "after_transaction_end", _restart_savepoint)
        session.close()
        outer.rollback()


# --------------------------------------------------------------------------- #
# HTTP client
# --------------------------------------------------------------------------- #
@pytest.fixture
def client(db) -> TestClient:
    """Unauthenticated TestClient sharing the isolated ``db`` session."""

    def _override_get_db():
        yield db

    # app.main wraps the FastAPI app in ProxyHeadersMiddleware, which has no
    # dependency_overrides — set them on the inner FastAPI app, but still send
    # requests through the wrapper so the middleware stack is exercised.
    fastapi_app = getattr(app, "app", app)
    fastapi_app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    fastapi_app.dependency_overrides.pop(get_db, None)


# --------------------------------------------------------------------------- #
# Factories
# --------------------------------------------------------------------------- #
def _unique(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def make_branch(db) -> Callable[..., Branch]:
    def _make_branch(
        *, name: Optional[str] = None, code: Optional[str] = None, active: bool = True
    ) -> Branch:
        branch = Branch(
            branch_name=name or _unique("Test Branch"),
            branch_code=(code or _unique("BR")).upper(),
            address="Test Address",
            active=active,
        )
        db.add(branch)
        db.flush()
        return branch

    return _make_branch


@pytest.fixture
def make_supplier(db) -> Callable[..., object]:
    """Factory for an active (by default) Supplier row."""
    from datetime import datetime

    from app.modules.purchasing.models import Supplier
    from app.modules.purchasing.repository import SupplierRepository

    def _make_supplier(
        *,
        active: bool = True,
        company_name: Optional[str] = None,
        credit_days: int = 30,
        max_credit_limit: int = 1_000_000,
        left_credit_amount: Optional[int] = None,
        initial_credit_amount: Optional[int] = None,
    ) -> Supplier:
        supplier = Supplier(
            supplier_no=SupplierRepository(db).get_next_supplier_no(),
            company_name=company_name or _unique("Supplier"),
            billing_address_line1="Billing Address",
            mobile_contact_number="0770000000",
            credit_days=credit_days,
            max_credit_limit=max_credit_limit,
            left_credit_amount=left_credit_amount,
            initial_credit_amount=initial_credit_amount,
            active=active,
            date_joined=datetime.utcnow(),
        )
        db.add(supplier)
        db.flush()
        return supplier

    return _make_supplier


@pytest.fixture
def make_product(db) -> Callable[..., object]:
    """Factory for an active (by default) Product plus its Category and Brand."""
    from datetime import date as _date
    from datetime import datetime

    from app.modules.products.models import Category, ItemsBrand, Product

    def _make_product(
        *,
        active: bool = True,
        cost_price: int = 100,
        name: Optional[str] = None,
    ) -> Product:
        category = Category(
            name=_unique("Category"),
            category_code=_unique("CAT"),
            active=True,
            created_date=datetime.utcnow(),
        )
        brand = ItemsBrand(
            brand_name=_unique("Brand"),
            # 4-char column: random letters never collide with the app's numeric codes (0001...)
            brand_code="".join(random.choices(string.ascii_uppercase, k=4)),
        )
        db.add_all([category, brand])
        db.flush()
        product = Product(
            name=name or _unique("Product"),
            item_code=_unique("ITM"),
            item_type="general",
            website_active=False,
            active=active,
            cost_price=cost_price,
            created_date=_date.today(),
            category_id=category.id,
            items_brand_id=brand.id,
            added_date=datetime.utcnow(),
        )
        db.add(product)
        db.flush()
        return product

    return _make_product


@pytest.fixture
def make_customer(db) -> Callable[..., object]:
    """Factory for an active (by default) Customer row."""
    from datetime import datetime

    from app.modules.customers.models import Customer
    from app.modules.customers.repository import CustomerRepository

    def _make_customer(
        *,
        active: bool = True,
        name: Optional[str] = None,
        is_customer_agent: bool = False,
        credit_days: int = 30,
        max_credit_limit: int = 1_000_000,
        left_credit_amount: Optional[int] = None,
        initial_credit_amount: Optional[int] = None,
    ) -> Customer:
        customer = Customer(
            customer_no=CustomerRepository().get_next_customer_no(db),
            title="Mr",
            customer_name=name or _unique("Customer"),
            payment_address="Pay Address",
            delivery_address="Delivery Address",
            gender="male",
            civil_status="single",
            no_of_kids="0",
            mobile_contact_number="0770000000",
            credit_days=credit_days,
            max_credit_limit=max_credit_limit,
            left_credit_amount=left_credit_amount,
            initial_credit_amount=initial_credit_amount,
            active=active,
            is_customer_agent=is_customer_agent,
            date_joined=datetime.utcnow(),
        )
        db.add(customer)
        db.flush()
        return customer

    return _make_customer


@pytest.fixture
def make_location(db, make_branch) -> Callable[..., object]:
    """Factory for a Locations (good_received_locations) row."""
    from datetime import datetime

    from app.modules.common.models import Locations

    def _make_location(
        *,
        branch=None,
        branch_code: Optional[str] = None,
        name: Optional[str] = None,
    ):
        if branch_code is None:
            branch_code = (branch.branch_code if branch else make_branch().branch_code)
        location = Locations(
            name=name or _unique("Location"),
            branch_code=branch_code,
            created_date=datetime.utcnow(),
        )
        db.add(location)
        db.flush()
        return location

    return _make_location


@pytest.fixture
def make_sales_stock(db, make_product, make_branch, make_supplier, make_location):
    """Factory for a SalesStock row.

    SalesStock has NOT-NULL FKs to a GRN and a purchasing-order item, so this
    helper transparently builds the minimal Supplier -> PO -> PO-item -> GRN
    chain it needs and returns the persisted ``SalesStock`` instance.
    """
    from datetime import date as _date
    from datetime import datetime

    from app.modules.purchasing.models import (
        GoodReceivedNote,
        PurchasingOrder,
        PurchasingOrderItems,
    )
    from app.common.enums import StockStatus

    def _make_sales_stock(
        *,
        product=None,
        branch=None,
        location=None,
        barcode: Optional[str] = None,
        status: str = StockStatus.AVAILABLE,
        is_active: bool = True,
        branch_code: Optional[str] = None,
    ):
        product = product or make_product()
        if branch is None and branch_code is None:
            branch = make_branch()
        bcode = branch_code or branch.branch_code
        location = location or make_location(branch_code=bcode)
        supplier = make_supplier()

        po = PurchasingOrder(
            purchasing_order_no=_unique("PO"),
            branch_code=bcode,
            payment_method="cash",
            purchasing_order_date=_date.today(),
            good_received_note_date=_date.today(),
            created_date=_date.today(),
            first_suppliers_id=supplier.id,
            added_date=datetime.utcnow(),
            status="approved",
        )
        db.add(po)
        db.flush()

        po_item = PurchasingOrderItems(
            quantity=1,
            unit_price=100,
            warrenty_month="12",
            created_date=_date.today(),
            product_id=product.id,
            purchasingorders_id=po.id,
            added_date=datetime.utcnow(),
        )
        db.add(po_item)
        db.flush()

        grn = GoodReceivedNote(
            good_received_no=_unique("GRN"),
            good_received_date=_date.today(),
            supplier_invoice_no=_unique("SINV"),
            supplier_invoice_date=_date.today(),
            branch_code=bcode,
            created_date=_date.today(),
            good_received_locations_id=location.id,
            purchasingorders_id=po.id,
            added_date=datetime.utcnow(),
        )
        db.add(grn)
        db.flush()

        stock = models_SalesStock(
            product_id=product.id,
            barcode=barcode or _unique("BC"),
            branch_code=bcode,
            location_id=location.id,
            good_received_note_id=grn.id,
            purchasing_order_items_id=po_item.id,
            status=status,
            is_active=is_active,
            added_date=datetime.utcnow(),
        )
        db.add(stock)
        db.flush()
        return stock

    from app.modules.inventory.models import SalesStock as models_SalesStock

    return _make_sales_stock


@pytest.fixture
def make_account(db) -> Callable[..., object]:
    """Factory for a ChartOfAccounts row."""
    from app.modules.finance.accounting_models import ChartOfAccounts

    def _make_account(
        *,
        account_type: str = "Asset",
        normal_balance: str = "Debit",
        is_active: bool = True,
        is_system_account: bool = False,
        code: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ChartOfAccounts:
        account = ChartOfAccounts(
            account_code=code or _unique("ACC"),
            account_name=name or _unique("Account"),
            account_type=account_type,
            normal_balance=normal_balance,
            is_active=is_active,
            is_system_account=is_system_account,
        )
        db.add(account)
        db.flush()
        return account

    return _make_account


@pytest.fixture
def make_employee(db, make_user) -> Callable[..., object]:
    """Factory for an Employee (with its backing User)."""
    from app.modules.employees.models import Employee

    def _make_employee(*, employee_id: Optional[str] = None, user=None):
        if user is None:
            user, _token = make_user()
        employee = Employee(
            user_id=user.id,
            employee_id=employee_id or _unique("EMP"),
        )
        db.add(employee)
        db.flush()
        return employee

    return _make_employee


@pytest.fixture
def make_user(db) -> Callable[..., Tuple[User, str]]:
    """Factory that creates a User and returns ``(user, bearer_token)``."""

    def _make_user(
        *,
        is_superuser: bool = False,
        permissions: Optional[Iterable[Tuple[str, str]]] = None,
        branches: Optional[Iterable[Branch]] = None,
        password: str = "Passw0rd!",
        is_active: bool = True,
    ) -> Tuple[User, str]:
        hashed = get_password_hash(password)
        user = User(
            username=_unique("user"),
            email=f"{_unique('mail')}@example.com",
            hashed_password=hashed,
            is_superuser=is_superuser,
            first_name="Test",
            last_name="User",
            gender="other",
            is_staff=True,
            is_active=is_active,
            date_joined=date.today(),
            birthdate=date(1990, 1, 1),
            employee_id=_unique("EMP"),
            verify=True,
            blocked=False,
            occupation="tester",
        )

        for resource, action in permissions or []:
            perm = (
                db.query(Permission)
                .filter(Permission.resource == resource, Permission.action == action)
                .first()
            )
            if perm is None:
                perm = Permission(
                    name=_unique(f"{resource}.{action}"),
                    resource=resource,
                    action=action,
                )
                db.add(perm)
                db.flush()
            user.permissions.append(perm)

        for branch in branches or []:
            user.branches.append(branch)

        db.add(user)
        db.flush()

        token = create_access_token(
            {"sub": str(user.id), "pwd": get_password_marker(hashed)}
        )
        return user, token

    return _make_user


@pytest.fixture
def superuser(make_user) -> Tuple[User, str]:
    return make_user(is_superuser=True)


@pytest.fixture
def api(client) -> Callable[[str], TestClient]:
    """Return a helper that presets the bearer token on the shared client."""

    def _api(token: str) -> TestClient:
        client.headers.update({"Authorization": f"Bearer {token}"})
        return client

    return _api


@pytest.fixture
def superclient(client, superuser) -> TestClient:
    _user, token = superuser
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


@pytest.fixture(autouse=True)
def _clear_user_cache():
    """The authenticated-user cache is process-local; never let it leak between tests."""
    from app.auth import user_cache

    user_cache.clear()
    yield
    user_cache.clear()


class _SharedTestSession:
    """Stand-in for an independent ``SessionLocal()`` inside a test: writes go
    into the test's transaction (rolled back afterwards) instead of committing
    to the real database. commit() only flushes; close() is a no-op."""

    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    def commit(self):
        self._real.flush()

    def close(self):
        pass


@pytest.fixture(autouse=True)
def _no_independent_sessions(request, monkeypatch):
    """Code that opens its own ``SessionLocal()`` (GL posting-failure recorder,
    e-mail log, alerts) used to commit straight into the shared dev database,
    leaving permanent rows behind every test run. Route it into the test
    session when the test has one."""
    if "db" not in request.fixturenames:
        yield
        return
    db = request.getfixturevalue("db")
    monkeypatch.setattr("app.db.session.SessionLocal", lambda: _SharedTestSession(db))
    yield


def product_master_ids(client) -> dict:
    """Product type + HS code + family a product create needs since the 2026-11-20 product master fields."""
    import random
    import uuid as _uuid
    pt = client.post("/api/v1/inventory/product-types/", json={"name": f"QA Type {_uuid.uuid4().hex[:8]}"})
    assert pt.status_code == 201, pt.text
    code = f"{random.randint(1000, 9999)}.{random.randint(10, 99)}.{random.randint(10, 99)}"
    hs = client.post("/api/v1/inventory/hs-codes/", json={"code": code, "description": "QA"})
    assert hs.status_code == 201, hs.text
    return {"product_type_id": pt.json()["id"], "hs_code_id": hs.json()["id"], "product_family": "QA Family"}


def purchasable_item(db, supplier, cost=100, *, product=None, tracking_type=None, moq=None, tax_rate=None,
                     preferred=False, name=None):
    """An Item Catalog item that ``supplier`` sells at ``cost`` (central stock phase 3: POs buy items).

    With ``product`` the product's item is used (created from the product when it has none, as
    for a stocked product) and the product is linked to it; otherwise a new raw item no product
    sells. ``tracking_type`` / ``tax_rate`` override the item's. Returns the Material."""
    from datetime import date as _date
    from datetime import datetime

    from app.modules.materials.from_product import item_for_product
    from app.modules.materials.models import Material, MaterialCategory, MaterialSupplier

    if product is not None:
        material = db.get(Material, product.material_id) if product.material_id else item_for_product(db, product)
        product.material_id = material.id
    else:
        category = MaterialCategory(name=_unique("MatCat"), category_code=_unique("MC"), active=True,
                                    created_date=datetime.utcnow())
        db.add(category)
        db.flush()
        material = Material(
            name=name or _unique("Item"), item_code=_unique("MAT"), item_type="stock_item", unit_of_measure="pcs",
            tracking_type=tracking_type or "serial", website_active=False, active=True, cost_price=cost,
            tax_rate=tax_rate or 0, created_date=_date.today(), category_id=category.id,
            added_date=datetime.utcnow(), product_family="QA",
        )
        db.add(material)
    if tracking_type:
        material.tracking_type = tracking_type
    if tax_rate is not None:
        material.tax_rate = tax_rate
    db.flush()
    link = db.query(MaterialSupplier).filter(MaterialSupplier.material_id == material.id,
                                             MaterialSupplier.supplier_id == supplier.id).first()
    if link is None:
        db.add(MaterialSupplier(material_id=material.id, supplier_id=supplier.id, cost_price=cost,
                                minimum_order_qty=moq, is_preferred=preferred, active=True))
    else:
        link.cost_price, link.minimum_order_qty, link.active = cost, moq, True
    db.flush()
    return material


@pytest.fixture
def make_purchasable_item(db):
    """Factory: ``make_purchasable_item(supplier, cost=100, product=None, ...)`` -> Material (see purchasable_item)."""
    def _make(supplier, cost=100, **kw):
        return purchasable_item(db, supplier, cost, **kw)
    return _make


def item_id_for(product, supplier, cost=100, **kw) -> int:
    """material_id a PO line uses to buy ``product`` from ``supplier`` (objects or ids): the product's
    item with an active price from that supplier (see purchasable_item). Works inside any test that
    has the ``db`` fixture (directly or via client / superclient), through the shared test session."""
    import app.db.session as _session
    from app.modules.products.models import Product
    from app.modules.purchasing.models import Supplier

    db = _session.SessionLocal()
    db = getattr(db, "_real", db)
    if isinstance(product, int):
        product = db.get(Product, product)
    if isinstance(supplier, int):
        supplier = db.get(Supplier, supplier)
    if supplier is None:  # unknown supplier (tests of that error): the product's item, no link
        from app.modules.materials.from_product import item_for_product
        if not product.material_id:
            product.material_id = item_for_product(db, product).id
            db.flush()
        return product.material_id
    return purchasable_item(db, supplier, cost, product=product, **kw).id


def mfg_item(db, product) -> int:
    """material_id manufacturing uses for ``product`` (central stock phase 4: BOMs, orders and
    reorder rules take Item Catalog items): the product's item, created from the product when
    it has none (its tracking, shelf life, QC flag and cost are copied at that moment), with
    the product's existing stock rows and ledger lines pointed at it. Returns the item id."""
    from app.modules.inventory.ledger import StockTransaction
    from app.modules.inventory.models import SalesStock
    from app.modules.materials.from_product import item_for_product

    if not product.material_id:
        product.material_id = item_for_product(db, product).id
        db.flush()
    for model in (SalesStock, StockTransaction):
        (db.query(model).filter(model.product_id == product.id, model.material_id.is_(None))
         .update({model.material_id: product.material_id}, synchronize_session="fetch"))
    db.flush()
    return product.material_id
