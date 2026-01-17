"""
Seed Customers.
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.customers.models import Customer
from app.modules.customers.enums import CustomerType
from app.modules.common.models import Country, Approvals, Locations
from datetime import datetime, date

# Comprehensive imports for mapper resolution
from app.auth.models import Branch, Group, User, Permission
from app.modules.employees.models import Employee
from app.modules.sales.models import Invoice
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
from app.modules.sales.models import InvoiceItems
from app.modules.purchasing.models import (
    PurchasingOrderItems, PurchasingReturnItems,
    SupplierCreditsSettle, SupplierCreditsSettleTransaction
)
from app.modules.support.models import CSJobItem
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.warehouse.models import ItemTransferNoteItems, ItemTransferNoteItemProduct
from app.modules.customers.models import (
    CustomerCuponCodes,
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle, CustomerCreditsSettleTransaction
)
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
)
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves

def seed_customers():
    db: Session = SessionLocal()
    
    try:
        print("🌱 Seeding customers...")
        
        # 0. Ensure Country exists
        country = db.query(Country).filter(Country.iso == "US").first()
        if not country:
            # Create a default country if not exists (minimal for test)
            country = Country(
                iso="US", iso3="USA", iso_numeric=840, name="United States",
                currency_code="USD", currency_symbol="$", phone="1"
            )
            db.add(country)
            db.flush()
        
        # 1. Individual Customer
        print("👤 Checking individual customers...")
        indiv_name = "John Doe (Individual)"
        indiv = db.query(Customer).filter(Customer.customer_name == indiv_name).first()
        
        if not indiv:
            print(f"   Creating individual customer: {indiv_name}")
            indiv = Customer(
                title="Mr",
                customer_name=indiv_name,
                mobile_contact_number="555-0100",
                email="john.doe@example.com",
                
                # Required fields based on previous models view
                # gender, civil_status, no_of_kids, credit_days, max_credit_limit
                gender="Male",
                civil_status="Single",
                no_of_kids="0",
                credit_days=30,
                max_credit_limit=1000.00,
                active=True,
                is_customer_agent=False,
                date_joined=datetime.now(),
                
                # Optional
                country_id=country.id if country else None
            )
            db.add(indiv)
            db.flush()
        else:
             print(f"   Customer exists: {indiv_name}")

        # 2. Business Customer
        print("🏢 Checking business customers...")
        biz_name = "Acme Corp (Business)"
        biz = db.query(Customer).filter(Customer.customer_name == biz_name).first()
        
        if not biz:
            print(f"   Creating business customer: {biz_name}")
            biz = Customer(
                title="Ms",
                customer_name=biz_name,
                company_name="Acme Corporation",
                mobile_contact_number="555-0200",
                email="contact@acme.com",
                
                gender="Other", # Placeholder for business
                civil_status="Other",
                no_of_kids="0",
                credit_days=60,
                max_credit_limit=50000.00,
                active=True,
                is_customer_agent=False, # Not an agent
                date_joined=datetime.now(),
                
                country_id=country.id if country else None
            )
            db.add(biz)
            db.flush()
        else:
             print(f"   Customer exists: {biz_name}")

        # 3. Agent Customer
        print("🕵️ Checking agent customers...")
        agent_name = "Agent Smith"
        agent = db.query(Customer).filter(Customer.customer_name == agent_name).first()
        
        if not agent:
            print(f"   Creating agent customer: {agent_name}")
            agent = Customer(
                title="Mr",
                customer_name=agent_name,
                mobile_contact_number="555-0007",
                email="agent.smith@matrix.com",
                
                gender="Male",
                civil_status="Single",
                no_of_kids="0",
                credit_days=45,
                max_credit_limit=10000.00,
                active=True,
                is_customer_agent=True, # THIS IS THE KEY
                date_joined=datetime.now(),
                
                country_id=country.id if country else None
            )
            db.add(agent)
            db.flush()
        else:
             print(f"   Customer exists: {agent_name}")

        db.commit()
        print("✅ Customer seeding completed successfully!")

    except Exception as e:
        print(f"❌ Error seeding customers: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_customers()
