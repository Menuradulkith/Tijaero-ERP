#!/usr/bin/env python3
"""
Create demo users with different roles and branch assignments
"""
import sys
from pathlib import Path
from datetime import date

sys.path.insert(0, str(Path(__file__).parent.parent))

# Import init_db first to ensure all models are registered
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.auth.models import User, Group, Branch
from app.modules.employees.models import Employee
from app.core.security import get_password_hash

def create_demo_users():
    db = SessionLocal()
    
    try:
        print("=" * 60)
        print("Creating Demo Users")
        print("=" * 60)
        
        # Get branches
        branches = db.query(Branch).all()
        if not branches:
            print("\n❌ No branches found. Please create branches first.")
            return
        
        print(f"\n📍 Found {len(branches)} branches")
        for branch in branches[:3]:
            print(f"   - {branch.branch_name} ({branch.branch_code})")
        
        # Get groups/roles
        groups = db.query(Group).all()
        if not groups:
            print("\n❌ No roles found. Please run init_permissions.py first.")
            return
        
        print(f"\n👥 Found {len(groups)} roles")
        
        # Map role names to group objects
        role_map = {group.name: group for group in groups}
        
        # Demo users data
        demo_users = [
            {
                "username": "john.manager",
                "password": "manager123",
                "email": "john.manager@erp.com",
                "first_name": "John",
                "last_name": "Manager",
                "employee_id": "EMP001",
                "occupation": "Branch Manager",
                "role": "Branch Manager",
                "branches": [0],  # First branch
            },
            {
                "username": "sarah.sales",
                "password": "sales123",
                "email": "sarah.sales@erp.com",
                "first_name": "Sarah",
                "last_name": "Johnson",
                "employee_id": "EMP002",
                "occupation": "Sales Representative",
                "role": "Sales Staff",
                "branches": [0],  # First branch
            },
            {
                "username": "mike.inventory",
                "password": "inventory123",
                "email": "mike.inventory@erp.com",
                "first_name": "Mike",
                "last_name": "Wilson",
                "employee_id": "EMP003",
                "occupation": "Inventory Manager",
                "role": "Inventory Manager",
                "branches": [0, 1],  # First two branches
            },
            {
                "username": "lisa.cashier",
                "password": "cashier123",
                "email": "lisa.cashier@erp.com",
                "first_name": "Lisa",
                "last_name": "Brown",
                "employee_id": "EMP004",
                "occupation": "Cashier",
                "role": "Cashier",
                "branches": [0],  # First branch
            },
            {
                "username": "david.accountant",
                "password": "accountant123",
                "email": "david.accountant@erp.com",
                "first_name": "David",
                "last_name": "Martinez",
                "employee_id": "EMP005",
                "occupation": "Accountant",
                "role": "Accountant",
                "branches": [0, 1, 2],  # First three branches
            },
            {
                "username": "emma.hr",
                "password": "hr123",
                "email": "emma.hr@erp.com",
                "first_name": "Emma",
                "last_name": "Davis",
                "employee_id": "EMP006",
                "occupation": "HR Manager",
                "role": "HR Manager",
                "branches": [0, 1],  # First two branches
            },
            {
                "username": "james.sales",
                "password": "sales123",
                "email": "james.sales@erp.com",
                "first_name": "James",
                "last_name": "Anderson",
                "employee_id": "EMP007",
                "occupation": "Sales Representative",
                "role": "Sales Staff",
                "branches": [1],  # Second branch
            },
            {
                "username": "sophia.cashier",
                "password": "cashier123",
                "email": "sophia.cashier@erp.com",
                "first_name": "Sophia",
                "last_name": "Taylor",
                "employee_id": "EMP008",
                "occupation": "Cashier",
                "role": "Cashier",
                "branches": [1],  # Second branch
            },
        ]
        
        print("\n" + "=" * 60)
        print("Creating Users...")
        print("=" * 60)
        
        created_count = 0
        skipped_count = 0
        
        for user_data in demo_users:
            # Check if user already exists
            existing_user = db.query(User).filter(User.username == user_data["username"]).first()
            if existing_user:
                print(f"\n⏭️  Skipped: {user_data['username']} (already exists)")
                skipped_count += 1
                continue
            
            # Check if employee exists
            existing_employee = db.query(Employee).filter(
                Employee.employee_id == user_data["employee_id"]
            ).first()
            
            if not existing_employee:
                # Create employee record
                employee = Employee(
                    user_id=0,  # Temporary, will update
                    employee_id=user_data["employee_id"]
                )
                db.add(employee)
                db.flush()
            else:
                employee = existing_employee
            
            # Create user
            user = User(
                email=user_data["email"],
                username=user_data["username"],
                hashed_password=get_password_hash(user_data["password"]),
                first_name=user_data["first_name"],
                middle_name="",
                last_name=user_data["last_name"],
                gender="Male" if user_data["first_name"] in ["John", "Mike", "David", "James"] else "Female",
                birthdate=date(1990, 1, 1),
                occupation=user_data["occupation"],
                employee_id=user_data["employee_id"],
                is_active=True,
                is_staff=True,
                is_superuser=False,
                verify=True,
                blocked=False,
                date_joined=date.today()
            )
            db.add(user)
            db.flush()
            
            # Update employee user_id
            if not existing_employee:
                employee.user_id = user.id
            
            # Assign branches
            for branch_idx in user_data["branches"]:
                if branch_idx < len(branches):
                    user.branches.append(branches[branch_idx])
            
            # Assign role
            role_name = user_data["role"]
            if role_name in role_map:
                user.groups.append(role_map[role_name])
            
            db.commit()
            
            # Print success
            branch_names = [branches[idx].branch_code for idx in user_data["branches"] if idx < len(branches)]
            print(f"\n✅ Created: {user_data['username']}")
            print(f"   Name: {user_data['first_name']} {user_data['last_name']}")
            print(f"   Email: {user_data['email']}")
            print(f"   Password: {user_data['password']}")
            print(f"   Role: {user_data['role']}")
            print(f"   Branches: {', '.join(branch_names)}")
            print(f"   Employee ID: {user_data['employee_id']}")
            
            created_count += 1
        
        print("\n" + "=" * 60)
        print("✅ Demo Users Creation Complete!")
        print("=" * 60)
        
        print(f"\n📊 Summary:")
        print(f"   Created: {created_count} users")
        print(f"   Skipped: {skipped_count} users (already exist)")
        print(f"   Total: {created_count + skipped_count} users")
        
        print("\n🔑 Login Credentials:")
        print("-" * 60)
        for user_data in demo_users:
            print(f"   {user_data['username']:20} | {user_data['password']:15} | {user_data['role']}")
        
        print("\n🌐 Access the application:")
        print("   URL: http://localhost:3000")
        print("   Login with any of the credentials above")
        
        print("\n👥 User Roles:")
        print("   - Branch Manager: Full branch operations")
        print("   - Sales Staff: Customer and sales operations")
        print("   - Inventory Manager: Stock and purchasing")
        print("   - Cashier: Sales and payments")
        print("   - Accountant: Financial records")
        print("   - HR Manager: Employee management")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    create_demo_users()
