"""
Centralized enumerations for TijaeroERP.

All status string literals used across the ERP must be defined here.
Import and compare against these enums instead of using raw strings.
"""

from enum import Enum


class Status(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    DELETED = "deleted"


class DocumentStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"
    PENDING_APPROVAL = "pending_approval"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class PaymentStatus(str, Enum):
    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"
    REFUNDED = "refunded"


class PaymentMethod(str, Enum):
    CASH = "cash"
    CREDIT = "credit"
    CHEQUE = "cheque"
    CARD_VISA = "card_visa"
    CARD_MASTERCARD = "card_mastercard"
    CARD_AMEX = "card_amex"
    BANK_TRANSFER = "bank_transfer"
    CREDIT_NOTE = "credit_note"


class StockStatus(str, Enum):
    AVAILABLE = "available"
    SOLD = "sold"
    RESERVED = "reserved"
    RETURNED = "returned"
    RETURNED_TO_SUPPLIER = "returned_to_supplier"
    RETURNED_NON_RESTOCKABLE = "returned_non_restockable"
    RETURN_PENDING = "return_pending"
    TRANSFERRED = "transferred"
    TRANSFER_PENDING = "transfer_pending"
    IN_TRANSIT = "in_transit"
    DAMAGED = "damaged"


class AssetStatus(str, Enum):
    AVAILABLE = "available"
    IN_USE = "in_use"
    RETIRED = "retired"
    DISPOSED = "disposed"
    RETURNED = "returned"  # From sale return (non-restockable)


class ExpenseStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAID = "paid"
    RECORDED = "recorded"


class ReturnCondition(str, Enum):
    GOOD = "good"
    DAMAGED = "damaged"
    DEFECTIVE = "defective"
    OPENED = "opened"


class ReturnReason(str, Enum):
    DEFECTIVE = "defective"
    WRONG_ITEM = "wrong_item"
    CUSTOMER_CHANGED_MIND = "customer_changed_mind"
    DAMAGED = "damaged"
    OTHER = "other"


class PurchaseOrderStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    PENDING = "pending"
    APPROVED = "approved"
    PARTIALLY_COMPLETED = "partially_completed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    # Manually closed while only partially received — the supplier has
    # confirmed no more units are coming for the remaining ordered qty, so
    # the order stops counting as "outstanding" without pretending it was
    # fully completed.
    SHORT_CLOSED = "short_closed"


class SupplierTaxArea(str, Enum):
    """A supplier's tax treatment classification — standard ERP "fiscal
    position" concept (cf. Odoo's Fiscal Position, SAP tax classification).
    Independent of the company-wide default tax rate (Settings.default_tax_rate)
    and of tax_registration_number (just an ID string)."""
    DOMESTIC_STANDARD = "domestic_standard"
    DOMESTIC_ZERO_RATED = "domestic_zero_rated"
    DOMESTIC_EXEMPT = "domestic_exempt"
    EXPORT = "export"
    IMPORT = "import"


class SupplierPaymentMethodType(str, Enum):
    """A supplier's standing/preferred payment method — master data on the
    supplier record (how they're set up to be paid), not a one-off
    transaction payment method. Matches standard ERP vendor-master payment
    method options (SAP, Oracle NetSuite, MS Dynamics)."""
    CASH = "cash"
    CHEQUE = "cheque"
    BANK_TRANSFER = "bank_transfer"
    DIRECT_DEBIT = "direct_debit"
    LETTER_OF_CREDIT = "letter_of_credit"
    CREDIT_CARD = "credit_card"
    DIGITAL_WALLET = "digital_wallet"
