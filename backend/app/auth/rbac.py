from typing import List

from app.auth.dependencies import get_current_active_user
from app.auth.models import Permission, User
from fastapi import Depends, HTTPException, status


def user_has_permission(user: User, resource: str, action: str) -> bool:

    if user.is_superuser:
        return True

    for permission in user.permissions:
        if permission.resource == resource and permission.action == action:
            return True

    for group in user.groups:
        for permission in group.permissions:
            if permission.resource == resource and permission.action == action:
                return True

    return False


def require_permission(resource: str, action: str):

    def permission_checker(current_user: User = Depends(get_current_active_user)):
        if not user_has_permission(current_user, resource, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required: {resource}:{action}",
            )
        return current_user

    return permission_checker


class Permissions:
    """
    Central permission registry for the entire ERP.
    Every sub-page defines its own CRUD + special actions.
    Tuples are (resource, action) — consumed by require_permission().
    """

    # ═══════════════════════════════════════════════════════════════════
    # DASHBOARD
    # ═══════════════════════════════════════════════════════════════════
    DASHBOARD_VIEW = ("dashboard", "view")

    # ═══════════════════════════════════════════════════════════════════
    # SALES — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    SALES_DASHBOARD_VIEW = ("sales_dashboard", "view")
    # Customers
    CUSTOMER_VIEW = ("customers", "view")
    CUSTOMER_CREATE = ("customers", "create")
    CUSTOMER_UPDATE = ("customers", "update")
    CUSTOMER_DELETE = ("customers", "delete")
    # Quotations
    QUOTATION_VIEW = ("quotations", "view")
    QUOTATION_CREATE = ("quotations", "create")
    QUOTATION_UPDATE = ("quotations", "update")
    QUOTATION_DELETE = ("quotations", "delete")
    # Proforma Invoices
    PROFORMA_INVOICE_VIEW = ("proforma_invoices", "view")
    PROFORMA_INVOICE_CREATE = ("proforma_invoices", "create")
    PROFORMA_INVOICE_UPDATE = ("proforma_invoices", "update")
    PROFORMA_INVOICE_DELETE = ("proforma_invoices", "delete")
    # Sales Orders
    SALES_ORDER_VIEW = ("sales_orders", "view")
    SALES_ORDER_CREATE = ("sales_orders", "create")
    SALES_ORDER_UPDATE = ("sales_orders", "update")
    SALES_ORDER_DELETE = ("sales_orders", "delete")
    # SO Approvals
    SO_APPROVAL_VIEW = ("so_approvals", "view")
    SO_APPROVAL_APPROVE = ("so_approvals", "approve")
    # Sales Returns
    SALES_RETURN_VIEW = ("sales_returns", "view")
    SALES_RETURN_CREATE = ("sales_returns", "create")
    SALES_RETURN_UPDATE = ("sales_returns", "update")
    SALES_RETURN_DELETE = ("sales_returns", "delete")
    # Sales Return Approvals
    SALES_RETURN_APPROVAL_VIEW = ("sales_return_approvals", "view")
    SALES_RETURN_APPROVAL_APPROVE = ("sales_return_approvals", "approve")
    # Coupons
    COUPON_VIEW = ("coupons", "view")
    COUPON_CREATE = ("coupons", "create")
    COUPON_UPDATE = ("coupons", "update")
    COUPON_DELETE = ("coupons", "delete")
    # Gift Vouchers
    GIFT_VOUCHER_VIEW = ("gift_vouchers", "view")
    GIFT_VOUCHER_CREATE = ("gift_vouchers", "create")
    GIFT_VOUCHER_UPDATE = ("gift_vouchers", "update")
    GIFT_VOUCHER_DELETE = ("gift_vouchers", "delete")
    # Agent Commissions
    AGENT_COMMISSION_VIEW = ("agent_commissions", "view")
    AGENT_COMMISSION_CREATE = ("agent_commissions", "create")
    AGENT_COMMISSION_UPDATE = ("agent_commissions", "update")
    AGENT_COMMISSION_DELETE = ("agent_commissions", "delete")
    # Commission Approvals
    COMMISSION_APPROVAL_VIEW = ("commission_approvals", "view")
    COMMISSION_APPROVAL_APPROVE = ("commission_approvals", "approve")
    # Sales Settings
    SALES_SETTINGS_VIEW = ("sales_settings", "view")
    SALES_SETTINGS_UPDATE = ("sales_settings", "update")
    # Sales Track
    SALES_TRACK_VIEW = ("sales_track", "view")

    # ═══════════════════════════════════════════════════════════════════
    # PURCHASING — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    PURCHASING_DASHBOARD_VIEW = ("purchasing_dashboard", "view")
    # Suppliers
    SUPPLIER_VIEW = ("suppliers", "view")
    SUPPLIER_CREATE = ("suppliers", "create")
    SUPPLIER_UPDATE = ("suppliers", "update")
    SUPPLIER_DELETE = ("suppliers", "delete")
    # Purchase Orders
    PURCHASE_ORDER_VIEW = ("purchase_orders", "view")
    PURCHASE_ORDER_CREATE = ("purchase_orders", "create")
    PURCHASE_ORDER_UPDATE = ("purchase_orders", "update")
    PURCHASE_ORDER_DELETE = ("purchase_orders", "delete")
    # PO Approvals
    PO_APPROVAL_VIEW = ("po_approvals", "view")
    PO_APPROVAL_APPROVE = ("po_approvals", "approve")
    # Good Received Notes
    GRN_VIEW = ("grn", "view")
    GRN_CREATE = ("grn", "create")
    GRN_UPDATE = ("grn", "update")
    GRN_DELETE = ("grn", "delete")
    # Purchase Returns
    PURCHASE_RETURN_VIEW = ("purchase_returns", "view")
    PURCHASE_RETURN_CREATE = ("purchase_returns", "create")
    PURCHASE_RETURN_UPDATE = ("purchase_returns", "update")
    PURCHASE_RETURN_DELETE = ("purchase_returns", "delete")
    # Purchase Return Approvals
    PURCHASE_RETURN_APPROVAL_VIEW = ("purchase_return_approvals", "view")
    PURCHASE_RETURN_APPROVAL_APPROVE = ("purchase_return_approvals", "approve")

    # ═══════════════════════════════════════════════════════════════════
    # INVENTORY / PRODUCT CATALOGS — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    PRODUCT_VIEW = ("products", "view")
    PRODUCT_CREATE = ("products", "create")
    PRODUCT_UPDATE = ("products", "update")
    PRODUCT_DELETE = ("products", "delete")
    CATEGORY_VIEW = ("categories", "view")
    CATEGORY_CREATE = ("categories", "create")
    CATEGORY_UPDATE = ("categories", "update")
    CATEGORY_DELETE = ("categories", "delete")
    BRAND_VIEW = ("brands", "view")
    BRAND_CREATE = ("brands", "create")
    BRAND_UPDATE = ("brands", "update")
    BRAND_DELETE = ("brands", "delete")

    # ═══════════════════════════════════════════════════════════════════
    # FINANCE — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    FINANCE_DASHBOARD_VIEW = ("finance_dashboard", "view")
    CASHBOOK_VIEW = ("cashbook", "view")
    CASHBOOK_CREATE = ("cashbook", "create")
    CASHBOOK_UPDATE = ("cashbook", "update")
    EXPENSE_VIEW = ("expenses", "view")
    EXPENSE_CREATE = ("expenses", "create")
    EXPENSE_UPDATE = ("expenses", "update")
    EXPENSE_DELETE = ("expenses", "delete")
    BANK_DEPOSIT_VIEW = ("bank_deposits", "view")
    BANK_DEPOSIT_CREATE = ("bank_deposits", "create")
    BANK_DEPOSIT_UPDATE = ("bank_deposits", "update")
    BANK_DEPOSIT_DELETE = ("bank_deposits", "delete")
    CARD_PAYMENT_VIEW = ("card_payments", "view")
    CARD_PAYMENT_CREATE = ("card_payments", "create")
    CARD_PAYMENT_UPDATE = ("card_payments", "update")
    CARD_PAYMENT_DELETE = ("card_payments", "delete")
    CHEQUE_PAYMENT_VIEW = ("cheque_payments", "view")
    CHEQUE_PAYMENT_CREATE = ("cheque_payments", "create")
    CHEQUE_PAYMENT_UPDATE = ("cheque_payments", "update")
    CHEQUE_PAYMENT_DELETE = ("cheque_payments", "delete")
    CREDIT_NOTE_VIEW = ("credit_notes", "view")
    CREDIT_NOTE_CREATE = ("credit_notes", "create")
    CREDIT_NOTE_UPDATE = ("credit_notes", "update")
    CREDIT_NOTE_DELETE = ("credit_notes", "delete")
    CUSTOMER_ADVANCE_VIEW = ("customer_advances", "view")
    CUSTOMER_ADVANCE_CREATE = ("customer_advances", "create")
    CUSTOMER_ADVANCE_UPDATE = ("customer_advances", "update")
    CUSTOMER_ADVANCE_DELETE = ("customer_advances", "delete")
    SUPPLIER_ADVANCE_VIEW = ("supplier_advances", "view")
    SUPPLIER_ADVANCE_CREATE = ("supplier_advances", "create")
    SUPPLIER_ADVANCE_UPDATE = ("supplier_advances", "update")
    SUPPLIER_ADVANCE_DELETE = ("supplier_advances", "delete")
    SUPPLIER_PAYMENT_VIEW = ("supplier_payments", "view")
    SUPPLIER_PAYMENT_CREATE = ("supplier_payments", "create")
    SUPPLIER_PAYMENT_UPDATE = ("supplier_payments", "update")
    SUPPLIER_PAYMENT_DELETE = ("supplier_payments", "delete")
    CUSTOMER_PAYMENT_VIEW = ("customer_payments", "view")
    CUSTOMER_PAYMENT_CREATE = ("customer_payments", "create")
    CUSTOMER_PAYMENT_UPDATE = ("customer_payments", "update")
    CUSTOMER_PAYMENT_DELETE = ("customer_payments", "delete")
    CHART_OF_ACCOUNTS_VIEW = ("chart_of_accounts", "view")
    CHART_OF_ACCOUNTS_CREATE = ("chart_of_accounts", "create")
    CHART_OF_ACCOUNTS_UPDATE = ("chart_of_accounts", "update")
    CHART_OF_ACCOUNTS_DELETE = ("chart_of_accounts", "delete")
    JOURNAL_ENTRY_VIEW = ("journal_entries", "view")
    JOURNAL_ENTRY_CREATE = ("journal_entries", "create")
    JOURNAL_ENTRY_UPDATE = ("journal_entries", "update")
    JOURNAL_ENTRY_DELETE = ("journal_entries", "delete")
    GENERAL_LEDGER_VIEW = ("general_ledger", "view")
    ACCOUNTING_PERIOD_VIEW = ("accounting_periods", "view")
    ACCOUNTING_PERIOD_CREATE = ("accounting_periods", "create")
    ACCOUNTING_PERIOD_UPDATE = ("accounting_periods", "update")
    CASH_FLOW_VIEW = ("cash_flow", "view")
    PAYMENT_APPROVAL_VIEW = ("payment_approvals", "view")
    PAYMENT_APPROVAL_APPROVE = ("payment_approvals", "approve")
    EXPENSE_APPROVAL_VIEW = ("expense_approvals", "view")
    EXPENSE_APPROVAL_APPROVE = ("expense_approvals", "approve")
    BANK_TRANSFER_VERIFY_VIEW = ("bank_transfer_verify", "view")
    BANK_TRANSFER_VERIFY_APPROVE = ("bank_transfer_verify", "approve")
    COMMISSION_PAYMENT_VIEW = ("commission_payments", "view")
    COMMISSION_PAYMENT_CREATE = ("commission_payments", "create")
    COMMISSION_PAYMENT_UPDATE = ("commission_payments", "update")
    COMMISSION_PAYMENT_APPROVAL_VIEW = ("commission_payment_approvals", "view")
    COMMISSION_PAYMENT_APPROVAL_APPROVE = ("commission_payment_approvals", "approve")

    # ═══════════════════════════════════════════════════════════════════
    # HR — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    HR_DASHBOARD_VIEW = ("hr_dashboard", "view")
    SALARY_PROFILE_VIEW = ("salary_profiles", "view")
    SALARY_PROFILE_CREATE = ("salary_profiles", "create")
    SALARY_PROFILE_UPDATE = ("salary_profiles", "update")
    SALARY_PROFILE_DELETE = ("salary_profiles", "delete")
    DEDUCTION_VIEW = ("deductions", "view")
    DEDUCTION_CREATE = ("deductions", "create")
    DEDUCTION_UPDATE = ("deductions", "update")
    DEDUCTION_DELETE = ("deductions", "delete")
    PAYROLL_VIEW = ("payroll", "view")
    PAYROLL_CREATE = ("payroll", "create")
    PAYROLL_UPDATE = ("payroll", "update")
    PAYROLL_DELETE = ("payroll", "delete")
    PAYROLL_PROCESSING_VIEW = ("payroll_processing", "view")
    PAYROLL_PROCESSING_CREATE = ("payroll_processing", "create")
    PAYROLL_APPROVAL_VIEW = ("payroll_approvals", "view")
    PAYROLL_APPROVAL_APPROVE = ("payroll_approvals", "approve")
    HR_SALES_COMMISSION_VIEW = ("hr_sales_commissions", "view")
    HR_SALES_COMMISSION_CREATE = ("hr_sales_commissions", "create")
    HR_SALES_COMMISSION_UPDATE = ("hr_sales_commissions", "update")
    REIMBURSEMENT_VIEW = ("reimbursements", "view")
    REIMBURSEMENT_CREATE = ("reimbursements", "create")
    REIMBURSEMENT_UPDATE = ("reimbursements", "update")
    REIMBURSEMENT_DELETE = ("reimbursements", "delete")
    REIMBURSEMENT_APPROVAL_VIEW = ("reimbursement_approvals", "view")
    REIMBURSEMENT_APPROVAL_APPROVE = ("reimbursement_approvals", "approve")
    PROMOTION_VIEW = ("promotions", "view")
    PROMOTION_CREATE = ("promotions", "create")
    PROMOTION_UPDATE = ("promotions", "update")
    PROMOTION_DELETE = ("promotions", "delete")
    HR_ASSET_VIEW = ("hr_assets", "view")
    HR_ASSET_CREATE = ("hr_assets", "create")
    HR_ASSET_UPDATE = ("hr_assets", "update")
    HR_ASSET_DELETE = ("hr_assets", "delete")

    # ═══════════════════════════════════════════════════════════════════
    # WAREHOUSE — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    SALES_STOCK_VIEW = ("sales_stock", "view")
    SALES_STOCK_CREATE = ("sales_stock", "create")
    SALES_STOCK_UPDATE = ("sales_stock", "update")
    SALES_STOCK_DELETE = ("sales_stock", "delete")
    WAREHOUSE_SALES_TRACK_VIEW = ("warehouse_sales_track", "view")
    ITN_VIEW = ("item_transfer_notes", "view")
    ITN_CREATE = ("item_transfer_notes", "create")
    ITN_UPDATE = ("item_transfer_notes", "update")
    ITN_DELETE = ("item_transfer_notes", "delete")
    ITN_APPROVAL_VIEW = ("itn_approvals", "view")
    ITN_APPROVAL_APPROVE = ("itn_approvals", "approve")
    RECEIVE_NOTE_VIEW = ("receive_notes", "view")
    RECEIVE_NOTE_CREATE = ("receive_notes", "create")
    RECEIVE_NOTE_UPDATE = ("receive_notes", "update")
    RECEIVE_NOTE_DELETE = ("receive_notes", "delete")
    COMPANY_ASSET_VIEW = ("company_assets", "view")
    COMPANY_ASSET_CREATE = ("company_assets", "create")
    COMPANY_ASSET_UPDATE = ("company_assets", "update")
    COMPANY_ASSET_DELETE = ("company_assets", "delete")

    # ═══════════════════════════════════════════════════════════════════
    # SUPPORT — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    SUPPORT_DASHBOARD_VIEW = ("support_dashboard", "view")
    SUPPORT_TICKET_VIEW = ("support_tickets", "view")
    SUPPORT_TICKET_CREATE = ("support_tickets", "create")
    SUPPORT_TICKET_UPDATE = ("support_tickets", "update")
    SUPPORT_TICKET_DELETE = ("support_tickets", "delete")
    JOB_ITEM_VIEW = ("job_items", "view")
    JOB_ITEM_CREATE = ("job_items", "create")
    JOB_ITEM_UPDATE = ("job_items", "update")
    JOB_ITEM_DELETE = ("job_items", "delete")
    CALL_LOG_VIEW = ("call_logs", "view")
    CALL_LOG_CREATE = ("call_logs", "create")
    CALL_LOG_UPDATE = ("call_logs", "update")
    CALL_LOG_DELETE = ("call_logs", "delete")
    WARRANTY_CLAIM_VIEW = ("warranty_claims", "view")
    WARRANTY_CLAIM_CREATE = ("warranty_claims", "create")
    WARRANTY_CLAIM_UPDATE = ("warranty_claims", "update")
    WARRANTY_CLAIM_DELETE = ("warranty_claims", "delete")

    # ═══════════════════════════════════════════════════════════════════
    # REPORTING — per sub-page
    # ═══════════════════════════════════════════════════════════════════
    REPORTING_DASHBOARD_VIEW = ("reporting_dashboard", "view")
    REPORTING_SALES_VIEW = ("reporting_sales", "view")
    REPORTING_SALES_GENERATE = ("reporting_sales", "generate")
    REPORTING_FINANCE_VIEW = ("reporting_finance", "view")
    REPORTING_FINANCE_GENERATE = ("reporting_finance", "generate")
    REPORTING_INVENTORY_VIEW = ("reporting_inventory", "view")
    REPORTING_INVENTORY_GENERATE = ("reporting_inventory", "generate")
    REPORTING_HR_VIEW = ("reporting_hr", "view")
    REPORTING_HR_GENERATE = ("reporting_hr", "generate")
    REPORTING_WAREHOUSE_VIEW = ("reporting_warehouse", "view")
    REPORTING_WAREHOUSE_GENERATE = ("reporting_warehouse", "generate")
    REPORTING_SUPPORT_VIEW = ("reporting_support", "view")
    REPORTING_SUPPORT_GENERATE = ("reporting_support", "generate")

    # ═══════════════════════════════════════════════════════════════════
    # ADMINISTRATION
    # ═══════════════════════════════════════════════════════════════════
    USER_VIEW = ("users", "view")
    USER_CREATE = ("users", "create")
    USER_UPDATE = ("users", "update")
    USER_DELETE = ("users", "delete")
    GROUP_VIEW = ("groups", "view")
    GROUP_CREATE = ("groups", "create")
    GROUP_UPDATE = ("groups", "update")
    GROUP_DELETE = ("groups", "delete")
    BRANCH_VIEW = ("branches", "view")
    BRANCH_CREATE = ("branches", "create")
    BRANCH_UPDATE = ("branches", "update")
    BRANCH_DELETE = ("branches", "delete")
    COMMON_VIEW = ("common", "view")
    COMMON_CREATE = ("common", "create")
    COMMON_UPDATE = ("common", "update")
    COMMON_DELETE = ("common", "delete")
    SETTINGS_VIEW = ("settings", "view")
    SETTINGS_UPDATE = ("settings", "update")
