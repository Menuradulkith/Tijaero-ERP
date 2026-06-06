import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import app.models # Register all SQLAlchemy models

from app.db.session import SessionLocal
from sqlalchemy import text

def main():
    db = SessionLocal()
    try:
        # Check column names of invoices table
        result = db.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'invoices'"))
        columns = result.fetchall()
        print("Invoices columns:")
        for col in columns:
            print(f"  {col[0]}: {col[1]}")
            
        print("\nChecking some invoice rows in invoices table:")
        result = db.execute(text("SELECT id, invoice_no, created_by, sale_rep_id FROM invoices LIMIT 5"))
        rows = result.fetchall()
        for row in rows:
            print(f"  id: {row[0]}, invoice_no: {row[1]}, created_by: {row[2]}, sale_rep_id: {row[3]}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
