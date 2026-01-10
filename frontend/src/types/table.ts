/**
 * Table/DataGrid Related Types
 */

import type { ReactNode } from 'react';
import type { FilterOperator, ID, SortDirection } from './common';

// Column definition
export interface ColumnDef<T = unknown> {
  id: string;
  header: string | ReactNode;
  accessor: keyof T | ((row: T) => unknown);
  cell?: (value: unknown, row: T) => ReactNode;
  width?: number | string;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  filterable?: boolean;
  hidden?: boolean;
  align?: 'left' | 'center' | 'right';
  sticky?: 'left' | 'right';
  className?: string;
  headerClassName?: string;
}

// Sort state
export interface SortState {
  column: string;
  direction: SortDirection;
}

// Filter state
export interface FilterState {
  column: string;
  value: unknown;
  operator: FilterOperator;
}

// Re-export FilterOperator for convenience
export type { FilterOperator };

// Pagination state
export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

// Row selection state
export interface RowSelectionState {
  selectedIds: Set<ID>;
  isAllSelected: boolean;
  isPartiallySelected: boolean;
}

// Table state
export interface TableState<T = unknown> {
  data: T[];
  columns: ColumnDef<T>[];
  sorting: SortState | null;
  filters: FilterState[];
  pagination: PaginationState;
  selection: RowSelectionState;
  loading: boolean;
  error: string | null;
}

// Table props
export interface TableProps<T = unknown> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  error?: string;
  // Sorting
  sortable?: boolean;
  defaultSort?: SortState;
  onSort?: (sort: SortState | null) => void;
  // Pagination
  pagination?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  totalItems?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  // Selection
  selectable?: boolean;
  selectedRows?: ID[];
  onSelectionChange?: (ids: ID[]) => void;
  // Actions
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  // Appearance
  striped?: boolean;
  bordered?: boolean;
  hoverable?: boolean;
  compact?: boolean;
  stickyHeader?: boolean;
  emptyMessage?: string | ReactNode;
  className?: string;
}

// Row action
export interface RowAction<T = unknown> {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: (row: T) => void;
  disabled?: boolean | ((row: T) => boolean);
  hidden?: boolean | ((row: T) => boolean);
  variant?: 'default' | 'primary' | 'danger';
}

// Bulk action
export interface BulkAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: (ids: ID[]) => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  confirmMessage?: string;
}

// Export column config
export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
  formatter?: (value: unknown) => string;
}

// Table export options
export interface TableExportOptions {
  format: 'csv' | 'xlsx' | 'pdf';
  columns?: ExportColumn[];
  filename?: string;
  includeHeaders?: boolean;
}
