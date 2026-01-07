/**
 * TFormDialog - Standardized form dialog component
 * 
 * Modal dialog for creating/editing records with consistent styling.
 * 
 * @example
 * ```tsx
 * <TFormDialog
 *   open={isOpen}
 *   onClose={handleClose}
 *   title={isEdit ? "Edit Customer" : "New Customer"}
 *   onSubmit={handleSubmit(onSubmit)}
 *   isSubmitting={mutation.isPending}
 *   maxWidth="md"
 * >
 *   <TFormField control={control} name="name" label="Name" />
 *   <TFormField control={control} name="email" label="Email" />
 * </TFormDialog>
 * ```
 */

import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { TButton } from "../base/TButton";

export interface TFormDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Dialog title */
  title: string;
  /** Title icon */
  icon?: React.ReactNode;
  /** Form submit handler */
  onSubmit?: (e: React.FormEvent) => void;
  /** Submit button loading state */
  isSubmitting?: boolean;
  /** Submit button disabled state */
  submitDisabled?: boolean;
  /** Submit button text */
  submitText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Dialog max width */
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Full width */
  fullWidth?: boolean;
  /** Dialog content */
  children: React.ReactNode;
  /** Custom footer actions */
  actions?: React.ReactNode;
  /** Form columns for grid layout */
  columns?: 1 | 2 | 3 | 4;
  /** Disable closing on backdrop click */
  disableBackdropClick?: boolean;
  /** Show close button in header */
  showCloseButton?: boolean;
  /** Form content padding */
  contentPadding?: number;
}

export const TFormDialog: React.FC<TFormDialogProps> = ({
  open,
  onClose,
  title,
  icon,
  onSubmit,
  isSubmitting = false,
  submitDisabled = false,
  submitText = "Save",
  cancelText = "Cancel",
  maxWidth = "sm",
  fullWidth = true,
  children,
  actions,
  columns = 2,
  disableBackdropClick = false,
  showCloseButton = true,
  contentPadding = 2,
}) => {
  // Grid template columns
  const gridTemplateColumns = {
    1: "1fr",
    2: { xs: "1fr", sm: "1fr 1fr" },
    3: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
    4: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr 1fr" },
  };

  const handleClose = (_event: object, reason: string) => {
    if (disableBackdropClick && reason === "backdropClick") {
      return;
    }
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(e);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      PaperProps={{
        sx: { borderRadius: 2 },
      }}
    >
      <form onSubmit={handleSubmit}>
        {/* Dialog Header */}
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pb: 1,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {icon && (
              <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
            )}
            <Typography variant="h6" fontWeight={600}>
              {title}
            </Typography>
          </Box>
          {showCloseButton && (
            <IconButton
              size="small"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>

        <Divider />

        {/* Dialog Content */}
        <DialogContent sx={{ pt: contentPadding, pb: contentPadding }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: gridTemplateColumns[columns],
              gap: 2,
              mt: 1,
            }}
          >
            {children}
          </Box>
        </DialogContent>

        <Divider />

        {/* Dialog Actions */}
        <DialogActions sx={{ px: 3, py: 2 }}>
          {actions || (
            <>
              <TButton
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {cancelText}
              </TButton>
              {onSubmit && (
                <TButton
                  variant="primary"
                  type="submit"
                  loading={isSubmitting}
                  disabled={submitDisabled}
                >
                  {submitText}
                </TButton>
              )}
            </>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default TFormDialog;
