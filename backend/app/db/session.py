from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool
from app.core.config import settings
from app.core.audit_context import current_user_id
import time
import logging

logger = logging.getLogger(__name__)


def _get_database_url() -> str:
    """Convert DATABASE_URL to use psycopg3 driver (postgresql+psycopg).
    Handles both 'postgresql://' and 'postgresql+psycopg2://' formats."""
    url = settings.DATABASE_URL
    if url.startswith("postgresql+psycopg2://"):
        url = url.replace("postgresql+psycopg2://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


# Performance-optimized database engine configuration
engine = create_engine(
    _get_database_url(),
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


@event.listens_for(Session, "before_flush")
def before_flush(session, flush_context, instances):
    """Stamp Sri Lankan local time and audit user on every insert/update.

    This guarantees that created_at / updated_at always reflect Asia/Colombo
    (UTC+5:30) time for every CRUD operation across the whole ERP, regardless
    of the per-column default (Python-side or DB-side func.now())."""
    from app.core import timezone as tz

    now = tz.now()
    user_id = current_user_id.get()

    # New rows → set created_at / updated_at if not explicitly provided.
    for instance in session.new:
        if hasattr(instance, "created_at") and getattr(instance, "created_at", None) is None:
            instance.created_at = now
        if hasattr(instance, "updated_at") and getattr(instance, "updated_at", None) is None:
            instance.updated_at = now
        if user_id:
            if hasattr(instance, "created_by") and getattr(instance, "created_by") is None:
                instance.created_by = user_id
            if hasattr(instance, "updated_by") and getattr(instance, "updated_by") is None:
                instance.updated_by = user_id

    # Modified rows → always refresh updated_at to current SL time.
    for instance in session.dirty:
        if not session.is_modified(instance, include_collections=False):
            continue
        if hasattr(instance, "updated_at"):
            instance.updated_at = now
        if user_id and hasattr(instance, "updated_by"):
            instance.updated_by = user_id



SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
