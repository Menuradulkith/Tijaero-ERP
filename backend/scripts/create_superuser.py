import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import SessionLocal
from app.auth.models import User
from app.core.security import get_password_hash

def create_superuser(email: str, username: str, password: str):
    db = SessionLocal()
    user = User(
        email=email,
        username=username,
        hashed_password=get_password_hash(password),
        is_superuser=True,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.close()

if __name__ == "__main__":
    create_superuser("admin@example.com", "admin", "admin123")
    print("Superuser created successfully!")
