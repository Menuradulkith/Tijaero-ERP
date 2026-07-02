from app.db.session import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    result = db.execute(text("SELECT indexname FROM pg_indexes WHERE indexname LIKE '%communication%';"))
    indexes = result.fetchall()
    print("Found indexes:")
    for row in indexes:
        print(row[0])
    
    result2 = db.execute(text("SELECT tablename FROM pg_tables WHERE tablename LIKE '%communication%';"))
    tables = result2.fetchall()
    print("Found tables:")
    for row in tables:
        print(row[0])
except Exception as e:
    print("Error:", e)
finally:
    db.close()
