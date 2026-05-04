"""
Seed 10 branches for a computer shop chain.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models import *
from app.auth.models import Branch

# (branch_name, branch_code, address, email, contact_number)
BRANCHES = [
    (
        "Head Office - Colombo",
        "HO-CMB",
        "No. 1, Main Street, Colombo 01",
        "headoffice@tijaerotech.lk",
        "0112345678",
    ),
    (
        "Colombo City Branch",
        "BR-CMB01",
        "No. 45, Galle Road, Colombo 03",
        "colombo@tijaerotech.lk",
        "0112345679",
    ),
    (
        "Kandy Branch",
        "BR-KDY01",
        "No. 12, Dalada Veediya, Kandy",
        "kandy@tijaerotech.lk",
        "0812345678",
    ),
    (
        "Galle Branch",
        "BR-GAL01",
        "No. 7, Wakwella Road, Galle",
        "galle@tijaerotech.lk",
        "0912345678",
    ),
    (
        "Negombo Branch",
        "BR-NGM01",
        "No. 23, Colombo Road, Negombo",
        "negombo@tijaerotech.lk",
        "0312345678",
    ),
    (
        "Kurunegala Branch",
        "BR-KRL01",
        "No. 56, Rajapihilla Road, Kurunegala",
        "kurunegala@tijaerotech.lk",
        "0372345678",
    ),
    (
        "Matara Branch",
        "BR-MTR01",
        "No. 18, Anagarika Dharmapala Mw, Matara",
        "matara@tijaerotech.lk",
        "0412345678",
    ),
    (
        "Jaffna Branch",
        "BR-JFN01",
        "No. 33, Hospital Road, Jaffna",
        "jaffna@tijaerotech.lk",
        "0212345678",
    ),
    (
        "Batticaloa Branch",
        "BR-BTC01",
        "No. 9, Bar Road, Batticaloa",
        "batticaloa@tijaerotech.lk",
        "0652345678",
    ),
    (
        "Anuradhapura Branch",
        "BR-ANR01",
        "No. 14, Maithripala Mawatha, Anuradhapura",
        "anuradhapura@tijaerotech.lk",
        "0252345678",
    ),
]


def seed_branches():
    db: Session = SessionLocal()
    try:
        print("🌱 Seeding branches...")
        created = skipped = 0

        for (branch_name, branch_code, address, email, contact_number) in BRANCHES:
            if db.query(Branch).filter(Branch.branch_code == branch_code).first():
                print(f"  ⏭  Skipped (exists): {branch_name}")
                skipped += 1
                continue

            db.add(Branch(
                branch_name=branch_name,
                branch_code=branch_code,
                address=address,
                email=email,
                contact_number=contact_number,
                active=True,
            ))
            print(f"  ✅ Created: {branch_name}")
            created += 1

        db.commit()
        print(f"\n✅ Done — {created} branches created, {skipped} already existed.")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_branches()
