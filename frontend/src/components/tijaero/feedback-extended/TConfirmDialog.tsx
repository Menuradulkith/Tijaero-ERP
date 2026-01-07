/**
 * TConfirmDialog - Standardized confirmation dialog component
 * 
 * Provides a consistent confirmation dialog and hook for easy usage.
 * 
 * @example
 * ```tsx
 * // Using the hook
 * const { confirm, dialogProps } = useConfirmDialog();
 * 
 * const handleDelete = async () => {
 *   const confirmed = await confirm({
 *     title: "Delete Record",
 *     message: "Are you sure you want to delete this record?",
 *     confirmText: "Delete",
 *     confirmColor: "danger",
 *   });
 *   if (confirmed) {
 *     deleteRecord();
 *   }
 * };
 * 
 * return (
 *   <>
 *     <Button onClick={handleDelete}>Delete</Button>
 *     <TConfirmDialog {...dialogProps} />
 *   </>
 * );
 * ```
 */

import React, { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Typography,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoIcon from "@mui/icons-material/Info";
import ErrorIcon from "@mui/icons-material/Error";
import HelpIcon from "@mui/icons-material/Help";
import { TButton } from "../base/TButton";

export interface TConfirmDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Dialog title */
  title?: string;
  /** Dialog message */
  message: string;
  /** Additional details */
  details?: string;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Confirm button color ("error" is alias for "danger") */
  confirmColor?: "primary" | "success" | "danger" | "warning" | "error";
  /** Dialog type (affects icon and colors) */
  type?: "confirm" | "warning" | "danger" | "info";
  /** Confirm handler */
  onConfirm: () => void;
  /** Cancel handler */
  onCancel: () => void;
  /** Loading state for confirm button */
  loading?: boolean;
}

// Type to icon mapping
const typeIcons = {
  confirm: <HelpIcon color="primary" fontSize="large" />,
  warning: <WarningAmberIcon color="warning" fontSize="large" />,
  danger: <ErrorIcon color="error" fontSize="large" />,
  info: <InfoIcon color="info" fontSize="large" />,
};

// Type to default confirm color (without "error" alias)
type ValidConfirmColor = "primary" | "success" | "danger" | "warning";
const typeColors: Record<string, ValidConfirmColor> = {
  confirm: "primary",
  warning: "warning",
  danger: "danger",
  info: "primary",
};

export const TConfirmDialog: React.FC<TConfirmDialogProps> = ({
  open,
  title = "Confirm Action",
  message,
  details,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmColor,
  type = "confirm",
  onConfirm,
  onCancel,
  loading = false,
}) => {
  // Handle "error" as an alias for "danger"
  const normalizedConfirmColor: ValidConfirmColor | undefined = 
    confirmColor === "error" ? "danger" : (confirmColor as ValidConfirmColor | undefined);
  const finalConfirmColor = normalizedConfirmColor || typeColors[type];

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 2 },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {typeIcons[type]}
        <Typography variant="h6" fontWeight={600}>
          {title}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
        {details && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1, fontStyle: "italic" }}
          >
            {details}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <TButton variant="secondary" onClick={onCancel} disabled={loading}>
          {cancelText}
        </TButton>
        <TButton
          variant={finalConfirmColor}
          onClick={onConfirm}
          loading={loading}
          autoFocus
        >
          {confirmText}
        </TButton>
      </DialogActions>
    </Dialog>
  );
};

// Hook for managing confirm dialog state
export interface UseConfirmDialogOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: TConfirmDialogProps["confirmColor"];
  type?: TConfirmDialogProps["type"];
  /** Shorthand for type: "danger" */
  danger?: boolean;
}

export interface UseConfirmDialogReturn {
  /** Is dialog open */
  isOpen: boolean;
  /** Dialog props to spread */
  dialogProps: TConfirmDialogProps;
  /** Show confirm dialog and return promise */
  confirm: (options?: UseConfirmDialogOptions) => Promise<boolean>;
  /** 
   * Open dialog with simpler API (backward compatibility)
   * @param title - Dialog title
   * @param message - Dialog message  
   * @param onConfirm - Callback when confirmed
   */
  open: (title: string, message: string, onConfirm: () => void) => void;
  /** Close dialog */
  close: () => void;
}

export function useConfirmDialog(
  defaultOptions: UseConfirmDialogOptions = {}
): UseConfirmDialogReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<UseConfirmDialogOptions>(defaultOptions);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (confirmOptions?: UseConfirmDialogOptions): Promise<boolean> => {
      // Handle danger shorthand
      const finalOptions = { ...defaultOptions, ...confirmOptions };
      if (finalOptions.danger && !finalOptions.type) {
        finalOptions.type = "danger";
      }
      setOptions(finalOptions);
      setIsOpen(true);
      return new Promise((resolve) => {
        resolveRef.current = resolve;
      });
    },
    [defaultOptions]
  );

  const handleConfirm = useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const close = useCallback(() => {
    handleCancel();
  }, [handleCancel]);

  // Simpler API for backward compatibility: open(title, message, onConfirm)
  const open = useCallback(
    (title: string, message: string, onConfirm: () => void) => {
      confirm({ title, message, confirmText: "Confirm" }).then((confirmed) => {
        if (confirmed) {
          onConfirm();
        }
      });
    },
    [confirm]
  );

  const dialogProps: TConfirmDialogProps = {
    open: isOpen,
    title: options.title || "Confirm",
    message: options.message || "Are you sure?",
    confirmText: options.confirmText,
    cancelText: options.cancelText,
    confirmColor: options.confirmColor,
    type: options.type,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return {
    isOpen,
    dialogProps,
    confirm,
    open, // Simpler API for backward compatibility
    close,
  };
}

export default TConfirmDialog;
