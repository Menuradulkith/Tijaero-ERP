#!/usr/bin/env python3
"""
Check if permission tables exist and have data
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import inspect, text
from app.db.session import SessionLocal
from app.auth.models import Permission, Group, User

def check_permissions():
    db = SessionLocal()
    
    try:
        print("=" * 60)
        print("Checking Permission System Status")
        print("=" * 60)
        
        # Check if tables exist
        inspector = inspect(db.bind)
        tables = inspector.get_table_names()
        
        print("\n1. Checking Database Tables:")
        required_tables = ['auth_permission', 'auth_group', 'auth_group_permissions', 'users']
        for table in required_tables:
            if table in tables:
                print(f"   ✓ {table} - EXISTS")
            else:
                print(f"   ✗ {table} - MISSING")
        
        # Check permissions count
        print("\n2. Checking Permissions:")
        permissions_count = db.query(Permission).count()
        print(f"   Total Permissions: {permissions_count}")
        
        if permissions_count > 0:
            print("\n   Sample Permissions:")
            sample_perms = db.query(Permission).limit(5).all()
            for perm in sample_perms:
                print(f"   - {perm.name} ({perm.resource}:{perm.action})")
        else:
            print("   ⚠️  No permissions found! Run: python scripts/init_permissions.py")
        
        # Check groups count
        print("\n3. Checking Groups/Roles:")
        groups_count = db.query(Group).count()
        print(f"   Total Groups: {groups_count}")
        
        if groups_count > 0:
            print("\n   Available Groups:")
            groups = db.query(Group).all()
            for group in groups:
                perm_count = len(group.permissions)
                print(f"   - {group.name} ({perm_count} permissions)")
        else:
            print("   ⚠️  No groups found! Run: python scripts/init_permissions.py")
        
        # Check users with permissions
        print("\n4. Checking Users:")
        users_count = db.query(User).count()
        print(f"   Total Users: {users_count}")
        
        if users_count > 0:
            print("\n   User Permission Status:")
            users = db.query(User).limit(5).all()
            for user in users:
                direct_perms = len(user.permissions)
                groups = len(user.groups)
                group_perms = sum(len(g.permissions) for g in user.groups)
                total_perms = direct_perms + group_perms
                
                status = "✓" if total_perms > 0 or user.is_superuser else "⚠️"
                superuser = " (SUPERUSER)" if user.is_superuser else ""
                print(f"   {status} {user.username}{superuser}")
                print(f"      - Direct permissions: {direct_perms}")
                print(f"      - Groups: {groups}")
                print(f"      - Group permissions: {group_perms}")
                print(f"      - Total effective permissions: {total_perms}")
        
        # Check for data integrity
        print("\n5. Data Integrity Check:")
        
        # Check for orphaned group permissions
        result = db.execute(text("""
            SELECT COUNT(*) FROM auth_group_permissions 
            WHERE permission_id NOT IN (SELECT id FROM auth_permission)
        """))
        orphaned = result.scalar()
        if orphaned > 0:
            print(f"   ⚠️  Found {orphaned} orphaned group-permission links")
        else:
            print("   ✓ No orphaned group-permission links")
        
        # Check for orphaned user permissions
        result = db.execute(text("""
            SELECT COUNT(*) FROM accounts_user_user_permissions 
            WHERE permission_id NOT IN (SELECT id FROM auth_permission)
        """))
        orphaned = result.scalar()
        if orphaned > 0:
            print(f"   ⚠️  Found {orphaned} orphaned user-permission links")
        else:
            print("   ✓ No orphaned user-permission links")
        
        print("\n" + "=" * 60)
        
        # Summary and recommendations
        if permissions_count == 0:
            print("❌ ISSUE: No permissions found in database")
            print("\n📝 To fix, run:")
            print("   python scripts/init_permissions.py")
        elif groups_count == 0:
            print("❌ ISSUE: No groups found in database")
            print("\n📝 To fix, run:")
            print("   python scripts/init_permissions.py")
        else:
            print("✅ Permission system is properly configured!")
            print(f"\n📊 Summary:")
            print(f"   - {permissions_count} permissions")
            print(f"   - {groups_count} groups")
            print(f"   - {users_count} users")
        
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    check_permissions()
