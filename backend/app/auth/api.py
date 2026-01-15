from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth import schemas, service
from app.core.security import create_access_token

router = APIRouter()

@router.post(
    "/login",
    response_model=schemas.Token,
    summary="User Login",
    description="Authenticate user and receive JWT access token",
    responses={
        200: {"description": "Successfully authenticated"},
        401: {"description": "Invalid credentials"},
    }
)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = service.auth_service.authenticate_user(db, form_data.username, form_data.password)
    access_token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}

@router.post(
    "/register",
    response_model=schemas.User,
    status_code=status.HTTP_201_CREATED,
    summary="Register New User",
    description="Create a new user account",
    responses={
        201: {"description": "User successfully created"},
        422: {"description": "Validation error"},
    }
)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):

    return service.auth_service.create_user(db, user_in)
