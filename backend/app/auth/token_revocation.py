"""JWT revocation (logout) backed by the auth_revoked_token denylist."""
from datetime import datetime
from typing import Optional

from app.auth.models import RevokedToken
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session


def is_revoked(db: Session, jti: Optional[str]) -> bool:
    """True if this jti was revoked. Tokens issued before jti was added to
    access tokens have none and stay valid until they expire."""
    if not jti:
        return False
    return db.query(RevokedToken.jti).filter(RevokedToken.jti == jti).first() is not None


def revoke(db: Session, payload: Optional[dict]) -> None:
    """Add a decoded token payload's jti to the denylist.

    Idempotent and safe under concurrency: a single atomic
    INSERT ... ON CONFLICT DO NOTHING, so two simultaneous logouts of the
    same token both succeed instead of one failing on the primary key.
    """
    if not payload or not payload.get("jti") or not payload.get("exp"):
        return
    db.execute(
        pg_insert(RevokedToken)
        .values(
            jti=payload["jti"],
            expires_at=datetime.utcfromtimestamp(payload["exp"]),
        )
        .on_conflict_do_nothing(index_elements=["jti"])
    )


def purge_expired(db: Session) -> None:
    db.query(RevokedToken).filter(RevokedToken.expires_at < datetime.utcnow()).delete(
        synchronize_session=False
    )
