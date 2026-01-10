"""
Centralized Configuration Constants for TijaeroERP Backend
Application-wide configuration values.
"""

# Pagination Defaults
PAGINATION_DEFAULTS = {
    "PAGE_SIZE": 20,
    "MAX_PAGE_SIZE": 100,
    "DEFAULT_PAGE": 1,
}

# File Upload Configuration
FILE_UPLOAD_CONFIG = {
    "MAX_FILE_SIZE_MB": 10,
    "MAX_FILE_SIZE_BYTES": 10 * 1024 * 1024,  # 10MB
    "ALLOWED_IMAGE_TYPES": ["image/jpeg", "image/png", "image/gif", "image/webp"],
    "ALLOWED_DOCUMENT_TYPES": ["application/pdf", "application/msword", 
                               "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                               "application/vnd.ms-excel",
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    "ALLOWED_EXTENSIONS": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx"],
}

# Cache Configuration
CACHE_CONFIG = {
    "DEFAULT_TTL_SECONDS": 300,  # 5 minutes
    "SHORT_TTL_SECONDS": 60,     # 1 minute
    "LONG_TTL_SECONDS": 3600,    # 1 hour
}

# Date/Time Formats
DATE_FORMATS = {
    "DATE": "%Y-%m-%d",
    "DATETIME": "%Y-%m-%d %H:%M:%S",
    "DATE_DISPLAY": "%d %b %Y",
    "DATETIME_DISPLAY": "%d %b %Y %H:%M",
    "TIME": "%H:%M:%S",
}

# Reporting Constants
REPORTING_CONFIG = {
    "MAX_EXPORT_ROWS": 10000,
    "DEFAULT_CHART_COLORS": [
        "#3B82F6", "#10B981", "#F59E0B", "#EF4444", 
        "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"
    ],
}

# Invoice/Order Number Prefixes
DOCUMENT_PREFIXES = {
    "INVOICE": "INV",
    "PURCHASE_ORDER": "PO",
    "SALE_RETURN": "SR",
    "PURCHASE_RETURN": "PR",
    "GRN": "GRN",
    "TRANSFER_NOTE": "TN",
    "EXPENSE": "EXP",
    "VOUCHER": "VCH",
}

# Workflow Configuration
WORKFLOW_CONFIG = {
    "AUTO_APPROVE_THRESHOLD": 0,  # Auto-approve if amount below this (0 = always require approval)
    "REQUIRE_DUAL_APPROVAL": False,
    "APPROVAL_EXPIRY_DAYS": 7,
}

# Security Constants
SECURITY_CONFIG = {
    "MIN_PASSWORD_LENGTH": 8,
    "PASSWORD_REQUIRE_UPPERCASE": True,
    "PASSWORD_REQUIRE_LOWERCASE": True,
    "PASSWORD_REQUIRE_DIGIT": True,
    "PASSWORD_REQUIRE_SPECIAL": False,
    "SESSION_TIMEOUT_MINUTES": 480,  # 8 hours
    "MAX_LOGIN_ATTEMPTS": 5,
    "LOCKOUT_DURATION_MINUTES": 30,
}

# Email Configuration
EMAIL_CONFIG = {
    "FROM_NAME": "TijaeroERP",
    "TEMPLATES_PATH": "templates/email",
}
