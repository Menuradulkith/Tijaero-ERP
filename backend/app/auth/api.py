from app.auth import schemas, service
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from app.core.simple_rate_limit import rate_limit
from app.db.session import get_db
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

router = APIRouter()


@router.post(
    "/login",
    response_model=schemas.Token,
    summary="User Login",
    description="Authenticate user and receive JWT access token. Refresh token is securely set in an HttpOnly cookie.",
    dependencies=[
        Depends(rate_limit(5))
    ],  # Industry standard: strict rate limiting on login
    responses={
        200: {"description": "Successfully authenticated"},
        401: {"description": "Invalid credentials"},
        429: {"description": "Too many requests (Rate limited)"},
    },
)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = service.auth_service.authenticate_user(
        db, form_data.username, form_data.password
    )
    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    # Industry Standard: Send refresh token securely via HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,  # Should be True in production (HTTPS)
        samesite="lax",  # Prevents CSRF while allowing seamless navigation
        max_age=7 * 24 * 60 * 60,  # 7 Days
        path="/",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


@router.post(
    "/refresh",
    response_model=schemas.Token,
    summary="Refresh Access Token",
    description="Use a valid secure cookie refresh token to obtain a new access token and rotate the refresh cookie.",
    responses={
        200: {"description": "New tokens issued"},
        401: {"description": "Invalid or expired refresh token"},
    },
)
def refresh_token(
    response: Response,
    refresh_token: str | None = Cookie(None),
    db: Session = Depends(get_db),
):
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing from cookies. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_refresh_token(refresh_token)
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

    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=7 * 24 * 60 * 60,
        path="/",
    )

    return {
        "access_token": new_access_token,
        "token_type": "bearer",
    }


@router.post(
    "/logout",
    summary="User Logout",
    description="Clears the HttpOnly refresh token cookie.",
)
def logout(response: Response):
    response.delete_cookie(
        "refresh_token", path="/", httponly=True, secure=True, samesite="lax"
    )
    return {"message": "Successfully logged out"}


@router.post(
    "/register",
    response_model=schemas.User,
    status_code=status.HTTP_201_CREATED,
    summary="Register New User",
    description="Create a new user account",
    dependencies=[Depends(rate_limit(10))],  # Industry standard: rate limit signup spam
    responses={
        201: {"description": "User successfully created"},
        422: {"description": "Validation error"},
        429: {"description": "Too many requests (Rate limited)"},
    },
)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):

    return service.auth_service.create_user(db, user_in)
