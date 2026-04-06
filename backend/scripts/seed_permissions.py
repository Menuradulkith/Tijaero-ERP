import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import SessionLocal
from app.auth.models import Permission, Group, User

def seed_permissions():
    db = SessionLocal()
    
    # ══════════════════════════════════════════════════════════════════
    # Define ALL permissions for every module in the ERP
    # ══════════════════════════════════════════════════════════════════
    permissions_data = [
        # ── Customer permissions ─────────────────────────────────────
        {"name": "view_customers", "resource": "customers", "action": "view", "description": "View customer records"},
        {"name": "create_customers", "resource": "customers", "action": "create", "description": "Create new customers"},
        {"name": "update_customers", "resource": "customers", "action": "update", "description": "Update customer information"},
        {"name": "delete_customers", "resource": "customers", "action": "delete", "description": "Delete customers"},
        
        # ── Sales permissions ────────────────────────────────────────
        {"name": "view_sales", "resource": "sales", "action": "view", "description": "View sales orders, invoices, quotations"},
        {"name": "create_sales", "resource": "sales", "action": "create", "description": "Create sales orders and invoices"},
        {"name": "update_sales", "resource": "sales", "action": "update", "description": "Update sales orders and invoices"},
        {"name": "delete_sales", "resource": "sales", "action": "delete", "description": "Delete sales orders and invoices"},
        {"name": "approve_sales", "resource": "sales", "action": "approve", "description": "Approve sales orders, returns, and commissions"},
        {"name": "manage_sales", "resource": "sales", "action": "manage", "description": "Manage sales settings (payment cards, coupons, vouchers)"},

        # ── Purchasing permissions ───────────────────────────────────
        {"name": "view_purchasing", "resource": "purchasing", "action": "view", "description": "View purchase orders, suppliers, GRNs"},
        {"name": "create_purchasing", "resource": "purchasing", "action": "create", "description": "Create purchase orders and GRNs"},
        {"name": "update_purchasing", "resource": "purchasing", "action": "update", "description": "Update purchase orders and GRNs"},
        {"name": "delete_purchasing", "resource": "purchasing", "action": "delete", "description": "Delete purchase orders and GRNs"},
        {"name": "approve_purchasing", "resource": "purchasing", "action": "approve", "description": "Approve purchase orders and returns"},
        
        # ── Inventory permissions ────────────────────────────────────
        {"name": "view_inventory", "resource": "inventory", "action": "view", "description": "View products, categories, brands"},
        {"name": "create_inventory", "resource": "inventory", "action": "create", "description": "Create products, categories, brands"},
        {"name": "update_inventory", "resource": "inventory", "action": "update", "description": "Update products, categories, brands"},
        {"name": "delete_inventory", "resource": "inventory", "action": "delete", "description": "Delete products, categories, brands"},

        # ── Finance permissions ──────────────────────────────────────
        {"name": "view_finance", "resource": "finance", "action": "view", "description": "View cashbook, expenses, payments, accounting"},
        {"name": "create_finance", "resource": "finance", "action": "create", "description": "Create expenses, payments, journal entries"},
        {"name": "update_finance", "resource": "finance", "action": "update", "description": "Update expenses, payments, journal entries"},
        {"name": "delete_finance", "resource": "finance", "action": "delete", "description": "Delete financial records"},
        {"name": "approve_finance", "resource": "finance", "action": "approve", "description": "Approve expenses, payments, bank transfers"},

        # ── HR permissions ───────────────────────────────────────────
        {"name": "view_hr", "resource": "hr", "action": "view", "description": "View salary profiles, payroll, deductions, reimbursements"},
        {"name": "create_hr", "resource": "hr", "action": "create", "description": "Create salary profiles, payroll runs, deductions"},
        {"name": "update_hr", "resource": "hr", "action": "update", "description": "Update HR records"},
        {"name": "delete_hr", "resource": "hr", "action": "delete", "description": "Delete HR records"},
        {"name": "approve_hr", "resource": "hr", "action": "approve", "description": "Approve payroll, reimbursements, promotions"},

        # ── Warehouse / Sales Stock permissions ──────────────────────
        {"name": "view_warehouse", "resource": "warehouse", "action": "view", "description": "View sales stock, item transfers, company assets"},
        {"name": "create_warehouse", "resource": "warehouse", "action": "create", "description": "Create item transfer notes, receive notes"},
        {"name": "update_warehouse", "resource": "warehouse", "action": "update", "description": "Update stock and transfer records"},
        {"name": "delete_warehouse", "resource": "warehouse", "action": "delete", "description": "Delete stock and transfer records"},
        {"name": "approve_warehouse", "resource": "warehouse", "action": "approve", "description": "Approve item transfer notes"},

        # ── Support permissions ──────────────────────────────────────
        {"name": "view_support", "resource": "support", "action": "view", "description": "View support tickets, job items, warranty claims"},
        {"name": "create_support", "resource": "support", "action": "create", "description": "Create support tickets and job items"},
        {"name": "update_support", "resource": "support", "action": "update", "description": "Update support tickets and job items"},
        {"name": "delete_support", "resource": "support", "action": "delete", "description": "Delete support records"},

        # ── Reporting permissions ────────────────────────────────────
        {"name": "view_reporting", "resource": "reporting", "action": "view", "description": "View reports and dashboards"},
        {"name": "generate_reporting", "resource": "reporting", "action": "generate", "description": "Generate and export reports"},

        # ── Dashboard permissions ────────────────────────────────────
        {"name": "view_dashboard", "resource": "dashboard", "action": "view", "description": "View main ERP dashboard"},

        # ── User management permissions ──────────────────────────────
        {"name": "view_users", "resource": "users", "action": "view", "description": "View user accounts"},
        {"name": "create_users", "resource": "users", "action": "create", "description": "Create user accounts"},
        {"name": "update_users", "resource": "users", "action": "update", "description": "Update user accounts"},
        {"name": "delete_users", "resource": "users", "action": "delete", "description": "Delete user accounts"},
        
        # ── Group / Role management permissions ──────────────────────
        {"name": "view_groups", "resource": "groups", "action": "view", "description": "View groups and roles"},
        {"name": "create_groups", "resource": "groups", "action": "create", "description": "Create groups and roles"},
        {"name": "update_groups", "resource": "groups", "action": "update", "description": "Update groups and roles"},
        {"name": "delete_groups", "resource": "groups", "action": "delete", "description": "Delete groups and roles"},

        # ── Branch permissions ───────────────────────────────────────
        {"name": "view_branches", "resource": "branches", "action": "view", "description": "View branches"},
        {"name": "create_branches", "resource": "branches", "action": "create", "description": "Create branches"},
        {"name": "update_branches", "resource": "branches", "action": "update", "description": "Update branches"},
        {"name": "delete_branches", "resource": "branches", "action": "delete", "description": "Delete branches"},

        # ── Common / Reference Data permissions ──────────────────────
        {"name": "view_common", "resource": "common", "action": "view", "description": "View reference data (locations, countries, etc.)"},
        {"name": "create_common", "resource": "common", "action": "create", "description": "Create reference data"},
        {"name": "update_common", "resource": "common", "action": "update", "description": "Update reference data"},
        {"name": "delete_common", "resource": "common", "action": "delete", "description": "Delete reference data"},

        # ── Settings permissions ─────────────────────────────────────
        {"name": "view_settings", "resource": "settings", "action": "view", "description": "View system and company settings"},
        {"name": "update_settings", "resource": "settings", "action": "update", "description": "Update system and company settings"},
    ]
    
    # Create permissions
    created_permissions = {}
    for perm_data in permissions_data:
        existing = db.query(Permission).filter(
            Permission.resource == perm_data["resource"],
            Permission.action == perm_data["action"],
        ).first()
        if not existing:
            perm = Permission(**perm_data)
            db.add(perm)
            db.flush()
            created_permissions[perm_data["name"]] = perm
            print(f"  ✅ Created permission: {perm_data['resource']}:{perm_data['action']}")
        else:
            # Update name/description if changed
            existing.name = perm_data["name"]
            existing.description = perm_data["description"]
            created_permissions[perm_data["name"]] = existing
            print(f"  ── Already exists: {perm_data['resource']}:{perm_data['action']}")
    
    db.commit()
    
    # ══════════════════════════════════════════════════════════════════
    # Helper to collect permissions by name prefix
    # ══════════════════════════════════════════════════════════════════
    def perms(*names):
        return [created_permissions[n] for n in names if n in created_permissions]

    all_perm_list = list(created_permissions.values())

    # ══════════════════════════════════════════════════════════════════
    # Create default groups (roles)
    # ══════════════════════════════════════════════════════════════════
    groups_data = [
        {
            "name": "Admin",
            "description": "Full system access — all modules, all actions",
            "permissions": all_perm_list,
        },
        {
            "name": "Sales Manager",
            "description": "Full sales access + view customers, inventory, warehouse, reporting",
            "permissions": perms(
                "view_sales", "create_sales", "update_sales", "delete_sales", "approve_sales", "manage_sales",
                "view_customers", "create_customers", "update_customers",
                "view_inventory",
                "view_warehouse",
                "view_reporting", "generate_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "Sales Representative",
            "description": "Create and view sales, view customers & inventory",
            "permissions": perms(
                "view_sales", "create_sales",
                "view_customers", "create_customers",
                "view_inventory",
                "view_dashboard",
            ),
        },
        {
            "name": "Purchasing Manager",
            "description": "Full purchasing access + view suppliers, inventory, finance",
            "permissions": perms(
                "view_purchasing", "create_purchasing", "update_purchasing", "delete_purchasing", "approve_purchasing",
                "view_inventory",
                "view_finance",
                "view_warehouse",
                "view_reporting", "generate_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "Purchasing Officer",
            "description": "Create purchase orders and GRNs",
            "permissions": perms(
                "view_purchasing", "create_purchasing",
                "view_inventory",
                "view_dashboard",
            ),
        },
        {
            "name": "Finance Manager",
            "description": "Full finance access + view sales & purchasing for reconciliation",
            "permissions": perms(
                "view_finance", "create_finance", "update_finance", "delete_finance", "approve_finance",
                "view_sales",
                "view_purchasing",
                "view_customers",
                "view_reporting", "generate_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "Accountant",
            "description": "View and create finance records",
            "permissions": perms(
                "view_finance", "create_finance", "update_finance",
                "view_sales",
                "view_purchasing",
                "view_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "HR Manager",
            "description": "Full HR access — payroll, deductions, reimbursements, promotions",
            "permissions": perms(
                "view_hr", "create_hr", "update_hr", "delete_hr", "approve_hr",
                "view_users",
                "view_reporting", "generate_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "Inventory Manager",
            "description": "Full inventory and warehouse access",
            "permissions": perms(
                "view_inventory", "create_inventory", "update_inventory", "delete_inventory",
                "view_warehouse", "create_warehouse", "update_warehouse", "approve_warehouse",
                "view_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "Warehouse Staff",
            "description": "View and manage stock, transfers, and receive notes",
            "permissions": perms(
                "view_warehouse", "create_warehouse", "update_warehouse",
                "view_inventory",
                "view_dashboard",
            ),
        },
        {
            "name": "Support Agent",
            "description": "Manage support tickets, job items, call logs, warranty claims",
            "permissions": perms(
                "view_support", "create_support", "update_support",
                "view_customers",
                "view_inventory",
                "view_dashboard",
            ),
        },
        {
            "name": "Branch Manager",
            "description": "View dashboards, sales, purchasing, warehouse for their branch",
            "permissions": perms(
                "view_sales", "create_sales", "approve_sales",
                "view_purchasing", "create_purchasing",
                "view_inventory",
                "view_warehouse", "approve_warehouse",
                "view_finance",
                "view_reporting",
                "view_dashboard",
            ),
        },
        {
            "name": "Viewer",
            "description": "Read-only access to all modules",
            "permissions": perms(
                "view_sales", "view_customers", "view_purchasing", "view_inventory",
                "view_finance", "view_hr", "view_warehouse", "view_support",
                "view_reporting", "view_dashboard",
            ),
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
            print(f"  ✅ Created group: {group_data['name']}")
        else:
            # Update description and permissions
            existing_group.description = group_data["description"]
            existing_group.permissions = group_data["permissions"]
            print(f"  🔄 Updated group: {group_data['name']}")
    
    db.commit()
    
    # Assign Admin group to admin user
    admin_user = db.query(User).filter(User.username == "admin").first()
    if admin_user:
        admin_group = db.query(Group).filter(Group.name == "Admin").first()
        if admin_group and admin_group not in admin_user.groups:
            admin_user.groups.append(admin_group)
            db.commit()
            print("  ✅ Assigned Admin group to admin user")
    
    db.close()

    print("\n" + "═" * 60)
    print("  Permissions and groups seeded successfully!")
    print("═" * 60)
    print(f"\n  Total permissions: {len(permissions_data)}")
    print(f"  Total groups: {len(groups_data)}")
    print("\n  Default Groups:")
    for i, g in enumerate(groups_data, 1):
        print(f"    {i:2d}. {g['name']:25s} — {g['description']}")


if __name__ == "__main__":
    seed_permissions()
