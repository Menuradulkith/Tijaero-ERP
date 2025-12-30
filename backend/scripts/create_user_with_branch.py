#!/usr/bin/env python3
"""
Create a user with employee record, branch assignment, and role
"""
import sys
from pathlib import Path
from datetime import date

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import SessionLocal
from app.auth.models import User, Branch, Group
from app.modules.employees.models import Employee
from app.core.security import get_password_hash

def create_user_with_branch():
    db = SessionLocal()
    
    try:
        print("=" * 60)
        print("Create User with Branch and Role")
        print("=" * 60)
        
        # Get user input
        print("\n📝 User Information:")
        username = input("Username: ").strip()
        password = input("Password: ").strip()
        email = input("Email: ").strip()
        first_name = input("First Name: ").strip()
        last_name = input("Last Name: ").strip()
        employee_id = input("Employee ID (e.g., EMP002): ").strip()
        
        # Check if user exists
        existing_user = db.query(User).filter(User.username == username).first()
        if existing_user:
            print(f"\n❌ User '{username}' already exists!")
            return
        
        # Show available branches
        print("\n🏢 Available Branches:")
        branches = db.query(Branch).all()
        if not branches:
            print("   No branches found. Please create a branch first.")
            return
        
        for i, branch in enumerate(branches, 1):
            print(f"   {i}. {branch.branch_name} ({branch.branch_code})")
        
        branch_choice = input("\nSelect branch number: ").strip()
        try:
            selected_branch = branches[int(branch_choice) - 1]
        except (ValueError, IndexError):
            print("❌ Invalid branch selection!")
            return
        
        # Show available groups/roles
        print("\n👥 Available Roles:")
        groups = db.query(Group).all()
        if not groups:
            print("   No groups found. Run init_permissions.py first.")
            return
        
        for i, group in enumerate(groups, 1):
            print(f"   {i}. {group.name}")
        
        group_choice = input("\nSelect role number: ").strip()
        try:
            selected_group = groups[int(group_choice) - 1]
        except (ValueError, IndexError):
            print("❌ Invalid role selection!")
            return
        
        # Create employee record
        print("\n1. Creating employee record...")
        employee = Employee(
            user_id=0,  # Temporary, will update
            employee_id=employee_id
        )
        db.add(employee)
        db.flush()
        print(f"   ✓ Employee created: {employee_id}")
        
        # Create user
        print("\n2. Creating user account...")
        user = User(
            email=email,
            username=username,
            hashed_password=get_password_hash(password),
            first_name=first_name,
            middle_name="",
            last_name=last_name,
            gender="Male",  # Default
            birthdate=date(1990, 1, 1),  # Default
            occupation="Staff",
            employee_id=employee_id,
            is_active=True,
            is_staff=True,
            is_superuser=False,
            verify=True,
            blocked=False,
            date_joined=date.today()
        )
        db.add(user)
        db.flush()
        print(f"   ✓ User created: {username}")
        
        # Update employee user_id
        employee.user_id = user.id
        
        # Assign branch
        print("\n3. Assigning to branch...")
        user.branches.append(selected_branch)
        print(f"   ✓ Assigned to: {selected_branch.branch_name}")
        
        # Assign role
        print("\n4. Assigning role...")
        user.groups.append(selected_group)
        print(f"   ✓ Assigned role: {selected_group.name}")
        
        db.commit()
        
        print("\n" + "=" * 60)
        print("✅ User created successfully!")
        print("=" * 60)
        print(f"\nLogin Credentials:")
        print(f"  Username: {username}")
        print(f"  Password: {password}")
        print(f"  Branch: {selected_branch.branch_name}")
        print(f"  Role: {selected_group.name}")
        print(f"\nThe user can now login at: http://localhost:3000")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    create_user_with_branch()
