from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth import schemas, service
from app.core.security import create_access_token, create_refresh_token, decode_refresh_token

router = APIRouter()

@router.post(
    "/login",
    response_model=schemas.Token,
    summary="User Login",
    description="Authenticate user and receive JWT access token and refresh token",
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
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }

@router.post(
    "/refresh",
    response_model=schemas.Token,
    summary="Refresh Access Token",
    description="Use a valid refresh token to obtain a new access token and refresh token (token rotation)",
    responses={
        200: {"description": "New tokens issued"},
        401: {"description": "Invalid or expired refresh token"},
    }
)
def refresh_token(
    request: schemas.RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Refresh token rotation: accepts a valid refresh token and returns
    a new access token AND a new refresh token. The old refresh token
    should be discarded by the client.
    """
    payload = decode_refresh_token(request.refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify the user still exists and is active
    from app.auth.models import User
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active or user.blocked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or blocked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Issue new token pair (rotation)
    new_access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }

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
