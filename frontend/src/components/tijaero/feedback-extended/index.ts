/**
 * Feedback Components
 * 
 * Components for providing user feedback including alerts, loading states,
 * toasts, and confirmation dialogs.
 */

export { TAlert, type TAlertProps } from "./TAlert";
export { TLoading, type TLoadingProps } from "./TLoading";
export { TLoadingSkeleton, type TLoadingSkeletonProps } from "./TLoadingSkeleton";
export { TConfirmDialog, useConfirmDialog, type TConfirmDialogProps, type UseConfirmDialogReturn } from "./TConfirmDialog";
// Alias for useTConfirmDialog
export { useConfirmDialog as useTConfirmDialog } from "./TConfirmDialog";
export { TEmptyState, type TEmptyStateProps } from "./TEmptyState";
export { 
  showToast, 
  useToast, 
  showSuccessToast, 
  showErrorToast, 
  showInfoToast, 
  showWarningToast,
  type ToastOptions 
} from "./toast";
export {
  TRemarkDialog,
  useRemarkDialog,
  type TRemarkDialogProps,
  type UseRemarkDialogOptions,
  type UseRemarkDialogReturn,
} from "./TRemarkDialog";
