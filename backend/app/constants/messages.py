"""
Centralized Messages for TijaeroERP Backend
Success and error messages used across the application.
"""

# Success Messages
SUCCESS_MESSAGES = {
    # Generic
    "CREATE": "{entity} created successfully",
    "UPDATE": "{entity} updated successfully",
    "DELETE": "{entity} deleted successfully",
    "FETCH": "{entity} retrieved successfully",
    "LIST": "{entity} list retrieved successfully",
    
    # Auth
    "LOGIN": "Login successful",
    "LOGOUT": "Logout successful",
    "PASSWORD_CHANGE": "Password changed successfully",
    "PASSWORD_RESET": "Password reset email sent",
    
    # Sales
    "INVOICE_CREATED": "Invoice created successfully",
    "INVOICE_PAID": "Invoice marked as paid",
    "SALE_RETURN_PROCESSED": "Sale return processed successfully",
    
    # Purchasing
    "PO_CREATED": "Purchase order created successfully",
    "PO_APPROVED": "Purchase order approved",
    "GRN_CREATED": "Goods received note created successfully",
    
    # Inventory
    "STOCK_UPDATED": "Stock updated successfully",
    "TRANSFER_INITIATED": "Item transfer initiated",
    "TRANSFER_COMPLETED": "Item transfer completed",
    
    # HR
    "LEAVE_APPROVED": "Leave request approved",
    "LEAVE_REJECTED": "Leave request rejected",
    "ATTENDANCE_MARKED": "Attendance marked successfully",
}

# Error Messages
ERROR_MESSAGES = {
    # Generic
    "NOT_FOUND": "{entity} not found",
    "ALREADY_EXISTS": "{entity} already exists",
    "INVALID_DATA": "Invalid data provided",
    "OPERATION_FAILED": "Operation failed",
    "PERMISSION_DENIED": "You do not have permission to perform this action",
    
    # Auth
    "INVALID_CREDENTIALS": "Invalid username or password",
    "TOKEN_EXPIRED": "Token has expired",
    "TOKEN_INVALID": "Invalid token",
    "USER_INACTIVE": "User account is inactive",
    "UNAUTHORIZED": "Authentication required",
    
    # Validation
    "REQUIRED_FIELD": "{field} is required",
    "INVALID_FORMAT": "Invalid {field} format",
    "MIN_LENGTH": "{field} must be at least {min} characters",
    "MAX_LENGTH": "{field} must not exceed {max} characters",
    "INVALID_EMAIL": "Invalid email address",
    "INVALID_PHONE": "Invalid phone number",
    
    # Business Logic
    "INSUFFICIENT_STOCK": "Insufficient stock for {product}",
    "INVOICE_ALREADY_PAID": "Invoice is already paid",
    "CANNOT_DELETE_REFERENCED": "Cannot delete {entity} as it is referenced by other records",
    "DUPLICATE_ENTRY": "Duplicate entry found for {field}",
    "INVALID_STATUS_TRANSITION": "Cannot transition from {current} to {new} status",
    "APPROVAL_REQUIRED": "Approval required before proceeding",
    
    # File Upload
    "FILE_TOO_LARGE": "File size exceeds maximum allowed size",
    "INVALID_FILE_TYPE": "Invalid file type. Allowed types: {types}",
    "UPLOAD_FAILED": "File upload failed",
}

# Validation Messages
VALIDATION_MESSAGES = {
    "POSITIVE_NUMBER": "{field} must be a positive number",
    "NON_NEGATIVE": "{field} cannot be negative",
    "DATE_IN_FUTURE": "{field} must be a future date",
    "DATE_IN_PAST": "{field} must be a past date",
    "INVALID_RANGE": "{field} must be between {min} and {max}",
}
