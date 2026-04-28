"""
Fix alembic version table in PostgreSQL database.
This script will reset the alembic_version to the correct head revision.
"""

import os
import sys
from sqlalchemy import create_engine, text

# Get PostgreSQL URL from environment or use default
pg_url = os.getenv(
    "DATABASE_URL", 
    "postgresql://erp_user:erp_password@localhost:5432/erp_db"
)

print(f"Connecting to: {pg_url.split('@')[1] if '@' in pg_url else pg_url}")

try:
    engine = create_engine(pg_url)
    
    with engine.connect() as conn:
        # Check current version
        result = conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
        print(f"Current version in DB: {result}")
        
        # Replace the missing revision with the current valid head
        conn.execute(text(
            "UPDATE alembic_version SET version_num = 's35_merge_all_heads' "
            "WHERE version_num = '20260501_cashbook_extra'"
        ))
        
        conn.commit()
        
        # Verify
        result = conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
        print(f"New version in DB: {result}")
        print("\n✅ Alembic version fixed successfully!")
        print("Now run: poetry run alembic upgrade head")
        
except Exception as e:
    print(f"\n❌ Error: {e}")
    print("\nIf you're using Docker, run this inside the backend container:")
    print("  docker exec -it <container_name> poetry run python fix_alembic_version.py")
    sys.exit(1)
