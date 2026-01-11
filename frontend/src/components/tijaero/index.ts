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
  TButton,
  TIconButton,
  TTextField,
  TSelect,
  TAutocomplete,
  TCheckbox,
  TSwitch,
  TDatePicker,
  TChip,
  TStatusChip,
  TPrintButton,
  getReportUrl,
  canPrintDocument,
  getPrintDisabledReason,
  getStatusProps,
  STATUS_MAPS,
  type TButtonProps,
  type TIconButtonProps,
  type TTextFieldProps,
  type TSelectProps,
  type TAutocompleteProps,
  type TCheckboxProps,
  type TSwitchProps,
  type TDatePickerProps,
  type TChipProps,
  type TStatusChipProps,
  type TPrintButtonProps,
  type TPrintDocumentType,
} from './base';

// =============================================================================
// DATA COMPONENTS - Data display and visualization
// =============================================================================
export {
  TDataGrid,
  TTable,
  TStatCard,
  TInfoCard,
  TDataCard,
  TList,
  TCurrency,
  TDate,
  TNumber,
  type TDataGridProps,
  type TTableProps,
  type TStatCardProps,
  type TInfoCardProps,
  type TDataCardProps,
  type TListProps,
  type TCurrencyProps,
  type TDateProps,
  type TNumberProps,
} from './data';

// =============================================================================
// FORM COMPONENTS - Form building and management
// =============================================================================
export {
  TFormField,
  TFormSection,
  TFormDialog,
  TFormActions,
  TLineItemsTable,
  TFilterBar,
  TFilterPanel,
  TBranchFilter,
  TSupplierFilter,
  TStatusFilter,
  PO_STATUS_FILTER_OPTIONS,
  RETURN_STATUS_FILTER_OPTIONS,
  GRN_STATUS_FILTER_OPTIONS,
  INVOICE_STATUS_FILTER_OPTIONS,
  SALES_STATUS_FILTER_OPTIONS,
  SERVICE_JOB_STATUS_FILTER_OPTIONS,
  useFormState,
  type TFormFieldProps,
  type TFormSectionProps,
  type TFormDialogProps,
  type TFormActionsProps,
  type TLineItemsTableProps,
  type TFilterBarProps,
  type TFilterConfig,
  type TLineItemColumn,
  type TFilterPanelProps,
  type TBranchFilterProps,
  type TSupplierFilterProps,
  type TStatusFilterProps,
  type TFilterBranch,
  type TFilterSupplier,
  type TFilterStatusOption,
} from './forms-extended';

// =============================================================================
// FEEDBACK COMPONENTS - User feedback and notifications
// =============================================================================
export {
  TAlert,
  TLoading,
  TLoadingSkeleton,
  TConfirmDialog,
  useTConfirmDialog,
  TEmptyState,
  TRemarkDialog,
  useRemarkDialog,
  showToast,
  showSuccessToast,
  showErrorToast,
  showInfoToast,
  showWarningToast,
  type TAlertProps,
  type TLoadingProps,
  type TLoadingSkeletonProps,
  type TConfirmDialogProps,
  type TEmptyStateProps,
  type TRemarkDialogProps,
  type UseRemarkDialogOptions,
  type UseRemarkDialogReturn,
} from './feedback-extended';

// =============================================================================
// NAVIGATION COMPONENTS - Navigation patterns
// =============================================================================
export {
  TTabs,
  TTabPanel,
  TBreadcrumbs,
  TContextMenu,
  useContextMenu,
  TDropdownMenu,
  TSteps,
  type TTabsProps,
  type TTabConfig,
  type TBreadcrumbsProps,
  type TBreadcrumbItem,
  type TContextMenuProps,
  type TDropdownMenuProps,
  type TStepsProps,
  type TStepConfig,
} from './navigation';

// =============================================================================
// LAYOUT COMPONENTS - Page and content layouts
// =============================================================================
export {
  TPageHeader,
  TPageLayout,
  TCardLayout,
  TGridLayout,
  TGridItem,
  TSidebar,
  TSplitPane,
  TSection,
  type TPageHeaderProps,
  type TPageLayoutProps,
  type TCardLayoutProps,
  type TGridLayoutProps,
  type TGridItemProps,
  type TSidebarProps,
  type TSidebarItem,
  type TSplitPaneProps,
  type TSectionProps,
} from './layout';

// =============================================================================
// STYLES - Reusable style utilities
// =============================================================================
export {
  modernTableStyles,
  modernTableContainerSx,
  modernTableHeaderCellSx,
  modernTableCellSx,
  currencyCellSx,
  numberCellSx,
  actionCellSx,
  getRowStyle,
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
// CONSTANTS - ERP Enums and Constants
// =============================================================================
export {
  // Person/Employee choices
  TITLE_CHOICES,
  GENDER_CHOICES,
  CIVIL_CHOICES,
  OCCUPATION_CHOICES,
  // Payment methods
  CUSTOMER_PAYMENT_METHOD,
  SUPPLIER_PAYMENT_METHOD,
  SALES_RETURN_PAYMENT_METHOD,
  PURCHASING_PAYMENT_METHOD,
  GENERIC_PAYMENT_METHOD,
  CARD_TYPE,
  // Expenses
  EXPENSES_METHOD,
  // Product/Inventory
  PRODUCT_ITEM_TYPE,
  // Service Job
  SERVICE_JOB_STATUS,
  SERVICE_JOB_FAULT_TYPE,
  // Helper functions
  getChoiceLabel,
  choicesToSelectOptions,
  choicesToAutocompleteOptions,
  // Types
  type TitleChoice,
  type GenderChoice,
  type CivilChoice,
  type OccupationChoice,
  type CustomerPaymentMethod,
  type SupplierPaymentMethod,
  type SalesReturnPaymentMethod,
  type PurchasingPaymentMethod,
  type GenericPaymentMethod,
  type CardType,
  type ExpensesMethod,
  type ProductItemType,
  type ServiceJobStatus,
  type ServiceJobFaultType,
} from "./constants";
