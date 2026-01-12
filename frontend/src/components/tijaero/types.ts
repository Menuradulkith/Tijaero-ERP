/**
 * Tijaero-Style Reusable Component Types
 * These types define the configuration options for all Tijaero-style components
 */

import { SxProps, Theme } from "@mui/material";
import { ReactNode } from "react";

// =============================================================================
// Common Types
// =============================================================================

export interface BaseEntity {
  id: number;
}

export type ChipColor = "default" | "primary" | "secondary" | "success" | "error" | "warning" | "info";
export type ChipVariant = "filled" | "outlined";

export interface ChipConfig {
  label: string;
  color?: ChipColor;
  variant?: ChipVariant;
  size?: "small" | "medium";
}

// =============================================================================
// Master Detail Layout Types
// =============================================================================

export interface TabConfig {
  id?: string;
  label: string;
  icon?: ReactNode;
}

export interface MasterDetailLayoutProps {
  /** Page title shown in header */
  title: string;
  /** Optional icon for the title */
  icon?: ReactNode;
  /** Refresh callback */
  onRefresh?: () => void;
  /** Page children (for simple usage without masterPanel/detailPanel) */
  children?: ReactNode;
  /** Master list panel content */
  masterPanel?: ReactNode;
  /** Detail panel content */
  detailPanel?: ReactNode;
  /** Optional tabs configuration */
  tabs?: TabConfig[];
  /** Current active tab (can be index or id) */
  activeTab?: string | number;
  /** Tab change callback */
  onTabChange?: (tab: string | number) => void;
  /** Custom header actions */
  headerActions?: ReactNode;
  /** Loading state */
  isLoading?: boolean;
}

// =============================================================================
// Searchable List Types
// =============================================================================

export interface SortOption {
  value: string;
  label: string;
}

export interface SearchableListProps<T extends BaseEntity> {
  /** Items to display (optional, can use children instead) */
  items?: T[];
  /** Children elements (for direct rendering of SelectableListItems) */
  children?: ReactNode;
  /** Loading state */
  isLoading?: boolean;
  /** Search query value (controlled) */
  searchValue?: string;
  /** Legacy: Search query value */
  searchQuery?: string;
  /** Search change callback */
  onSearchChange: (query: string) => void;
  /** Placeholder text for search */
  placeholder?: string;
  /** Alias for placeholder */
  searchPlaceholder?: string;
  /** Sort options */
  sortOptions?: SortOption[];
  /** Current sort field */
  sortField?: string;
  /** Alias for sortField */
  currentSort?: string;
  /** Sort change callback */
  onSortChange?: (field: string) => void;
  /** Currently selected item */
  selectedItem?: T | null;
  /** Item selection callback */
  onSelectItem?: (item: T) => void;
  /** Render function for list items (when using items prop) */
  renderItem?: (item: T, isSelected: boolean) => ReactNode;
  /** Message when list is empty */
  emptyMessage?: string;
  /** Width of the panel (default: 280) */
  width?: number;
  /** Favorite item ids */
  favorites?: number[];
  /** Favorite toggle callback */
  onToggleFavorite?: (id: number, e: React.MouseEvent) => void;
  /** Custom list header */
  listHeader?: ReactNode;
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// Selectable List Item Types
// =============================================================================

export interface SelectableListItemProps {
  /** Unique identifier (optional for direct usage) */
  id?: number;
  /** Whether the item is selected */
  isSelected: boolean;
  /** Click callback */
  onClick: () => void;
  /** Primary text content */
  primaryText: ReactNode;
  /** Secondary text content */
  secondaryText?: ReactNode;
  /** Whether the item is favorited */
  isFavorite?: boolean;
  /** Favorite toggle callback */
  onToggleFavorite?: (e?: React.MouseEvent) => void;
  /** Status chip configuration */
  statusChip?: ChipConfig;
  /** Additional chips */
  chips?: ChipConfig[];
  /** Custom end action */
  endAction?: ReactNode;
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// Detail Panel Header Types
// =============================================================================

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: ReactNode;
}

export interface DetailPanelHeaderProps {
  /** Breadcrumb items */
  breadcrumbs: BreadcrumbItem[];
  /** Main title */
  title: string;
  /** Title icon */
  titleIcon?: ReactNode;
  /** Alias for titleIcon */
  icon?: ReactNode;
  /** Subtitle */
  subtitle?: string;
  /** Creating new mode */
  isCreating?: boolean;
  /** Create mode title */
  createTitle?: string;
  /** No selection title */
  noSelectionTitle?: string;
  /** Status chips */
  chips?: ChipConfig[];
  /** Whether item is favorite */
  isFavorite?: boolean;
  /** Favorite toggle callback */
  onToggleFavorite?: (e: React.MouseEvent) => void;
  /** Custom header actions */
  actions?: ReactNode;
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// Action Toolbar Types
// =============================================================================

export interface ActionToolbarProps {
  /** Can create new items */
  canCreate?: boolean;
  /** Can update items */
  canUpdate?: boolean;
  /** Can delete items */
  canDelete?: boolean;
  /** Can duplicate items */
  canDuplicate?: boolean;
  /** Has selected item */
  hasSelectedItem?: boolean;
  /** Alias for hasSelectedItem */
  hasSelection?: boolean;
  /** Creating new mode */
  isCreating: boolean;
  /** Editing mode */
  isEditing: boolean;
  /** Save in progress */
  isSaving?: boolean;
  /** Form is valid */
  isFormValid?: boolean;
  /** Save button disabled */
  saveDisabled?: boolean;
  /** New item callback */
  onNew?: () => void;
  /** Alias for onNew */
  onAdd?: () => void;
  /** Duplicate callback */
  onDuplicate?: () => void;
  /** Delete callback */
  onDelete?: () => void;
  /** Save callback */
  onSave?: () => void;
  /** Cancel callback */
  onCancel?: () => void;
  /** Edit callback */
  onEdit?: () => void;
  /** Custom actions before default buttons */
  startActions?: ReactNode;
  /** Custom actions after default buttons */
  endActions?: ReactNode;
  /** Alias for endActions */
  customActions?: ReactNode;
  /** Show divider between action groups */
  showDivider?: boolean;
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// Form Section Types
// =============================================================================

export interface FormSectionProps {
  /** Section title */
  title: string;
  /** Number of columns (default: 2) */
  columns?: 1 | 2 | 3 | 4;
  /** Section content (form fields) */
  children: ReactNode;
  /** Collapsible section */
  collapsible?: boolean;
  /** Initially collapsed (only if collapsible) */
  defaultCollapsed?: boolean;
  /** Section icon */
  icon?: ReactNode;
  /** Is last section (no margin bottom) */
  isLast?: boolean;
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// Empty State Types
// =============================================================================

export interface EmptyStateProps {
  /** Message to display */
  message: string;
  /** Icon to show */
  icon?: ReactNode;
  /** Action button config */
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
  };
  /** Custom styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// Hook Types
// =============================================================================

export interface UseMasterDetailStateOptions<T extends BaseEntity, TCreate> {
  /** Initial form data for create mode */
  initialFormData: TCreate;
  /** Function to reset form data from selected item */
  resetFormFromItem?: (item: T) => TCreate;
  /** Storage key for favorites (localStorage) */
  favoritesKey?: string;
  /** Default sort field */
  defaultSortField?: string;
  /** Alias for defaultSortField */
  initialSortField?: string;
  /** Optional async function to confirm discarding unsaved changes (replaces window.confirm) */
  confirmUnsavedChanges?: () => Promise<boolean>;
}

export interface UseMasterDetailStateReturn<T extends BaseEntity, TCreate> {
  // Search & Sort
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortField: string;
  setSortField: (field: string) => void;
  sortAnchorEl: HTMLElement | null;
  setSortAnchorEl: (el: HTMLElement | null) => void;
  
  // Selection
  selectedItem: T | null;
  setSelectedItem: (item: T | null) => void;
  
  // Edit state
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  isCreating: boolean;
  setIsCreating: (creating: boolean) => void;
  readonly hasChanges: boolean;
  
  // Favorites
  favorites: number[];
  toggleFavorite: (id: number, e?: React.MouseEvent) => void;
  
  // Form
  formData: TCreate;
  setFormData: React.Dispatch<React.SetStateAction<TCreate>>;
  updateFormField: <K extends keyof TCreate>(field: K, value: TCreate[K]) => void;
  markAsSaved: () => void;
  
  // Handlers
  /** Select an item - returns true if selection succeeded, false if user cancelled */
  handleSelectItem: (item: T) => Promise<boolean>;
  /** Create new item - returns true if succeeded, false if user cancelled */
  handleNew: () => Promise<boolean>;
  handleCancel: (filteredItems: T[]) => void;
  handleStartEdit: () => void;
  resetToItem: (item: T) => void;
}
