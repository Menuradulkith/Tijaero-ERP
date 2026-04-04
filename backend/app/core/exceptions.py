"""
Custom exception hierarchy for TijaeroERP.

These exceptions are caught by the global exception handlers registered
in ``app.main`` and translated into appropriate HTTP responses.
Business logic should raise these instead of ``HTTPException`` so that
the service / repository layers stay framework-agnostic.
"""

from typing import Any, Optional


class AppException(Exception):
    """Base exception for all application errors."""

    def __init__(self, detail: str = "An application error occurred", status_code: int = 500, extra: Optional[dict[str, Any]] = None):
        self.detail = detail
        self.status_code = status_code
        self.extra = extra or {}
        super().__init__(detail)


class AuthenticationError(AppException):
    """Raised when authentication fails (invalid credentials, expired tokens, etc.)."""

    def __init__(self, detail: str = "Authentication failed"):
        super().__init__(detail=detail, status_code=401)


class AuthorizationError(AppException):
    """Raised when an authenticated user lacks required permissions."""

    def __init__(self, detail: str = "Permission denied"):
        super().__init__(detail=detail, status_code=403)


class NotFoundError(AppException):
    """Raised when a requested resource does not exist."""

    def __init__(self, detail: str = "Resource not found", entity: str = "", entity_id: Any = None):
        if entity and entity_id is not None:
            detail = f"{entity} with id {entity_id} not found"
        super().__init__(detail=detail, status_code=404)


class ValidationError(AppException):
    """Raised when input data fails business-rule validation."""

    def __init__(self, detail: str = "Validation error"):
        super().__init__(detail=detail, status_code=422)


class ConflictError(AppException):
    """Raised when an operation conflicts with current state (duplicates, etc.)."""

    def __init__(self, detail: str = "Conflict"):
        super().__init__(detail=detail, status_code=409)


class BusinessRuleError(AppException):
    """Raised when a business rule is violated (e.g. daily PO limit, credit limit exceeded)."""

    def __init__(self, detail: str = "Business rule violation"):
        super().__init__(detail=detail, status_code=400)
