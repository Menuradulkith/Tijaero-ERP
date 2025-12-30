#!/usr/bin/env python3
"""
Create demo data for Finance module
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
from app.modules.finance.models import (
    BankDeposits,
    CardPayments,
    ChequePayments,
    Expenses,
    CustomerAdvancePayments,
    CustomerCreditNotes,
)
from app.modules.customers.models import Customer
# Import all models to ensure relationships are configured
import app.models  # noqa: F401


def create_demo_bank_deposits(db: Session, count: int = 20):
    """Create demo bank deposits"""
    print(f"Creating {count} demo bank deposits...")
    
    banks = ["ABC Bank", "XYZ Bank", "National Bank", "City Bank", "Trust Bank"]
    branches = ["BR001", "BR002", "BR003", "BR004"]
    payment_purposes = ["Customer Payment", "Supplier Refund", "Service Payment", "Product Sale"]
    
    deposits = []
    for i in range(count):
        date = datetime.now() - timedelta(days=random.randint(0, 90))
        deposit = BankDeposits(
            deposits_amount=Decimal(random.uniform(100, 10000)).quantize(Decimal('0.01')),
            remarks=f"Demo deposit {i+1} - {random.choice(['Regular payment', 'Bulk deposit', 'Monthly collection'])}",
            created_date=date,
            branch_code=random.choice(branches),
            bank_name=random.choice(banks),
            payment_for=random.choice(payment_purposes),
            invoice_no=f"INV{random.randint(1000, 9999)}" if random.random() > 0.3 else None,
            verified=random.random() > 0.4,  # 60% verified
            returned=False
        )
        deposits.append(deposit)
    
    db.add_all(deposits)
    db.commit()
    print(f"✓ Created {count} bank deposits")


def create_demo_card_payments(db: Session, count: int = 30):
    """Create demo card payments"""
    print(f"Creating {count} demo card payments...")
    
    card_types = ["VISA", "MASTERCARD", "AMEX"]
    
    payments = []
    for i in range(count):
        date = datetime.now() - timedelta(days=random.randint(0, 60))
        payment = CardPayments(
            card_type=random.choice(card_types),
            amount=Decimal(random.uniform(50, 5000)).quantize(Decimal('0.01')),
            date_time=date,
            remark=f"Demo card payment {i+1}",
            ref_number=f"REF{random.randint(100000, 999999)}",
            invoice_no=f"INV{random.randint(1000, 9999)}" if random.random() > 0.2 else None,
            deposited=random.random() > 0.3  # 70% deposited
        )
        payments.append(payment)
    
    db.add_all(payments)
    db.commit()
    print(f"✓ Created {count} card payments")


def create_demo_cheque_payments(db: Session, count: int = 15):
    """Create demo cheque payments"""
    print(f"Creating {count} demo cheque payments...")
    
    banks = ["ABC Bank", "XYZ Bank", "National Bank", "City Bank"]
    parties = ["John Doe", "ABC Company", "XYZ Corp", "Smith & Sons", "Global Trading"]
    branches = [1001, 1002, 1003, 1004, 1005]
    
    payments = []
    for i in range(count):
        cheque_date = datetime.now() - timedelta(days=random.randint(0, 30))
        deposit_date = cheque_date + timedelta(days=random.randint(1, 7))
        
        payment = ChequePayments(
            cheque_number=random.randint(100000, 999999),
            branch_code=random.choice(branches),
            from_party=random.choice(parties),
            bank=random.choice(banks),
            amount=Decimal(random.uniform(500, 15000)).quantize(Decimal('0.01')),
            cheque_date=cheque_date.date(),
            deposit_date=deposit_date.date(),
            remark=f"Demo cheque payment {i+1}",
            payment_for=random.choice(["Invoice Payment", "Advance Payment", "Settlement"]),
            invoice_no=f"INV{random.randint(1000, 9999)}" if random.random() > 0.3 else None
        )
        payments.append(payment)
    
    db.add_all(payments)
    db.commit()
    print(f"✓ Created {count} cheque payments")


def create_demo_expenses(db: Session, count: int = 25):
    """Create demo expenses"""
    print(f"Creating {count} demo expenses...")
    
    expense_methods = ["cash", "card", "cheque", "bank_transfer"]
    branches = ["BR001", "BR002", "BR003", "BR004"]
    expense_types = [
        "Office Supplies", "Utilities", "Rent", "Salaries", "Marketing",
        "Transportation", "Maintenance", "Insurance", "Professional Fees"
    ]
    
    expenses = []
    for i in range(count):
        date = datetime.now() - timedelta(days=random.randint(0, 90))
        expense = Expenses(
            expenses_no=f"EXP{str(i+1).zfill(4)}",
            expenses_method=random.choice(expense_methods),
            expense_amount=Decimal(random.uniform(50, 5000)).quantize(Decimal('0.01')),
            remarks=f"{random.choice(expense_types)} - Demo expense {i+1}",
            created_date=date.date(),
            branch_code=random.choice(branches),
            bill_reference=f"BILL{random.randint(1000, 9999)}" if random.random() > 0.4 else None
        )
        expenses.append(expense)
    
    db.add_all(expenses)
    db.commit()
    print(f"✓ Created {count} expenses")


def create_demo_advance_payments(db: Session, count: int = 15):
    """Create demo customer advance payments"""
    print(f"Creating {count} demo advance payments...")
    
    # Get existing customers
    customers = db.query(Customer).filter(Customer.active == True).limit(10).all()
    if not customers:
        print("⚠ No customers found. Please create customers first.")
        return
    
    payment_methods = ["cash", "card", "cheque", "bank_transfer"]
    branches = ["BR001", "BR002", "BR003", "BR004"]
    
    payments = []
    for i in range(count):
        date = datetime.now() - timedelta(days=random.randint(0, 60))
        payment = CustomerAdvancePayments(
            advance_payments_no=f"ADV{str(i+1).zfill(4)}",
            payment_method=random.choice(payment_methods),
            branch_code=random.choice(branches),
            payment_amount=Decimal(random.uniform(500, 10000)).quantize(Decimal('0.01')),
            remarks=f"Demo advance payment {i+1} - {random.choice(['Future order', 'Bulk purchase', 'Reservation'])}",
            created_date=date.date(),
            customer_id=random.choice(customers).id,
            cheque_date=date.date(),
            active=random.random() > 0.2  # 80% active
        )
        payments.append(payment)
    
    db.add_all(payments)
    db.commit()
    print(f"✓ Created {count} advance payments")


def create_demo_credit_notes(db: Session, count: int = 12):
    """Create demo customer credit notes"""
    print(f"Creating {count} demo credit notes...")
    
    # Get existing customers
    customers = db.query(Customer).filter(Customer.active == True).limit(10).all()
    if not customers:
        print("⚠ No customers found. Please create customers first.")
        return
    
    reasons = [
        "Product return - defective item",
        "Service not delivered",
        "Overcharge correction",
        "Promotional credit",
        "Goodwill gesture",
        "Price adjustment",
        "Damaged goods",
        "Late delivery compensation"
    ]
    
    notes = []
    for i in range(count):
        date = datetime.now() - timedelta(days=random.randint(0, 90))
        note = CustomerCreditNotes(
            customer_id=random.choice(customers).id,
            date=date,
            amount=Decimal(random.uniform(50, 2000)).quantize(Decimal('0.01')),
            remark=f"{random.choice(reasons)} - Demo credit note {i+1}",
            invoice_no=f"INV{random.randint(1000, 9999)}" if random.random() > 0.3 else None
        )
        notes.append(note)
    
    db.add_all(notes)
    db.commit()
    print(f"✓ Created {count} credit notes")


def main():
    """Main function to create all demo data"""
    print("\n" + "="*60)
    print("Creating Finance Module Demo Data")
    print("="*60 + "\n")
    
    db = SessionLocal()
    
    try:
        # Create demo data for each module
        create_demo_bank_deposits(db, count=20)
        create_demo_card_payments(db, count=30)
        create_demo_cheque_payments(db, count=15)
        create_demo_expenses(db, count=25)
        create_demo_advance_payments(db, count=15)
        create_demo_credit_notes(db, count=12)
        
        print("\n" + "="*60)
        print("✓ Finance demo data created successfully!")
        print("="*60)
        print("\nSummary:")
        print("  • 20 Bank Deposits")
        print("  • 30 Card Payments")
        print("  • 15 Cheque Payments")
        print("  • 25 Expenses")
        print("  • 15 Advance Payments")
        print("  • 12 Credit Notes")
        print("\nTotal: 117 finance records created")
        print("\nYou can now view this data in the Finance module!")
        print("Navigate to: http://localhost:3000/finance")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n✗ Error creating demo data: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
