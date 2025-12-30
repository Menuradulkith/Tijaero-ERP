// Auth types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface Group {
  id: number;
  name: string;
  permissions: Permission[];
}

export interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  first_name: string;
  last_name: string;
  middle_name?: string;
  groups: Group[];
  permissions?: Permission[];
}

// Branch types
export interface Branch {
  id: number;
  branch_name: string;
  branch_code: string;
  address?: string;
  email?: string;
  contact_number?: string;
  created_at: string;
  updated_at: string;
}

export interface BranchCreate {
  branch_name: string;
  branch_code: string;
  address?: string;
  email?: string;
  contact_number?: string;
}

export interface BranchUpdate {
  branch_name?: string;
  address?: string;
  email?: string;
  contact_number?: string;
}

// Pagination
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}
