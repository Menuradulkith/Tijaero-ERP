/**
 * TRemarkDialog - Reusable dialog for viewing/editing remarks
 * 
 * Used for adding notes/remarks to items in orders, invoices, and other documents.
 * 
 * @example
 * ```tsx
 * // Basic usage
 * <TRemarkDialog
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   value={remark}
 *   onChange={setRemark}
 *   onSave={handleSave}
 * />
 * 
 * // With hook
 * const { dialogProps, openDialog } = useRemarkDialog({
 *   onSave: (item, remark) => updateItemRemark(item.id, remark)
 * });
 * 
 * <TRemarkDialog {...dialogProps} />
 * <IconButton onClick={() => openDialog(item, item.remark)}>
 *   <NotesIcon />
 * </IconButton>
 * ```
 */

import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import MenuBookIcon from "@mui/icons-material/MenuBook";

export interface TRemarkDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Dialog title */
  title?: string;
  /** Remark value */
  value: string;
  /** Change handler */
  onChange?: (value: string) => void;
  /** Save handler */
  onSave?: () => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Text field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Number of rows for textarea */
  rows?: number;
  /** Dialog max width */
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Custom icon */
  icon?: React.ReactNode;
}

export const TRemarkDialog: React.FC<TRemarkDialogProps> = ({
  open,
  onClose,
  title = "Item Remark",
  value,
  onChange,
  onSave,
  readOnly = false,
  label = "Remark",
  placeholder = "Enter remark...",
  rows = 4,
  maxWidth = "sm",
  icon = <MenuBookIcon />,
}) => {
  const handleSave = () => {
    if (onSave) {
      onSave();
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {icon}
        {title}
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          multiline
          rows={rows}
          label={label}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          disabled={readOnly}
          sx={{ mt: 1 }}
          placeholder={placeholder}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && onSave && (
          <Button variant="contained" onClick={handleSave}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

/**
 * Hook options for useRemarkDialog
 */
export interface UseRemarkDialogOptions<T = unknown> {
  /** Save handler called with item and remark value */
  onSave?: (item: T, remark: string) => void;
}

/**
 * Hook return type for useRemarkDialog
 */
export interface UseRemarkDialogReturn<T = unknown> {
  /** Whether dialog is open */
  open: boolean;
  /** Currently selected item */
  selectedItem: T | null;
  /** Current remark value */
  remarkValue: string;
  /** Open the dialog with an item */
  openDialog: (item: T, initialRemark?: string) => void;
  /** Close the dialog */
  closeDialog: () => void;
  /** Update remark value */
  setRemarkValue: (value: string) => void;
  /** Save handler */
  handleSave: () => void;
  /** Props to spread to TRemarkDialog */
  dialogProps: Omit<TRemarkDialogProps, "readOnly">;
}

/**
 * useRemarkDialog - Hook to manage remark dialog state
 * 
 * @example
 * ```tsx
 * const { dialogProps, openDialog, closeDialog } = useRemarkDialog({
 *   onSave: (item, remark) => {
 *     updateItemRemark(item.id, remark);
 *   }
 * });
 * 
 * return (
 *   <>
 *     <IconButton onClick={() => openDialog(currentItem, currentItem.remark)}>
 *       <NotesIcon />
 *     </IconButton>
 *     <TRemarkDialog {...dialogProps} />
 *   </>
 * );
 * ```
 */
export function useRemarkDialog<T = unknown>({
  onSave,
}: UseRemarkDialogOptions<T> = {}): UseRemarkDialogReturn<T> {
  const [open, setOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [remarkValue, setRemarkValue] = useState("");

  const openDialog = useCallback((item: T, initialRemark?: string) => {
    setSelectedItem(item);
    setRemarkValue(initialRemark || "");
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setSelectedItem(null);
    setRemarkValue("");
  }, []);

  const handleSave = useCallback(() => {
    if (selectedItem && onSave) {
      onSave(selectedItem, remarkValue);
    }
    closeDialog();
  }, [selectedItem, remarkValue, onSave, closeDialog]);

  const dialogProps: Omit<TRemarkDialogProps, "readOnly"> = {
    open,
    onClose: closeDialog,
    value: remarkValue,
    onChange: setRemarkValue,
    onSave: handleSave,
  };

  return {
    open,
    selectedItem,
    remarkValue,
    openDialog,
    closeDialog,
    setRemarkValue,
    handleSave,
    dialogProps,
  };
}

export default TRemarkDialog;
