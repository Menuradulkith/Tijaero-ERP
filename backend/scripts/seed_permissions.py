import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import SessionLocal
from app.auth.models import Permission, Group, User

def seed_permissions():
    db = SessionLocal()

    # ══════════════════════════════════════════════════════════════════
    # Remove any legacy coarse-grained permissions that no longer exist
    # in the new granular schema (e.g. resource="sales", "inventory"…)
    # ══════════════════════════════════════════════════════════════════
    LEGACY_RESOURCES = {
        "sales", "inventory", "purchasing", "finance", "warehouse",
        "hr", "support", "employees", "reports",
    }
    stale = db.query(Permission).filter(Permission.resource.in_(LEGACY_RESOURCES)).all()
    if stale:
        print(f"\n  🗑  Removing {len(stale)} legacy permission(s)…")
        for p in stale:
            db.delete(p)
        db.commit()

    # ══════════════════════════════════════════════════════════════════
    # Define ALL permissions — granular per sub-page for every module
    # ══════════════════════════════════════════════════════════════════
    permissions_data = [
        # ── Dashboard ────────────────────────────────────────────────
        {"name": "view_dashboard", "resource": "dashboard", "action": "view", "description": "View main ERP dashboard"},

        # ══════════════════════════════════════════════════════════════
        # SALES — per sub-page
        # ══════════════════════════════════════════════════════════════
        # Sales Dashboard
        {"name": "view_sales_dashboard", "resource": "sales_dashboard", "action": "view", "description": "View sales dashboard"},
        # Customers
        {"name": "view_customers", "resource": "customers", "action": "view", "description": "View customer records"},
        {"name": "create_customers", "resource": "customers", "action": "create", "description": "Create new customers"},
        {"name": "update_customers", "resource": "customers", "action": "update", "description": "Update customer information"},
        {"name": "delete_customers", "resource": "customers", "action": "delete", "description": "Delete customers"},
        # Quotations
        {"name": "view_quotations", "resource": "quotations", "action": "view", "description": "View quotations"},
        {"name": "create_quotations", "resource": "quotations", "action": "create", "description": "Create quotations"},
        {"name": "update_quotations", "resource": "quotations", "action": "update", "description": "Update quotations"},
        {"name": "delete_quotations", "resource": "quotations", "action": "delete", "description": "Delete quotations"},
        # Proforma Invoices
        {"name": "view_proforma_invoices", "resource": "proforma_invoices", "action": "view", "description": "View proforma invoices"},
        {"name": "create_proforma_invoices", "resource": "proforma_invoices", "action": "create", "description": "Create proforma invoices"},
        {"name": "update_proforma_invoices", "resource": "proforma_invoices", "action": "update", "description": "Update proforma invoices"},
        {"name": "delete_proforma_invoices", "resource": "proforma_invoices", "action": "delete", "description": "Delete proforma invoices"},
        # Sales Orders
        {"name": "view_sales_orders", "resource": "sales_orders", "action": "view", "description": "View sales orders"},
        {"name": "create_sales_orders", "resource": "sales_orders", "action": "create", "description": "Create sales orders"},
        {"name": "update_sales_orders", "resource": "sales_orders", "action": "update", "description": "Update sales orders"},
        {"name": "delete_sales_orders", "resource": "sales_orders", "action": "delete", "description": "Delete sales orders"},
        # SO Approvals
        {"name": "view_so_approvals", "resource": "so_approvals", "action": "view", "description": "View sales order approvals"},
        {"name": "approve_so_approvals", "resource": "so_approvals", "action": "approve", "description": "Approve/reject sales orders"},
        # Sales Returns
        {"name": "view_sales_returns", "resource": "sales_returns", "action": "view", "description": "View sales returns"},
        {"name": "create_sales_returns", "resource": "sales_returns", "action": "create", "description": "Create sales returns"},
        {"name": "update_sales_returns", "resource": "sales_returns", "action": "update", "description": "Update sales returns"},
        {"name": "delete_sales_returns", "resource": "sales_returns", "action": "delete", "description": "Delete sales returns"},
        # Sales Return Approvals
        {"name": "view_sales_return_approvals", "resource": "sales_return_approvals", "action": "view", "description": "View sales return approvals"},
        {"name": "approve_sales_return_approvals", "resource": "sales_return_approvals", "action": "approve", "description": "Approve/reject sales returns"},
        # Coupons
        {"name": "view_coupons", "resource": "coupons", "action": "view", "description": "View coupons"},
        {"name": "create_coupons", "resource": "coupons", "action": "create", "description": "Create coupons"},
        {"name": "update_coupons", "resource": "coupons", "action": "update", "description": "Update coupons"},
        {"name": "delete_coupons", "resource": "coupons", "action": "delete", "description": "Delete coupons"},
        # Gift Vouchers
        {"name": "view_gift_vouchers", "resource": "gift_vouchers", "action": "view", "description": "View gift vouchers"},
        {"name": "create_gift_vouchers", "resource": "gift_vouchers", "action": "create", "description": "Create gift vouchers"},
        {"name": "update_gift_vouchers", "resource": "gift_vouchers", "action": "update", "description": "Update gift vouchers"},
        {"name": "delete_gift_vouchers", "resource": "gift_vouchers", "action": "delete", "description": "Delete gift vouchers"},
        # Agent Commissions
        {"name": "view_agent_commissions", "resource": "agent_commissions", "action": "view", "description": "View agent commissions"},
        {"name": "create_agent_commissions", "resource": "agent_commissions", "action": "create", "description": "Create agent commissions"},
        {"name": "update_agent_commissions", "resource": "agent_commissions", "action": "update", "description": "Update agent commissions"},
        {"name": "delete_agent_commissions", "resource": "agent_commissions", "action": "delete", "description": "Delete agent commissions"},
        # Commission Approvals (Sales)
        {"name": "view_commission_approvals", "resource": "commission_approvals", "action": "view", "description": "View commission approvals"},
        {"name": "approve_commission_approvals", "resource": "commission_approvals", "action": "approve", "description": "Approve/reject commission requests"},
        # Sales Settings
        {"name": "view_sales_settings", "resource": "sales_settings", "action": "view", "description": "View sales settings"},
        {"name": "update_sales_settings", "resource": "sales_settings", "action": "update", "description": "Update sales settings"},
        # Sales Track
        {"name": "view_sales_track", "resource": "sales_track", "action": "view", "description": "View sales tracking"},

        # ══════════════════════════════════════════════════════════════
        # PURCHASING — per sub-page
        # ══════════════════════════════════════════════════════════════
        # Purchasing Dashboard
        {"name": "view_purchasing_dashboard", "resource": "purchasing_dashboard", "action": "view", "description": "View purchasing dashboard"},
        # Suppliers
        {"name": "view_suppliers", "resource": "suppliers", "action": "view", "description": "View suppliers"},
        {"name": "create_suppliers", "resource": "suppliers", "action": "create", "description": "Create suppliers"},
        {"name": "update_suppliers", "resource": "suppliers", "action": "update", "description": "Update suppliers"},
        {"name": "delete_suppliers", "resource": "suppliers", "action": "delete", "description": "Delete suppliers"},
        # Purchase Orders
        {"name": "view_purchase_orders", "resource": "purchase_orders", "action": "view", "description": "View purchase orders"},
        {"name": "create_purchase_orders", "resource": "purchase_orders", "action": "create", "description": "Create purchase orders"},
        {"name": "update_purchase_orders", "resource": "purchase_orders", "action": "update", "description": "Update purchase orders"},
        {"name": "delete_purchase_orders", "resource": "purchase_orders", "action": "delete", "description": "Delete purchase orders"},
        # PO Approvals
        {"name": "view_po_approvals", "resource": "po_approvals", "action": "view", "description": "View purchase order approvals"},
        {"name": "approve_po_approvals", "resource": "po_approvals", "action": "approve", "description": "Approve/reject purchase orders"},
        # Good Received Notes
        {"name": "view_grn", "resource": "grn", "action": "view", "description": "View goods received notes"},
        {"name": "create_grn", "resource": "grn", "action": "create", "description": "Create goods received notes"},
        {"name": "update_grn", "resource": "grn", "action": "update", "description": "Update goods received notes"},
        {"name": "delete_grn", "resource": "grn", "action": "delete", "description": "Delete goods received notes"},
        # Purchase Returns
        {"name": "view_purchase_returns", "resource": "purchase_returns", "action": "view", "description": "View purchase returns"},
        {"name": "create_purchase_returns", "resource": "purchase_returns", "action": "create", "description": "Create purchase returns"},
        {"name": "update_purchase_returns", "resource": "purchase_returns", "action": "update", "description": "Update purchase returns"},
        {"name": "delete_purchase_returns", "resource": "purchase_returns", "action": "delete", "description": "Delete purchase returns"},
        # Purchase Return Approvals
        {"name": "view_purchase_return_approvals", "resource": "purchase_return_approvals", "action": "view", "description": "View purchase return approvals"},
        {"name": "approve_purchase_return_approvals", "resource": "purchase_return_approvals", "action": "approve", "description": "Approve/reject purchase returns"},

        # ══════════════════════════════════════════════════════════════
        # INVENTORY / PRODUCT CATALOGS — per sub-page
        # ══════════════════════════════════════════════════════════════
        # Products
        {"name": "view_products", "resource": "products", "action": "view", "description": "View products"},
        {"name": "create_products", "resource": "products", "action": "create", "description": "Create products"},
        {"name": "update_products", "resource": "products", "action": "update", "description": "Update products"},
        {"name": "delete_products", "resource": "products", "action": "delete", "description": "Delete products"},
        # Categories
        {"name": "view_categories", "resource": "categories", "action": "view", "description": "View categories"},
        {"name": "create_categories", "resource": "categories", "action": "create", "description": "Create categories"},
        {"name": "update_categories", "resource": "categories", "action": "update", "description": "Update categories"},
        {"name": "delete_categories", "resource": "categories", "action": "delete", "description": "Delete categories"},
        # Brands
        {"name": "view_brands", "resource": "brands", "action": "view", "description": "View brands"},
        {"name": "create_brands", "resource": "brands", "action": "create", "description": "Create brands"},
        {"name": "update_brands", "resource": "brands", "action": "update", "description": "Update brands"},
        {"name": "delete_brands", "resource": "brands", "action": "delete", "description": "Delete brands"},

        # ══════════════════════════════════════════════════════════════
        # FINANCE — per sub-page
        # ══════════════════════════════════════════════════════════════
        # Finance Dashboard
        {"name": "view_finance_dashboard", "resource": "finance_dashboard", "action": "view", "description": "View finance dashboard"},
        # Cashbook
        {"name": "view_cashbook", "resource": "cashbook", "action": "view", "description": "View cashbook"},
        {"name": "create_cashbook", "resource": "cashbook", "action": "create", "description": "Create cashbook entries"},
        {"name": "update_cashbook", "resource": "cashbook", "action": "update", "description": "Update cashbook entries"},
        # Expenses
        {"name": "view_expenses", "resource": "expenses", "action": "view", "description": "View expenses"},
        {"name": "create_expenses", "resource": "expenses", "action": "create", "description": "Create expenses"},
        {"name": "update_expenses", "resource": "expenses", "action": "update", "description": "Update expenses"},
        {"name": "delete_expenses", "resource": "expenses", "action": "delete", "description": "Delete expenses"},
        # Bank Deposits
        {"name": "view_bank_deposits", "resource": "bank_deposits", "action": "view", "description": "View bank deposits"},
        {"name": "create_bank_deposits", "resource": "bank_deposits", "action": "create", "description": "Create bank deposits"},
        {"name": "update_bank_deposits", "resource": "bank_deposits", "action": "update", "description": "Update bank deposits"},
        {"name": "delete_bank_deposits", "resource": "bank_deposits", "action": "delete", "description": "Delete bank deposits"},
        # Card Payments
        {"name": "view_card_payments", "resource": "card_payments", "action": "view", "description": "View card payments"},
        {"name": "create_card_payments", "resource": "card_payments", "action": "create", "description": "Create card payments"},
        {"name": "update_card_payments", "resource": "card_payments", "action": "update", "description": "Update card payments"},
        {"name": "delete_card_payments", "resource": "card_payments", "action": "delete", "description": "Delete card payments"},
        # Cheque Payments
        {"name": "view_cheque_payments", "resource": "cheque_payments", "action": "view", "description": "View cheque payments"},
        {"name": "create_cheque_payments", "resource": "cheque_payments", "action": "create", "description": "Create cheque payments"},
        {"name": "update_cheque_payments", "resource": "cheque_payments", "action": "update", "description": "Update cheque payments"},
        {"name": "delete_cheque_payments", "resource": "cheque_payments", "action": "delete", "description": "Delete cheque payments"},
        # Credit Notes
        {"name": "view_credit_notes", "resource": "credit_notes", "action": "view", "description": "View credit notes"},
        {"name": "create_credit_notes", "resource": "credit_notes", "action": "create", "description": "Create credit notes"},
        {"name": "update_credit_notes", "resource": "credit_notes", "action": "update", "description": "Update credit notes"},
        {"name": "delete_credit_notes", "resource": "credit_notes", "action": "delete", "description": "Delete credit notes"},
        # Customer Advances
        {"name": "view_customer_advances", "resource": "customer_advances", "action": "view", "description": "View customer advances"},
        {"name": "create_customer_advances", "resource": "customer_advances", "action": "create", "description": "Create customer advances"},
        {"name": "update_customer_advances", "resource": "customer_advances", "action": "update", "description": "Update customer advances"},
        {"name": "delete_customer_advances", "resource": "customer_advances", "action": "delete", "description": "Delete customer advances"},
        # Supplier Advances
        {"name": "view_supplier_advances", "resource": "supplier_advances", "action": "view", "description": "View supplier advances"},
        {"name": "create_supplier_advances", "resource": "supplier_advances", "action": "create", "description": "Create supplier advances"},
        {"name": "update_supplier_advances", "resource": "supplier_advances", "action": "update", "description": "Update supplier advances"},
        {"name": "delete_supplier_advances", "resource": "supplier_advances", "action": "delete", "description": "Delete supplier advances"},
        # Supplier Payments
        {"name": "view_supplier_payments", "resource": "supplier_payments", "action": "view", "description": "View supplier payments"},
        {"name": "create_supplier_payments", "resource": "supplier_payments", "action": "create", "description": "Create supplier payments"},
        {"name": "update_supplier_payments", "resource": "supplier_payments", "action": "update", "description": "Update supplier payments"},
        {"name": "delete_supplier_payments", "resource": "supplier_payments", "action": "delete", "description": "Delete supplier payments"},
        # Customer Payments
        {"name": "view_customer_payments", "resource": "customer_payments", "action": "view", "description": "View customer payments"},
        {"name": "create_customer_payments", "resource": "customer_payments", "action": "create", "description": "Create customer payments"},
        {"name": "update_customer_payments", "resource": "customer_payments", "action": "update", "description": "Update customer payments"},
        {"name": "delete_customer_payments", "resource": "customer_payments", "action": "delete", "description": "Delete customer payments"},
        # Chart of Accounts
        {"name": "view_chart_of_accounts", "resource": "chart_of_accounts", "action": "view", "description": "View chart of accounts"},
        {"name": "create_chart_of_accounts", "resource": "chart_of_accounts", "action": "create", "description": "Create chart of accounts entries"},
        {"name": "update_chart_of_accounts", "resource": "chart_of_accounts", "action": "update", "description": "Update chart of accounts entries"},
        {"name": "delete_chart_of_accounts", "resource": "chart_of_accounts", "action": "delete", "description": "Delete chart of accounts entries"},
        # Journal Entries
        {"name": "view_journal_entries", "resource": "journal_entries", "action": "view", "description": "View journal entries"},
        {"name": "create_journal_entries", "resource": "journal_entries", "action": "create", "description": "Create journal entries"},
        {"name": "update_journal_entries", "resource": "journal_entries", "action": "update", "description": "Update journal entries"},
        {"name": "delete_journal_entries", "resource": "journal_entries", "action": "delete", "description": "Delete journal entries"},
        # General Ledger
        {"name": "view_general_ledger", "resource": "general_ledger", "action": "view", "description": "View general ledger"},
        # Accounting Periods
        {"name": "view_accounting_periods", "resource": "accounting_periods", "action": "view", "description": "View accounting periods"},
        {"name": "create_accounting_periods", "resource": "accounting_periods", "action": "create", "description": "Create accounting periods"},
        {"name": "update_accounting_periods", "resource": "accounting_periods", "action": "update", "description": "Update accounting periods"},
        # Cash Flow
        {"name": "view_cash_flow", "resource": "cash_flow", "action": "view", "description": "View cash flow report"},
        # Payment Approvals
        {"name": "view_payment_approvals", "resource": "payment_approvals", "action": "view", "description": "View payment approvals"},
        {"name": "approve_payment_approvals", "resource": "payment_approvals", "action": "approve", "description": "Approve/reject payments"},
        # Expense Approvals
        {"name": "view_expense_approvals", "resource": "expense_approvals", "action": "view", "description": "View expense approvals"},
        {"name": "approve_expense_approvals", "resource": "expense_approvals", "action": "approve", "description": "Approve/reject expenses"},
        # Bank Transfer Verify
        {"name": "view_bank_transfer_verify", "resource": "bank_transfer_verify", "action": "view", "description": "View bank transfer verifications"},
        {"name": "approve_bank_transfer_verify", "resource": "bank_transfer_verify", "action": "approve", "description": "Verify/approve bank transfers"},
        # Commission Payments
        {"name": "view_commission_payments", "resource": "commission_payments", "action": "view", "description": "View commission payments"},
        {"name": "create_commission_payments", "resource": "commission_payments", "action": "create", "description": "Create commission payments"},
        {"name": "update_commission_payments", "resource": "commission_payments", "action": "update", "description": "Update commission payments"},
        # Commission Payment Approvals
        {"name": "view_commission_payment_approvals", "resource": "commission_payment_approvals", "action": "view", "description": "View commission payment approvals"},
        {"name": "approve_commission_payment_approvals", "resource": "commission_payment_approvals", "action": "approve", "description": "Approve/reject commission payments"},

        # ══════════════════════════════════════════════════════════════
        # HR — per sub-page
        # ══════════════════════════════════════════════════════════════
        # HR Dashboard
        {"name": "view_hr_dashboard", "resource": "hr_dashboard", "action": "view", "description": "View HR dashboard"},
        # Salary Profiles
        {"name": "view_salary_profiles", "resource": "salary_profiles", "action": "view", "description": "View salary profiles"},
        {"name": "create_salary_profiles", "resource": "salary_profiles", "action": "create", "description": "Create salary profiles"},
        {"name": "update_salary_profiles", "resource": "salary_profiles", "action": "update", "description": "Update salary profiles"},
        {"name": "delete_salary_profiles", "resource": "salary_profiles", "action": "delete", "description": "Delete salary profiles"},
        # Deductions
        {"name": "view_deductions", "resource": "deductions", "action": "view", "description": "View deductions"},
        {"name": "create_deductions", "resource": "deductions", "action": "create", "description": "Create deductions"},
        {"name": "update_deductions", "resource": "deductions", "action": "update", "description": "Update deductions"},
        {"name": "delete_deductions", "resource": "deductions", "action": "delete", "description": "Delete deductions"},
        # Payroll Records
        {"name": "view_payroll", "resource": "payroll", "action": "view", "description": "View payroll records"},
        {"name": "create_payroll", "resource": "payroll", "action": "create", "description": "Create payroll records"},
        {"name": "update_payroll", "resource": "payroll", "action": "update", "description": "Update payroll records"},
        {"name": "delete_payroll", "resource": "payroll", "action": "delete", "description": "Delete payroll records"},
        # Payroll Processing
        {"name": "view_payroll_processing", "resource": "payroll_processing", "action": "view", "description": "View payroll processing"},
        {"name": "create_payroll_processing", "resource": "payroll_processing", "action": "create", "description": "Process payroll runs"},
        # Payroll Approvals
        {"name": "view_payroll_approvals", "resource": "payroll_approvals", "action": "view", "description": "View payroll approvals"},
        {"name": "approve_payroll_approvals", "resource": "payroll_approvals", "action": "approve", "description": "Approve/reject payroll"},
        # Sales Commissions (HR)
        {"name": "view_hr_sales_commissions", "resource": "hr_sales_commissions", "action": "view", "description": "View HR sales commissions"},
        {"name": "create_hr_sales_commissions", "resource": "hr_sales_commissions", "action": "create", "description": "Create HR sales commissions"},
        {"name": "update_hr_sales_commissions", "resource": "hr_sales_commissions", "action": "update", "description": "Update HR sales commissions"},
        # Reimbursements
        {"name": "view_reimbursements", "resource": "reimbursements", "action": "view", "description": "View reimbursements"},
        {"name": "create_reimbursements", "resource": "reimbursements", "action": "create", "description": "Create reimbursements"},
        {"name": "update_reimbursements", "resource": "reimbursements", "action": "update", "description": "Update reimbursements"},
        {"name": "delete_reimbursements", "resource": "reimbursements", "action": "delete", "description": "Delete reimbursements"},
        # Reimbursement Approvals
        {"name": "view_reimbursement_approvals", "resource": "reimbursement_approvals", "action": "view", "description": "View reimbursement approvals"},
        {"name": "approve_reimbursement_approvals", "resource": "reimbursement_approvals", "action": "approve", "description": "Approve/reject reimbursements"},
        # Promotions
        {"name": "view_promotions", "resource": "promotions", "action": "view", "description": "View promotions"},
        {"name": "create_promotions", "resource": "promotions", "action": "create", "description": "Create promotions"},
        {"name": "update_promotions", "resource": "promotions", "action": "update", "description": "Update promotions"},
        {"name": "delete_promotions", "resource": "promotions", "action": "delete", "description": "Delete promotions"},
        # Company Assets (HR)
        {"name": "view_hr_assets", "resource": "hr_assets", "action": "view", "description": "View HR company assets"},
        {"name": "create_hr_assets", "resource": "hr_assets", "action": "create", "description": "Create HR company assets"},
        {"name": "update_hr_assets", "resource": "hr_assets", "action": "update", "description": "Update HR company assets"},
        {"name": "delete_hr_assets", "resource": "hr_assets", "action": "delete", "description": "Delete HR company assets"},
        # Attendance
        {"name": "view_attendance", "resource": "attendance", "action": "view", "description": "View attendance"},
        {"name": "create_attendance", "resource": "attendance", "action": "create", "description": "Mark / create attendance"},
        {"name": "update_attendance", "resource": "attendance", "action": "update", "description": "Update attendance"},
        {"name": "delete_attendance", "resource": "attendance", "action": "delete", "description": "Delete attendance"},
        # Leaves
        {"name": "view_leaves", "resource": "leaves", "action": "view", "description": "View leaves"},
        {"name": "create_leaves", "resource": "leaves", "action": "create", "description": "Create leaves"},
        {"name": "update_leaves", "resource": "leaves", "action": "update", "description": "Update leaves"},
        {"name": "delete_leaves", "resource": "leaves", "action": "delete", "description": "Delete leaves"},
        {"name": "view_leave_approvals", "resource": "leave_approvals", "action": "view", "description": "View leave approvals"},
        {"name": "approve_leave_approvals", "resource": "leave_approvals", "action": "approve", "description": "Approve / reject leaves"},
        # Employees master
        {"name": "view_employees", "resource": "employees", "action": "view", "description": "View employee master"},
        {"name": "create_employees", "resource": "employees", "action": "create", "description": "Create employees"},
        {"name": "update_employees", "resource": "employees", "action": "update", "description": "Update employees"},
        {"name": "delete_employees", "resource": "employees", "action": "delete", "description": "Delete employees"},

        # ══════════════════════════════════════════════════════════════
        # WAREHOUSE — per sub-page
        # ══════════════════════════════════════════════════════════════
        # Sales Stock Dashboard
        {"name": "view_sales_stock", "resource": "sales_stock", "action": "view", "description": "View sales stock dashboard"},
        {"name": "create_sales_stock", "resource": "sales_stock", "action": "create", "description": "Create sales stock entries"},
        {"name": "update_sales_stock", "resource": "sales_stock", "action": "update", "description": "Update sales stock entries"},
        {"name": "delete_sales_stock", "resource": "sales_stock", "action": "delete", "description": "Delete sales stock entries"},
        # Sales Track (Warehouse)
        {"name": "view_warehouse_sales_track", "resource": "warehouse_sales_track", "action": "view", "description": "View warehouse sales tracking"},
        # Item Transfer Notes
        {"name": "view_item_transfer_notes", "resource": "item_transfer_notes", "action": "view", "description": "View item transfer notes"},
        {"name": "create_item_transfer_notes", "resource": "item_transfer_notes", "action": "create", "description": "Create item transfer notes"},
        {"name": "update_item_transfer_notes", "resource": "item_transfer_notes", "action": "update", "description": "Update item transfer notes"},
        {"name": "delete_item_transfer_notes", "resource": "item_transfer_notes", "action": "delete", "description": "Delete item transfer notes"},
        # ITN Approvals
        {"name": "view_itn_approvals", "resource": "itn_approvals", "action": "view", "description": "View ITN approvals"},
        {"name": "approve_itn_approvals", "resource": "itn_approvals", "action": "approve", "description": "Approve/reject item transfer notes"},
        # Receive Notes
        {"name": "view_receive_notes", "resource": "receive_notes", "action": "view", "description": "View receive notes"},
        {"name": "create_receive_notes", "resource": "receive_notes", "action": "create", "description": "Create receive notes"},
        {"name": "update_receive_notes", "resource": "receive_notes", "action": "update", "description": "Update receive notes"},
        {"name": "delete_receive_notes", "resource": "receive_notes", "action": "delete", "description": "Delete receive notes"},
        # Company Assets (Warehouse)
        {"name": "view_company_assets", "resource": "company_assets", "action": "view", "description": "View company assets"},
        {"name": "create_company_assets", "resource": "company_assets", "action": "create", "description": "Create company assets"},
        {"name": "update_company_assets", "resource": "company_assets", "action": "update", "description": "Update company assets"},
        {"name": "delete_company_assets", "resource": "company_assets", "action": "delete", "description": "Delete company assets"},

        # ══════════════════════════════════════════════════════════════
        # SUPPORT — per sub-page
        # ══════════════════════════════════════════════════════════════
        # Support Dashboard
        {"name": "view_support_dashboard", "resource": "support_dashboard", "action": "view", "description": "View support dashboard"},
        # Support Tickets
        {"name": "view_support_tickets", "resource": "support_tickets", "action": "view", "description": "View support tickets"},
        {"name": "create_support_tickets", "resource": "support_tickets", "action": "create", "description": "Create support tickets"},
        {"name": "update_support_tickets", "resource": "support_tickets", "action": "update", "description": "Update support tickets"},
        {"name": "delete_support_tickets", "resource": "support_tickets", "action": "delete", "description": "Delete support tickets"},
        # Job Items
        {"name": "view_job_items", "resource": "job_items", "action": "view", "description": "View job items"},
        {"name": "create_job_items", "resource": "job_items", "action": "create", "description": "Create job items"},
        {"name": "update_job_items", "resource": "job_items", "action": "update", "description": "Update job items"},
        {"name": "delete_job_items", "resource": "job_items", "action": "delete", "description": "Delete job items"},
        # Call Logs
        {"name": "view_call_logs", "resource": "call_logs", "action": "view", "description": "View call logs"},
        {"name": "create_call_logs", "resource": "call_logs", "action": "create", "description": "Create call logs"},
        {"name": "update_call_logs", "resource": "call_logs", "action": "update", "description": "Update call logs"},
        {"name": "delete_call_logs", "resource": "call_logs", "action": "delete", "description": "Delete call logs"},
        # Warranty Claims
        {"name": "view_warranty_claims", "resource": "warranty_claims", "action": "view", "description": "View warranty claims"},
        {"name": "create_warranty_claims", "resource": "warranty_claims", "action": "create", "description": "Create warranty claims"},
        {"name": "update_warranty_claims", "resource": "warranty_claims", "action": "update", "description": "Update warranty claims"},
        {"name": "delete_warranty_claims", "resource": "warranty_claims", "action": "delete", "description": "Delete warranty claims"},

        # ══════════════════════════════════════════════════════════════
        # REPORTING — per sub-page
        # ══════════════════════════════════════════════════════════════
        {"name": "view_reporting_dashboard", "resource": "reporting_dashboard", "action": "view", "description": "View reporting dashboard"},
        {"name": "view_reporting_sales", "resource": "reporting_sales", "action": "view", "description": "View sales reports"},
        {"name": "generate_reporting_sales", "resource": "reporting_sales", "action": "generate", "description": "Generate sales reports"},
        {"name": "view_reporting_finance", "resource": "reporting_finance", "action": "view", "description": "View finance reports"},
        {"name": "generate_reporting_finance", "resource": "reporting_finance", "action": "generate", "description": "Generate finance reports"},
        {"name": "view_reporting_inventory", "resource": "reporting_inventory", "action": "view", "description": "View inventory reports"},
        {"name": "generate_reporting_inventory", "resource": "reporting_inventory", "action": "generate", "description": "Generate inventory reports"},
        {"name": "view_reporting_hr", "resource": "reporting_hr", "action": "view", "description": "View HR reports"},
        {"name": "generate_reporting_hr", "resource": "reporting_hr", "action": "generate", "description": "Generate HR reports"},
        {"name": "view_reporting_warehouse", "resource": "reporting_warehouse", "action": "view", "description": "View warehouse reports"},
        {"name": "generate_reporting_warehouse", "resource": "reporting_warehouse", "action": "generate", "description": "Generate warehouse reports"},
        {"name": "view_reporting_support", "resource": "reporting_support", "action": "view", "description": "View support reports"},
        {"name": "generate_reporting_support", "resource": "reporting_support", "action": "generate", "description": "Generate support reports"},

        # ══════════════════════════════════════════════════════════════
        # ADMINISTRATION — Users, Groups, Branches, Settings, Common
        # ══════════════════════════════════════════════════════════════
        # User management
        {"name": "view_users", "resource": "users", "action": "view", "description": "View user accounts"},
        {"name": "create_users", "resource": "users", "action": "create", "description": "Create user accounts"},
        {"name": "update_users", "resource": "users", "action": "update", "description": "Update user accounts"},
        {"name": "delete_users", "resource": "users", "action": "delete", "description": "Delete user accounts"},
        # Group / Role management
        {"name": "view_groups", "resource": "groups", "action": "view", "description": "View groups and roles"},
        {"name": "create_groups", "resource": "groups", "action": "create", "description": "Create groups and roles"},
        {"name": "update_groups", "resource": "groups", "action": "update", "description": "Update groups and roles"},
        {"name": "delete_groups", "resource": "groups", "action": "delete", "description": "Delete groups and roles"},
        # Branches
        {"name": "view_branches", "resource": "branches", "action": "view", "description": "View branches"},
        {"name": "create_branches", "resource": "branches", "action": "create", "description": "Create branches"},
        {"name": "update_branches", "resource": "branches", "action": "update", "description": "Update branches"},
        {"name": "delete_branches", "resource": "branches", "action": "delete", "description": "Delete branches"},
        # Common / Reference Data
        {"name": "view_common", "resource": "common", "action": "view", "description": "View reference data"},
        {"name": "create_common", "resource": "common", "action": "create", "description": "Create reference data"},
        {"name": "update_common", "resource": "common", "action": "update", "description": "Update reference data"},
        {"name": "delete_common", "resource": "common", "action": "delete", "description": "Delete reference data"},
        # Settings
        {"name": "view_settings", "resource": "settings", "action": "view", "description": "View system and company settings"},
        {"name": "update_settings", "resource": "settings", "action": "update", "description": "Update system and company settings"},
    ]
    
    # Create permissions
    created_permissions = {}
    for perm_data in permissions_data:
        existing = db.query(Permission).filter(
            Permission.resource == perm_data["resource"],
            Permission.action == perm_data["action"],
        ).first()
        if not existing:
            perm = Permission(**perm_data)
            db.add(perm)
            db.flush()
            created_permissions[perm_data["name"]] = perm
            print(f"  ✅ Created permission: {perm_data['resource']}:{perm_data['action']}")
        else:
            # Update name/description if changed
            existing.name = perm_data["name"]
            existing.description = perm_data["description"]
            created_permissions[perm_data["name"]] = existing
            print(f"  ── Already exists: {perm_data['resource']}:{perm_data['action']}")
    
    db.commit()
    
    # ══════════════════════════════════════════════════════════════════
    # Helper to collect permissions by name prefix
    # ══════════════════════════════════════════════════════════════════
    def perms(*names):
        return [created_permissions[n] for n in names if n in created_permissions]

    all_perm_list = list(created_permissions.values())

    # ══════════════════════════════════════════════════════════════════
    # Create default groups (roles)
    # ══════════════════════════════════════════════════════════════════
    groups_data = [
        {
            "name": "Admin",
            "description": "Full system access — all modules, all actions",
            "permissions": all_perm_list,
        },
        {
            "name": "Sales Manager",
            "description": "Full sales access + view customers, inventory, warehouse, reporting",
            "permissions": perms(
                # Sales — all sub-pages
                "view_sales_dashboard",
                "view_customers", "create_customers", "update_customers", "delete_customers",
                "view_quotations", "create_quotations", "update_quotations", "delete_quotations",
                "view_proforma_invoices", "create_proforma_invoices", "update_proforma_invoices", "delete_proforma_invoices",
                "view_sales_orders", "create_sales_orders", "update_sales_orders", "delete_sales_orders",
                "view_so_approvals", "approve_so_approvals",
                "view_sales_returns", "create_sales_returns", "update_sales_returns", "delete_sales_returns",
                "view_sales_return_approvals", "approve_sales_return_approvals",
                "view_coupons", "create_coupons", "update_coupons", "delete_coupons",
                "view_gift_vouchers", "create_gift_vouchers", "update_gift_vouchers", "delete_gift_vouchers",
                "view_agent_commissions", "create_agent_commissions", "update_agent_commissions", "delete_agent_commissions",
                "view_commission_approvals", "approve_commission_approvals",
                "view_sales_settings", "update_sales_settings",
                "view_sales_track",
                # Cross-module view access
                "view_products", "view_categories", "view_brands",
                "view_sales_stock",
                "view_reporting_dashboard", "view_reporting_sales", "generate_reporting_sales",
                "view_dashboard",
            ),
        },
        {
            "name": "Sales Representative",
            "description": "Create and view sales, view customers & inventory",
            "permissions": perms(
                "view_sales_dashboard",
                "view_customers", "create_customers",
                "view_quotations", "create_quotations",
                "view_proforma_invoices", "create_proforma_invoices",
                "view_sales_orders", "create_sales_orders",
                "view_sales_returns", "create_sales_returns",
                "view_sales_track",
                "view_products", "view_categories", "view_brands",
                "view_dashboard",
            ),
        },
        {
            "name": "Purchasing Manager",
            "description": "Full purchasing access + view inventory, finance, warehouse, reporting",
            "permissions": perms(
                # Purchasing — all sub-pages
                "view_purchasing_dashboard",
                "view_suppliers", "create_suppliers", "update_suppliers", "delete_suppliers",
                "view_purchase_orders", "create_purchase_orders", "update_purchase_orders", "delete_purchase_orders",
                "view_po_approvals", "approve_po_approvals",
                "view_grn", "create_grn", "update_grn", "delete_grn",
                "view_purchase_returns", "create_purchase_returns", "update_purchase_returns", "delete_purchase_returns",
                "view_purchase_return_approvals", "approve_purchase_return_approvals",
                # Cross-module view access
                "view_products", "view_categories", "view_brands",
                "view_finance_dashboard",
                "view_sales_stock",
                "view_reporting_dashboard", "view_reporting_inventory", "generate_reporting_inventory",
                "view_dashboard",
            ),
        },
        {
            "name": "Purchasing Officer",
            "description": "Create purchase orders and GRNs",
            "permissions": perms(
                "view_purchasing_dashboard",
                "view_suppliers", "create_suppliers",
                "view_purchase_orders", "create_purchase_orders",
                "view_grn", "create_grn",
                "view_purchase_returns", "create_purchase_returns",
                "view_products", "view_categories", "view_brands",
                "view_dashboard",
            ),
        },
        {
            "name": "Finance Manager",
            "description": "Full finance access + view sales & purchasing for reconciliation",
            "permissions": perms(
                # Finance — all sub-pages
                "view_finance_dashboard",
                "view_cashbook", "create_cashbook", "update_cashbook",
                "view_expenses", "create_expenses", "update_expenses", "delete_expenses",
                "view_bank_deposits", "create_bank_deposits", "update_bank_deposits", "delete_bank_deposits",
                "view_card_payments", "create_card_payments", "update_card_payments", "delete_card_payments",
                "view_cheque_payments", "create_cheque_payments", "update_cheque_payments", "delete_cheque_payments",
                "view_credit_notes", "create_credit_notes", "update_credit_notes", "delete_credit_notes",
                "view_customer_advances", "create_customer_advances", "update_customer_advances", "delete_customer_advances",
                "view_supplier_advances", "create_supplier_advances", "update_supplier_advances", "delete_supplier_advances",
                "view_supplier_payments", "create_supplier_payments", "update_supplier_payments", "delete_supplier_payments",
                "view_customer_payments", "create_customer_payments", "update_customer_payments", "delete_customer_payments",
                "view_chart_of_accounts", "create_chart_of_accounts", "update_chart_of_accounts", "delete_chart_of_accounts",
                "view_journal_entries", "create_journal_entries", "update_journal_entries", "delete_journal_entries",
                "view_general_ledger",
                "view_accounting_periods", "create_accounting_periods", "update_accounting_periods",
                "view_cash_flow",
                "view_payment_approvals", "approve_payment_approvals",
                "view_expense_approvals", "approve_expense_approvals",
                "view_bank_transfer_verify", "approve_bank_transfer_verify",
                "view_commission_payments", "create_commission_payments", "update_commission_payments",
                "view_commission_payment_approvals", "approve_commission_payment_approvals",
                # Cross-module view access
                "view_sales_dashboard", "view_sales_orders",
                "view_purchasing_dashboard", "view_purchase_orders",
                "view_customers",
                "view_reporting_dashboard", "view_reporting_finance", "generate_reporting_finance",
                "view_dashboard",
            ),
        },
        {
            "name": "Accountant",
            "description": "View and create finance records",
            "permissions": perms(
                "view_finance_dashboard",
                "view_cashbook", "create_cashbook", "update_cashbook",
                "view_expenses", "create_expenses", "update_expenses",
                "view_bank_deposits", "create_bank_deposits",
                "view_card_payments", "create_card_payments",
                "view_cheque_payments", "create_cheque_payments",
                "view_credit_notes", "create_credit_notes",
                "view_customer_advances", "create_customer_advances",
                "view_supplier_advances", "create_supplier_advances",
                "view_supplier_payments", "create_supplier_payments",
                "view_customer_payments", "create_customer_payments",
                "view_chart_of_accounts",
                "view_journal_entries", "create_journal_entries",
                "view_general_ledger",
                "view_accounting_periods",
                "view_cash_flow",
                "view_commission_payments",
                # Cross-module view
                "view_sales_dashboard", "view_sales_orders",
                "view_purchasing_dashboard", "view_purchase_orders",
                "view_reporting_dashboard", "view_reporting_finance",
                "view_dashboard",
            ),
        },
        {
            "name": "HR Manager",
            "description": "Full HR access — payroll, deductions, reimbursements, promotions",
            "permissions": perms(
                # HR — all sub-pages
                "view_hr_dashboard",
                "view_salary_profiles", "create_salary_profiles", "update_salary_profiles", "delete_salary_profiles",
                "view_deductions", "create_deductions", "update_deductions", "delete_deductions",
                "view_payroll", "create_payroll", "update_payroll", "delete_payroll",
                "view_payroll_processing", "create_payroll_processing",
                "view_payroll_approvals", "approve_payroll_approvals",
                "view_hr_sales_commissions", "create_hr_sales_commissions", "update_hr_sales_commissions",
                "view_reimbursements", "create_reimbursements", "update_reimbursements", "delete_reimbursements",
                "view_reimbursement_approvals", "approve_reimbursement_approvals",
                "view_promotions", "create_promotions", "update_promotions", "delete_promotions",
                "view_hr_assets", "create_hr_assets", "update_hr_assets", "delete_hr_assets",
                # Attendance / Leaves / Employees
                "view_attendance", "create_attendance", "update_attendance", "delete_attendance",
                "view_leaves", "create_leaves", "update_leaves", "delete_leaves",
                "view_leave_approvals", "approve_leave_approvals",
                "view_employees", "create_employees", "update_employees", "delete_employees",
                # Cross-module
                "view_users",
                "view_reporting_dashboard", "view_reporting_hr", "generate_reporting_hr",
                "view_dashboard",
            ),
        },
        {
            "name": "Inventory Manager",
            "description": "Full inventory and warehouse access",
            "permissions": perms(
                # Inventory
                "view_products", "create_products", "update_products", "delete_products",
                "view_categories", "create_categories", "update_categories", "delete_categories",
                "view_brands", "create_brands", "update_brands", "delete_brands",
                # Warehouse
                "view_sales_stock", "create_sales_stock", "update_sales_stock",
                "view_warehouse_sales_track",
                "view_item_transfer_notes", "create_item_transfer_notes", "update_item_transfer_notes",
                "view_itn_approvals", "approve_itn_approvals",
                "view_receive_notes", "create_receive_notes", "update_receive_notes",
                "view_company_assets", "create_company_assets", "update_company_assets",
                # Cross-module
                "view_reporting_dashboard", "view_reporting_inventory", "view_reporting_warehouse",
                "view_dashboard",
            ),
        },
        {
            "name": "Warehouse Staff",
            "description": "View and manage stock, transfers, and receive notes",
            "permissions": perms(
                "view_sales_stock", "create_sales_stock", "update_sales_stock",
                "view_warehouse_sales_track",
                "view_item_transfer_notes", "create_item_transfer_notes", "update_item_transfer_notes",
                "view_receive_notes", "create_receive_notes", "update_receive_notes",
                "view_company_assets",
                "view_products", "view_categories", "view_brands",
                "view_dashboard",
            ),
        },
        {
            "name": "Support Agent",
            "description": "Manage support tickets, job items, call logs, warranty claims",
            "permissions": perms(
                "view_support_dashboard",
                "view_support_tickets", "create_support_tickets", "update_support_tickets",
                "view_job_items", "create_job_items", "update_job_items",
                "view_call_logs", "create_call_logs", "update_call_logs",
                "view_warranty_claims", "create_warranty_claims", "update_warranty_claims",
                "view_customers",
                "view_products", "view_categories", "view_brands",
                "view_dashboard",
            ),
        },
        {
            "name": "Branch Manager",
            "description": "View dashboards, sales, purchasing, warehouse for their branch",
            "permissions": perms(
                # Sales (view + create + approve)
                "view_sales_dashboard",
                "view_customers", "create_customers",
                "view_quotations", "create_quotations",
                "view_proforma_invoices", "create_proforma_invoices",
                "view_sales_orders", "create_sales_orders",
                "view_so_approvals", "approve_so_approvals",
                "view_sales_returns",
                "view_sales_return_approvals",
                "view_sales_track",
                # Purchasing (view + create)
                "view_purchasing_dashboard",
                "view_suppliers", "create_suppliers",
                "view_purchase_orders", "create_purchase_orders",
                "view_grn", "create_grn",
                "view_purchase_returns",
                # Inventory (view only)
                "view_products", "view_categories", "view_brands",
                # Warehouse (view + approve)
                "view_sales_stock",
                "view_warehouse_sales_track",
                "view_item_transfer_notes",
                "view_itn_approvals", "approve_itn_approvals",
                "view_receive_notes",
                "view_company_assets",
                # Finance (view only)
                "view_finance_dashboard",
                # Reporting
                "view_reporting_dashboard", "view_reporting_sales", "view_reporting_warehouse",
                "view_dashboard",
            ),
        },
        {
            "name": "Viewer",
            "description": "Read-only access to all modules",
            "permissions": perms(
                "view_dashboard",
                # Sales
                "view_sales_dashboard", "view_customers", "view_quotations", "view_proforma_invoices",
                "view_sales_orders", "view_so_approvals", "view_sales_returns", "view_sales_return_approvals",
                "view_coupons", "view_gift_vouchers", "view_agent_commissions", "view_commission_approvals",
                "view_sales_settings", "view_sales_track",
                # Purchasing
                "view_purchasing_dashboard", "view_suppliers", "view_purchase_orders", "view_po_approvals",
                "view_grn", "view_purchase_returns", "view_purchase_return_approvals",
                # Inventory
                "view_products", "view_categories", "view_brands",
                # Finance
                "view_finance_dashboard", "view_cashbook", "view_expenses",
                "view_bank_deposits", "view_card_payments", "view_cheque_payments", "view_credit_notes",
                "view_customer_advances", "view_supplier_advances",
                "view_supplier_payments", "view_customer_payments",
                "view_chart_of_accounts", "view_journal_entries", "view_general_ledger",
                "view_accounting_periods", "view_cash_flow",
                "view_payment_approvals", "view_expense_approvals", "view_bank_transfer_verify",
                "view_commission_payments", "view_commission_payment_approvals",
                # HR
                "view_hr_dashboard", "view_salary_profiles", "view_deductions",
                "view_payroll", "view_payroll_processing", "view_payroll_approvals",
                "view_hr_sales_commissions", "view_reimbursements", "view_reimbursement_approvals",
                "view_promotions", "view_hr_assets",
                "view_attendance", "view_leaves", "view_leave_approvals", "view_employees",
                # Warehouse
                "view_sales_stock", "view_warehouse_sales_track",
                "view_item_transfer_notes", "view_itn_approvals",
                "view_receive_notes", "view_company_assets",
                # Support
                "view_support_dashboard", "view_support_tickets", "view_job_items",
                "view_call_logs", "view_warranty_claims",
                # Reporting
                "view_reporting_dashboard", "view_reporting_sales", "view_reporting_finance",
                "view_reporting_inventory", "view_reporting_hr",
                "view_reporting_warehouse", "view_reporting_support",
            ),
        },
    ]
    
    for group_data in groups_data:
        existing_group = db.query(Group).filter(Group.name == group_data["name"]).first()
        if not existing_group:
            group = Group(name=group_data["name"])
            group.permissions = group_data["permissions"]
            db.add(group)
            print(f"  ✅ Created group: {group_data['name']}")
        else:
            # Update permissions
            existing_group.permissions = group_data["permissions"]
            print(f"  🔄 Updated group: {group_data['name']}")
    
    db.commit()
    
    # Assign Admin group to admin user
    admin_user = db.query(User).filter(User.username == "admin").first()
    if admin_user:
        admin_group = db.query(Group).filter(Group.name == "Admin").first()
        if admin_group and admin_group not in admin_user.groups:
            admin_user.groups.append(admin_group)
            db.commit()
            print("  ✅ Assigned Admin group to admin user")
    
    db.close()

    print("\n" + "═" * 60)
    print("  Permissions and groups seeded successfully!")
    print("═" * 60)
    print(f"\n  Total permissions: {len(permissions_data)}")
    print(f"  Total groups: {len(groups_data)}")
    print("\n  Default Groups:")
    for i, g in enumerate(groups_data, 1):
        print(f"    {i:2d}. {g['name']:25s} — {g['description']}")


if __name__ == "__main__":
    seed_permissions()
