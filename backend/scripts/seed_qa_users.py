#!/usr/bin/env python3
"""Seed two QA accounts for local browser testing (safe to run repeatedly).

  qa_admin   superuser                       password: QaAdmin#2026
  qa_branch  one branch (the first active    password: QaBranch#2026
             branch), a few view permissions
             and no products:view / suppliers:view
  qa_sales   same branch, quotations:view    password: QaSales#2026
             only (no purchasing permissions)

The restricted account exists to check branch scoping and price redaction by hand:
it must not see other branches' documents or supplier cost prices.
Local / development databases only.
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.base import Base  # noqa: F401,E402
from app.models import *  # noqa: F401,F403,E402

from app.auth.models import Branch, Permission, User  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

RESTRICTED_PERMISSIONS = [
    ("purchase_orders", "view"),
    ("grn", "view"),
    ("quotations", "view"),
    ("supplier_payments", "view"),
    ("item_transfer_notes", "view"),
]


def _upsert(db, username: str, password: str, superuser: bool) -> User:
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        user = User(
            username=username, email=f"{username}@example.com", first_name="QA", last_name=username,
            gender="Other", is_staff=True, date_joined=date.today(), birthdate=date(1990, 1, 1),
            employee_id=username.upper(), verify=True, blocked=False, occupation="QA",
        )
        db.add(user)
    user.email = f"{username}@example.com"
    user.hashed_password = get_password_hash(password)
    user.is_superuser = superuser
    user.is_active = True
    user.blocked = False
    return user


def main() -> None:
    db = SessionLocal()
    try:
        _upsert(db, "qa_admin", "QaAdmin#2026", superuser=True)
        restricted = _upsert(db, "qa_branch", "QaBranch#2026", superuser=False)
        branch = db.query(Branch).filter(Branch.is_active.is_(True)).order_by(Branch.id).first() \
            if hasattr(Branch, "is_active") else db.query(Branch).order_by(Branch.id).first()
        restricted.branches = [branch] if branch else []
        perms = []
        for resource, action in RESTRICTED_PERMISSIONS:
            p = db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
            if p:
                perms.append(p)
        restricted.permissions = perms
        # Sales-side viewer: may peek products from quotations but must never see supplier costs.
        sales = _upsert(db, "qa_sales", "QaSales#2026", superuser=False)
        sales.branches = [branch] if branch else []
        sales.permissions = [
            p for p in [db.query(Permission).filter(Permission.resource == "quotations", Permission.action == "view").first()] if p
        ]
        db.commit()
        print(f"qa_admin ready; qa_branch ready on branch {branch.branch_code if branch else '-'} "
              f"with {len(perms)} permissions")
    finally:
        db.close()


if __name__ == "__main__":
    main()
