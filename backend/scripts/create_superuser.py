import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.auth.models import User
from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models import *  # This imports all models in correct order
from sqlalchemy import select


def create_superuser(email: str, username: str, password: str):
    db = SessionLocal()

    # Check if user already exists
    stmt = select(User).where(User.username == username)
    existing_user = db.execute(stmt).scalars().first()

    if existing_user:
        print(f"User {username} already exists. Updating password...")
        existing_user.hashed_password = get_password_hash(password)
        existing_user.is_superuser = True
        existing_user.is_active = True
    else:
        print(f"Creating new superuser {username}...")
        user = User(
            email=email,
            username=username,
            hashed_password=get_password_hash(password),
            is_superuser=True,
            is_active=True,
        )
        db.add(user)

    db.commit()
    db.close()


if __name__ == "__main__":
    create_superuser("admin@example.com", "admin", "admin123")
    print("Superuser created successfully!")
