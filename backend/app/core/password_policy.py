"""One password policy for every place a password is set (create user, update
user, change password). Mirrors the rules the Users page already enforces in
the browser, so the API can no longer be used to bypass them."""
import re
from typing import Optional

MIN_LENGTH = 8
# bcrypt only uses the first 72 bytes; longer passwords would be silently truncated.
MAX_BYTES = 72


def validate_password_strength(password: str, username: Optional[str] = None) -> str:
    """Return ``password`` unchanged if acceptable, else raise ``ValueError``."""
    if len(password) < MIN_LENGTH:
        raise ValueError(f"Password must be at least {MIN_LENGTH} characters long")
    if len(password.encode("utf-8")) > MAX_BYTES:
        raise ValueError(f"Password must be at most {MAX_BYTES} bytes long")
    if not password.strip():
        raise ValueError("Password cannot be blank")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"[0-9]", password):
        raise ValueError("Password must contain at least one number")
    if not re.search(r"[^A-Za-z0-9\s]", password):
        raise ValueError("Password must contain at least one special character")
    if username and password.strip().lower() == username.strip().lower():
        raise ValueError("Password must not be the same as the username")
    return password
