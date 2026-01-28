from app.auth.models import Branch, Group, Permission, User
from app.common.attachments import Attachment
from app.common.audit import AuditLog
from app.modules.common.models import Approvals, Country, Locations
from app.common.workflow import WorkflowStep
from app.modules.attendance.models import Attendance, Leaves
from app.modules.customers.models import (
    Customer,
    CustomerAdvancePayments,
    CustomerCreditNotes,
    CustomerCreditsSettle,
    CustomerCreditsSettleTransaction,
    CustomerCuponCodes,
    CustomerGiftVoucher,
)
from app.modules.employees.models import (
    Employee,
    EmployeePayroll,
    EmployeePromotions,
    EmployeeSalaryProfile,
    EmployeesAssets,
)
from app.modules.finance.models import (
    BankDeposits,
    CardPayments,
    ChequePayments,
    CreditPayments,
    Expenses,
    PettyCash,
    Vouchers,
)
from app.modules.hr.models import Reimbursements, SalaryDeductions
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.marketing.models import AdvanceReceipt, WebPosts
from app.modules.products.models import Category, ItemsBrand, MinimumPrice, Product
from app.modules.purchasing.models import (
    GoodReceivedItems,
    GoodReceivedNote,
    PurchasingOrder,
    PurchasingOrderItems,
    PurchasingReturn,
    PurchasingReturnItems,
    Supplier,
    SupplierCreditsSettle,
    SupplierCreditsSettleTransaction,
)
from app.modules.reporting.models import Report, ReportExecution
from app.modules.sales.models import (
    Invoice,
    InvoiceItems,
    InvoiceItemsBarcode,
    SaleReturn,
    SaleReturnItems,
)
from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
from app.modules.settings.models import Settings, UserNotification, UserPreferences
from app.modules.support.models import (
    CSJobItem,
    CustomerCallLog,
    CustomerSupport,
    WarrantyClaims,
)
from app.modules.warehouse.models import (
    ItemReceiveNote,
    ItemTransferNote,
    ItemTransferNoteApproved,
    ItemTransferNoteItemProduct,
    ItemTransferNoteItems,
)

__all__ = [
    "User",
    "Group",
    "Permission",
    "Branch",
    "Customer",
    "CustomerAdvancePayments",
    "CustomerCreditNotes",
    "CustomerCreditsSettle",
    "CustomerCreditsSettleTransaction",
    "CustomerCuponCodes",
    "CustomerGiftVoucher",
    "Employee",
    "Product",
    "Invoice",
    "SalesQuote",
    "SalesQuoteItem",
    "PurchasingOrder",
    "Supplier",
    "SupplierCreditsSettle",
    "SupplierCreditsSettleTransaction",
    "ItemTransferNote",
    "CustomerSupport",
    "Attendance",
    "Country",
    "WorkflowStep",
    "Attachment",
    "AuditLog",
    "AdvanceReceipt",
    "WebPosts",
    "Settings",
    "UserNotification",
    "UserPreferences",
    "Report",
    "ReportExecution",
]
