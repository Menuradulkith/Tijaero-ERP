from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from app.core.config import settings
import time
import logging

logger = logging.getLogger(__name__)

# Performance-optimized database engine configuration
engine = create_engine(
    settings.DATABASE_URL,
    poolclass=QueuePool,
    pool_pre_ping=True,       # Verify connections before use
    pool_size=10,             # Base pool size
    max_overflow=20,          # Additional connections when needed
    pool_timeout=30,          # Wait time for connection
    pool_recycle=1800,        # Recycle connections every 30 min
    echo=False,               # Disable SQL logging in production
)

# Optional: Log slow queries (queries > 1 second)
@event.listens_for(engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    context._query_start_time = time.time()

@event.listens_for(engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    total = time.time() - context._query_start_time
    if total > 1.0:
        logger.warning(f"Slow query ({total:.2f}s): {statement[:200]}...")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
