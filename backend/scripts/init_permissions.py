#!/usr/bin/env python3
"""
Initialize default permissions and groups/roles
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Import all models first to avoid relationship errors
import app.models  # noqa: F401

from app.db.session import SessionLocal
from app.auth.models import Permission, Group

def init_permissions():
    db = SessionLocal()
    
    try:
        print("=" * 60)
        print("Initializing Permissions and Groups")
        print("=" * 60)
        
        # Define all permissions
        permissions_data = [
            # Customer permissions
            {"name": "View Customers", "resource": "customers", "action": "view", "description": "View customer list and details"},
            {"name": "Create Customers", "resource": "customers", "action": "create", "description": "Create new customers"},
            {"name": "Update Customers", "resource": "customers", "action": "update", "description": "Update customer information"},
            {"name": "Delete Customers", "resource": "customers", "action": "delete", "description": "Delete customers"},
            
            # Sales permissions
            {"name": "View Sales", "resource": "sales", "action": "view", "description": "View sales and invoices"},
            {"name": "Create Sales", "resource": "sales", "action": "create", "description": "Create new sales/invoices"},
            {"name": "Update Sales", "resource": "sales", "action": "update", "description": "Update sales/invoices"},
            {"name": "Delete Sales", "resource": "sales", "action": "delete", "description": "Delete sales/invoices"},
            {"name": "Approve Sales", "resource": "sales", "action": "approve", "description": "Approve sales transactions"},
            
            # Inventory permissions
            {"name": "View Inventory", "resource": "inventory", "action": "view", "description": "View inventory and products"},
            {"name": "Create Inventory", "resource": "inventory", "action": "create", "description": "Add new products"},
            {"name": "Update Inventory", "resource": "inventory", "action": "update", "description": "Update product information"},
            {"name": "Delete Inventory", "resource": "inventory", "action": "delete", "description": "Delete products"},
            
            # User management permissions
            {"name": "View Users", "resource": "users", "action": "view", "description": "View user list and details"},
            {"name": "Create Users", "resource": "users", "action": "create", "description": "Create new users"},
            {"name": "Update Users", "resource": "users", "action": "update", "description": "Update user information"},
            {"name": "Delete Users", "resource": "users", "action": "delete", "description": "Delete users"},
            
            # Group management permissions
            {"name": "View Groups", "resource": "groups", "action": "view", "description": "View groups/roles"},
            {"name": "Create Groups", "resource": "groups", "action": "create", "description": "Create new groups/roles"},
            {"name": "Update Groups", "resource": "groups", "action": "update", "description": "Update groups/roles"},
            {"name": "Delete Groups", "resource": "groups", "action": "delete", "description": "Delete groups/roles"},
            
            # Branch permissions
            {"name": "View Branches", "resource": "branches", "action": "view", "description": "View branch list and details"},
            {"name": "Create Branches", "resource": "branches", "action": "create", "description": "Create new branches"},
            {"name": "Update Branches", "resource": "branches", "action": "update", "description": "Update branch information"},
            {"name": "Delete Branches", "resource": "branches", "action": "delete", "description": "Delete branches"},
            
            # Employee permissions
            {"name": "View Employees", "resource": "employees", "action": "view", "description": "View employee list and details"},
            {"name": "Create Employees", "resource": "employees", "action": "create", "description": "Create new employees"},
            {"name": "Update Employees", "resource": "employees", "action": "update", "description": "Update employee information"},
            {"name": "Delete Employees", "resource": "employees", "action": "delete", "description": "Delete employees"},
            
            # Purchasing permissions
            {"name": "View Purchasing", "resource": "purchasing", "action": "view", "description": "View purchase orders"},
            {"name": "Create Purchasing", "resource": "purchasing", "action": "create", "description": "Create purchase orders"},
            {"name": "Update Purchasing", "resource": "purchasing", "action": "update", "description": "Update purchase orders"},
            {"name": "Delete Purchasing", "resource": "purchasing", "action": "delete", "description": "Delete purchase orders"},
            
            # Finance permissions
            {"name": "View Finance", "resource": "finance", "action": "view", "description": "View financial records"},
            {"name": "Create Finance", "resource": "finance", "action": "create", "description": "Create financial records"},
            {"name": "Update Finance", "resource": "finance", "action": "update", "description": "Update financial records"},
            {"name": "Delete Finance", "resource": "finance", "action": "delete", "description": "Delete financial records"},
            
            # Reports permissions
            {"name": "View Reports", "resource": "reports", "action": "view", "description": "View reports and analytics"},
            {"name": "Export Reports", "resource": "reports", "action": "export", "description": "Export reports"},
        ]
        
        print("\n1. Creating permissions...")
        created_permissions = {}
        for perm_data in permissions_data:
            existing = db.query(Permission).filter(
                Permission.resource == perm_data["resource"],
                Permission.action == perm_data["action"]
            ).first()
            
            if not existing:
                permission = Permission(**perm_data)
                db.add(permission)
                db.flush()
                created_permissions[f"{perm_data['resource']}:{perm_data['action']}"] = permission
                print(f"   ✓ Created: {perm_data['name']}")
            else:
                created_permissions[f"{perm_data['resource']}:{perm_data['action']}"] = existing
                print(f"   - Exists: {perm_data['name']}")
        
        db.commit()
        
        # Define default groups/roles
        print("\n2. Creating default groups/roles...")
        
        groups_data = [
            {
                "name": "Branch Manager",
                "permissions": [
                    "customers:view", "customers:create", "customers:update",
                    "sales:view", "sales:create", "sales:update", "sales:approve",
                    "inventory:view", "inventory:create", "inventory:update",
                    "users:view", "employees:view",
                    "branches:view", "reports:view", "reports:export"
                ]
            },
            {
                "name": "Sales Staff",
                "permissions": [
                    "customers:view", "customers:create", "customers:update",
                    "sales:view", "sales:create",
                    "inventory:view",
                    "reports:view"
                ]
            },
            {
                "name": "Inventory Manager",
                "permissions": [
                    "inventory:view", "inventory:create", "inventory:update",
                    "purchasing:view", "purchasing:create", "purchasing:update",
                    "reports:view", "reports:export"
                ]
            },
            {
                "name": "Cashier",
                "permissions": [
                    "customers:view",
                    "sales:view", "sales:create",
                    "inventory:view",
                    "finance:view", "finance:create"
                ]
            },
            {
                "name": "Accountant",
                "permissions": [
                    "finance:view", "finance:create", "finance:update",
                    "sales:view",
                    "purchasing:view",
                    "reports:view", "reports:export"
                ]
            },
            {
                "name": "HR Manager",
                "permissions": [
                    "employees:view", "employees:create", "employees:update",
                    "users:view", "users:create", "users:update",
                    "reports:view", "reports:export"
                ]
            }
        ]
        
        for group_data in groups_data:
            existing = db.query(Group).filter(Group.name == group_data["name"]).first()
            
            if not existing:
                group = Group(name=group_data["name"])
                
                # Assign permissions
                for perm_key in group_data["permissions"]:
                    if perm_key in created_permissions:
                        group.permissions.append(created_permissions[perm_key])
                
                db.add(group)
                db.commit()
                print(f"   ✓ Created: {group_data['name']} ({len(group_data['permissions'])} permissions)")
            else:
                print(f"   - Exists: {group_data['name']}")
        
        print("\n" + "=" * 60)
        print("✅ Permissions and Groups initialized successfully!")
        print("=" * 60)
        
        # Summary
        total_permissions = db.query(Permission).count()
        total_groups = db.query(Group).count()
        
        print(f"\nSummary:")
        print(f"  - Total Permissions: {total_permissions}")
        print(f"  - Total Groups: {total_groups}")
        print(f"\nDefault Groups Created:")
        for group_data in groups_data:
            print(f"  - {group_data['name']}")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    init_permissions()
