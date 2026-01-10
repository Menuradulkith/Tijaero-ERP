/**
 * Common Shared Types
 */

// Generic ID type
export type ID = string | number;

// Nullable type helper
export type Nullable<T> = T | null;

// Optional type helper
export type Optional<T> = T | undefined;

// Deep partial type
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Record with string keys
export type StringRecord<T> = Record<string, T>;

// Timestamp fields common to most entities
export interface TimestampFields {
  created_at: string;
  updated_at: string;
}

// Audit fields for entities
export interface AuditFields extends TimestampFields {
  created_by?: ID;
  updated_by?: ID;
}

// Base entity with ID
export interface BaseEntity {
  id: ID;
}

// Entity with timestamps
export interface TimestampedEntity extends BaseEntity, TimestampFields {}

// Entity with audit trail
export interface AuditedEntity extends BaseEntity, AuditFields {}

// Status badge variant
export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

// Sort direction
export type SortDirection = 'asc' | 'desc';

// Sort configuration
export interface SortConfig {
  field: string;
  direction: SortDirection;
}

// Filter operator
export type FilterOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'starts_with' 
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'in'
  | 'not_in';

// Filter configuration
export interface FilterConfig {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

// Date range
export interface DateRange {
  start: Date | string;
  end: Date | string;
}

// Money/Currency
export interface Money {
  amount: number;
  currency: string;
}

// Address type
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
}

// Contact information
export interface ContactInfo {
  email?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
}

// File/Attachment type
export interface FileAttachment {
  id: ID;
  name: string;
  url: string;
  size: number;
  type: string;
  uploaded_at: string;
}

// Select option for dropdowns
export interface SelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

// Grouped select options
export interface GroupedSelectOptions<T = string> {
  label: string;
  options: SelectOption<T>[];
}

// Breadcrumb item
export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

// Tab item
export interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  badge?: string | number;
}

// Menu item
export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: MenuItem[];
}

// Notification type
export interface Notification {
  id: ID;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  read: boolean;
  created_at: string;
  action_url?: string;
}
