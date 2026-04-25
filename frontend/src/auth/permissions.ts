import { User } from "@/api/types";
import { useAuthStore } from "@/state/authStore";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Permission constants — must match backend app/auth/rbac.py Permissions
 * ═══════════════════════════════════════════════════════════════════════
 */
export const PERMISSIONS = {
  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  DASHBOARD_VIEW: { resource: "dashboard", action: "view" },

  // ═══════════════════════════════════════════════════════════════════
  // SALES — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // Sales Dashboard
  SALES_DASHBOARD_VIEW: { resource: "sales_dashboard", action: "view" },
  // Customers
  CUSTOMERS_VIEW: { resource: "customers", action: "view" },
  CUSTOMERS_CREATE: { resource: "customers", action: "create" },
  CUSTOMERS_UPDATE: { resource: "customers", action: "update" },
  CUSTOMERS_DELETE: { resource: "customers", action: "delete" },
  // Quotations
  QUOTATIONS_VIEW: { resource: "quotations", action: "view" },
  QUOTATIONS_CREATE: { resource: "quotations", action: "create" },
  QUOTATIONS_UPDATE: { resource: "quotations", action: "update" },
  QUOTATIONS_DELETE: { resource: "quotations", action: "delete" },
  // Proforma Invoices
  PROFORMA_INVOICES_VIEW: { resource: "proforma_invoices", action: "view" },
  PROFORMA_INVOICES_CREATE: { resource: "proforma_invoices", action: "create" },
  PROFORMA_INVOICES_UPDATE: { resource: "proforma_invoices", action: "update" },
  PROFORMA_INVOICES_DELETE: { resource: "proforma_invoices", action: "delete" },
  // Sales Orders
  SALES_ORDERS_VIEW: { resource: "sales_orders", action: "view" },
  SALES_ORDERS_CREATE: { resource: "sales_orders", action: "create" },
  SALES_ORDERS_UPDATE: { resource: "sales_orders", action: "update" },
  SALES_ORDERS_DELETE: { resource: "sales_orders", action: "delete" },
  // SO Approvals
  SO_APPROVALS_VIEW: { resource: "so_approvals", action: "view" },
  SO_APPROVALS_APPROVE: { resource: "so_approvals", action: "approve" },
  // Sales Returns
  SALES_RETURNS_VIEW: { resource: "sales_returns", action: "view" },
  SALES_RETURNS_CREATE: { resource: "sales_returns", action: "create" },
  SALES_RETURNS_UPDATE: { resource: "sales_returns", action: "update" },
  SALES_RETURNS_DELETE: { resource: "sales_returns", action: "delete" },
  // Sales Return Approvals
  SALES_RETURN_APPROVALS_VIEW: { resource: "sales_return_approvals", action: "view" },
  SALES_RETURN_APPROVALS_APPROVE: { resource: "sales_return_approvals", action: "approve" },
  // Coupons
  COUPONS_VIEW: { resource: "coupons", action: "view" },
  COUPONS_CREATE: { resource: "coupons", action: "create" },
  COUPONS_UPDATE: { resource: "coupons", action: "update" },
  COUPONS_DELETE: { resource: "coupons", action: "delete" },
  // Gift Vouchers
  GIFT_VOUCHERS_VIEW: { resource: "gift_vouchers", action: "view" },
  GIFT_VOUCHERS_CREATE: { resource: "gift_vouchers", action: "create" },
  GIFT_VOUCHERS_UPDATE: { resource: "gift_vouchers", action: "update" },
  GIFT_VOUCHERS_DELETE: { resource: "gift_vouchers", action: "delete" },
  // Agent Commissions
  AGENT_COMMISSIONS_VIEW: { resource: "agent_commissions", action: "view" },
  AGENT_COMMISSIONS_CREATE: { resource: "agent_commissions", action: "create" },
  AGENT_COMMISSIONS_UPDATE: { resource: "agent_commissions", action: "update" },
  AGENT_COMMISSIONS_DELETE: { resource: "agent_commissions", action: "delete" },
  // Commission Approvals (Sales)
  COMMISSION_APPROVALS_VIEW: { resource: "commission_approvals", action: "view" },
  COMMISSION_APPROVALS_APPROVE: { resource: "commission_approvals", action: "approve" },
  // Sales Settings
  SALES_SETTINGS_VIEW: { resource: "sales_settings", action: "view" },
  SALES_SETTINGS_UPDATE: { resource: "sales_settings", action: "update" },
  // Sales Track
  SALES_TRACK_VIEW: { resource: "sales_track", action: "view" },

  // ═══════════════════════════════════════════════════════════════════
  // PURCHASING — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // Purchasing Dashboard
  PURCHASING_DASHBOARD_VIEW: { resource: "purchasing_dashboard", action: "view" },
  // Suppliers
  SUPPLIERS_VIEW: { resource: "suppliers", action: "view" },
  SUPPLIERS_CREATE: { resource: "suppliers", action: "create" },
  SUPPLIERS_UPDATE: { resource: "suppliers", action: "update" },
  SUPPLIERS_DELETE: { resource: "suppliers", action: "delete" },
  // Purchase Orders
  PURCHASE_ORDERS_VIEW: { resource: "purchase_orders", action: "view" },
  PURCHASE_ORDERS_CREATE: { resource: "purchase_orders", action: "create" },
  PURCHASE_ORDERS_UPDATE: { resource: "purchase_orders", action: "update" },
  PURCHASE_ORDERS_DELETE: { resource: "purchase_orders", action: "delete" },
  // PO Approvals
  PO_APPROVALS_VIEW: { resource: "po_approvals", action: "view" },
  PO_APPROVALS_APPROVE: { resource: "po_approvals", action: "approve" },
  // Good Received Notes (GRN)
  GRN_VIEW: { resource: "grn", action: "view" },
  GRN_CREATE: { resource: "grn", action: "create" },
  GRN_UPDATE: { resource: "grn", action: "update" },
  GRN_DELETE: { resource: "grn", action: "delete" },
  // Purchase Returns
  PURCHASE_RETURNS_VIEW: { resource: "purchase_returns", action: "view" },
  PURCHASE_RETURNS_CREATE: { resource: "purchase_returns", action: "create" },
  PURCHASE_RETURNS_UPDATE: { resource: "purchase_returns", action: "update" },
  PURCHASE_RETURNS_DELETE: { resource: "purchase_returns", action: "delete" },
  // Purchase Return Approvals
  PURCHASE_RETURN_APPROVALS_VIEW: { resource: "purchase_return_approvals", action: "view" },
  PURCHASE_RETURN_APPROVALS_APPROVE: { resource: "purchase_return_approvals", action: "approve" },

  // ═══════════════════════════════════════════════════════════════════
  // INVENTORY / PRODUCT CATALOGS — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // Products
  PRODUCTS_VIEW: { resource: "products", action: "view" },
  PRODUCTS_CREATE: { resource: "products", action: "create" },
  PRODUCTS_UPDATE: { resource: "products", action: "update" },
  PRODUCTS_DELETE: { resource: "products", action: "delete" },
  // Categories
  CATEGORIES_VIEW: { resource: "categories", action: "view" },
  CATEGORIES_CREATE: { resource: "categories", action: "create" },
  CATEGORIES_UPDATE: { resource: "categories", action: "update" },
  CATEGORIES_DELETE: { resource: "categories", action: "delete" },
  // Brands
  BRANDS_VIEW: { resource: "brands", action: "view" },
  BRANDS_CREATE: { resource: "brands", action: "create" },
  BRANDS_UPDATE: { resource: "brands", action: "update" },
  BRANDS_DELETE: { resource: "brands", action: "delete" },

  // ═══════════════════════════════════════════════════════════════════
  // FINANCE — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // Finance Dashboard
  FINANCE_DASHBOARD_VIEW: { resource: "finance_dashboard", action: "view" },
  // Cashbook
  CASHBOOK_VIEW: { resource: "cashbook", action: "view" },
  CASHBOOK_CREATE: { resource: "cashbook", action: "create" },
  CASHBOOK_UPDATE: { resource: "cashbook", action: "update" },
  // Expenses
  EXPENSES_VIEW: { resource: "expenses", action: "view" },
  EXPENSES_CREATE: { resource: "expenses", action: "create" },
  EXPENSES_UPDATE: { resource: "expenses", action: "update" },
  EXPENSES_DELETE: { resource: "expenses", action: "delete" },
  // Bank Deposits
  BANK_DEPOSITS_VIEW: { resource: "bank_deposits", action: "view" },
  BANK_DEPOSITS_CREATE: { resource: "bank_deposits", action: "create" },
  BANK_DEPOSITS_UPDATE: { resource: "bank_deposits", action: "update" },
  BANK_DEPOSITS_DELETE: { resource: "bank_deposits", action: "delete" },
  // Card Payments
  CARD_PAYMENTS_VIEW: { resource: "card_payments", action: "view" },
  CARD_PAYMENTS_CREATE: { resource: "card_payments", action: "create" },
  CARD_PAYMENTS_UPDATE: { resource: "card_payments", action: "update" },
  CARD_PAYMENTS_DELETE: { resource: "card_payments", action: "delete" },
  // Cheque Payments
  CHEQUE_PAYMENTS_VIEW: { resource: "cheque_payments", action: "view" },
  CHEQUE_PAYMENTS_CREATE: { resource: "cheque_payments", action: "create" },
  CHEQUE_PAYMENTS_UPDATE: { resource: "cheque_payments", action: "update" },
  CHEQUE_PAYMENTS_DELETE: { resource: "cheque_payments", action: "delete" },
  // Credit Notes
  CREDIT_NOTES_VIEW: { resource: "credit_notes", action: "view" },
  CREDIT_NOTES_CREATE: { resource: "credit_notes", action: "create" },
  CREDIT_NOTES_UPDATE: { resource: "credit_notes", action: "update" },
  CREDIT_NOTES_DELETE: { resource: "credit_notes", action: "delete" },
  // Customer Advances
  CUSTOMER_ADVANCES_VIEW: { resource: "customer_advances", action: "view" },
  CUSTOMER_ADVANCES_CREATE: { resource: "customer_advances", action: "create" },
  CUSTOMER_ADVANCES_UPDATE: { resource: "customer_advances", action: "update" },
  CUSTOMER_ADVANCES_DELETE: { resource: "customer_advances", action: "delete" },
  // Supplier Advances
  SUPPLIER_ADVANCES_VIEW: { resource: "supplier_advances", action: "view" },
  SUPPLIER_ADVANCES_CREATE: { resource: "supplier_advances", action: "create" },
  SUPPLIER_ADVANCES_UPDATE: { resource: "supplier_advances", action: "update" },
  SUPPLIER_ADVANCES_DELETE: { resource: "supplier_advances", action: "delete" },
  // Supplier Payments
  SUPPLIER_PAYMENTS_VIEW: { resource: "supplier_payments", action: "view" },
  SUPPLIER_PAYMENTS_CREATE: { resource: "supplier_payments", action: "create" },
  SUPPLIER_PAYMENTS_UPDATE: { resource: "supplier_payments", action: "update" },
  SUPPLIER_PAYMENTS_DELETE: { resource: "supplier_payments", action: "delete" },
  // Customer Payments
  CUSTOMER_PAYMENTS_VIEW: { resource: "customer_payments", action: "view" },
  CUSTOMER_PAYMENTS_CREATE: { resource: "customer_payments", action: "create" },
  CUSTOMER_PAYMENTS_UPDATE: { resource: "customer_payments", action: "update" },
  CUSTOMER_PAYMENTS_DELETE: { resource: "customer_payments", action: "delete" },
  // Chart of Accounts
  CHART_OF_ACCOUNTS_VIEW: { resource: "chart_of_accounts", action: "view" },
  CHART_OF_ACCOUNTS_CREATE: { resource: "chart_of_accounts", action: "create" },
  CHART_OF_ACCOUNTS_UPDATE: { resource: "chart_of_accounts", action: "update" },
  CHART_OF_ACCOUNTS_DELETE: { resource: "chart_of_accounts", action: "delete" },
  // Journal Entries
  JOURNAL_ENTRIES_VIEW: { resource: "journal_entries", action: "view" },
  JOURNAL_ENTRIES_CREATE: { resource: "journal_entries", action: "create" },
  JOURNAL_ENTRIES_UPDATE: { resource: "journal_entries", action: "update" },
  JOURNAL_ENTRIES_DELETE: { resource: "journal_entries", action: "delete" },
  // General Ledger
  GENERAL_LEDGER_VIEW: { resource: "general_ledger", action: "view" },
  // Accounting Periods
  ACCOUNTING_PERIODS_VIEW: { resource: "accounting_periods", action: "view" },
  ACCOUNTING_PERIODS_CREATE: { resource: "accounting_periods", action: "create" },
  ACCOUNTING_PERIODS_UPDATE: { resource: "accounting_periods", action: "update" },
  // Cash Flow
  CASH_FLOW_VIEW: { resource: "cash_flow", action: "view" },
  // Payment Approvals
  PAYMENT_APPROVALS_VIEW: { resource: "payment_approvals", action: "view" },
  PAYMENT_APPROVALS_APPROVE: { resource: "payment_approvals", action: "approve" },
  // Expense Approvals
  EXPENSE_APPROVALS_VIEW: { resource: "expense_approvals", action: "view" },
  EXPENSE_APPROVALS_APPROVE: { resource: "expense_approvals", action: "approve" },
  // Bank Transfer Verify
  BANK_TRANSFER_VERIFY_VIEW: { resource: "bank_transfer_verify", action: "view" },
  BANK_TRANSFER_VERIFY_APPROVE: { resource: "bank_transfer_verify", action: "approve" },
  // Commission Payments
  COMMISSION_PAYMENTS_VIEW: { resource: "commission_payments", action: "view" },
  COMMISSION_PAYMENTS_CREATE: { resource: "commission_payments", action: "create" },
  COMMISSION_PAYMENTS_UPDATE: { resource: "commission_payments", action: "update" },
  // Commission Payment Approvals
  COMMISSION_PAYMENT_APPROVALS_VIEW: { resource: "commission_payment_approvals", action: "view" },
  COMMISSION_PAYMENT_APPROVALS_APPROVE: { resource: "commission_payment_approvals", action: "approve" },

  // ═══════════════════════════════════════════════════════════════════
  // HR — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // HR Dashboard
  HR_DASHBOARD_VIEW: { resource: "hr_dashboard", action: "view" },
  // Salary Profiles
  SALARY_PROFILES_VIEW: { resource: "salary_profiles", action: "view" },
  SALARY_PROFILES_CREATE: { resource: "salary_profiles", action: "create" },
  SALARY_PROFILES_UPDATE: { resource: "salary_profiles", action: "update" },
  SALARY_PROFILES_DELETE: { resource: "salary_profiles", action: "delete" },
  // Deductions
  DEDUCTIONS_VIEW: { resource: "deductions", action: "view" },
  DEDUCTIONS_CREATE: { resource: "deductions", action: "create" },
  DEDUCTIONS_UPDATE: { resource: "deductions", action: "update" },
  DEDUCTIONS_DELETE: { resource: "deductions", action: "delete" },
  // Payroll Records
  PAYROLL_VIEW: { resource: "payroll", action: "view" },
  PAYROLL_CREATE: { resource: "payroll", action: "create" },
  PAYROLL_UPDATE: { resource: "payroll", action: "update" },
  PAYROLL_DELETE: { resource: "payroll", action: "delete" },
  // Payroll Processing
  PAYROLL_PROCESSING_VIEW: { resource: "payroll_processing", action: "view" },
  PAYROLL_PROCESSING_CREATE: { resource: "payroll_processing", action: "create" },
  // Payroll Approvals
  PAYROLL_APPROVALS_VIEW: { resource: "payroll_approvals", action: "view" },
  PAYROLL_APPROVALS_APPROVE: { resource: "payroll_approvals", action: "approve" },
  // Sales Commissions (HR)
  HR_SALES_COMMISSIONS_VIEW: { resource: "hr_sales_commissions", action: "view" },
  HR_SALES_COMMISSIONS_CREATE: { resource: "hr_sales_commissions", action: "create" },
  HR_SALES_COMMISSIONS_UPDATE: { resource: "hr_sales_commissions", action: "update" },
  // Reimbursements
  REIMBURSEMENTS_VIEW: { resource: "reimbursements", action: "view" },
  REIMBURSEMENTS_CREATE: { resource: "reimbursements", action: "create" },
  REIMBURSEMENTS_UPDATE: { resource: "reimbursements", action: "update" },
  REIMBURSEMENTS_DELETE: { resource: "reimbursements", action: "delete" },
  // Reimbursement Approvals
  REIMBURSEMENT_APPROVALS_VIEW: { resource: "reimbursement_approvals", action: "view" },
  REIMBURSEMENT_APPROVALS_APPROVE: { resource: "reimbursement_approvals", action: "approve" },
  // Promotions
  PROMOTIONS_VIEW: { resource: "promotions", action: "view" },
  PROMOTIONS_CREATE: { resource: "promotions", action: "create" },
  PROMOTIONS_UPDATE: { resource: "promotions", action: "update" },
  PROMOTIONS_DELETE: { resource: "promotions", action: "delete" },
  // Company Assets (HR)
  HR_ASSETS_VIEW: { resource: "hr_assets", action: "view" },
  HR_ASSETS_CREATE: { resource: "hr_assets", action: "create" },
  HR_ASSETS_UPDATE: { resource: "hr_assets", action: "update" },
  HR_ASSETS_DELETE: { resource: "hr_assets", action: "delete" },
  // Attendance
  ATTENDANCE_VIEW: { resource: "attendance", action: "view" },
  ATTENDANCE_CREATE: { resource: "attendance", action: "create" },
  ATTENDANCE_UPDATE: { resource: "attendance", action: "update" },
  ATTENDANCE_DELETE: { resource: "attendance", action: "delete" },
  // Leaves
  LEAVES_VIEW: { resource: "leaves", action: "view" },
  LEAVES_CREATE: { resource: "leaves", action: "create" },
  LEAVES_UPDATE: { resource: "leaves", action: "update" },
  LEAVES_DELETE: { resource: "leaves", action: "delete" },
  LEAVE_APPROVALS_VIEW: { resource: "leave_approvals", action: "view" },
  LEAVE_APPROVALS_APPROVE: { resource: "leave_approvals", action: "approve" },
  // Employees master
  EMPLOYEES_VIEW: { resource: "employees", action: "view" },
  EMPLOYEES_CREATE: { resource: "employees", action: "create" },
  EMPLOYEES_UPDATE: { resource: "employees", action: "update" },
  EMPLOYEES_DELETE: { resource: "employees", action: "delete" },

  // ═══════════════════════════════════════════════════════════════════
  // WAREHOUSE — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // Sales Stock Dashboard
  SALES_STOCK_VIEW: { resource: "sales_stock", action: "view" },
  SALES_STOCK_CREATE: { resource: "sales_stock", action: "create" },
  SALES_STOCK_UPDATE: { resource: "sales_stock", action: "update" },
  SALES_STOCK_DELETE: { resource: "sales_stock", action: "delete" },
  // Sales Track (Warehouse)
  WAREHOUSE_SALES_TRACK_VIEW: { resource: "warehouse_sales_track", action: "view" },
  // Item Transfer Notes
  ITN_VIEW: { resource: "item_transfer_notes", action: "view" },
  ITN_CREATE: { resource: "item_transfer_notes", action: "create" },
  ITN_UPDATE: { resource: "item_transfer_notes", action: "update" },
  ITN_DELETE: { resource: "item_transfer_notes", action: "delete" },
  // ITN Approvals
  ITN_APPROVALS_VIEW: { resource: "itn_approvals", action: "view" },
  ITN_APPROVALS_APPROVE: { resource: "itn_approvals", action: "approve" },
  // Receive Notes
  RECEIVE_NOTES_VIEW: { resource: "receive_notes", action: "view" },
  RECEIVE_NOTES_CREATE: { resource: "receive_notes", action: "create" },
  RECEIVE_NOTES_UPDATE: { resource: "receive_notes", action: "update" },
  RECEIVE_NOTES_DELETE: { resource: "receive_notes", action: "delete" },
  // Company Assets (Warehouse)
  COMPANY_ASSETS_VIEW: { resource: "company_assets", action: "view" },
  COMPANY_ASSETS_CREATE: { resource: "company_assets", action: "create" },
  COMPANY_ASSETS_UPDATE: { resource: "company_assets", action: "update" },
  COMPANY_ASSETS_DELETE: { resource: "company_assets", action: "delete" },

  // ═══════════════════════════════════════════════════════════════════
  // SUPPORT — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  // Support Dashboard
  SUPPORT_DASHBOARD_VIEW: { resource: "support_dashboard", action: "view" },
  // Support Tickets
  SUPPORT_TICKETS_VIEW: { resource: "support_tickets", action: "view" },
  SUPPORT_TICKETS_CREATE: { resource: "support_tickets", action: "create" },
  SUPPORT_TICKETS_UPDATE: { resource: "support_tickets", action: "update" },
  SUPPORT_TICKETS_DELETE: { resource: "support_tickets", action: "delete" },
  // Job Items
  JOB_ITEMS_VIEW: { resource: "job_items", action: "view" },
  JOB_ITEMS_CREATE: { resource: "job_items", action: "create" },
  JOB_ITEMS_UPDATE: { resource: "job_items", action: "update" },
  JOB_ITEMS_DELETE: { resource: "job_items", action: "delete" },
  // Call Logs
  CALL_LOGS_VIEW: { resource: "call_logs", action: "view" },
  CALL_LOGS_CREATE: { resource: "call_logs", action: "create" },
  CALL_LOGS_UPDATE: { resource: "call_logs", action: "update" },
  CALL_LOGS_DELETE: { resource: "call_logs", action: "delete" },
  // Warranty Claims
  WARRANTY_CLAIMS_VIEW: { resource: "warranty_claims", action: "view" },
  WARRANTY_CLAIMS_CREATE: { resource: "warranty_claims", action: "create" },
  WARRANTY_CLAIMS_UPDATE: { resource: "warranty_claims", action: "update" },
  WARRANTY_CLAIMS_DELETE: { resource: "warranty_claims", action: "delete" },

  // ═══════════════════════════════════════════════════════════════════
  // REPORTING — per sub-page permissions
  // ═══════════════════════════════════════════════════════════════════
  REPORTING_DASHBOARD_VIEW: { resource: "reporting_dashboard", action: "view" },
  REPORTING_SALES_VIEW: { resource: "reporting_sales", action: "view" },
  REPORTING_SALES_GENERATE: { resource: "reporting_sales", action: "generate" },
  REPORTING_FINANCE_VIEW: { resource: "reporting_finance", action: "view" },
  REPORTING_FINANCE_GENERATE: { resource: "reporting_finance", action: "generate" },
  REPORTING_INVENTORY_VIEW: { resource: "reporting_inventory", action: "view" },
  REPORTING_INVENTORY_GENERATE: { resource: "reporting_inventory", action: "generate" },
  REPORTING_HR_VIEW: { resource: "reporting_hr", action: "view" },
  REPORTING_HR_GENERATE: { resource: "reporting_hr", action: "generate" },
  REPORTING_WAREHOUSE_VIEW: { resource: "reporting_warehouse", action: "view" },
  REPORTING_WAREHOUSE_GENERATE: { resource: "reporting_warehouse", action: "generate" },
  REPORTING_SUPPORT_VIEW: { resource: "reporting_support", action: "view" },
  REPORTING_SUPPORT_GENERATE: { resource: "reporting_support", action: "generate" },

  // ═══════════════════════════════════════════════════════════════════
  // ADMINISTRATION — Users, Groups, Branches, Settings
  // ═══════════════════════════════════════════════════════════════════
  // User management
  USER_VIEW: { resource: "users", action: "view" },
  USER_CREATE: { resource: "users", action: "create" },
  USER_UPDATE: { resource: "users", action: "update" },
  USER_DELETE: { resource: "users", action: "delete" },
  // Group / Role management
  GROUP_VIEW: { resource: "groups", action: "view" },
  GROUP_CREATE: { resource: "groups", action: "create" },
  GROUP_UPDATE: { resource: "groups", action: "update" },
  GROUP_DELETE: { resource: "groups", action: "delete" },
  // Branches
  BRANCH_VIEW: { resource: "branches", action: "view" },
  BRANCH_CREATE: { resource: "branches", action: "create" },
  BRANCH_UPDATE: { resource: "branches", action: "update" },
  BRANCH_DELETE: { resource: "branches", action: "delete" },
  // Common / Reference Data
  COMMON_VIEW: { resource: "common", action: "view" },
  COMMON_CREATE: { resource: "common", action: "create" },
  COMMON_UPDATE: { resource: "common", action: "update" },
  COMMON_DELETE: { resource: "common", action: "delete" },
  // Settings
  SETTINGS_VIEW: { resource: "settings", action: "view" },
  SETTINGS_UPDATE: { resource: "settings", action: "update" },
} as const;

// ═══════════════════════════════════════════════════════════════════════
// Permission checking helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if user has a specific permission
 */
export function hasPermission(
  user: User | null,
  resource: string,
  action: string,
): boolean {
  if (!user) return false;

  // Superusers have all permissions
  if (user.is_superuser) return true;

  // Check direct user permissions
  if (user.permissions) {
    for (const permission of user.permissions) {
      if (permission.resource === resource && permission.action === action) {
        return true;
      }
    }
  }

  // Check group permissions
  if (user.groups) {
    for (const group of user.groups) {
      for (const permission of group.permissions) {
        if (permission.resource === resource && permission.action === action) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(
  user: User | null,
  permissions: Array<{ resource: string; action: string }>,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  return permissions.some((perm) =>
    hasPermission(user, perm.resource, perm.action),
  );
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(
  user: User | null,
  permissions: Array<{ resource: string; action: string }>,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  return permissions.every((perm) =>
    hasPermission(user, perm.resource, perm.action),
  );
}

/**
 * Get user's permissions as a flat list
 */
export function getUserPermissions(user: User | null): string[] {
  if (!user) return [];
  if (user.is_superuser) return ["*:*"]; // Superuser has all permissions

  const permissions = new Set<string>();

  // Add direct permissions
  if (user.permissions) {
    user.permissions.forEach((perm) => {
      permissions.add(`${perm.resource}:${perm.action}`);
    });
  }

  // Add group permissions
  if (user.groups) {
    user.groups.forEach((group) => {
      group.permissions.forEach((perm) => {
        permissions.add(`${perm.resource}:${perm.action}`);
      });
    });
  }

  return Array.from(permissions);
}

// ═══════════════════════════════════════════════════════════════════════
// Module-level access control
// ═══════════════════════════════════════════════════════════════════════

/**
 * Module-to-permission mapping for route guards and sidebar visibility.
 * Maps each route prefix to the VIEW permission required to access it.
 */
export const MODULE_PERMISSIONS: Record<
  string,
  { resource: string; action: string }
> = {
  "/dashboard": PERMISSIONS.DASHBOARD_VIEW,
  "/sales": PERMISSIONS.SALES_DASHBOARD_VIEW,
  "/purchasing": PERMISSIONS.PURCHASING_DASHBOARD_VIEW,
  "/product-catalogs": PERMISSIONS.PRODUCTS_VIEW,
  "/finance": PERMISSIONS.FINANCE_DASHBOARD_VIEW,
  "/hr": PERMISSIONS.HR_DASHBOARD_VIEW,
  "/warehouse": PERMISSIONS.SALES_STOCK_VIEW,
  "/support": PERMISSIONS.SUPPORT_DASHBOARD_VIEW,
  "/reporting": PERMISSIONS.REPORTING_DASHBOARD_VIEW,
  "/branches": PERMISSIONS.BRANCH_VIEW,
  "/users": PERMISSIONS.USER_VIEW,
  "/roles": PERMISSIONS.GROUP_VIEW,
  "/settings": PERMISSIONS.SETTINGS_VIEW,
  "/company-settings": PERMISSIONS.SETTINGS_VIEW,
};

/**
 * Check if a user has access to a specific module by its path prefix.
 */
export function hasModuleAccess(
  user: User | null,
  modulePath: string,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  const perm = MODULE_PERMISSIONS[modulePath];
  if (!perm) return true; // No permission defined → public
  return hasPermission(user, perm.resource, perm.action);
}

/**
 * Check if user has access to ANY module at all.
 * Used to decide whether to show the dashboard.
 */
export function hasAnyModuleAccess(user: User | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  return Object.values(MODULE_PERMISSIONS).some((perm) =>
    hasPermission(user, perm.resource, perm.action),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// React hooks
// ═══════════════════════════════════════════════════════════════════════

/**
 * React hook to check if current user has a specific permission
 */
export function usePermission(resource: string, action: string): boolean {
  const user = useAuthStore((state) => state.user);
  return hasPermission(user, resource, action);
}

/**
 * React hook to check if the current user has access to ANY module.
 */
export function useHasAnyAccess(): boolean {
  const user = useAuthStore((state) => state.user);
  return hasAnyModuleAccess(user);
}

/**
 * React hook to check if the current user has access to a specific module path.
 */
export function useModuleAccess(modulePath: string): boolean {
  const user = useAuthStore((state) => state.user);
  return hasModuleAccess(user, modulePath);
}
