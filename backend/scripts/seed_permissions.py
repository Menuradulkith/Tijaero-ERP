import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import SessionLocal
from app.auth.models import Permission, Group, User

def seed_permissions():
    db = SessionLocal()
    
    # Define all permissions
    permissions_data = [
        # Customer permissions
        {"name": "view_customers", "resource": "customers", "action": "view", "description": "View customer records"},
        {"name": "create_customers", "resource": "customers", "action": "create", "description": "Create new customers"},
        {"name": "update_customers", "resource": "customers", "action": "update", "description": "Update customer information"},
        {"name": "delete_customers", "resource": "customers", "action": "delete", "description": "Delete customers"},
        
        # Sales permissions
        {"name": "view_sales", "resource": "sales", "action": "view", "description": "View sales orders"},
        {"name": "create_sales", "resource": "sales", "action": "create", "description": "Create sales orders"},
        {"name": "update_sales", "resource": "sales", "action": "update", "description": "Update sales orders"},
        {"name": "delete_sales", "resource": "sales", "action": "delete", "description": "Delete sales orders"},
        {"name": "approve_sales", "resource": "sales", "action": "approve", "description": "Approve sales orders"},
        
        # Inventory permissions
        {"name": "view_inventory", "resource": "inventory", "action": "view", "description": "View inventory"},
        {"name": "create_inventory", "resource": "inventory", "action": "create", "description": "Create products"},
        {"name": "update_inventory", "resource": "inventory", "action": "update", "description": "Update products"},
        {"name": "delete_inventory", "resource": "inventory", "action": "delete", "description": "Delete products"},
        
        # User management permissions
        {"name": "view_users", "resource": "users", "action": "view", "description": "View users"},
        {"name": "create_users", "resource": "users", "action": "create", "description": "Create users"},
        {"name": "update_users", "resource": "users", "action": "update", "description": "Update users"},
        {"name": "delete_users", "resource": "users", "action": "delete", "description": "Delete users"},
        
        # Group management permissions
        {"name": "view_groups", "resource": "groups", "action": "view", "description": "View groups"},
        {"name": "create_groups", "resource": "groups", "action": "create", "description": "Create groups"},
        {"name": "update_groups", "resource": "groups", "action": "update", "description": "Update groups"},
        {"name": "delete_groups", "resource": "groups", "action": "delete", "description": "Delete groups"},
    ]
    
    # Create permissions
    created_permissions = {}
    for perm_data in permissions_data:
        existing = db.query(Permission).filter(Permission.name == perm_data["name"]).first()
        if not existing:
            perm = Permission(**perm_data)
            db.add(perm)
            db.flush()
            created_permissions[perm_data["name"]] = perm
            print(f"Created permission: {perm_data['name']}")
        else:
            created_permissions[perm_data["name"]] = existing
            print(f"Permission already exists: {perm_data['name']}")
    
    db.commit()
    
    # Create default groups
    groups_data = [
        {
            "name": "Admin",
            "description": "Full system access",
            "permissions": list(created_permissions.values())
        },
        {
            "name": "Sales Manager",
            "description": "Manage sales and customers",
            "permissions": [
                created_permissions["view_customers"],
                created_permissions["create_customers"],
                created_permissions["update_customers"],
                created_permissions["view_sales"],
                created_permissions["create_sales"],
                created_permissions["update_sales"],
                created_permissions["approve_sales"],
                created_permissions["view_inventory"],
            ]
        },
        {
            "name": "Sales Representative",
            "description": "Create and view sales",
            "permissions": [
                created_permissions["view_customers"],
                created_permissions["create_customers"],
                created_permissions["view_sales"],
                created_permissions["create_sales"],
                created_permissions["view_inventory"],
            ]
        },
        {
            "name": "Inventory Manager",
            "description": "Manage inventory",
            "permissions": [
                created_permissions["view_inventory"],
                created_permissions["create_inventory"],
                created_permissions["update_inventory"],
                created_permissions["delete_inventory"],
            ]
        },
    ]
    
    for group_data in groups_data:
        existing_group = db.query(Group).filter(Group.name == group_data["name"]).first()
        if not existing_group:
            group = Group(
                name=group_data["name"],
                description=group_data["description"]
            )
            group.permissions = group_data["permissions"]
            db.add(group)
            print(f"Created group: {group_data['name']}")
        else:
            print(f"Group already exists: {group_data['name']}")
    
    db.commit()
    
    # Assign Admin group to admin user
    admin_user = db.query(User).filter(User.username == "admin").first()
    if admin_user:
        admin_group = db.query(Group).filter(Group.name == "Admin").first()
        if admin_group and admin_group not in admin_user.groups:
            admin_user.groups.append(admin_group)
            db.commit()
            print("Assigned Admin group to admin user")
    
    db.close()
    print("\nPermissions and groups seeded successfully!")
    print("\nDefault Groups Created:")
    print("1. Admin - Full system access")
    print("2. Sales Manager - Manage sales and customers")
    print("3. Sales Representative - Create and view sales")
    print("4. Inventory Manager - Manage inventory")

if __name__ == "__main__":
    seed_permissions()
