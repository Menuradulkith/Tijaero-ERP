# All models import
from app.auth.models import User, Group, Permission, Branch
from app.modules.common.models import Country, Approvals, Locations
from app.modules.customers.models import Customer
from app.modules.employees.models import Employee, EmployeePayroll, EmployeeSalaryProfile, EmployeePromotions, EmployeesAssets
from app.modules.attendance.models import Attendance, Leaves
from app.modules.products.models import Product, Category, ItemsBrand, MinimumPrice
from app.modules.inventory.models import CompanyAssets, GoodReceivedItems, GoodReceivedNote
from app.modules.sales.models import Invoice, InvoiceItems, InvoiceItemsBarcode, SaleReturn, SaleReturnItems
from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems, PurchasingReturn, PurchasingReturnItems, Supplier
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, CreditPayments, 
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle,
    CustomerCreditsSettleTransaction, Expenses, Vouchers
)
from app.modules.warehouse.models import (
    ItemTransferNote, ItemTransferNoteItems, ItemTransferNoteItemProduct,
    ItemTransferNoteApproved, ItemReceiveNote
)
from app.modules.support.models import CustomerSupport, CSJobItem, CustomerCallLog, WarrantyClaims
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.marketing.models import CustomerCuponCodes, CustomerGiftVoucher


__all__ = [
    "User", "Group", "Permission", "Branch",
    "Customer", "Employee", "Product", "Invoice",
    "PurchasingOrder", "Supplier", "ItemTransferNote",
    "CustomerSupport", "Attendance", "Country"
]
