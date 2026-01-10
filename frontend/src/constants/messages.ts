/**
 * Centralized Messages for TijaeroERP Frontend
 * Success, error, and validation messages
 */

// Success Messages
export const SUCCESS_MESSAGES = {
  // Generic CRUD
  CREATE: (entity: string) => `${entity} created successfully`,
  UPDATE: (entity: string) => `${entity} updated successfully`,
  DELETE: (entity: string) => `${entity} deleted successfully`,
  SAVE: 'Changes saved successfully',
  
  // Auth
  LOGIN: 'Login successful',
  LOGOUT: 'Logged out successfully',
  PASSWORD_CHANGED: 'Password changed successfully',
  PASSWORD_RESET_SENT: 'Password reset email sent',
  
  // Sales
  INVOICE_CREATED: 'Invoice created successfully',
  INVOICE_SENT: 'Invoice sent to customer',
  PAYMENT_RECORDED: 'Payment recorded successfully',
  
  // Purchasing
  PO_CREATED: 'Purchase order created successfully',
  PO_APPROVED: 'Purchase order approved',
  GRN_CREATED: 'Goods received note created',
  
  // Inventory
  STOCK_UPDATED: 'Stock updated successfully',
  TRANSFER_INITIATED: 'Item transfer initiated',
  
  // General
  COPIED: 'Copied to clipboard',
  EXPORTED: 'Export completed',
  IMPORTED: 'Import completed',
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  // Generic
  GENERIC: 'Something went wrong. Please try again.',
  NETWORK: 'Network error. Please check your connection.',
  NOT_FOUND: (entity: string) => `${entity} not found`,
  ALREADY_EXISTS: (entity: string) => `${entity} already exists`,
  PERMISSION_DENIED: 'You do not have permission to perform this action',
  
  // Auth
  INVALID_CREDENTIALS: 'Invalid username or password',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  UNAUTHORIZED: 'Please log in to continue',
  
  // Validation
  REQUIRED: (field: string) => `${field} is required`,
  INVALID_EMAIL: 'Please enter a valid email address',
  INVALID_PHONE: 'Please enter a valid phone number',
  MIN_LENGTH: (field: string, min: number) => `${field} must be at least ${min} characters`,
  MAX_LENGTH: (field: string, max: number) => `${field} must not exceed ${max} characters`,
  
  // Business Logic
  INSUFFICIENT_STOCK: 'Insufficient stock available',
  INVALID_QUANTITY: 'Please enter a valid quantity',
  INVALID_AMOUNT: 'Please enter a valid amount',
  
  // File Upload
  FILE_TOO_LARGE: 'File size exceeds the maximum allowed size',
  INVALID_FILE_TYPE: 'Invalid file type',
  UPLOAD_FAILED: 'File upload failed',
} as const;

// Confirmation Messages
export const CONFIRM_MESSAGES = {
  DELETE: (entity: string) => `Are you sure you want to delete this ${entity}? This action cannot be undone.`,
  CANCEL: 'Are you sure you want to cancel? Any unsaved changes will be lost.',
  LOGOUT: 'Are you sure you want to log out?',
  APPROVE: (entity: string) => `Are you sure you want to approve this ${entity}?`,
  REJECT: (entity: string) => `Are you sure you want to reject this ${entity}?`,
  SUBMIT: (entity: string) => `Are you sure you want to submit this ${entity}?`,
} as const;

// Loading Messages
export const LOADING_MESSAGES = {
  DEFAULT: 'Loading...',
  SAVING: 'Saving...',
  DELETING: 'Deleting...',
  PROCESSING: 'Processing...',
  UPLOADING: 'Uploading...',
  EXPORTING: 'Exporting...',
} as const;

// Empty State Messages
export const EMPTY_MESSAGES = {
  NO_DATA: 'No data available',
  NO_RESULTS: 'No results found',
  NO_ITEMS: (entity: string) => `No ${entity} found`,
  TRY_DIFFERENT_SEARCH: 'Try adjusting your search or filters',
} as const;
