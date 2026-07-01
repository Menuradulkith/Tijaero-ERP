from app.auth import schemas, service
from app.auth.dependencies import get_current_active_user
from app.auth.rbac import Permissions, require_permission
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_password_marker,
)
from app.core.simple_rate_limit import rate_limit
from app.db.session import get_db
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

router = APIRouter()


def _use_secure_cookie() -> bool:
    """Use Secure cookies only when at least one configured frontend origin is HTTPS.
    This keeps production secure and allows local HTTP development to work.
    """
    origins = settings.BACKEND_CORS_ORIGINS
    return any(str(origin).startswith("https://") for origin in origins)


def _get_expiry_days(db: Session) -> int:
    """Read passcode_expiry_days from company settings. Falls back to 30 if not set."""
    try:
        from app.modules.settings.models import Settings as CompanySettings
        row = db.query(CompanySettings).first()
        if row and hasattr(row, "passcode_expiry_days") and row.passcode_expiry_days:
            return int(row.passcode_expiry_days)
    except Exception:
        pass
    return 30


def _issue_tokens(user, response: Response, db: Session) -> dict:
    """Create and set access+refresh token pair. Returns the token dict."""
    password_marker = get_password_marker(user.hashed_password)
    access_token = create_access_token(
        data={"sub": str(user.id), "pwd": password_marker}
    )
    refresh_token_val = create_refresh_token(
        data={"sub": str(user.id), "pwd": password_marker}
    )
    secure_cookie = _use_secure_cookie()
    response.set_cookie(
        key="refresh_token",
        value=refresh_token_val,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=7 * 24 * 60 * 60,
        path="/",
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post(
    "/login",
    response_model=schemas.PasscodeLoginResponse,
    summary="User Login",
    description=(
        "Authenticate user and receive JWT access token. "
        "Refresh token is securely set in an HttpOnly cookie. "
        "passcode_expired=true in the response signals that the user's passcode "
        "has expired and they should visit Profile → Security to set a new one."
    ),
    dependencies=[Depends(rate_limit(5))],
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
    token_data = _issue_tokens(user, response, db)

    # Handle passcode lockout and expiry checks
    from app.auth.passcode_service import check_and_reset_passcode_lockout, is_passcode_expired
    
    # If the user was locked out, we delete their passcode and notify the frontend
    passcode_locked_out = check_and_reset_passcode_lockout(db, user.id)

    # Inform the frontend whether the passcode has expired so it can show a nudge
    expiry_days = _get_expiry_days(db)
    passcode_expired = False
    if not passcode_locked_out:
        # Only check expiry if they weren't just locked out (and thus had it deleted)
        passcode_expired = is_passcode_expired(db, user.id, expiry_days)

    return {
        **token_data, 
        "passcode_expired": passcode_expired,
        "passcode_locked_out": passcode_locked_out
    }


@router.post(
    "/passcode-login",
    response_model=schemas.Token,
    summary="Passcode Login",
    description=(
        "Authenticate with a 6-digit numeric passcode instead of a full password. "
        "Returns structured error codes (PASSCODE_EXPIRED, PASSCODE_LOCKED, "
        "PASSCODE_INVALID) so the UI can react appropriately."
    ),
    dependencies=[Depends(rate_limit(5))],
    responses={
        200: {"description": "Successfully authenticated via passcode"},
        401: {"description": "Invalid, expired, or locked passcode"},
        429: {"description": "Too many requests (Rate limited)"},
    },
)
def passcode_login(
    body: schemas.PasscodeLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    from app.auth.passcode_service import verify_passcode_login

    expiry_days = _get_expiry_days(db)
    user = verify_passcode_login(db, body.username, body.passcode, expiry_days)
    return _issue_tokens(user, response, db)


@router.post(
    "/passcode",
    summary="Set or Change Passcode",
    description=(
        "Set or change the authenticated user's 6-digit passcode. "
        "Returns 400 if the passcode matches any of the last 5 used passcodes."
    ),
)
def set_passcode(
    body: schemas.SetPasscodeRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    from app.auth.passcode_service import set_passcode as svc_set_passcode
    return svc_set_passcode(db, current_user.id, body.passcode, body.confirm_passcode)


@router.get(
    "/passcode/status",
    response_model=schemas.PasscodeStatus,
    summary="Get Passcode Status",
    description="Returns the current passcode state for the authenticated user.",
)
def get_passcode_status(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    from app.auth.passcode_service import get_passcode_status as svc_status
    expiry_days = _get_expiry_days(db)
    return svc_status(db, current_user.id, expiry_days)


@router.delete(
    "/passcode",
    summary="Remove Passcode",
    description=(
        "Removes the authenticated user's active passcode. "
        "History is retained so previously used codes remain blocked."
    ),
)
def delete_passcode(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    from app.auth.passcode_service import delete_passcode as svc_delete
    return svc_delete(db, current_user.id)


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

    token_password_marker = payload.get("pwd")
    current_password_marker = get_password_marker(user.hashed_password)
    if not token_password_marker or token_password_marker != current_password_marker:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired due to password change. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    new_access_token = create_access_token(
        data={"sub": str(user.id), "pwd": current_password_marker}
    )
    new_refresh_token = create_refresh_token(
        data={"sub": str(user.id), "pwd": current_password_marker}
    )
    secure_cookie = _use_secure_cookie()

    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=secure_cookie,
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
    secure_cookie = _use_secure_cookie()
    response.delete_cookie(
        "refresh_token",
        path="/",
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
    )
    return {"message": "Successfully logged out"}


@router.post(
    "/register",
    response_model=schemas.User,
    status_code=status.HTTP_201_CREATED,
    summary="Register New User (Admin Only)",
    description=(
        "Create a new user account. This endpoint is restricted to authenticated "
        "administrators with the `users:create` permission. Public self-registration "
        "is not permitted in this ERP system."
    ),
    dependencies=[
        Depends(rate_limit(10)),
        Depends(require_permission(*Permissions.USER_CREATE)),
    ],
    responses={
        201: {"description": "User successfully created"},
        401: {"description": "Not authenticated"},
        403: {"description": "Insufficient permissions"},
        422: {"description": "Validation error"},
        429: {"description": "Too many requests (Rate limited)"},
    },
)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    """Create a new user account. Requires admin authentication and USER_CREATE permission."""
    return service.auth_service.create_user(db, user_in)
