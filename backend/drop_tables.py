from app.db.session import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    db.execute(text("DROP TABLE IF EXISTS communication_email_logs CASCADE;"))
    db.execute(text("DROP TABLE IF EXISTS communication_email_templates CASCADE;"))
    
    # Try to drop indexes manually if they somehow lingered
    for idx in [
        'ix_communication_email_logs_document_id',
        'ix_communication_email_logs_document_type',
        'ix_communication_email_logs_id',
        'ix_communication_email_logs_status',
        'ix_communication_email_templates_document_type',
        'ix_communication_email_templates_id'
    ]:
        db.execute(text(f"DROP INDEX IF EXISTS {idx} CASCADE;"))
        
    db.execute(text("DELETE FROM alembic_version WHERE version_num = '874888ed5142';"))
    db.commit()
    print("Dropped everything.")
except Exception as e:
    print("Error:", e)
    db.rollback()
finally:
    db.close()
