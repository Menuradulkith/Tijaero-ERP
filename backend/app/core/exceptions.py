class AppException(Exception):
    pass

class AuthenticationError(AppException):
    pass

class AuthorizationError(AppException):
    pass

class NotFoundError(AppException):
    pass

class ValidationError(AppException):
    pass
