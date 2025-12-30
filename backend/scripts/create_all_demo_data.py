#!/usr/bin/env python3
"""
Create comprehensive demo data for the entire ERP system
"""
import sys
import os
from datetime import datetime, timedelta
from decimal import Decimal
import random

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Load environment variables
from dotenv import load_dotenv
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.customers.models import Customer
from app.modules.products.models import Product, Category, ItemsBrand
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, Expenses,
    CustomerAdvancePayments, CustomerCreditNotes
)
# Import all models to ensure relationships are configured
import app.models  # noqa: F401


def create_demo_customers(db: Session, count: int = 20):
    """Create demo customers"""
    print(f"Creating {count} demo customers...")
    
    titles = ["Mr", "Mrs", "Ms", "Dr"]
    genders = ["Male", "Female"]
    civil_statuses = ["Single", "Married", "Divorced"]
    
    first_names = ["John", "Jane", "Michael", "Sarah", "David", "Emily", "Robert", "Lisa", "James", "Maria"]
    last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"]
    companies = ["Tech Solutions", "Global Trading", "Smart Systems", "Prime Services", "Elite Corp"]
    
    customers = []
    for i in range(count):
        first_name = random.choice(first_names)
        last_name = random.choice(last_names)
        
        customer = Customer(
            title=random.choice(titles),
            customer_name=f"{first_name} {last_name}",
            name_in_cheque_card=f"{first_name} {last_name}",
            occupation=random.choice(["Engineer", "Manager", "Director", "Consultant", "Business Owner"]),
            company_name=random.choice(companies) if random.random() > 0.5 else None,
            payment_address=f"{random.randint(1, 999)} Main Street, City {random.randint(1, 10)}",
            delivery_address=f"{random.randint(1, 999)} Delivery Ave, City {random.randint(1, 10)}",
            date_joined=datetime.now() - timedelta(days=random.randint(30, 365)),
            birthdate=(datetime.now() - timedelta(days=random.randint(7300, 18250))).date(),
            gender=random.choice(genders),
            civil_status=random.choice(civil_statuses),
            no_of_kids=str(random.randint(0, 4)),
            email=f"{first_name.lower()}.{last_name.lower()}@example.com",
            mobile_contact_number=f"07{random.randint(10000000, 99999999)}",
            credit_days=random.choice([0, 7, 15, 30, 45, 60]),
            max_credit_limit=random.randint(5000, 50000),
            left_credit_amount=random.randint(0, 10000),
            initial_credit_amount=0,
            active=True,
            is_customer_agent=False
        )
        customers.append(customer)
    
    db.add_all(customers)
    db.commit()
    print(f"✓ Created {count} customers")
    return customers


def create_demo_categories(db: Session):
    """Create demo product categories"""
    print("Creating demo categories...")
    
    categories_data = [
        ("Electronics", "ELEC", "Electronic devices and accessories"),
        ("Computers", "COMP", "Computers and computer accessories"),
        ("Mobile Phones", "MOBL", "Mobile phones and accessories"),
        ("Home Appliances", "HOME", "Home and kitchen appliances"),
        ("Office Equipment", "OFFC", "Office furniture and equipment"),
    ]
    
    categories = []
    for name, code, desc in categories_data:
        category = Category(
            name=name,
            category_code=code,
            description=desc,
            active=True,
            created_date=datetime.now()
        )
        categories.append(category)
    
    db.add_all(categories)
    db.commit()
    print(f"✓ Created {len(categories)} categories")
    return categories


def create_demo_brands(db: Session):
    """Create demo product brands"""
    print("Creating demo brands...")
    
    brands_data = [
        ("Samsung", "SAMS", "Samsung Electronics"),
        ("Apple", "APPL", "Apple Inc."),
        ("Sony", "SONY", "Sony Corporation"),
        ("LG", "LG", "LG Electronics"),
        ("Dell", "DELL", "Dell Technologies"),
        ("HP", "HP", "HP Inc."),
        ("Lenovo", "LENO", "Lenovo Group"),
    ]
    
    brands = []
    for name, code, desc in brands_data:
        brand = ItemsBrand(
            brand_name=name,
            brand_code=code,
            description=desc
        )
        brands.append(brand)
    
    db.add_all(brands)
    db.commit()
    print(f"✓ Created {len(brands)} brands")
    return brands


def create_demo_products(db: Session, categories, brands, count: int = 30):
    """Create demo products"""
    print(f"Creating {count} demo products...")
    
    product_names = [
        "Laptop", "Desktop Computer", "Monitor", "Keyboard", "Mouse",
        "Smartphone", "Tablet", "Headphones", "Speaker", "Webcam",
        "Printer", "Scanner", "Router", "Hard Drive", "SSD",
        "RAM Module", "Graphics Card", "Processor", "Motherboard", "Power Supply",
        "TV", "Refrigerator", "Washing Machine", "Microwave", "Air Conditioner",
        "Office Chair", "Desk", "Filing Cabinet", "Projector", "Whiteboard"
    ]
    
    products = []
    for i in range(min(count, len(product_names))):
        product = Product(
            name=product_names[i],
            item_code=f"PROD{str(i+1).zfill(4)}",
            model=f"Model-{random.randint(100, 999)}",
            item_type="Product",
            description=f"High quality {product_names[i].lower()} for professional use",
            website_active=random.random() > 0.3,
            website_price=Decimal(random.uniform(100, 5000)).quantize(Decimal('0.01')),
            active=True,
            cost_price=Decimal(random.uniform(50, 3000)).quantize(Decimal('0.01')),
            created_date=datetime.now().date(),
            category_id=random.choice(categories).id,
            items_brand_id=random.choice(brands).id,
            added_date=datetime.now()
        )
        products.append(product)
    
    db.add_all(products)
    db.commit()
    print(f"✓ Created {len(products)} products")
    return products


def create_finance_demo_data(db: Session, customers):
    """Create all finance demo data"""
    print("\nCreating Finance demo data...")
    
    # Bank Deposits
    print("  • Creating bank deposits...")
    banks = ["ABC Bank", "XYZ Bank", "National Bank", "City Bank"]
    branches = ["BR001", "BR002", "BR003"]
    
    deposits = []
    for i in range(20):
        date = datetime.now() - timedelta(days=random.randint(0, 90))
        deposit = BankDeposits(
            deposits_amount=Decimal(random.uniform(100, 10000)).quantize(Decimal('0.01')),
            remarks=f"Customer payment - Demo {i+1}",
            created_date=date,
            branch_code=random.choice(branches),
            bank_name=random.choice(banks),
            payment_for="Customer Payment",
            invoice_no=f"INV{random.randint(1000, 9999)}",
            verified=random.random() > 0.4,
            returned=False
        )
        deposits.append(deposit)
    db.add_all(deposits)
    
    # Card Payments
    print("  • Creating card payments...")
    card_types = ["VISA", "MASTERCARD", "AMEX"]
    payments = []
    for i in range(30):
        date = datetime.now() - timedelta(days=random.randint(0, 60))
        payment = CardPayments(
            card_type=random.choice(card_types),
            amount=Decimal(random.uniform(50, 5000)).quantize(Decimal('0.01')),
            date_time=date,
            remark=f"Card payment {i+1}",
            ref_number=f"REF{random.randint(100000, 999999)}",
            invoice_no=f"INV{random.randint(1000, 9999)}",
            deposited=random.random() > 0.3
        )
        payments.append(payment)
    db.add_all(payments)
    
    # Cheque Payments
    print("  • Creating cheque payments...")
    parties = ["John Doe", "ABC Company", "XYZ Corp", "Smith & Sons"]
    cheques = []
    for i in range(15):
        cheque_date = datetime.now() - timedelta(days=random.randint(0, 30))
        deposit_date = cheque_date + timedelta(days=random.randint(1, 7))
        cheque = ChequePayments(
            cheque_number=random.randint(100000, 999999),
            branch_code=random.randint(1001, 1005),
            from_party=random.choice(parties),
            bank=random.choice(banks),
            amount=Decimal(random.uniform(500, 15000)).quantize(Decimal('0.01')),
            cheque_date=cheque_date.date(),
            deposit_date=deposit_date.date(),
            remark=f"Cheque payment {i+1}",
            payment_for="Invoice Payment",
            invoice_no=f"INV{random.randint(1000, 9999)}"
        )
        cheques.append(cheque)
    db.add_all(cheques)
    
    # Expenses
    print("  • Creating expenses...")
    expense_methods = ["cash", "card", "cheque", "bank_transfer"]
    expense_types = ["Office Supplies", "Utilities", "Rent", "Marketing", "Transportation"]
    expenses = []
    for i in range(25):
        date = datetime.now() - timedelta(days=random.randint(0, 90))
        expense = Expenses(
            expenses_no=f"EXP{str(i+1).zfill(4)}",
            expenses_method=random.choice(expense_methods),
            expense_amount=Decimal(random.uniform(50, 5000)).quantize(Decimal('0.01')),
            remarks=f"{random.choice(expense_types)} - Demo {i+1}",
            created_date=date.date(),
            branch_code=random.choice(branches),
            bill_reference=f"BILL{random.randint(1000, 9999)}"
        )
        expenses.append(expense)
    db.add_all(expenses)
    
    # Advance Payments
    print("  • Creating advance payments...")
    payment_methods = ["cash", "card", "cheque", "bank_transfer"]
    advances = []
    for i in range(15):
        date = datetime.now() - timedelta(days=random.randint(0, 60))
        advance = CustomerAdvancePayments(
            advance_payments_no=f"ADV{str(i+1).zfill(4)}",
            payment_method=random.choice(payment_methods),
            branch_code=random.choice(branches),
            payment_amount=Decimal(random.uniform(500, 10000)).quantize(Decimal('0.01')),
            remarks=f"Advance payment for future order - Demo {i+1}",
            created_date=date.date(),
            customer_id=random.choice(customers).id,
            cheque_date=date.date(),
            active=True
        )
        advances.append(advance)
    db.add_all(advances)
    
    # Credit Notes
    print("  • Creating credit notes...")
    reasons = ["Product return", "Service issue", "Overcharge", "Goodwill gesture"]
    notes = []
    for i in range(12):
        date = datetime.now() - timedelta(days=random.randint(0, 90))
        note = CustomerCreditNotes(
            customer_id=random.choice(customers).id,
            date=date,
            amount=Decimal(random.uniform(50, 2000)).quantize(Decimal('0.01')),
            remark=f"{random.choice(reasons)} - Demo {i+1}",
            invoice_no=f"INV{random.randint(1000, 9999)}"
        )
        notes.append(note)
    db.add_all(notes)
    
    db.commit()
    print("✓ Finance demo data created")


def main():
    """Main function to create all demo data"""
    print("\n" + "="*70)
    print(" "*15 + "ERP SYSTEM - DEMO DATA CREATION")
    print("="*70 + "\n")
    
    db = SessionLocal()
    
    try:
        # Create base data
        customers = create_demo_customers(db, count=20)
        categories = create_demo_categories(db)
        brands = create_demo_brands(db)
        products = create_demo_products(db, categories, brands, count=30)
        
        # Create finance data
        create_finance_demo_data(db, customers)
        
        print("\n" + "="*70)
        print("✓ ALL DEMO DATA CREATED SUCCESSFULLY!")
        print("="*70)
        print("\nData Summary:")
        print("  📊 Master Data:")
        print("     • 20 Customers")
        print("     • 5 Product Categories")
        print("     • 7 Product Brands")
        print("     • 30 Products")
        print("\n  💰 Finance Data:")
        print("     • 20 Bank Deposits")
        print("     • 30 Card Payments")
        print("     • 15 Cheque Payments")
        print("     • 25 Expenses")
        print("     • 15 Advance Payments")
        print("     • 12 Credit Notes")
        print("\n  📈 Total Records: 179")
        print("="*70)
        print("\n🎉 You can now explore the system with realistic demo data!")
        print("\n📍 Access the application:")
        print("   Frontend: http://localhost:3000")
        print("   Backend API: http://localhost:8000/docs")
        print("\n🔐 Login credentials:")
        print("   Username: admin")
        print("   Password: admin123")
        print("\n💡 Navigate to Finance module to see all the demo data!")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"\n✗ Error creating demo data: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
