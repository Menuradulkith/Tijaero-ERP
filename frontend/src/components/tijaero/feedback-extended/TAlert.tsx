/**
 * TAlert - Standardized alert component
 * 
 * Consistent alert styling for displaying messages to users.
 * 
 * @example
 * ```tsx
 * <TAlert severity="success" title="Success">
 *   Record saved successfully.
 * </TAlert>
 * 
 * <TAlert severity="error" onClose={handleDismiss}>
 *   Something went wrong. Please try again.
 * </TAlert>
 * ```
 */

import React from "react";
import {
  Alert,
  AlertTitle,
  AlertProps,
  Box,
  Collapse,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

export interface TAlertProps extends Omit<AlertProps, "severity" | "children"> {
  /** Alert severity */
  severity?: "success" | "info" | "warning" | "error";
  /** Alert title */
  title?: string;
  /** Alert message */
  children: React.ReactNode;
  /** Closeable alert */
  closeable?: boolean;
  /** Close handler */
  onClose?: () => void;
  /** Auto-dismiss after ms (0 = no auto-dismiss) */
  autoDismiss?: number;
  /** Show icon */
  showIcon?: boolean;
  /** Variant */
  variant?: "standard" | "filled" | "outlined";
  /** Custom action */
  action?: React.ReactNode;
}

export const TAlert: React.FC<TAlertProps> = ({
  severity = "info",
  title,
  children,
  closeable = false,
  onClose,
  autoDismiss = 0,
  showIcon = true,
  variant = "standard",
  action,
  sx,
  ...rest
}) => {
  const [open, setOpen] = React.useState(true);

  // Auto-dismiss effect
  React.useEffect(() => {
    if (autoDismiss > 0) {
      const timer = setTimeout(() => {
        setOpen(false);
        onClose?.();
      }, autoDismiss);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, onClose]);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <Collapse in={open}>
      <Alert
        {...rest}
        severity={severity}
        variant={variant}
        icon={showIcon ? undefined : false}
        action={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {action}
            {closeable && (
              <IconButton
                size="small"
                color="inherit"
                onClick={handleClose}
                aria-label="close"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        }
        sx={{
          ...sx,
        }}
      >
        {title && <AlertTitle>{title}</AlertTitle>}
        {children}
      </Alert>
    </Collapse>
  );
};

export default TAlert;
