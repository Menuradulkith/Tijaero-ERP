from app.db.base import Base
from app.db.session import engine

import app.models  # noqa: F401 — registers all models on Base.metadata

def init_db():
    Base.metadata.create_all(bind=engine)
