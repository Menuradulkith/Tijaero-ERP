"""
Seed sample data for testing the ERP modules
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.auth.models import User, Group, Permission
from app.modules.customers.models import Customer
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn, SaleReturnItems
from app.modules.employees.models import Employee, EmployeePayroll, EmployeeSalaryProfile, EmployeePromotions, EmployeesAssets
from app.modules.common.models import Country
from app.modules.finance.models import (
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle, CustomerCreditsSettleTransaction,
    SupplierCreditsSettle, SupplierCreditsSettleTransaction,
    BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
)
from app.modules.support.models import CustomerSupport, CSJobItem, CustomerCallLog, WarrantyClaims
from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems, PurchasingReturn, PurchasingReturnItems, GoodReceivedNote, GoodReceivedItems
from app.modules.inventory.models import CompanyAssets
from app.modules.warehouse.models import (
    ItemTransferNote, ItemTransferNoteItems, ItemTransferNoteItemProduct,
    ItemTransferNoteApproved, ItemReceiveNote
)
from app.modules.marketing.models import CustomerCuponCodes, CustomerGiftVoucher, AdvanceReceipt
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Attendance, Leaves
# Settings models removed - not currently implemented
from datetime import datetime, date, timedelta
from decimal import Decimal

def seed_data():
    db: Session = SessionLocal()
    
    try:
        print("🌱 Seeding sample data...")
        
        # Check if data already exists
        existing_customers = db.query(Customer).count()
        if existing_customers > 0:
            print(f"⚠️  Found {existing_customers} existing customers. Clearing old data...")
            # Clear existing data
            db.query(InvoiceItems).delete()
            db.query(Invoice).delete()
            db.query(MinimumPrice).delete()
            db.query(Product).delete()
            db.query(ItemsBrand).delete()
            db.query(Category).delete()
            db.query(Customer).delete()
            db.commit()
            print("✅ Old data cleared.")
        
        # Create Categories
        print("📦 Creating categories...")
        categories = [
            Category(
                name="Electronics",
                category_code="ELEC",
                description="Electronic devices and accessories",
                active=True,
                created_date=datetime.now()
            ),
            Category(
                name="Furniture",
                category_code="FURN",
                description="Office and home furniture",
                active=True,
                created_date=datetime.now()
            ),
            Category(
                name="Stationery",
                category_code="STAT",
                description="Office supplies and stationery",
                active=True,
                created_date=datetime.now()
            ),
            Category(
                name="Computers",
                category_code="COMP",
                description="Computers and accessories",
                active=True,
                created_date=datetime.now()
            ),
            Category(
                name="Appliances",
                category_code="APPL",
                description="Home and office appliances",
                active=True,
                created_date=datetime.now()
            ),
        ]
        db.add_all(categories)
        db.flush()
        
        # Create Brands
        print("🏷️  Creating brands...")
        brands = [
            ItemsBrand(
                brand_name="Samsung",
                brand_code="SAMS",
                description="Samsung Electronics"
            ),
            ItemsBrand(
                brand_name="Apple",
                brand_code="APPL",
                description="Apple Inc."
            ),
            ItemsBrand(
                brand_name="IKEA",
                brand_code="IKEA",
                description="IKEA Furniture"
            ),
            ItemsBrand(
                brand_name="Dell",
                brand_code="DELL",
                description="Dell Technologies"
            ),
            ItemsBrand(
                brand_name="HP",
                brand_code="HP",
                description="HP Inc."
            ),
            ItemsBrand(
                brand_name="Sony",
                brand_code="SONY",
                description="Sony Corporation"
            ),
            ItemsBrand(
                brand_name="LG",
                brand_code="LG",
                description="LG Electronics"
            ),
        ]
        db.add_all(brands)
        db.flush()
        
        # Create Products
        print("📱 Creating products...")
        products = [
            # Electronics
            Product(
                name="Samsung Galaxy S23",
                item_code="SAMS-S23-001",
                model="Galaxy S23",
                item_type="smartphone",
                description="Latest Samsung flagship smartphone with 256GB storage",
                website_active=True,
                website_price=Decimal("999.99"),
                active=True,
                cost_price=Decimal("750.00"),
                category_id=categories[0].id,
                items_brand_id=brands[0].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="iPhone 15 Pro",
                item_code="APPL-IP15-001",
                model="iPhone 15 Pro",
                item_type="smartphone",
                description="Apple iPhone 15 Pro with 512GB storage",
                website_active=True,
                website_price=Decimal("1199.99"),
                active=True,
                cost_price=Decimal("900.00"),
                category_id=categories[0].id,
                items_brand_id=brands[1].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="Samsung 55\" 4K TV",
                item_code="SAMS-TV55-001",
                model="QN55Q80C",
                item_type="television",
                description="55-inch 4K QLED Smart TV",
                website_active=True,
                website_price=Decimal("1299.99"),
                active=True,
                cost_price=Decimal("950.00"),
                category_id=categories[0].id,
                items_brand_id=brands[0].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="Sony WH-1000XM5",
                item_code="SONY-WH1000-001",
                model="WH-1000XM5",
                item_type="headphones",
                description="Premium noise-canceling wireless headphones",
                website_active=True,
                website_price=Decimal("399.99"),
                active=True,
                cost_price=Decimal("280.00"),
                category_id=categories[0].id,
                items_brand_id=brands[5].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            # Furniture
            Product(
                name="Office Desk",
                item_code="IKEA-DESK-001",
                model="BEKANT",
                item_type="furniture",
                description="Adjustable office desk 160x80cm",
                website_active=True,
                website_price=Decimal("299.99"),
                active=True,
                cost_price=Decimal("150.00"),
                category_id=categories[1].id,
                items_brand_id=brands[2].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="Office Chair",
                item_code="IKEA-CHAIR-001",
                model="MARKUS",
                item_type="furniture",
                description="Ergonomic office chair with lumbar support",
                website_active=True,
                website_price=Decimal("199.99"),
                active=True,
                cost_price=Decimal("100.00"),
                category_id=categories[1].id,
                items_brand_id=brands[2].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="Bookshelf",
                item_code="IKEA-SHELF-001",
                model="BILLY",
                item_type="furniture",
                description="Classic bookshelf 80x202cm",
                website_active=True,
                website_price=Decimal("79.99"),
                active=True,
                cost_price=Decimal("40.00"),
                category_id=categories[1].id,
                items_brand_id=brands[2].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            # Computers
            Product(
                name="Dell XPS 15",
                item_code="DELL-XPS15-001",
                model="XPS 15 9530",
                item_type="laptop",
                description="15.6\" laptop with Intel i7, 16GB RAM, 512GB SSD",
                website_active=True,
                website_price=Decimal("1799.99"),
                active=True,
                cost_price=Decimal("1400.00"),
                category_id=categories[3].id,
                items_brand_id=brands[3].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="HP ProBook 450",
                item_code="HP-PB450-001",
                model="ProBook 450 G10",
                item_type="laptop",
                description="Business laptop with Intel i5, 8GB RAM, 256GB SSD",
                website_active=True,
                website_price=Decimal("899.99"),
                active=True,
                cost_price=Decimal("650.00"),
                category_id=categories[3].id,
                items_brand_id=brands[4].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="Dell UltraSharp Monitor",
                item_code="DELL-MON27-001",
                model="U2723DE",
                item_type="monitor",
                description="27\" 4K USB-C monitor",
                website_active=True,
                website_price=Decimal("649.99"),
                active=True,
                cost_price=Decimal("450.00"),
                category_id=categories[3].id,
                items_brand_id=brands[3].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            # Appliances
            Product(
                name="LG Refrigerator",
                item_code="LG-FRIDGE-001",
                model="LRFVS3006S",
                item_type="appliance",
                description="French door refrigerator 30 cu. ft.",
                website_active=True,
                website_price=Decimal("2299.99"),
                active=True,
                cost_price=Decimal("1700.00"),
                category_id=categories[4].id,
                items_brand_id=brands[6].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
            Product(
                name="Samsung Microwave",
                item_code="SAMS-MICRO-001",
                model="MS14K6000AS",
                item_type="appliance",
                description="1.4 cu. ft. countertop microwave",
                website_active=True,
                website_price=Decimal("199.99"),
                active=True,
                cost_price=Decimal("120.00"),
                category_id=categories[4].id,
                items_brand_id=brands[0].id,
                created_date=date.today(),
                added_date=datetime.now()
            ),
        ]
        db.add_all(products)
        db.flush()
        
        # Create minimum prices for products
        print("💰 Creating minimum prices...")
        min_prices = []
        for product in products:
            min_prices.append(
                MinimumPrice(
                    minimum_price=product.cost_price * Decimal("1.1"),  # 10% markup minimum
                    created_date=datetime.now(),
                    product_id=product.id
                )
            )
        db.add_all(min_prices)
        db.flush()
        
        # Create Customers
        print("👥 Creating customers...")
        customers = [
            Customer(
                title="Mr",
                customer_name="John Smith",
                name_in_cheque_card="John Smith",
                occupation="Software Engineer",
                company_name="Tech Corp",
                payment_address="123 Main St, New York, NY 10001",
                delivery_address="123 Main St, New York, NY 10001",
                date_joined=datetime.now() - timedelta(days=180),
                birthdate=date(1985, 5, 15),
                id_card_number="123456789",
                gender="Male",
                civil_status="Married",
                no_of_kids="2",
                email="john.smith@techcorp.com",
                home_contact_number="2125551234",
                mobile_contact_number="9175551234",
                credit_days=30,
                max_credit_limit=10000,
                left_credit_amount=10000,
                active=True,
                initial_credit_amount=10000,
                is_customer_agent=False
            ),
            Customer(
                title="Ms",
                customer_name="Sarah Johnson",
                name_in_cheque_card="Sarah Johnson",
                occupation="Business Owner",
                company_name="Johnson Enterprises",
                payment_address="456 Oak Ave, Los Angeles, CA 90001",
                delivery_address="456 Oak Ave, Los Angeles, CA 90001",
                date_joined=datetime.now() - timedelta(days=120),
                birthdate=date(1990, 8, 22),
                id_card_number="987654321",
                gender="Female",
                civil_status="Single",
                no_of_kids="0",
                email="sarah.johnson@johnsonent.com",
                home_contact_number="3105551234",
                mobile_contact_number="3105555678",
                credit_days=45,
                max_credit_limit=15000,
                left_credit_amount=15000,
                active=True,
                initial_credit_amount=15000,
                is_customer_agent=False
            ),
            Customer(
                title="Mr",
                customer_name="Michael Brown",
                name_in_cheque_card="Michael Brown",
                occupation="Manager",
                company_name="Brown & Associates",
                payment_address="789 Pine Rd, Chicago, IL 60601",
                delivery_address="789 Pine Rd, Chicago, IL 60601",
                date_joined=datetime.now() - timedelta(days=90),
                birthdate=date(1978, 3, 10),
                id_card_number="456789123",
                gender="Male",
                civil_status="Married",
                no_of_kids="3",
                email="michael.brown@brownassoc.com",
                home_contact_number="3125551234",
                mobile_contact_number="3125559876",
                credit_days=60,
                max_credit_limit=20000,
                left_credit_amount=20000,
                active=True,
                initial_credit_amount=20000,
                is_customer_agent=False
            ),
            Customer(
                title="Mrs",
                customer_name="Emily Davis",
                name_in_cheque_card="Emily Davis",
                occupation="Architect",
                company_name="Davis Design Studio",
                payment_address="321 Elm St, Boston, MA 02101",
                delivery_address="321 Elm St, Boston, MA 02101",
                date_joined=datetime.now() - timedelta(days=60),
                birthdate=date(1988, 11, 5),
                id_card_number="789123456",
                gender="Female",
                civil_status="Married",
                no_of_kids="1",
                email="emily.davis@davisdesign.com",
                home_contact_number="6175551234",
                mobile_contact_number="6175558765",
                credit_days=30,
                max_credit_limit=12000,
                left_credit_amount=12000,
                active=True,
                initial_credit_amount=12000,
                is_customer_agent=False
            ),
            Customer(
                title="Mr",
                customer_name="David Wilson",
                name_in_cheque_card="David Wilson",
                occupation="Retail Manager",
                company_name="Wilson Retail Group",
                payment_address="555 Market St, San Francisco, CA 94102",
                delivery_address="555 Market St, San Francisco, CA 94102",
                date_joined=datetime.now() - timedelta(days=30),
                birthdate=date(1982, 7, 18),
                id_card_number="321654987",
                gender="Male",
                civil_status="Single",
                no_of_kids="0",
                email="david.wilson@wilsonretail.com",
                home_contact_number="4155551234",
                mobile_contact_number="4155556543",
                credit_days=45,
                max_credit_limit=18000,
                left_credit_amount=18000,
                active=True,
                initial_credit_amount=18000,
                is_customer_agent=False
            ),
        ]
        db.add_all(customers)
        db.flush()
        
        # Get or create a sales rep (employee)
        print("👔 Getting sales representative...")
        sales_rep = db.query(Employee).first()
        if not sales_rep:
            print("⚠️  No employees found. Creating demo sales rep...")
            sales_rep = Employee(
                employee_name="Demo Sales Rep",
                employee_code="SALES001",
                email="sales@company.com",
                mobile_contact_number="5555551234",
                date_joined=datetime.now(),
                gender="Male",
                civil_status="Single",
                active=True
            )
            db.add(sales_rep)
            db.flush()
        
        # Create Sales Orders (Invoices)
        print("🛒 Creating sales orders...")
        
        # Order 1: John Smith - Electronics order
        invoice1 = Invoice(
            invoice_no="INV-2024-001",
            branch_code="MAIN",
            payment_method="cash",
            remarks="First order from Tech Corp",
            created_date=date.today() - timedelta(days=15),
            customer_id=customers[0].id,
            sale_rep_id=sales_rep.id,
            approval=True,  # This is the boolean column
            approval_id=None,  # This is the FK to approvals table
            bank_transfer_amount=Decimal("0"),
            card_amex_amount=Decimal("0"),
            card_mastercard_amount=Decimal("0"),
            card_visa_amount=Decimal("0"),
            cash_amount=Decimal("1399.98"),
            cheque_date=date.today() - timedelta(days=15),
            cheque_amount=Decimal("0"),
            payment_adjustments=Decimal("0"),
            credit_amount=Decimal("0"),
            cupon_amount=Decimal("0"),
            credit_note_amount=Decimal("0"),
            special=False,
            created_date_time=datetime.now() - timedelta(days=15),
            status=True
        )
        db.add(invoice1)
        db.flush()
        
        # Invoice 1 items
        invoice1_items = [
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("999.99"),
                created_date=datetime.now() - timedelta(days=15),
                invoice_id=invoice1.id,
                product_id=products[0].id,  # Samsung Galaxy S23
                quantity=1,
                minimum_selling_price=Decimal("825.00")
            ),
            InvoiceItems(
                warrenty_month="6",
                selling_price=Decimal("399.99"),
                created_date=datetime.now() - timedelta(days=15),
                invoice_id=invoice1.id,
                product_id=products[3].id,  # Sony Headphones
                quantity=1,
                minimum_selling_price=Decimal("308.00")
            ),
        ]
        db.add_all(invoice1_items)
        
        # Order 2: Sarah Johnson - Office furniture
        invoice2 = Invoice(
            invoice_no="INV-2024-002",
            branch_code="MAIN",
            payment_method="card_visa",
            remarks="Office setup for new location",
            created_date=date.today() - timedelta(days=12),
            customer_id=customers[1].id,
            sale_rep_id=sales_rep.id,
            approval=True,
            approval_id=None,
            bank_transfer_amount=Decimal("0"),
            card_amex_amount=Decimal("0"),
            card_mastercard_amount=Decimal("0"),
            card_visa_amount=Decimal("779.96"),
            cash_amount=Decimal("0"),
            cheque_date=date.today() - timedelta(days=12),
            cheque_amount=Decimal("0"),
            payment_adjustments=Decimal("0"),
            credit_amount=Decimal("0"),
            cupon_amount=Decimal("0"),
            credit_note_amount=Decimal("0"),
            special=False,
            created_date_time=datetime.now() - timedelta(days=12),
            status=True
        )
        db.add(invoice2)
        db.flush()
        
        # Invoice 2 items
        invoice2_items = [
            InvoiceItems(
                warrenty_month="24",
                selling_price=Decimal("299.99"),
                created_date=datetime.now() - timedelta(days=12),
                invoice_id=invoice2.id,
                product_id=products[4].id,  # Office Desk
                quantity=2,
                minimum_selling_price=Decimal("165.00")
            ),
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("179.99"),
                created_date=datetime.now() - timedelta(days=12),
                invoice_id=invoice2.id,
                product_id=products[5].id,  # Office Chair
                quantity=1,
                minimum_selling_price=Decimal("110.00")
            ),
        ]
        db.add_all(invoice2_items)
        
        # Order 3: Michael Brown - Computer equipment
        invoice3 = Invoice(
            invoice_no="INV-2024-003",
            branch_code="MAIN",
            payment_method="bank_transfer",
            remarks="IT equipment for office expansion",
            created_date=date.today() - timedelta(days=8),
            customer_id=customers[2].id,
            sale_rep_id=sales_rep.id,
            approval=True,
            approval_id=None,
            bank_transfer_amount=Decimal("3249.96"),
            card_amex_amount=Decimal("0"),
            card_mastercard_amount=Decimal("0"),
            card_visa_amount=Decimal("0"),
            cash_amount=Decimal("0"),
            cheque_date=date.today() - timedelta(days=8),
            cheque_amount=Decimal("0"),
            payment_adjustments=Decimal("0"),
            credit_amount=Decimal("0"),
            cupon_amount=Decimal("0"),
            credit_note_amount=Decimal("0"),
            special=False,
            created_date_time=datetime.now() - timedelta(days=8),
            status=True
        )
        db.add(invoice3)
        db.flush()
        
        # Invoice 3 items
        invoice3_items = [
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("1799.99"),
                created_date=datetime.now() - timedelta(days=8),
                invoice_id=invoice3.id,
                product_id=products[7].id,  # Dell XPS 15
                quantity=1,
                minimum_selling_price=Decimal("1540.00")
            ),
            InvoiceItems(
                warrenty_month="36",
                selling_price=Decimal("649.99"),
                created_date=datetime.now() - timedelta(days=8),
                invoice_id=invoice3.id,
                product_id=products[9].id,  # Dell Monitor
                quantity=2,
                minimum_selling_price=Decimal("495.00")
            ),
            InvoiceItems(
                warrenty_month="24",
                selling_price=Decimal("149.99"),
                created_date=datetime.now() - timedelta(days=8),
                invoice_id=invoice3.id,
                product_id=products[6].id,  # Bookshelf
                quantity=1,
                minimum_selling_price=Decimal("44.00")
            ),
        ]
        db.add_all(invoice3_items)
        
        # Order 4: Emily Davis - Mixed order
        invoice4 = Invoice(
            invoice_no="INV-2024-004",
            branch_code="MAIN",
            payment_method="credit",
            remarks="Design studio equipment - 30 days credit",
            created_date=date.today() - timedelta(days=5),
            customer_id=customers[3].id,
            sale_rep_id=sales_rep.id,
            approval=True,
            approval_id=None,
            bank_transfer_amount=Decimal("0"),
            card_amex_amount=Decimal("0"),
            card_mastercard_amount=Decimal("0"),
            card_visa_amount=Decimal("0"),
            cash_amount=Decimal("0"),
            cheque_date=date.today() - timedelta(days=5),
            cheque_amount=Decimal("0"),
            payment_adjustments=Decimal("0"),
            credit_amount=Decimal("2099.97"),
            cupon_amount=Decimal("0"),
            credit_note_amount=Decimal("0"),
            special=False,
            created_date_time=datetime.now() - timedelta(days=5),
            status=True
        )
        db.add(invoice4)
        db.flush()
        
        # Invoice 4 items
        invoice4_items = [
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("1299.99"),
                created_date=datetime.now() - timedelta(days=5),
                invoice_id=invoice4.id,
                product_id=products[2].id,  # Samsung TV
                quantity=1,
                minimum_selling_price=Decimal("1045.00")
            ),
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("899.99"),
                created_date=datetime.now() - timedelta(days=5),
                invoice_id=invoice4.id,
                product_id=products[8].id,  # HP Laptop
                quantity=1,
                minimum_selling_price=Decimal("715.00")
            ),
        ]
        db.add_all(invoice4_items)
        
        # Order 5: David Wilson - Recent order
        invoice5 = Invoice(
            invoice_no="INV-2024-005",
            branch_code="MAIN",
            payment_method="card_mastercard",
            remarks="Store equipment purchase",
            created_date=date.today() - timedelta(days=2),
            customer_id=customers[4].id,
            sale_rep_id=sales_rep.id,
            approval=True,
            approval_id=None,
            bank_transfer_amount=Decimal("0"),
            card_amex_amount=Decimal("0"),
            card_mastercard_amount=Decimal("2699.97"),
            card_visa_amount=Decimal("0"),
            cash_amount=Decimal("0"),
            cheque_date=date.today() - timedelta(days=2),
            cheque_amount=Decimal("0"),
            payment_adjustments=Decimal("0"),
            credit_amount=Decimal("0"),
            cupon_amount=Decimal("0"),
            credit_note_amount=Decimal("0"),
            special=False,
            created_date_time=datetime.now() - timedelta(days=2),
            status=True
        )
        db.add(invoice5)
        db.flush()
        
        # Invoice 5 items
        invoice5_items = [
            InvoiceItems(
                warrenty_month="60",
                selling_price=Decimal("2299.99"),
                created_date=datetime.now() - timedelta(days=2),
                invoice_id=invoice5.id,
                product_id=products[10].id,  # LG Refrigerator
                quantity=1,
                minimum_selling_price=Decimal("1870.00")
            ),
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("199.99"),
                created_date=datetime.now() - timedelta(days=2),
                invoice_id=invoice5.id,
                product_id=products[11].id,  # Samsung Microwave
                quantity=2,
                minimum_selling_price=Decimal("132.00")
            ),
        ]
        db.add_all(invoice5_items)
        
        # Order 6: John Smith - Second order
        invoice6 = Invoice(
            invoice_no="INV-2024-006",
            branch_code="MAIN",
            payment_method="cash",
            remarks="Additional equipment",
            created_date=date.today(),
            customer_id=customers[0].id,
            sale_rep_id=sales_rep.id,
            approval=False,
            approval_id=None,
            bank_transfer_amount=Decimal("0"),
            card_amex_amount=Decimal("0"),
            card_mastercard_amount=Decimal("0"),
            card_visa_amount=Decimal("0"),
            cash_amount=Decimal("1199.99"),
            cheque_date=date.today(),
            cheque_amount=Decimal("0"),
            payment_adjustments=Decimal("0"),
            credit_amount=Decimal("0"),
            cupon_amount=Decimal("0"),
            credit_note_amount=Decimal("0"),
            special=False,
            created_date_time=datetime.now(),
            status=True
        )
        db.add(invoice6)
        db.flush()
        
        # Invoice 6 items
        invoice6_items = [
            InvoiceItems(
                warrenty_month="12",
                selling_price=Decimal("1199.99"),
                created_date=datetime.now(),
                invoice_id=invoice6.id,
                product_id=products[1].id,  # iPhone 15 Pro
                quantity=1,
                minimum_selling_price=Decimal("990.00")
            ),
        ]
        db.add_all(invoice6_items)
        
        db.commit()
        
        print("✅ Sample data seeded successfully!")
        print(f"   - {len(categories)} categories")
        print(f"   - {len(brands)} brands")
        print(f"   - {len(products)} products")
        print(f"   - {len(customers)} customers")
        print(f"   - 6 sales orders with multiple items")
        print(f"   - Total order value: $11,129.83")
        print("")
        print("📊 Sales Orders Summary:")
        print("   INV-2024-001: $1,399.98 (Cash)")
        print("   INV-2024-002: $779.96 (Visa)")
        print("   INV-2024-003: $3,249.96 (Bank Transfer)")
        print("   INV-2024-004: $2,099.97 (Credit)")
        print("   INV-2024-005: $2,699.97 (Mastercard)")
        print("   INV-2024-006: $1,199.99 (Cash)")
        
    except Exception as e:
        print(f"❌ Error seeding data: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_data()
