from app.db.base import Base
from app.db.session import engine

# Import all models to register them with SQLAlchemy
from app.auth.models import User, Group, Permission, Branch
from app.modules.common.models import Country, Approvals, Locations
from app.modules.customers.models import (
    Customer, CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle,
    CustomerCreditsSettleTransaction, CustomerCuponCodes, CustomerGiftVoucher
)
from app.modules.employees.models import Employee, EmployeePayroll, EmployeeSalaryProfile, EmployeePromotions, EmployeesAssets
from app.modules.attendance.models import Attendance, Leaves
from app.modules.products.models import Product, Category, ItemsBrand, MinimumPrice
from app.modules.inventory.models import CompanyAssets
from app.modules.sales.models import Invoice, InvoiceItems, InvoiceItemsBarcode, SaleReturn, SaleReturnItems
from app.modules.purchasing.models import (
    PurchasingOrder, PurchasingOrderItems, PurchasingReturn, PurchasingReturnItems, 
    Supplier, GoodReceivedNote, GoodReceivedItems, 
    SupplierCreditsSettle, SupplierCreditsSettleTransaction
)
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
)
from app.modules.warehouse.models import (
    ItemTransferNote, ItemTransferNoteItems, ItemTransferNoteItemProduct,
    ItemTransferNoteApproved, ItemReceiveNote
)
from app.modules.support.models import CustomerSupport, CSJobItem, CustomerCallLog, WarrantyClaims
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.marketing.models import AdvanceReceipt
# Settings models removed - not currently implemented

def init_db():
    Base.metadata.create_all(bind=engine)
