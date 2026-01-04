"""Fix status column in purchasing_orders table"""
from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL", "sqlite:///./erp_db.sqlite")
print(f"Using database: {db_url}")

engine = create_engine(db_url)

with engine.connect() as conn:
    # List tables
    result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
    tables = [row[0] for row in result]
    print(f"Tables: {tables}")
    
    if 'purchasing_orders' in tables:
        # Check current status values
        result = conn.execute(text("SELECT id, status FROM purchasing_orders"))
        rows = list(result)
        print(f"Current data: {rows}")
        
        # Update NULL status to 'pending'
        conn.execute(text("UPDATE purchasing_orders SET status = 'pending' WHERE status IS NULL"))
        conn.commit()
        print("Updated status to 'pending' for NULL values")
        
        # Verify
        result = conn.execute(text("SELECT id, status FROM purchasing_orders"))
        rows = list(result)
        print(f"After update: {rows}")
    else:
        print("purchasing_orders table not found")
