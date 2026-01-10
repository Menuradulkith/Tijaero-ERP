/**
 * API Related Types
 */

import type { ID } from './common';

// API Response wrapper
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

// Paginated response from API
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

// Pagination parameters for requests
export interface PaginationParams {
  page?: number;
  size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

// Search/Filter parameters
export interface SearchParams extends PaginationParams {
  search?: string;
  filters?: Record<string, unknown>;
}

// API Error response
export interface ApiError {
  detail: string | ApiErrorDetail[];
  status_code?: number;
}

export interface ApiErrorDetail {
  loc: (string | number)[];
  msg: string;
  type: string;
}

// HTTP Methods
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Request configuration
export interface RequestConfig {
  method?: HttpMethod;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
}

// Auth token response
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

// User session
export interface UserSession {
  user: AuthUser;
  token: string;
  expires_at: string;
}

// Authenticated user
export interface AuthUser {
  id: ID;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  permissions: string[];
  groups: string[];
  branch_id?: ID;
}

// Permission
export interface Permission {
  id: ID;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

// Group/Role
export interface Group {
  id: ID;
  name: string;
  description?: string;
  permissions: Permission[];
}

// Branch
export interface Branch {
  id: ID;
  branch_name: string;
  branch_code: string;
  address?: string;
  email?: string;
  contact_number?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Bulk action response
export interface BulkActionResponse {
  success: ID[];
  failed: { id: ID; error: string }[];
  total: number;
}

// Export options
export interface ExportOptions {
  format: 'csv' | 'xlsx' | 'pdf';
  columns?: string[];
  filters?: Record<string, unknown>;
  filename?: string;
}

// Import result
export interface ImportResult {
  total_rows: number;
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

// Webhook payload
export interface WebhookPayload<T = unknown> {
  event: string;
  timestamp: string;
  data: T;
}
