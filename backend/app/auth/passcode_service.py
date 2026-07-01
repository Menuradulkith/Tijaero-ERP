"""
Passcode Service — business logic for 6-digit PIN-based quick login.

Security model:
- Passcodes are bcrypt-hashed (same library / cost as regular passwords).
- Each user may have exactly one active passcode (stored in user_passcodes).
- A rolling history of the last 5 hashed passcodes is kept in user_passcode_history
  to prevent reuse.  History survives active-passcode deletion.
- Expiry is enforced by comparing created_at_ts to the admin-configured
  passcode_expiry_days (1-30, default 30 — a hard monthly cap).
- Failed attempts are counted in the DB row.  Reaching 3 sets locked_out=True.
  Successful password login resets both counters silently.
- A timing-safe dummy bcrypt call is executed whenever the user is not found
  to prevent user enumeration via response-time analysis.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth.models import User, UserPasscode, UserPasscodeHistory
from app.core import timezone as tz
from app.core.security import DUMMY_PASSWORD_HASH

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PASSCODE_REGEX = re.compile(r"^\d{6}$")
_MAX_ATTEMPTS = 3
_MAX_HISTORY = 5

# Pre-computed dummy hash so failed lookups always execute a bcrypt verify
_DUMMY_PASSCODE_HASH = bcrypt.hashpw(b"000000", bcrypt.gensalt()).decode()


def _bcrypt_hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _bcrypt_verify(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Core service functions
# ---------------------------------------------------------------------------


def set_passcode(db: Session, user_id: int, passcode_plain: str, confirm: str) -> dict:
    """
    Set or change a user's passcode.

    Steps:
    1. Validate format (exactly 6 numeric digits, confirmation matches).
    2. Check last-5 history for reuse.
    3. Archive current passcode (if any) to history, pruning to MAX_HISTORY.
    4. Upsert new hashed passcode and reset created_at_ts.
    """
    if passcode_plain != confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passcodes do not match.",
        )
    if not PASSCODE_REGEX.match(passcode_plain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passcode must be exactly 6 numeric digits.",
        )

    # Check reuse against last-5 history
    history_rows = (
        db.query(UserPasscodeHistory)
        .filter(UserPasscodeHistory.user_id == user_id)
        .order_by(UserPasscodeHistory.set_at.desc())
        .limit(_MAX_HISTORY)
        .all()
    )
    for row in history_rows:
        if _bcrypt_verify(passcode_plain, row.hashed_passcode):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot reuse any of your last 5 passcodes. Please choose a different passcode.",
            )

    now = _utcnow()

    # Archive current passcode to history before overwriting
    current = (
        db.query(UserPasscode).filter(UserPasscode.user_id == user_id).first()
    )
    if current:
        history_entry = UserPasscodeHistory(
            user_id=user_id,
            hashed_passcode=current.hashed_passcode,
            set_at=now,
        )
        db.add(history_entry)
        db.flush()

        # Prune history: keep only the MAX_HISTORY most recent rows
        all_history = (
            db.query(UserPasscodeHistory)
            .filter(UserPasscodeHistory.user_id == user_id)
            .order_by(UserPasscodeHistory.set_at.desc())
            .all()
        )
        if len(all_history) > _MAX_HISTORY:
            for old in all_history[_MAX_HISTORY:]:
                db.delete(old)

    new_hash = _bcrypt_hash(passcode_plain)

    if current:
        current.hashed_passcode = new_hash
        current.failed_attempts = 0
        current.locked_out = False
        current.created_at_ts = now
    else:
        current = UserPasscode(
            user_id=user_id,
            hashed_passcode=new_hash,
            failed_attempts=0,
            locked_out=False,
            created_at_ts=now,
        )
        db.add(current)

    db.commit()
    db.refresh(current)
    return {"message": "Passcode set successfully."}


def delete_passcode(db: Session, user_id: int) -> dict:
    """Remove a user's active passcode. History is preserved for reuse prevention."""
    current = (
        db.query(UserPasscode).filter(UserPasscode.user_id == user_id).first()
    )
    if not current:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No passcode is set for this account.",
        )
    db.delete(current)
    db.commit()
    return {"message": "Passcode removed successfully."}


def get_passcode_status(db: Session, user_id: int, expiry_days: int) -> dict:
    """Return the current passcode status for a user."""
    current = (
        db.query(UserPasscode).filter(UserPasscode.user_id == user_id).first()
    )
    if not current:
        return {
            "has_passcode": False,
            "locked_out": False,
            "failed_attempts": 0,
            "expires_at": None,
            "is_expired": False,
            "days_until_expiry": None,
        }

    expires_at = current.created_at_ts + timedelta(days=expiry_days)
    now = _utcnow()
    is_expired = now >= expires_at
    days_remaining = max(0, (expires_at - now).days) if not is_expired else 0

    return {
        "has_passcode": True,
        "locked_out": current.locked_out,
        "failed_attempts": current.failed_attempts,
        "expires_at": expires_at.isoformat(),
        "is_expired": is_expired,
        "days_until_expiry": days_remaining,
    }


def verify_passcode_login(
    db: Session, username: str, passcode_plain: str, expiry_days: int
) -> tuple[User, bool]:
    """
    Authenticate a user by username + passcode.

    Returns (user, passcode_expired_flag) on success.
    Raises HTTPException on any failure with a structured detail dict
    so the frontend can differentiate error types via detail['code'].

    Error codes:
      PASSCODE_EXPIRED  — passcode has passed its expiry window
      PASSCODE_LOCKED   — account locked after 3 failed attempts
      PASSCODE_INVALID  — wrong passcode (attempt count returned in detail)
      USER_INACTIVE     — user account is blocked or inactive
    """
    user = db.query(User).filter(User.username == username).first()

    if not user:
        # Timing-safe: always run a verify so response time doesn't reveal user existence
        _bcrypt_verify(passcode_plain, _DUMMY_PASSCODE_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "PASSCODE_INVALID", "message": "Invalid username or passcode."},
        )

    if not user.is_active or user.blocked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "USER_INACTIVE", "message": "User account is inactive or blocked."},
        )

    passcode_row = (
        db.query(UserPasscode).filter(UserPasscode.user_id == user.id).first()
    )

    if not passcode_row:
        # Timing-safe dummy check
        _bcrypt_verify(passcode_plain, _DUMMY_PASSCODE_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "PASSCODE_INVALID", "message": "No passcode is configured for this account."},
        )

    # --- Expiry check (before lockout, to give the correct UX signal) ---
    expires_at = passcode_row.created_at_ts + timedelta(days=expiry_days)
    now = _utcnow()
    if now >= expires_at:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "PASSCODE_EXPIRED",
                "message": "Your passcode has expired. Please sign in with your username and password to set a new one.",
            },
        )

    # --- Lockout check ---
    if passcode_row.locked_out:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "PASSCODE_LOCKED",
                "message": "Passcode locked after too many failed attempts. Sign in with your password to unlock.",
            },
        )

    # --- Verify ---
    if not _bcrypt_verify(passcode_plain, passcode_row.hashed_passcode):
        passcode_row.failed_attempts += 1
        if passcode_row.failed_attempts >= _MAX_ATTEMPTS:
            passcode_row.locked_out = True
        db.commit()
        remaining = max(0, _MAX_ATTEMPTS - passcode_row.failed_attempts)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "PASSCODE_INVALID",
                "message": f"Incorrect passcode. {remaining} attempt(s) remaining.",
                "attempts_remaining": remaining,
            },
        )

    # --- Success ---
    passcode_row.failed_attempts = 0
    user.last_login = tz.now()
    db.commit()
    return user


def check_and_reset_passcode_lockout(db: Session, user_id: int) -> bool:
    """
    Called after a successful password login.
    If the passcode is locked out (>= 3 attempts), it leaves it locked out and returns True.
    If it's just partially failed (< 3), it resets the attempts to 0 and returns False.
    """
    passcode_row = (
        db.query(UserPasscode).filter(UserPasscode.user_id == user_id).first()
    )
    if passcode_row:
        if passcode_row.locked_out or passcode_row.failed_attempts >= 3:
            passcode_row.locked_out = True
            db.commit()
            return True
        elif passcode_row.failed_attempts > 0:
            passcode_row.failed_attempts = 0
            db.commit()
    return False


def is_passcode_expired(db: Session, user_id: int, expiry_days: int) -> bool:
    """
    Returns True if the user has a passcode that has passed its expiry window.
    Used by the regular login endpoint to include a passcode_expired flag in its response.
    """
    passcode_row = (
        db.query(UserPasscode).filter(UserPasscode.user_id == user_id).first()
    )
    if not passcode_row:
        return False
    expires_at = passcode_row.created_at_ts + timedelta(days=expiry_days)
    return _utcnow() >= expires_at
