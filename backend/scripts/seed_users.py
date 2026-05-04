"""
Seed staff users across all branches for a computer shop.
Creates 1 manager + 2 sales staff per branch = 30 users total,
plus 5 shared roles (warehouse, finance, HR, IT admin, support).
All users get password: Password@123
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models import *
from app.auth.models import User, Branch
from app.modules.common.models import Country
from app.core.security import get_password_hash

# Branch code → list of (first_name, last_name, gender, username, email, occupation, employee_id)
BRANCH_USERS = {
    "HO-CMB": [
        ("Rohan",   "Mendis",      "Male",   "rohan.mendis",      "rohan.mendis@tijaerotech.lk",      "Branch Manager",   "EMP-HO-001"),
        ("Kasun",   "Perera",      "Male",   "kasun.perera",      "kasun.perera@tijaerotech.lk",      "Sales Executive",  "EMP-HO-002"),
        ("Nisha",   "Fernando",    "Female", "nisha.fernando",    "nisha.fernando@tijaerotech.lk",    "Sales Executive",  "EMP-HO-003"),
    ],
    "BR-CMB01": [
        ("Thilina", "Silva",       "Male",   "thilina.silva",     "thilina.silva@tijaerotech.lk",     "Branch Manager",   "EMP-CMB-001"),
        ("Dinesh",  "Jayawardena", "Male",   "dinesh.jaya",       "dinesh.jaya@tijaerotech.lk",       "Sales Executive",  "EMP-CMB-002"),
        ("Priya",   "Bandara",     "Female", "priya.bandara",     "priya.bandara@tijaerotech.lk",     "Sales Executive",  "EMP-CMB-003"),
    ],
    "BR-KDY01": [
        ("Chamara", "Rathnayake",  "Male",   "chamara.rathna",    "chamara.rathna@tijaerotech.lk",    "Branch Manager",   "EMP-KDY-001"),
        ("Vimukthi","Wickrama",    "Male",   "vimukthi.w",        "vimukthi.w@tijaerotech.lk",        "Sales Executive",  "EMP-KDY-002"),
        ("Sanduni", "Gunasekara",  "Female", "sanduni.guna",      "sanduni.guna@tijaerotech.lk",      "Sales Executive",  "EMP-KDY-003"),
    ],
    "BR-GAL01": [
        ("Lahiru",  "Dissanayake", "Male",   "lahiru.dissa",      "lahiru.dissa@tijaerotech.lk",      "Branch Manager",   "EMP-GAL-001"),
        ("Nuwan",   "Senanayake",  "Male",   "nuwan.sena",        "nuwan.sena@tijaerotech.lk",        "Sales Executive",  "EMP-GAL-002"),
        ("Ishara",  "Rajapaksa",   "Female", "ishara.raja",       "ishara.raja@tijaerotech.lk",       "Sales Executive",  "EMP-GAL-003"),
    ],
    "BR-NGM01": [
        ("Sanjaya", "Weerasinghe", "Male",   "sanjaya.weera",     "sanjaya.weera@tijaerotech.lk",     "Branch Manager",   "EMP-NGM-001"),
        ("Dhanuka", "Amarasinghe", "Male",   "dhanuka.amara",     "dhanuka.amara@tijaerotech.lk",     "Sales Executive",  "EMP-NGM-002"),
        ("Dilini",  "Kuruppu",     "Female", "dilini.kuruppu",    "dilini.kuruppu@tijaerotech.lk",    "Sales Executive",  "EMP-NGM-003"),
    ],
    "BR-KRL01": [
        ("Asela",   "Liyanage",    "Male",   "asela.liyanage",    "asela.liyanage@tijaerotech.lk",    "Branch Manager",   "EMP-KRL-001"),
        ("Harsha",  "Samaraweera", "Male",   "harsha.samara",     "harsha.samara@tijaerotech.lk",     "Sales Executive",  "EMP-KRL-001B"),
        ("Malsha",  "Karunaratne", "Female", "malsha.karuna",     "malsha.karuna@tijaerotech.lk",     "Sales Executive",  "EMP-KRL-002"),
    ],
    "BR-MTR01": [
        ("Udara",   "Wijesinghe",  "Male",   "udara.wije",        "udara.wije@tijaerotech.lk",        "Branch Manager",   "EMP-MTR-001"),
        ("Chathura","Pathirana",   "Male",   "chathura.pathi",    "chathura.pathi@tijaerotech.lk",    "Sales Executive",  "EMP-MTR-002"),
        ("Ruwani",  "Siriwardena", "Female", "ruwani.siri",       "ruwani.siri@tijaerotech.lk",       "Sales Executive",  "EMP-MTR-003"),
    ],
    "BR-JFN01": [
        ("Kumaran", "Arumugam",    "Male",   "kumaran.arum",      "kumaran.arum@tijaerotech.lk",      "Branch Manager",   "EMP-JFN-001"),
        ("Praveen", "Navaratnam",  "Male",   "praveen.nava",      "praveen.nava@tijaerotech.lk",      "Sales Executive",  "EMP-JFN-002"),
        ("Thivya",  "Rajaratnam",  "Female", "thivya.raja",       "thivya.raja@tijaerotech.lk",       "Sales Executive",  "EMP-JFN-003"),
    ],
    "BR-BTC01": [
        ("Riyaz",   "Ahamed",      "Male",   "riyaz.ahamed",      "riyaz.ahamed@tijaerotech.lk",      "Branch Manager",   "EMP-BTC-001"),
        ("Faris",   "Nusrath",     "Male",   "faris.nusrath",     "faris.nusrath@tijaerotech.lk",     "Sales Executive",  "EMP-BTC-002"),
        ("Shafiya", "Fairoze",     "Female", "shafiya.fair",      "shafiya.fair@tijaerotech.lk",      "Sales Executive",  "EMP-BTC-003"),
    ],
    "BR-ANR01": [
        ("Pradeep", "Jayasuriya",  "Male",   "pradeep.jaya",      "pradeep.jaya@tijaerotech.lk",      "Branch Manager",   "EMP-ANR-001"),
        ("Kalana",  "Abeykoon",    "Male",   "kalana.abey",       "kalana.abey@tijaerotech.lk",       "Sales Executive",  "EMP-ANR-002"),
        ("Sachini", "Gunawardena", "Female", "sachini.guna",      "sachini.guna@tijaerotech.lk",      "Sales Executive",  "EMP-ANR-003"),
    ],
}

# Shared HQ staff assigned to Head Office
HQ_STAFF = [
    ("Nimal",    "Jayasinghe",   "Male",   "nimal.jaya",        "nimal.jaya@tijaerotech.lk",        "Warehouse Manager",   "EMP-WH-001"),
    ("Amali",    "Peiris",       "Female", "amali.peiris",      "amali.peiris@tijaerotech.lk",      "Finance Manager",     "EMP-FIN-001"),
    ("Tharanga", "Ranasinghe",   "Male",   "tharanga.rana",     "tharanga.rana@tijaerotech.lk",     "HR Manager",          "EMP-HR-001"),
    ("Isuru",    "Wickramasinghe","Male",  "isuru.wickrama",    "isuru.wickrama@tijaerotech.lk",    "IT Administrator",    "EMP-IT-001"),
    ("Kavindi",  "Hettiarachchi","Female", "kavindi.hetti",     "kavindi.hetti@tijaerotech.lk",     "Customer Support",    "EMP-CS-001"),
]

DEFAULT_PASSWORD = "Password@123"


def seed_users():
    db: Session = SessionLocal()
    try:
        print("🌱 Seeding staff users...")
        created = skipped = 0
        today = date.today()

        country = db.query(Country).filter(Country.iso == "LK").first()
        if not country:
            country = db.query(Country).first()

        hashed_pw = get_password_hash(DEFAULT_PASSWORD)

        # ── Branch staff ──────────────────────────────────────────────
        for branch_code, staff_list in BRANCH_USERS.items():
            branch = db.query(Branch).filter(Branch.branch_code == branch_code).first()
            if not branch:
                print(f"  ⚠  Branch not found: {branch_code} — run seed_branches.py first")
                continue

            for (first_name, last_name, gender, username, email, occupation, employee_id) in staff_list:
                if db.query(User).filter(User.username == username).first():
                    print(f"  ⏭  Skipped (exists): {username}")
                    skipped += 1
                    continue

                user = User(
                    username=username,
                    email=email,
                    first_name=first_name,
                    last_name=last_name,
                    gender=gender,
                    hashed_password=hashed_pw,
                    is_superuser=False,
                    is_staff=True,
                    is_active=True,
                    date_joined=today,
                    birthdate=today,
                    employee_id=employee_id,
                    verify=True,
                    blocked=False,
                    occupation=occupation,
                    country_id=country.id if country else None,
                )
                user.branches.append(branch)
                db.add(user)
                print(f"  ✅ Created: {username} → {branch_code}")
                created += 1

        # ── HQ shared staff ───────────────────────────────────────────
        hq_branch = db.query(Branch).filter(Branch.branch_code == "HO-CMB").first()

        for (first_name, last_name, gender, username, email, occupation, employee_id) in HQ_STAFF:
            if db.query(User).filter(User.username == username).first():
                print(f"  ⏭  Skipped (exists): {username}")
                skipped += 1
                continue

            user = User(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
                gender=gender,
                hashed_password=hashed_pw,
                is_superuser=False,
                is_staff=True,
                is_active=True,
                date_joined=today,
                birthdate=today,
                employee_id=employee_id,
                verify=True,
                blocked=False,
                occupation=occupation,
                country_id=country.id if country else None,
            )
            if hq_branch:
                user.branches.append(hq_branch)
            db.add(user)
            print(f"  ✅ Created: {username} (HQ Staff)")
            created += 1

        db.commit()
        print(f"\n✅ Done — {created} users created, {skipped} already existed.")
        print(f"🔑 Default password for all users: {DEFAULT_PASSWORD}")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_users()
