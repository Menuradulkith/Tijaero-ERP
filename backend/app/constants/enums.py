"""
Centralized Enums for TijaeroERP Backend
All enum constants used across modules should be defined here.
"""
from enum import Enum


class OrderStatus(str, Enum):
    """Status for orders (sales/purchase)"""
    DRAFT = "draft"
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PROCESSING = "processing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ON_HOLD = "on_hold"


class PaymentStatus(str, Enum):
    """Payment status for invoices and orders"""
    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"
    REFUNDED = "refunded"


class PaymentMethod(str, Enum):
    """Payment methods supported"""
    CASH = "cash"
    CARD = "card"
    CHEQUE = "cheque"
    BANK_TRANSFER = "bank_transfer"
    CREDIT = "credit"
    MOBILE_PAYMENT = "mobile_payment"


class InvoiceStatus(str, Enum):
    """Invoice lifecycle status"""
    DRAFT = "draft"
    PENDING = "pending"
    SENT = "sent"
    PAID = "paid"
    PARTIAL = "partial"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class PurchaseOrderStatus(str, Enum):
    """Purchase order status"""
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    ORDERED = "ordered"
    PARTIALLY_RECEIVED = "partially_received"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class TransferStatus(str, Enum):
    """Item transfer note status"""
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    IN_TRANSIT = "in_transit"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class LeaveStatus(str, Enum):
    """Employee leave request status"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class AttendanceStatus(str, Enum):
    """Employee attendance status"""
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    HALF_DAY = "half_day"
    ON_LEAVE = "on_leave"
    HOLIDAY = "holiday"


class UserRole(str, Enum):
    """User roles in the system"""
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    MANAGER = "manager"
    STAFF = "staff"
    VIEWER = "viewer"


class ApprovalStatus(str, Enum):
    """Generic approval status"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUIRED = "revision_required"


class GRNStatus(str, Enum):
    """Goods Received Note status"""
    DRAFT = "draft"
    PENDING = "pending"
    PARTIALLY_RECEIVED = "partially_received"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class SupportTicketStatus(str, Enum):
    """Customer support ticket status"""
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING_CUSTOMER = "waiting_customer"
    RESOLVED = "resolved"
    CLOSED = "closed"


class WarrantyClaimStatus(str, Enum):
    """Warranty claim status"""
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    PROCESSING = "processing"
    COMPLETED = "completed"


class ExpenseStatus(str, Enum):
    """Expense claim status"""
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAID = "paid"


class StockMovementType(str, Enum):
    """Type of stock movement"""
    IN = "in"
    OUT = "out"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"
    RETURN = "return"
