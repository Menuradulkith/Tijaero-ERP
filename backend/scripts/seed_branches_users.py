import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.auth.models import Branch, Group, User, Permission
from app.modules.employees.models import Employee
from app.modules.common.models import Country, Approvals, Locations
from app.modules.sales.models import Invoice
# Import other models to ensure relationships are resolved (needed because Employee links to Invoice, which links to everything)
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
    CustomerCuponCodes, Customer,
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle, CustomerCreditsSettleTransaction
)
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
)
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves
from app.core.security import get_password_hash
from datetime import datetime, date

def seed_branches_users():
    db: Session = SessionLocal()
    
    try:
        print("🌱 Seeding branches and users...")
        
        # 1. Create Head Office Branch
        print("🏢 Checking branches...")
        branch_code = "HO-001"
        branch = db.query(Branch).filter(Branch.branch_code == branch_code).first()
        
        if not branch:
            print("   Creating Head Office branch...")
            branch = Branch(
                branch_name="Head Office",
                branch_code=branch_code,
                address="123 Corporate Blvd, Business City",
                email="info@tijaero.com",
                contact_number="+1234567890",
                created_at=datetime.now()
            )
            db.add(branch)
            db.flush()
        else:
             print("   Head Office branch exists.")

        # 2. Create Groups (Roles)
        print("👥 Checking groups...")
        roles = ["Admin", "Staff", "Manager"]
        group_map = {}

        for role_name in roles:
            group = db.query(Group).filter(Group.name == role_name).first()
            if not group:
                print(f"   Creating group: {role_name}")
                group = Group(name=role_name, created_at=datetime.now())
                db.add(group)
                db.flush()
            else:
                 print(f"   Group exists: {role_name}")
            group_map[role_name] = group

        # 3. Create Users
        print("👤 Checking users...")
        
        from sqlalchemy import or_

        # Superuser
        admin_email = "admin@tijaero.com"
        admin_username = "admin"
        admin_user = db.query(User).filter(or_(User.email == admin_email, User.username == admin_username)).first()
        
        if not admin_user:
            print(f"   Creating superuser: {admin_email}")
            
            # Create User first (needs employee_id string but not FK)
            admin_user = User(
                email=admin_email,
                username=admin_username,
                hashed_password=get_password_hash("TjrAdmin@123"),
                first_name="Super",
                last_name="Admin",
                gender="Other",
                birthdate=date(1990, 1, 1),
                occupation="Administrator",
                employee_id="EMP-001",
                is_active=True,
                is_staff=True,
                is_superuser=True,
                verify=True,
                blocked=False,
                date_joined=date.today()
            )
            db.add(admin_user)
            db.flush()
            
            # Create Employee record (needs User FK)
            admin_employee = Employee(
                employee_id="EMP-001",
                user_id=admin_user.id
            )
            db.add(admin_employee)
            db.flush()
            
            # Assign Branch
            admin_user.branches.append(branch)
            # Assign Group
            admin_user.groups.append(group_map["Admin"])
        else:
            print(f"   User exists: {admin_email} / {admin_username}")

        # Staff User
        staff_email = "staff@tijaero.com"
        staff_username = "staff"
        staff_user = db.query(User).filter(or_(User.email == staff_email, User.username == staff_username)).first()
        
        if not staff_user:
            print(f"   Creating staff user: {staff_email}")
            
            staff_user = User(
                email=staff_email,
                username=staff_username,
                hashed_password=get_password_hash("staff123"),
                first_name="John",
                last_name="Doe",
                gender="Male",
                birthdate=date(1995, 5, 15),
                occupation="Sales Staff",
                employee_id="EMP-002",
                is_active=True,
                is_staff=True,
                is_superuser=False,
                verify=True,
                blocked=False,
                date_joined=date.today()
            )
            db.add(staff_user)
            db.flush()

            staff_employee = Employee(
                employee_id="EMP-002",
                user_id=staff_user.id
            )
            db.add(staff_employee)
            db.flush()
            
            staff_user.branches.append(branch)
            staff_user.groups.append(group_map["Staff"])
        else:
             print(f"   User exists: {staff_email}")

        db.commit()
        print("✅ Branch and User seeding completed successfully!")

    except Exception as e:
        print(f"❌ Error seeding branches and users: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_branches_users()
