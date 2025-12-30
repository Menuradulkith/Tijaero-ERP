#!/usr/bin/env python3
"""
Create finance demo data using the API endpoints
This works with the existing database
"""
import requests
import random
from datetime import datetime, timedelta
from decimal import Decimal

# API base URL
BASE_URL = "http://localhost:8000/api/v1"

# Login credentials
USERNAME = "admin"
PASSWORD = "admin123"

def get_auth_token():
    """Get authentication token"""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        data={"username": USERNAME, "password": PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    if response.status_code == 200:
        return response.json()["access_token"]
    else:
        print(f"❌ Login failed: {response.text}")
        return None

def create_bank_deposits(token, count=20):
    """Create demo bank deposits"""
    print(f"Creating {count} bank deposits...")
    
    banks = ["ABC Bank", "XYZ Bank", "National Bank", "City Bank"]
    branches = ["BR001", "BR002", "BR003"]
    
    headers = {"Authorization": f"Bearer {token}"}
    created = 0
    
    for i in range(count):
        date = (datetime.now() - timedelta(days=random.randint(0, 90))).isoformat()
        data = {
            "deposits_amount": round(random.uniform(100, 10000), 2),
            "branch_code": random.choice(branches),
            "bank_name": random.choice(banks),
            "payment_for": "Customer Payment",
            "invoice_no": f"INV{random.randint(1000, 9999)}",
            "remarks": f"Demo deposit {i+1}"
        }
        
        response = requests.post(
            f"{BASE_URL}/finance/bank-deposits",
            json=data,
            headers=headers
        )
        
        if response.status_code in [200, 201]:
            created += 1
        else:
            print(f"  ⚠️  Failed to create deposit {i+1}: {response.text[:100]}")
    
    print(f"✓ Created {created}/{count} bank deposits")
    return created

def create_card_payments(token, count=30):
    """Create demo card payments"""
    print(f"Creating {count} card payments...")
    
    card_types = ["VISA", "MASTERCARD", "AMEX"]
    headers = {"Authorization": f"Bearer {token}"}
    created = 0
    
    for i in range(count):
        data = {
            "card_type": random.choice(card_types),
            "amount": round(random.uniform(50, 5000), 2),
            "ref_number": f"REF{random.randint(100000, 999999)}",
            "invoice_no": f"INV{random.randint(1000, 9999)}",
            "deposited": random.random() > 0.3,
            "remark": f"Demo card payment {i+1}"
        }
        
        response = requests.post(
            f"{BASE_URL}/finance/card-payments",
            json=data,
            headers=headers
        )
        
        if response.status_code in [200, 201]:
            created += 1
        else:
            print(f"  ⚠️  Failed to create payment {i+1}: {response.text[:100]}")
    
    print(f"✓ Created {created}/{count} card payments")
    return created

def create_cheque_payments(token, count=15):
    """Create demo cheque payments"""
    print(f"Creating {count} cheque payments...")
    
    banks = ["ABC Bank", "XYZ Bank", "National Bank"]
    parties = ["John Doe", "ABC Company", "XYZ Corp"]
    headers = {"Authorization": f"Bearer {token}"}
    created = 0
    
    for i in range(count):
        cheque_date = (datetime.now() - timedelta(days=random.randint(0, 30))).date().isoformat()
        deposit_date = (datetime.now() - timedelta(days=random.randint(0, 7))).date().isoformat()
        
        data = {
            "cheque_number": random.randint(100000, 999999),
            "branch_code": random.randint(1001, 1005),
            "from": random.choice(parties),
            "bank": random.choice(banks),
            "amount": round(random.uniform(500, 15000), 2),
            "cheque_date": cheque_date,
            "deposit_date": deposit_date,
            "payment_for": "Invoice Payment",
            "invoice_no": f"INV{random.randint(1000, 9999)}",
            "remark": f"Demo cheque {i+1}"
        }
        
        response = requests.post(
            f"{BASE_URL}/finance/cheque-payments",
            json=data,
            headers=headers
        )
        
        if response.status_code in [200, 201]:
            created += 1
        else:
            print(f"  ⚠️  Failed to create cheque {i+1}: {response.text[:100]}")
    
    print(f"✓ Created {created}/{count} cheque payments")
    return created

def create_expenses(token, count=25):
    """Create demo expenses"""
    print(f"Creating {count} expenses...")
    
    methods = ["cash", "card", "cheque", "bank_transfer"]
    branches = ["BR001", "BR002", "BR003"]
    types = ["Office Supplies", "Utilities", "Rent", "Marketing"]
    headers = {"Authorization": f"Bearer {token}"}
    created = 0
    
    for i in range(count):
        date = (datetime.now() - timedelta(days=random.randint(0, 90))).date().isoformat()
        
        data = {
            "expenses_no": f"EXP{str(i+1).zfill(4)}",
            "expenses_method": random.choice(methods),
            "expense_amount": round(random.uniform(50, 5000), 2),
            "branch_code": random.choice(branches),
            "bill_reference": f"BILL{random.randint(1000, 9999)}",
            "remarks": f"{random.choice(types)} - Demo {i+1}"
        }
        
        response = requests.post(
            f"{BASE_URL}/finance/expenses",
            json=data,
            headers=headers
        )
        
        if response.status_code in [200, 201]:
            created += 1
        else:
            print(f"  ⚠️  Failed to create expense {i+1}: {response.text[:100]}")
    
    print(f"✓ Created {created}/{count} expenses")
    return created

def main():
    print("\n" + "="*70)
    print(" "*15 + "FINANCE DEMO DATA CREATION (via API)")
    print("="*70 + "\n")
    
    print("Step 1: Authenticating...")
    token = get_auth_token()
    
    if not token:
        print("\n❌ Failed to authenticate. Please ensure:")
        print("  1. Backend server is running (./start.sh)")
        print("  2. Admin user exists (username: admin, password: admin123)")
        return
    
    print("✓ Authenticated successfully\n")
    
    print("Step 2: Creating demo data...\n")
    
    total = 0
    total += create_bank_deposits(token, 20)
    total += create_card_payments(token, 30)
    total += create_cheque_payments(token, 15)
    total += create_expenses(token, 25)
    
    print("\n" + "="*70)
    print("✓ DEMO DATA CREATION COMPLETE!")
    print("="*70)
    print(f"\n📊 Total records created: {total}")
    print("\n💡 View the data at: http://localhost:3000/finance")
    print("\n🔐 Login with:")
    print("   Username: admin")
    print("   Password: admin123")
    print("="*70 + "\n")

if __name__ == "__main__":
    main()
