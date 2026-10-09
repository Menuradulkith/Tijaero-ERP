"""Short-lived, process-local cache of the authenticated user.

Every request used to reload the user with its branches, groups, group
permissions and direct permissions (4 queries, hundreds of rows) - about half
of the per-request cost. The loaded graph is now kept detached for a few
seconds and merged into the request session without touching the database.

Correctness: any flush that touches a User, Group or Permission (role change,
deactivation, password change, branch assignment...) empties the cache when the
transaction commits, so in a single process a change is effective immediately.
With several workers each process only learns about its own writes, so the
short TTL bounds staleness there.
"""
import threading
import time
from typing import Optional

from sqlalchemy import event
from sqlalchemy.orm import Session, joinedload, selectinload

from app.auth.models import Group, Permission, User

TTL_SECONDS = 15.0
MAX_ENTRIES = 512

_lock = threading.Lock()
_cache: dict = {}
_flights: dict = {}


def _flight_lock(user_id: int) -> threading.Lock:
    with _lock:
        return _flights.setdefault(user_id, threading.Lock())


def clear() -> None:
    with _lock:
        _cache.clear()


def _fetch(db: Session, user_id: int) -> Optional[User]:
    # A private session so the request session never owns the cached objects.
    # Same connection as the request session: one pooled connection per request.
    s = Session(bind=db.connection(), autoflush=False, expire_on_commit=False)
    try:
        user = (
            s.query(User)
            .options(
                joinedload(User.branches),
                selectinload(User.groups).selectinload(Group.permissions),
                selectinload(User.permissions),
            )
            .filter(User.id == user_id)
            .first()
        )
        if user is not None:
            s.expunge_all()
        return user
    finally:
        s.close()


def load_user(db: Session, user_id: int) -> Optional[User]:
    """Return the user (fully loaded) attached to ``db``."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get(user_id)
    if hit is not None and now - hit[0] < TTL_SECONDS:
        return db.merge(hit[1], load=False)
    with _flight_lock(user_id):
        # another request may have filled the entry while we waited (stampede guard)
        with _lock:
            hit = _cache.get(user_id)
        if hit is not None and time.monotonic() - hit[0] < TTL_SECONDS:
            return db.merge(hit[1], load=False)
        user = _fetch(db, user_id)
    if user is None:
        with _lock:
            _cache.pop(user_id, None)
        return None
    with _lock:
        if len(_cache) >= MAX_ENTRIES:
            _cache.clear()
        _cache[user_id] = (now, user)
    return db.merge(user, load=False)


_WATCHED = (User, Group, Permission)


@event.listens_for(Session, "before_flush")
def _mark_dirty(session, flush_context, instances):
    for inst in list(session.new) + list(session.dirty) + list(session.deleted):
        if isinstance(inst, _WATCHED):
            session.info["_user_cache_dirty"] = True
            clear()  # also now: the request itself may read right after the flush
            return


@event.listens_for(Session, "after_commit")
def _after_commit(session):
    if session.info.pop("_user_cache_dirty", False):
        clear()


@event.listens_for(Session, "after_rollback")
def _after_rollback(session):
    session.info.pop("_user_cache_dirty", None)
