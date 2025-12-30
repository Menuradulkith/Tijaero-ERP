class AppException(Exception):
    """Base application exception"""
    pass

class AuthenticationError(AppException):
    """Authentication failed"""
    pass

class AuthorizationError(AppException):
    """Authorization failed"""
    pass

class NotFoundError(AppException):
    """Resource not found"""
    pass

class ValidationError(AppException):
    """Validation failed"""
    pass
