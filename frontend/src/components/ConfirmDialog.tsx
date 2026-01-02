/**
 * ConfirmDialog - Reusable confirmation dialog component
 * 
 * Replaces browser's native confirm() with a styled MUI dialog
 */

import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: "primary" | "secondary" | "error" | "warning" | "info" | "success";
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title = "Confirm Action",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmColor = "error",
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 2 }
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <WarningAmberIcon color="warning" />
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} variant="outlined" color="inherit">
          {cancelText}
        </Button>
        <Button onClick={onConfirm} variant="contained" color={confirmColor} autoFocus>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/**
 * Hook for managing confirm dialog state
 */
export interface UseConfirmDialogOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: ConfirmDialogProps["confirmColor"];
}

export interface UseConfirmDialogReturn {
  isOpen: boolean;
  dialogProps: ConfirmDialogProps;
  confirm: (options?: UseConfirmDialogOptions) => Promise<boolean>;
  open: (title: string, message: string, onConfirm: () => void) => void;
  close: () => void;
}

export function useConfirmDialog(defaultOptions: UseConfirmDialogOptions = {}): UseConfirmDialogReturn {
  const [isOpen, setIsOpen] = React.useState(false);
  const [options, setOptions] = React.useState<UseConfirmDialogOptions>(defaultOptions);
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null);
  const onConfirmCallbackRef = React.useRef<(() => void) | null>(null);

  const confirm = React.useCallback((confirmOptions?: UseConfirmDialogOptions): Promise<boolean> => {
    setOptions({ ...defaultOptions, ...confirmOptions });
    setIsOpen(true);
    onConfirmCallbackRef.current = null;
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, [defaultOptions]);

  // Simpler open method that takes a callback instead of returning a Promise
  const open = React.useCallback((title: string, message: string, onConfirm: () => void) => {
    setOptions({ ...defaultOptions, title, message });
    onConfirmCallbackRef.current = onConfirm;
    resolveRef.current = null;
    setIsOpen(true);
  }, [defaultOptions]);

  const handleConfirm = React.useCallback(() => {
    setIsOpen(false);
    if (onConfirmCallbackRef.current) {
      onConfirmCallbackRef.current();
      onConfirmCallbackRef.current = null;
    }
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = React.useCallback(() => {
    setIsOpen(false);
    onConfirmCallbackRef.current = null;
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const close = React.useCallback(() => {
    setIsOpen(false);
    onConfirmCallbackRef.current = null;
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const dialogProps: ConfirmDialogProps = {
    open: isOpen,
    title: options.title || "Confirm Action",
    message: options.message || "Are you sure?",
    confirmText: options.confirmText || "Confirm",
    cancelText: options.cancelText || "Cancel",
    confirmColor: options.confirmColor || "error",
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return {
    isOpen,
    dialogProps,
    confirm,
    open,
    close,
  };
}

export default ConfirmDialog;
