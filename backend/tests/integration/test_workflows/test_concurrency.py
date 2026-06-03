import threading
import uuid
import pytest
from decimal import Decimal
from datetime import date, datetime, timedelta
from typing import List, Dict, Any

from app.db.session import SessionLocal
from app.modules.sales.service import SalesService
from app.modules.purchasing.service import GoodReceivedNoteService
from app.modules.sales import schemas as sales_schemas
from app.modules.purchasing import schemas as purchasing_schemas

# Import models to cleanup and assert
from app.auth.models import Branch, User
from app.core.security import get_password_hash
from app.modules.customers.models import Customer
from app.modules.purchasing.models import (
    Supplier,
    PurchasingOrder,
    PurchasingOrderItems,
    GoodReceivedNote,
    GoodReceivedItems,
)
from app.modules.products.models import Product, Category, ItemsBrand
from app.modules.common.models import Locations
from app.modules.inventory.models import SalesStock
from app.modules.sales.models import Invoice, InvoiceItems, InvoiceItemsBarcode
from app.modules.finance.models import (
    ChequePayments,
    CardPayments,
    BankDeposits,
    CreditPayments,
    CashbookEntryRecord,
)
from app.modules.finance.accounting_models import JournalEntry, JournalEntryLine, GeneralLedger

def _uid(prefix: str = "") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

@pytest.fixture(scope="module")
def shared_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class TestConcurrencyAndRaceConditions:
    """
    Test suite for verifying concurrency and race conditions.
    Creates real database rows, runs concurrent threads, verifies states, and cleans up.
    """

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self, shared_db):
        # We will keep track of all database entities created to clean them up.
        self.cleanup_ids = {
            "invoice_items_barcode": [],
            "invoice_items": [],
            "invoice": [],
            "general_ledger": [],
            "journal_entry_line": [],
            "journal_entry": [],
            "cashbook_entries": [],
            "cheque_payments": [],
            "card_payments": [],
            "bank_deposits": [],
            "credit_payments": [],
            "sales_stock": [],
            "good_received_items": [],
            "good_received_note": [],
            "purchasing_order_items": [],
            "purchasing_orders": [],
            "locations": [],
            "products": [],
            "categories": [],
            "brands": [],
            "customers": [],
            "suppliers": [],
            "branches": [],
            "users": [],
        }

        # Create basic setup data
        db = shared_db
        try:
            # 0. User for sale rep reference
            self.user = User(
                username=_uid("user"),
                email=f"{_uid('mail')}@example.com",
                hashed_password=get_password_hash("Passw0rd!"),
                is_superuser=True,
                first_name="Concurrency",
                last_name="Tester",
                gender="other",
                is_staff=True,
                is_active=True,
                date_joined=date.today(),
                birthdate=date(1990, 1, 1),
                employee_id=_uid("EMP"),
                verify=True,
                blocked=False,
                occupation="tester",
            )
            db.add(self.user)
            db.flush()
            self.cleanup_ids["users"].append(self.user.id)

            # 1. Branch
            self.branch = Branch(
                branch_name=_uid("BrName"),
                branch_code=_uid("BR").upper()[:15],
                address="Concurrency Test Addr",
                active=True
            )
            db.add(self.branch)
            db.flush()
            self.cleanup_ids["branches"].append(self.branch.branch_code)

            # 2. Customer
            self.customer = Customer(
                title="Mr",
                customer_name=_uid("Cust"),
                email=f"{_uid('cust')}@example.com",  # Required for credit check
                payment_address="Pay Address",
                delivery_address="Delivery Address",
                gender="male",
                civil_status="single",
                no_of_kids="0",
                mobile_contact_number="0770000000",
                credit_days=30,
                max_credit_limit=50000, # Rs. 50,000 credit limit
                left_credit_amount=50000,
                initial_credit_amount=50000,
                active=True,
                is_customer_agent=False,
                date_joined=datetime.utcnow()
            )
            db.add(self.customer)
            db.flush()
            self.cleanup_ids["customers"].append(self.customer.id)

            # 3. Supplier
            self.supplier = Supplier(
                title="Mr",
                full_name=_uid("Supp"),
                postal_address="Postal Address",
                permenent_address="Permanent Address",
                gender="male",
                civil_status="single",
                no_of_kids="0",
                mobile_contact_number="0770000000",
                credit_days=30,
                max_credit_limit=1000000,
                active=True,
                date_joined=datetime.utcnow()
            )
            db.add(self.supplier)
            db.flush()
            self.cleanup_ids["suppliers"].append(self.supplier.id)

            # 4. Product setup (category, brand, product)
            self.category = Category(
                name=_uid("Cat"),
                category_code=_uid("CAT")[:10],
                active=True,
                created_date=datetime.utcnow()
            )
            self.brand = ItemsBrand(
                brand_name=_uid("Brand"),
                brand_code=_uid("B")[:4]
            )
            db.add_all([self.category, self.brand])
            db.flush()
            self.cleanup_ids["categories"].append(self.category.id)
            self.cleanup_ids["brands"].append(self.brand.id)

            self.product = Product(
                name=_uid("Prod"),
                item_code=_uid("ITM")[:10],
                item_type="general",
                website_active=False,
                active=True,
                cost_price=100.0,
                selling_price=150.0,
                created_date=date.today(),
                category_id=self.category.id,
                items_brand_id=self.brand.id,
                added_date=datetime.utcnow(),
            )
            db.add(self.product)
            db.flush()
            self.cleanup_ids["products"].append(self.product.id)

            # 5. Location
            self.location = Locations(
                name=_uid("Loc"),
                branch_code=self.branch.branch_code,
                created_date=datetime.utcnow()
            )
            db.add(self.location)
            db.flush()
            self.cleanup_ids["locations"].append(self.location.id)

            # 6. Purchase Order & GRN setup to generate stock
            self.po = PurchasingOrder(
                purchasing_order_no=_uid("PO"),
                branch_code=self.branch.branch_code,
                payment_method="cash",
                purchasing_order_date=date.today(),
                good_received_note_date=date.today(),
                created_date=date.today(),
                first_suppliers_id=self.supplier.id,
                added_date=datetime.utcnow(),
                status="approved"
            )
            db.add(self.po)
            db.flush()
            self.cleanup_ids["purchasing_orders"].append(self.po.id)

            self.po_item = PurchasingOrderItems(
                quantity=10,
                unit_price=100.0,
                warrenty_month="12",
                created_date=date.today(),
                product_id=self.product.id,
                purchasingorders_id=self.po.id,
                added_date=datetime.utcnow()
            )
            db.add(self.po_item)
            db.flush()
            self.cleanup_ids["purchasing_order_items"].append(self.po_item.id)

            self.grn = GoodReceivedNote(
                good_received_no=_uid("GRN"),
                good_received_date=date.today(),
                supplier_invoice_no=_uid("SINV"),
                supplier_invoice_date=date.today(),
                branch_code=self.branch.branch_code,
                created_date=date.today(),
                good_received_locations_id=self.location.id,
                purchasingorders_id=self.po.id,
                added_date=datetime.utcnow()
            )
            db.add(self.grn)
            db.flush()
            self.cleanup_ids["good_received_note"].append(self.grn.id)

            # Add GRN items (which will be linked to sales stock)
            self.barcode_avail = _uid("BC_AV")
            self.grn_item = GoodReceivedItems(
                good_received_note=self.grn.good_received_no,
                barcode=self.barcode_avail,
                branch_code=self.branch.branch_code,
                active=True,
                created_date=date.today(),
                purchasing_order_items_id=self.po_item.id,
                added_date=datetime.utcnow()
            )
            db.add(self.grn_item)
            db.flush()
            self.cleanup_ids["good_received_items"].append(self.grn_item.id)

            # Insert some available SalesStock
            self.stock_item = SalesStock(
                product_id=self.product.id,
                barcode=self.barcode_avail,
                branch_code=self.branch.branch_code,
                location_id=self.location.id,
                good_received_note_id=self.grn.id,
                purchasing_order_items_id=self.po_item.id,
                warranty_month="12",
                status="available",
                is_active=True,
                added_date=datetime.utcnow()
            )
            db.add(self.stock_item)
            db.flush()
            self.cleanup_ids["sales_stock"].append(self.stock_item.id)

            db.commit()
        except Exception as e:
            db.rollback()
            raise e

        yield

        # Teardown: Delete everything created in reverse dependency order
        db = SessionLocal()
        try:
            # Query and collect all linked IDs to prevent FK violations
            # 1. Collect from invoices
            inv_ids = self.cleanup_ids["invoice"]
            if inv_ids:
                invoices = db.query(Invoice).filter(Invoice.id.in_(inv_ids)).all()
                for inv in invoices:
                    if inv.credit_payment_id and inv.credit_payment_id not in self.cleanup_ids["credit_payments"]:
                        self.cleanup_ids["credit_payments"].append(inv.credit_payment_id)
                    if inv.cheque_payment_id and inv.cheque_payment_id not in self.cleanup_ids["cheque_payments"]:
                        self.cleanup_ids["cheque_payments"].append(inv.cheque_payment_id)
                    if inv.bank_transfer_id and inv.bank_transfer_id not in self.cleanup_ids["bank_deposits"]:
                        self.cleanup_ids["bank_deposits"].append(inv.bank_transfer_id)
                    if inv.card_payment_id and inv.card_payment_id not in self.cleanup_ids["card_payments"]:
                        self.cleanup_ids["card_payments"].append(inv.card_payment_id)
                    
                    # Cashbook entries
                    cb_entries = db.query(CashbookEntryRecord).filter(
                        CashbookEntryRecord.source_table == "invoices",
                        CashbookEntryRecord.source_id == inv.id
                    ).all()
                    for cb in cb_entries:
                        if cb.id not in self.cleanup_ids["cashbook_entries"]:
                            self.cleanup_ids["cashbook_entries"].append(cb.id)
                    
                    # Journal Entry, Line, GL
                    jes = db.query(JournalEntry).filter(
                        JournalEntry.description.like(f"%Invoice ID: {inv.id}%")
                    ).all()
                    for je in jes:
                        if je.id not in self.cleanup_ids["journal_entry"]:
                            self.cleanup_ids["journal_entry"].append(je.id)
                        
                        lines = db.query(JournalEntryLine).filter(JournalEntryLine.journal_entry_id == je.id).all()
                        for line in lines:
                            if line.id not in self.cleanup_ids["journal_entry_line"]:
                                self.cleanup_ids["journal_entry_line"].append(line.id)
                                
                        gls = db.query(GeneralLedger).filter(GeneralLedger.journal_entry_id == je.id).all()
                        for gl in gls:
                            if gl.id not in self.cleanup_ids["general_ledger"]:
                                self.cleanup_ids["general_ledger"].append(gl.id)

                # Invoice Items & Barcodes
                inv_items = db.query(InvoiceItems).filter(InvoiceItems.invoice_id.in_(inv_ids)).all()
                for item in inv_items:
                    if item.id not in self.cleanup_ids["invoice_items"]:
                        self.cleanup_ids["invoice_items"].append(item.id)
                    
                    barcodes = db.query(InvoiceItemsBarcode).filter(InvoiceItemsBarcode.invoice_items_id == item.id).all()
                    for bc in barcodes:
                        if bc.id not in self.cleanup_ids["invoice_items_barcode"]:
                            self.cleanup_ids["invoice_items_barcode"].append(bc.id)

            # 2. Collect from GRNs
            grn_ids = self.cleanup_ids["good_received_note"]
            if grn_ids:
                grns = db.query(GoodReceivedNote).filter(GoodReceivedNote.id.in_(grn_ids)).all()
                grn_nos = [g.good_received_no for g in grns]
                if grn_nos:
                    gi_items = db.query(GoodReceivedItems).filter(GoodReceivedItems.good_received_note.in_(grn_nos)).all()
                    for gi in gi_items:
                        if gi.id not in self.cleanup_ids["good_received_items"]:
                            self.cleanup_ids["good_received_items"].append(gi.id)
                    
                    # Stock items
                    stocks = db.query(SalesStock).filter(SalesStock.good_received_note_id.in_(grn_ids)).all()
                    for st in stocks:
                        if st.id not in self.cleanup_ids["sales_stock"]:
                            self.cleanup_ids["sales_stock"].append(st.id)

            # Gather dynamically created IDs/records during tests and delete them in reverse dependency order
            for tbl, model_cls, id_attr in [
                ("invoice_items_barcode", InvoiceItemsBarcode, "id"),
                ("invoice_items", InvoiceItems, "id"),
                ("invoice", Invoice, "id"),
                ("general_ledger", GeneralLedger, "id"),
                ("journal_entry_line", JournalEntryLine, "id"),
                ("journal_entry", JournalEntry, "id"),
                ("cashbook_entries", CashbookEntryRecord, "id"),
                ("cheque_payments", ChequePayments, "id"),
                ("card_payments", CardPayments, "id"),
                ("bank_deposits", BankDeposits, "id"),
                ("credit_payments", CreditPayments, "id"),
                ("sales_stock", SalesStock, "id"),
                ("good_received_items", GoodReceivedItems, "id"),
                ("good_received_note", GoodReceivedNote, "id"),
                ("purchasing_order_items", PurchasingOrderItems, "id"),
                ("purchasing_orders", PurchasingOrder, "id"),
                ("locations", Locations, "id"),
                ("products", Product, "id"),
                ("categories", Category, "id"),
                ("brands", ItemsBrand, "id"),
                ("customers", Customer, "id"),
                ("suppliers", Supplier, "id"),
                ("users", User, "id"),
            ]:
                ids = self.cleanup_ids[tbl]
                if ids:
                    db.query(model_cls).filter(getattr(model_cls, id_attr).in_(ids)).delete(synchronize_session=False)

            # Special cleanup for branches (by code)
            b_codes = self.cleanup_ids["branches"]
            if b_codes:
                db.query(Branch).filter(Branch.branch_code.in_(b_codes)).delete(synchronize_session=False)

            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Teardown error: {e}")
        finally:
            db.close()

    def test_duplicate_invoice_with_barcode(self):
        """
        Test Scenario 1: Two concurrent requests to create an invoice with the same barcode.
        Because of the barcode level locking (with_for_update), one must succeed,
        and the other must fail with a 409 Conflict.
        """
        results = []
        errors = []

        # Local variables to avoid cross-thread session issues
        branch_code = self.branch.branch_code
        customer_id = self.customer.id
        user_id = self.user.id
        product_id = self.product.id
        barcode_avail = self.barcode_avail

        def create_invoice_worker():
            db = SessionLocal()
            try:
                service = SalesService()
                # Create invoice payload
                payload = sales_schemas.InvoiceCreate(
                    branch_code=branch_code,
                    customer_id=customer_id,
                    sale_rep_id=user_id,
                    payment_method="cash",
                    cash_amount=150.0,
                    items=[
                        sales_schemas.InvoiceItemCreate(
                            product_id=product_id,
                            quantity=1,
                            selling_price=150.0,
                            minimum_selling_price=120.0,
                            warrenty_month="12",
                            barcode=barcode_avail
                        )
                    ]
                )
                # Execute creation
                invoice = service.create_invoice(db, payload, user_id=user_id)
                db.commit()
                results.append(invoice)
                # Register created models for cleanup
                self.cleanup_ids["invoice"].append(invoice.id)
            except Exception as e:
                db.rollback()
                import traceback
                print("Worker Exception test1:", e)
                traceback.print_exc()
                errors.append(e)
            finally:
                db.close()

        # Run 2 threads concurrently
        t1 = threading.Thread(target=create_invoice_worker)
        t2 = threading.Thread(target=create_invoice_worker)
        
        t1.start()
        t2.start()
        
        t1.join()
        t2.join()

        # Assertions
        assert len(results) == 1, "Only one invoice should be successfully created"
        assert len(errors) == 1, "One request must fail due to concurrency control"
        assert "no longer available" in str(errors[0]) or "409" in str(errors[0]), \
            f"Expected conflict error, got: {errors[0]}"

    def test_concurrent_invoices_without_barcode_can_oversell(self):
        """
        Test Scenario 2: Two concurrent requests to buy a product WITHOUT specifying a barcode.
        We only have 1 stock item available in sales_stock.
        If there is no row locking / serialization for product availability,
        both requests might see count=1 and succeed, causing overselling (double sell).
        """
        results = []
        errors = []

        # Local variables to avoid cross-thread session issues
        branch_code = self.branch.branch_code
        customer_id = self.customer.id
        user_id = self.user.id
        product_id = self.product.id

        def create_invoice_worker():
            db = SessionLocal()
            try:
                service = SalesService()
                payload = sales_schemas.InvoiceCreate(
                    branch_code=branch_code,
                    customer_id=customer_id,
                    sale_rep_id=user_id,
                    payment_method="cash",
                    cash_amount=150.0,
                    items=[
                        sales_schemas.InvoiceItemCreate(
                            product_id=product_id,
                            quantity=1,
                            selling_price=150.0,
                            minimum_selling_price=120.0,
                            warrenty_month="12",
                            barcode=None  # No barcode
                        )
                    ]
                )
                invoice = service.create_invoice(db, payload, user_id=user_id)
                db.commit()
                results.append(invoice)
                self.cleanup_ids["invoice"].append(invoice.id)
            except Exception as e:
                db.rollback()
                import traceback
                print("Worker Exception test2:", e)
                traceback.print_exc()
                errors.append(e)
            finally:
                db.close()

        t1 = threading.Thread(target=create_invoice_worker)
        t2 = threading.Thread(target=create_invoice_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # If product-level locking is missing, both might succeed (overselling)
        print(f"Without barcode: Succeeded count={len(results)}, Error count={len(errors)}")
        # Ideally, only 1 succeeds:
        assert len(results) == 1, f"Should only allow 1 invoice, but got {len(results)}"
        assert len(errors) == 1, f"Should have 1 error, but got {len(errors)}"

    def test_concurrent_credit_sales_bypass_credit_check(self):
        """
        Test Scenario 3: Two concurrent credit sales for the same customer.
        Customer credit limit is Rs. 50,000.
        We send two concurrent credit sales of Rs. 30,000 each.
        If there is no serialization, both will check current outstanding (which is 0),
        see 30k < 50k, and both succeed. This pushes customer outstanding to 60k (exceeding limit).
        """
        results = []
        errors = []

        # Let's add more stock first so stock availability doesn't block the invoice
        db = SessionLocal()
        try:
            for i in range(10):
                bc = f"BC_CREDIT_{i}_{uuid.uuid4().hex[:5]}"
                g_item = GoodReceivedItems(
                    good_received_note=self.grn.good_received_no,
                    barcode=bc,
                    branch_code=self.branch.branch_code,
                    active=True,
                    created_date=date.today(),
                    purchasing_order_items_id=self.po_item.id,
                    added_date=datetime.utcnow()
                )
                db.add(g_item)
                db.flush()
                self.cleanup_ids["good_received_items"].append(g_item.id)

                stock = SalesStock(
                    product_id=self.product.id,
                    barcode=bc,
                    branch_code=self.branch.branch_code,
                    location_id=self.location.id,
                    good_received_note_id=self.grn.id,
                    purchasing_order_items_id=self.po_item.id,
                    warranty_month="12",
                    status="available",
                    is_active=True,
                    added_date=datetime.utcnow()
                )
                db.add(stock)
                db.flush()
                self.cleanup_ids["sales_stock"].append(stock.id)
            db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

        # Local variables to avoid cross-thread session issues
        branch_code = self.branch.branch_code
        customer_id = self.customer.id
        user_id = self.user.id
        product_id = self.product.id

        def create_credit_invoice_worker(idx):
            db = SessionLocal()
            try:
                service = SalesService()
                payload = sales_schemas.InvoiceCreate(
                    branch_code=branch_code,
                    customer_id=customer_id,
                    sale_rep_id=user_id,
                    payment_method="credit",
                    credit_amount=30000.0, # Rs. 30,000
                    items=[
                        sales_schemas.InvoiceItemCreate(
                            product_id=product_id,
                            quantity=1,
                            selling_price=30000.0,
                            minimum_selling_price=120.0,
                            warrenty_month="12",
                            barcode=None
                        )
                    ]
                )
                invoice = service.create_invoice(db, payload, user_id=user_id)
                db.commit()
                results.append(invoice)
                self.cleanup_ids["invoice"].append(invoice.id)
            except Exception as e:
                db.rollback()
                import traceback
                print("Worker Exception test3:", e)
                traceback.print_exc()
                errors.append(e)
            finally:
                db.close()

        t1 = threading.Thread(target=create_credit_invoice_worker, args=(1,))
        t2 = threading.Thread(target=create_credit_invoice_worker, args=(2,))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Without credit limit serialization, both will succeed, outstanding will be 60k > 50k.
        # With serialization, only 1 should succeed, and the second should block/fail.
        print(f"Credit sale: Succeeded count={len(results)}, Error count={len(errors)}")
        assert len(results) == 1, f"Should only allow 1 credit sale, but got {len(results)}"
        assert len(errors) == 1, f"Should have 1 error, but got {len(errors)}"

    def test_concurrent_grn_same_supplier_invoice(self):
        """
        Test Scenario 5: Two concurrent GRN creations for the same supplier and invoice number.
        Only one must succeed; the other must fail with a 400 Bad Request.
        """
        results = []
        errors = []
        supp_inv_no = _uid("SUPPINV")

        # Local variables to avoid cross-thread session issues
        branch_code = self.branch.branch_code
        location_id = self.location.id
        po_id = self.po.id

        def create_grn_worker():
            db = SessionLocal()
            try:
                service = GoodReceivedNoteService(db)
                payload = purchasing_schemas.GoodReceivedNoteCreate(
                    good_received_date=date.today(),
                    supplier_invoice_no=supp_inv_no,
                    supplier_invoice_date=date.today(),
                    branch_code=branch_code,
                    good_received_locations_id=location_id,
                    purchasingorders_id=po_id,
                    items=[] # Emtpy items is fine for testing GRN note header creation
                )
                grn = service.create(payload)
                self.cleanup_ids["good_received_note"].append(grn.id)
                results.append(grn)
            except Exception as e:
                import traceback
                print("Worker Exception test5:", e)
                traceback.print_exc()
                errors.append(e)
            finally:
                db.close()

        t1 = threading.Thread(target=create_grn_worker)
        t2 = threading.Thread(target=create_grn_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        print(f"GRN: Succeeded count={len(results)}, Error count={len(errors)}")
        assert len(results) == 1, f"Should only allow 1 GRN creation, but got {len(results)}"
        assert len(errors) == 1, f"Should have 1 error, but got {len(errors)}"

    def test_concurrent_grn_item_same_barcode(self):
        """
        Test Scenario 6: Two concurrent GoodReceivedItems creation with the exact same barcode.
        Only one must succeed; the other must fail to prevent duplicate barcode in stock.
        """
        results = []
        errors = []
        test_barcode = _uid("BC_DUP")

        # Local variables to avoid cross-thread session issues
        grn_no = self.grn.good_received_no
        branch_code = self.branch.branch_code
        po_item_id = self.po_item.id

        def create_grn_item_worker():
            db = SessionLocal()
            try:
                service = GoodReceivedNoteService(db)
                payload = purchasing_schemas.GoodReceivedItemCreate(
                    good_received_note=grn_no,
                    barcode=test_barcode,
                    branch_code=branch_code,
                    active=True,
                    created_date=date.today(),
                    purchasing_order_items_id=po_item_id
                )
                item = service.create_item(payload)
                self.cleanup_ids["good_received_items"].append(item.id)
                results.append(item)
            except Exception as e:
                import traceback
                print("Worker Exception test6:", e)
                traceback.print_exc()
                errors.append(e)
            finally:
                db.close()

        t1 = threading.Thread(target=create_grn_item_worker)
        t2 = threading.Thread(target=create_grn_item_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        print(f"GRN Item Barcode: Succeeded count={len(results)}, Error count={len(errors)}")
        assert len(results) == 1, f"Should only allow 1 GRN Item barcode, but got {len(results)}"
        assert len(errors) == 1, f"Should have 1 error, but got {len(errors)}"
