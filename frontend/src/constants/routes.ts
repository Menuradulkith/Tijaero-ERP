/**
 * Route Constants for TijaeroERP Frontend
 * Centralized route paths for navigation
 */

// Base Routes
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  
  // Auth Routes
  AUTH: {
    LOGIN: '/login',
    LOGOUT: '/logout',
    FORGOT_PASSWORD: '/forgot-password',
    RESET_PASSWORD: '/reset-password',
  },
  
  // User Management
  USERS: {
    LIST: '/users',
    CREATE: '/users/new',
    EDIT: (id: string | number = ':id') => `/users/${id}/edit`,
    VIEW: (id: string | number = ':id') => `/users/${id}`,
  },
  
  // Groups/Roles
  GROUPS: {
    LIST: '/groups',
    CREATE: '/groups/new',
    EDIT: (id: string | number = ':id') => `/groups/${id}/edit`,
    VIEW: (id: string | number = ':id') => `/groups/${id}`,
  },
  
  // Branches
  BRANCHES: {
    LIST: '/branches',
    CREATE: '/branches/new',
    EDIT: (id: string | number = ':id') => `/branches/${id}/edit`,
    VIEW: (id: string | number = ':id') => `/branches/${id}`,
  },
  
  // Sales Module
  SALES: {
    DASHBOARD: '/sales',
    INVOICES: '/sales/invoices',
    INVOICE_CREATE: '/sales/invoices/new',
    INVOICE_VIEW: (id: string | number = ':id') => `/sales/invoices/${id}`,
    INVOICE_EDIT: (id: string | number = ':id') => `/sales/invoices/${id}/edit`,
    RETURNS: '/sales/returns',
    CUSTOMERS: '/sales/customers',
  },
  
  // Purchasing Module
  PURCHASING: {
    DASHBOARD: '/purchasing',
    ORDERS: '/purchasing/orders',
    ORDER_CREATE: '/purchasing/orders/new',
    ORDER_VIEW: (id: string | number = ':id') => `/purchasing/orders/${id}`,
    GRN: '/purchasing/grn',
    SUPPLIERS: '/purchasing/suppliers',
    RETURNS: '/purchasing/returns',
  },
  
  // Inventory Module
  INVENTORY: {
    DASHBOARD: '/inventory',
    PRODUCTS: '/inventory/products',
    PRODUCT_CREATE: '/inventory/products/new',
    PRODUCT_VIEW: (id: string | number = ':id') => `/inventory/products/${id}`,
    STOCK: '/inventory/stock',
    CATEGORIES: '/inventory/categories',
  },
  
  // Warehouse Module
  WAREHOUSE: {
    DASHBOARD: '/warehouse',
    TRANSFERS: '/warehouse/transfers',
    TRANSFER_CREATE: '/warehouse/transfers/new',
    TRANSFER_VIEW: (id: string | number = ':id') => `/warehouse/transfers/${id}`,
  },
  
  // Finance Module
  FINANCE: {
    DASHBOARD: '/finance',
    EXPENSES: '/finance/expenses',
    VOUCHERS: '/finance/vouchers',
    PAYMENTS: '/finance/payments',
    LEDGER: '/finance/ledger',
  },
  
  // HR Module
  HR: {
    DASHBOARD: '/hr',
    EMPLOYEES: '/hr/employees',
    EMPLOYEE_CREATE: '/hr/employees/new',
    EMPLOYEE_VIEW: (id: string | number = ':id') => `/hr/employees/${id}`,
    ATTENDANCE: '/hr/attendance',
    LEAVES: '/hr/leaves',
    PAYROLL: '/hr/payroll',
    PAYROLL_PROCESSING: '/hr/payroll-processing',
    SALARY_PROFILES: '/hr/salary-profiles',
    DEDUCTIONS: '/hr/deductions',
    REIMBURSEMENTS: '/hr/reimbursements',
    PROMOTIONS: '/hr/promotions',
    ASSETS: '/hr/assets',
  },
  
  // Reporting
  REPORTING: {
    DASHBOARD: '/reporting',
    SALES_REPORTS: '/reporting/sales',
    INVENTORY_REPORTS: '/reporting/inventory',
    FINANCE_REPORTS: '/reporting/finance',
    HR_REPORTS: '/reporting/hr',
  },
  
  // Settings
  SETTINGS: {
    GENERAL: '/settings',
    PROFILE: '/settings/profile',
    PERMISSIONS: '/settings/permissions',
    SYSTEM: '/settings/system',
  },
  
  // Support
  SUPPORT: {
    TICKETS: '/support/tickets',
    WARRANTY: '/support/warranty',
  },
} as const;

// API Endpoints (relative to base URL)
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/api/v1/auth/login',
    LOGOUT: '/api/v1/auth/logout',
    ME: '/api/v1/auth/me',
    REFRESH: '/api/v1/auth/refresh',
  },
  USERS: '/api/v1/users',
  GROUPS: '/api/v1/groups',
  BRANCHES: '/api/v1/branches',
  PERMISSIONS: '/api/v1/permissions',
  CUSTOMERS: '/api/v1/customers',
  PRODUCTS: '/api/v1/products',
  INVOICES: '/api/v1/sales/invoices',
  PURCHASE_ORDERS: '/api/v1/purchasing/orders',
  SUPPLIERS: '/api/v1/suppliers',
  EMPLOYEES: '/api/v1/employees',
  REPORTING: '/api/v1/reporting',
} as const;
