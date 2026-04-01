"""
Generic Base Repository for TijaeroERP.

Provides standard CRUD operations so that module repositories only need to
define model-specific queries.  Supports both session-per-method and
session-in-constructor patterns through a unified interface.

Usage (session-in-constructor — preferred for services that own a tx):
    class SupplierRepository(BaseRepository[Supplier]):
        model = Supplier

    repo = SupplierRepository(db)
    repo.get_by_id(1)

Usage (session-per-method — for singleton repositories):
    class ProductRepository(BaseRepository[Product]):
        model = Product

    product_repository = ProductRepository()
    product_repository.get_by_id(1, db=db)
"""

from typing import TypeVar, Generic, Type, Optional, List, Any
from sqlalchemy.orm import Session
from app.db.base import Base

T = TypeVar("T", bound=Base)


class BaseRepository(Generic[T]):
    """Generic CRUD repository.  Subclasses set ``model`` to their
    SQLAlchemy model class."""

    model: Type[T]

    def __init__(self, db: Optional[Session] = None):
        self.db = db

    # ------------------------------------------------------------------
    # Internal helper — resolves session from self.db or kwarg
    # ------------------------------------------------------------------
    def _session(self, db: Optional[Session] = None) -> Session:
        session = db or self.db
        if session is None:
            raise RuntimeError(
                f"{self.__class__.__name__}: no database session — pass db= "
                "or instantiate the repository with a Session."
            )
        return session

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------
    def get_by_id(self, id: Any, *, db: Optional[Session] = None) -> Optional[T]:
        """Get a single record by primary key."""
        session = self._session(db)
        return session.query(self.model).filter(self.model.id == id).first()

    def get_all(
        self,
        *,
        db: Optional[Session] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[T]:
        """Return a paginated list of all records."""
        session = self._session(db)
        return session.query(self.model).offset(skip).limit(limit).all()

    def count(self, *, db: Optional[Session] = None) -> int:
        """Return the total number of records."""
        from sqlalchemy import func

        session = self._session(db)
        return session.query(func.count(self.model.id)).scalar() or 0

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------
    def create(self, obj: T, *, db: Optional[Session] = None) -> T:
        """Add a new record, commit, and return the refreshed instance."""
        session = self._session(db)
        session.add(obj)
        session.commit()
        session.refresh(obj)
        return obj

    def update(
        self,
        id: Any,
        update_data: dict,
        *,
        db: Optional[Session] = None,
    ) -> Optional[T]:
        """Partial update by primary key. Returns None if not found."""
        session = self._session(db)
        obj = self.get_by_id(id, db=session)
        if obj is None:
            return None
        for field, value in update_data.items():
            setattr(obj, field, value)
        session.commit()
        session.refresh(obj)
        return obj

    def delete(self, id: Any, *, db: Optional[Session] = None) -> bool:
        """Delete by primary key.  Returns True if deleted, False if not found."""
        session = self._session(db)
        obj = self.get_by_id(id, db=session)
        if obj is None:
            return False
        session.delete(obj)
        session.commit()
        return True
