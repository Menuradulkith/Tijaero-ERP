/**
 * Application Configuration Constants
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  API_VERSION: 'v1',
  TIMEOUT: 30000, // 30 seconds
} as const;

// Pagination Defaults
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 100,
} as const;

// Date Formats
export const DATE_FORMATS = {
  DATE: 'YYYY-MM-DD',
  DATETIME: 'YYYY-MM-DD HH:mm:ss',
  DATE_DISPLAY: 'DD MMM YYYY',
  DATETIME_DISPLAY: 'DD MMM YYYY HH:mm',
  TIME: 'HH:mm',
  TIME_WITH_SECONDS: 'HH:mm:ss',
} as const;

// File Upload Configuration
export const FILE_UPLOAD = {
  MAX_SIZE_MB: 10,
  MAX_SIZE_BYTES: 10 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf', '.doc', '.docx', '.xls', '.xlsx'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'],
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  DEFAULT_TTL_MS: 5 * 60 * 1000, // 5 minutes
  SHORT_TTL_MS: 60 * 1000, // 1 minute
  LONG_TTL_MS: 60 * 60 * 1000, // 1 hour
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_DATA: 'user_data',
  THEME: 'theme',
  LANGUAGE: 'language',
  SIDEBAR_COLLAPSED: 'sidebar_collapsed',
} as const;

// Debounce/Throttle Delays
export const DELAYS = {
  SEARCH_DEBOUNCE: 300,
  RESIZE_DEBOUNCE: 150,
  SCROLL_THROTTLE: 100,
  AUTO_SAVE: 2000,
} as const;

// Chart Colors
export const CHART_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
] as const;

// Document Prefixes (for display)
export const DOCUMENT_PREFIXES = {
  INVOICE: 'INV',
  PURCHASE_ORDER: 'PO',
  SALE_RETURN: 'SR',
  PURCHASE_RETURN: 'PR',
  GRN: 'GRN',
  TRANSFER_NOTE: 'TN',
  EXPENSE: 'EXP',
} as const;

// Table Configuration
export const TABLE_CONFIG = {
  ROW_HEIGHT: 52,
  HEADER_HEIGHT: 56,
  MIN_COLUMN_WIDTH: 100,
  DEFAULT_COLUMN_WIDTH: 150,
} as const;

// Animation Durations
export const ANIMATIONS = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,
} as const;

// Breakpoints (matching Tailwind defaults)
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const;
