from fastapi import Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.dependencies import get_current_active_user
from app.auth.models import User

def get_current_user_dep(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return current_user
