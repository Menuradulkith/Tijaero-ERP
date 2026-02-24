#!/usr/bin/env python3
"""
Ensure admin user exists - creates one if it doesn't
This script is safe to run multiple times
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import all models first to ensure proper SQLAlchemy configuration
from app.db.base import Base
from app.models import *  # This imports all models in correct order

from app.db.session import SessionLocal
from app.auth.models import User
from app.core.security import get_password_hash
from sqlalchemy import select

def ensure_admin_user():
    """Check if admin user exists, create if not"""
    db = SessionLocal()
    
    try:
        # Check if any superuser exists
        stmt = select(User).where(User.is_superuser == True)
        existing_admin = db.execute(stmt).scalars().first()
        
        if existing_admin:
            print(f"✅ Admin user already exists: {existing_admin.username} ({existing_admin.email})")
            return
        
        # Check if 'admin' username exists
        stmt = select(User).where(User.username == "admin")
        existing_user = db.execute(stmt).scalars().first()
        
        if existing_user:
            print(f"⚠️  User 'admin' exists but is not a superuser. Promoting to superuser...")
            existing_user.is_superuser = True
            existing_user.is_active = True
            db.commit()
            print(f"✅ User 'admin' promoted to superuser")
            return
        
        # Create new admin user
        print("🔧 No admin user found. Creating default admin user...")
        from datetime import date
        
        admin_user = User(
            email="admin@example.com",
            username="admin",
            hashed_password=get_password_hash("TjrAdmin@123"),
            is_superuser=True,
            is_active=True,
            first_name="Admin",
            last_name="User",
            gender="Other",
            is_staff=True,
            date_joined=date.today(),
            birthdate=date(1990, 12, 9),
            employee_id="ADMIN001",
            verify=True,
            blocked=False,
            occupation="Administrator"
        )
        db.add(admin_user)
        db.commit()
        
        print("✅ Admin user created successfully!")
        print("   Username: admin")
        print("   Password: TjrAdmin@123")
        print("   Email: admin@example.com")
        print("")
        print("⚠️  IMPORTANT: Change the default password after first login!")
        
    except Exception as e:
        print(f"❌ Error ensuring admin user: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    ensure_admin_user()
