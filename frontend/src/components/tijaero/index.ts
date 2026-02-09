/**
 * Tijaero ERP Component Library
 * 
 * A comprehensive, reusable UI component library for building consistent
 * enterprise-grade interfaces across the entire ERP application.
 * 
 * The library is organized into the following categories:
 * 
 * - **Base Components**: Core UI building blocks (buttons, inputs, selects, etc.)
 * - **Data Components**: Data display components (tables, grids, cards, stats)
 * - **Form Components**: Form building with react-hook-form integration
 * - **Feedback Components**: User feedback (alerts, loading, dialogs, toasts)
 * - **Navigation Components**: Navigation patterns (tabs, breadcrumbs, menus)
 * - **Layout Components**: Page and section layouts
 * - **Master-Detail Components**: Pre-built master-detail patterns
 * 
 * Usage Example:
 * ```tsx
 * import {
 *   // Base
 *   TButton, TTextField, TSelect, TStatusChip,
 *   // Data
 *   TDataGrid, TStatCard, TTable,
 *   // Forms
 *   TFormField, TFormDialog, TLineItemsTable,
 *   // Feedback
 *   TConfirmDialog, TLoading, showToast,
 *   // Navigation
 *   TTabs, TBreadcrumbs, TSteps,
 *   // Layout
 *   TPageHeader, TPageLayout, TSection,
 *   // Master-Detail
 *   MasterDetailLayout, useMasterDetailState,
 * } from "@/components/tijaero";
 * ```
 */

// =============================================================================
// BASE COMPONENTS - Core UI building blocks
// =============================================================================
export {
  STATUS_MAPS, TAutocomplete, TButton, TCheckbox, TChip, TDatePicker, TIconButton, TPrintButton, TSelect, TStatusChip, TSwitch, TTextField, canPrintDocument,
  getPrintDisabledReason, getReportUrl, getStatusProps, type TAutocompleteProps, type TButtonProps, type TCheckboxProps, type TChipProps, type TDatePickerProps, type TIconButtonProps, type TPrintButtonProps,
  type TPrintDocumentType, type TSelectProps, type TStatusChipProps, type TSwitchProps, type TTextFieldProps
} from './base';

// =============================================================================
// DATA COMPONENTS - Data display and visualization
// =============================================================================
export {
  TCurrency, TDataCard, TDataGrid, TDate, TInfoCard, TList, TNumber, TStatCard, TTable, formatCurrency, fmtLKR, type TCurrencyProps, type TDataCardProps, type TDataGridColumn, type TDataGridProps, type TDateProps, type TInfoCardProps, type TListProps, type TNumberProps, type TStatCardProps, type TTableProps
} from './data';

// Pagination Controls for load-balanced lists
export { TPaginationControls, type TPaginationControlsProps } from './data-display-extended/TPaginationControls';

// =============================================================================
// FORM COMPONENTS - Form building and management
// =============================================================================
export {
  GRN_STATUS_FILTER_OPTIONS,
  INVOICE_STATUS_FILTER_OPTIONS, PO_STATUS_FILTER_OPTIONS,
  RETURN_STATUS_FILTER_OPTIONS, SALES_STATUS_FILTER_OPTIONS,
  SERVICE_JOB_STATUS_FILTER_OPTIONS, TBranchFilter, TFilterBar,
  TFilterPanel, TFormActions, TFormDialog, TFormField,
  TFormSection, TLineItemsTable, TStatusFilter, TSupplierFilter, useFormState, type TBranchFilterProps, type TFilterBarProps, type TFilterBranch, type TFilterConfig, type TFilterPanelProps, type TFilterStatusOption, type TFilterSupplier, type TFormActionsProps, type TFormDialogProps, type TFormFieldProps,
  type TFormSectionProps, type TLineItemColumn, type TLineItemsTableProps, type TStatusFilterProps, type TSupplierFilterProps
} from './forms-extended';

// =============================================================================
// FEEDBACK COMPONENTS - User feedback and notifications
// =============================================================================
export {
  TAlert, TConfirmDialog, TEmptyState, TLoading,
  TLoadingSkeleton, TPrintPreviewDialog, TRemarkDialog, showErrorToast,
  showInfoToast, showSuccessToast, showToast, showWarningToast, useTConfirmDialog as useConfirmDialog, useRemarkDialog, useTConfirmDialog, type TAlertProps, type TConfirmDialogProps,
  type TEmptyStateProps, type TLoadingProps,
  type TLoadingSkeletonProps, type TPrintPreviewDialogProps, type TRemarkDialogProps,
  type UseRemarkDialogOptions,
  type UseRemarkDialogReturn
} from './feedback-extended';

// =============================================================================
// NAVIGATION COMPONENTS - Navigation patterns
// =============================================================================
export {
  TBreadcrumbs,
  TContextMenu, TDropdownMenu,
  TSteps, TTabPanel, TTabs, useContextMenu, type TBreadcrumbItem, type TBreadcrumbsProps, type TContextMenuProps,
  type TDropdownMenuProps, type TStepConfig, type TStepsProps, type TTabConfig, type TTabsProps
} from './navigation';

// =============================================================================
// LAYOUT COMPONENTS - Page and content layouts
// =============================================================================
export {
  TCardLayout, TGridItem, TGridLayout, TPageHeader,
  TPageLayout, TSection, TSidebar,
  TSplitPane, type TCardLayoutProps, type TGridItemProps, type TGridLayoutProps, type TPageHeaderProps,
  type TPageLayoutProps, type TSectionProps, type TSidebarItem, type TSidebarProps, type TSplitPaneProps
} from './layout';

// =============================================================================
// STYLES - Reusable style utilities
// =============================================================================
export {
  actionCellSx, currencyCellSx, getRowStyle, modernTableCellSx, modernTableContainerSx,
  modernTableHeaderCellSx, modernTableStyles, numberCellSx
} from './styles';

// =============================================================================
// MASTER-DETAIL COMPONENTS - Pre-built master-detail patterns (legacy)
// =============================================================================

// Types
export * from "./types";

// Hooks
export { useMasterDetailState } from "./hooks";

// Layouts
export { MasterDetailLayout } from "./layouts";

// Lists
export { SearchableList, SelectableListItem } from "./lists";

// Panels
export { DetailPanelHeader } from "./panels";

// Toolbars
export { ActionToolbar } from "./toolbars";

// Forms (legacy - use TFormSection for new code)
export { FormSection } from "./forms";

// Feedback (legacy - use TEmptyState for new code)
export { EmptyState } from "./feedback";

// =============================================================================
// ERROR HANDLING - Centralized API error utilities
// =============================================================================
export { handleApiError, extractFieldErrors } from "../../utils/errorHandling";

// =============================================================================
// CONSTANTS - ERP Enums and Constants
// =============================================================================
export {
  CARD_TYPE, CIVIL_CHOICES,
  // Payment methods
  CUSTOMER_PAYMENT_METHOD,
  // Expenses
  EXPENSES_METHOD, GENDER_CHOICES, GENERIC_PAYMENT_METHOD, OCCUPATION_CHOICES,
  // Product/Inventory
  PRODUCT_ITEM_TYPE, PURCHASING_PAYMENT_METHOD, SALES_RETURN_PAYMENT_METHOD, SERVICE_JOB_FAULT_TYPE,
  // Service Job
  SERVICE_JOB_STATUS, SUPPLIER_PAYMENT_METHOD,
  // Person/Employee choices
  TITLE_CHOICES, choicesToAutocompleteOptions, choicesToSelectOptions,
  // Helper functions
  getChoiceLabel, type CardType, type CivilChoice, type CustomerPaymentMethod, type ExpensesMethod, type GenderChoice, type GenericPaymentMethod, type OccupationChoice, type ProductItemType, type PurchasingPaymentMethod, type SalesReturnPaymentMethod, type ServiceJobFaultType, type ServiceJobStatus, type SupplierPaymentMethod,
  // Types
  type TitleChoice
} from "./constants";

