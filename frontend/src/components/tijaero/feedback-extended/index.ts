/**
 * Feedback Components
 * 
 * Components for providing user feedback including alerts, loading states,
 * toasts, and confirmation dialogs.
 */

export { TAlert, type TAlertProps } from "./TAlert";
export { TConfirmDialog, useConfirmDialog, type TConfirmDialogProps, type UseConfirmDialogReturn } from "./TConfirmDialog";
export { TLoading, type TLoadingProps } from "./TLoading";
export { TDetailSkeleton, type TDetailSkeletonProps } from "./TDetailSkeleton";
export { TLoadingSkeleton, type TLoadingSkeletonProps } from "./TLoadingSkeleton";
export { TPageSkeleton, type TPageSkeletonProps, type TPageSkeletonVariant } from "./TPageSkeleton";
// Alias for useTConfirmDialog
export { useConfirmDialog as useTConfirmDialog } from "./TConfirmDialog";
export { TEmptyState, type TEmptyStateProps } from "./TEmptyState";
export {
  showErrorToast,
  showInfoToast, showSuccessToast, showToast, showWarningToast, useToast, type ToastOptions
} from "./toast";
export { TPrintPreviewDialog, type TPrintPreviewDialogProps } from "./TPrintPreviewDialog";
export {
  TRemarkDialog,
  useRemarkDialog,
  type TRemarkDialogProps,
  type UseRemarkDialogOptions,
  type UseRemarkDialogReturn
} from "./TRemarkDialog";

