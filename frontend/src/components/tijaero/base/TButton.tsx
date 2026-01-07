/**
 * TButton - Standardized button component
 * 
 * Provides consistent button styling with predefined variants for common actions:
 * - primary: Main actions (Save, Submit, Create)
 * - secondary: Secondary actions (Cancel, Back)
 * - success: Positive actions (Approve, Complete)
 * - danger: Destructive actions (Delete, Remove)
 * - warning: Cautionary actions (Reject, Suspend)
 * 
 * @example
 * ```tsx
 * <TButton variant="primary" onClick={handleSave}>Save</TButton>
 * <TButton variant="danger" startIcon={<DeleteIcon />} onClick={handleDelete}>Delete</TButton>
 * <TButton variant="secondary" loading>Loading...</TButton>
 * ```
 */

import React from "react";
import { Button, ButtonProps, CircularProgress } from "@mui/material";

export interface TButtonProps extends Omit<ButtonProps, "variant" | "color"> {
  /** Button variant */
  variant?: "primary" | "secondary" | "success" | "danger" | "warning" | "outlined" | "text";
  /** Loading state - shows spinner and disables button */
  loading?: boolean;
  /** Size of the button */
  size?: "small" | "medium" | "large";
  /** Icon to show before text */
  startIcon?: React.ReactNode;
  /** Icon to show after text */
  endIcon?: React.ReactNode;
  /** Full width button */
  fullWidth?: boolean;
  /** Children content */
  children: React.ReactNode;
}

// Map our semantic variants to MUI props
const variantMap: Record<string, { variant: "contained" | "outlined" | "text"; color: ButtonProps["color"] }> = {
  primary: { variant: "contained", color: "primary" },
  secondary: { variant: "outlined", color: "inherit" },
  success: { variant: "contained", color: "success" },
  danger: { variant: "contained", color: "error" },
  warning: { variant: "contained", color: "warning" },
  outlined: { variant: "outlined", color: "primary" },
  text: { variant: "text", color: "primary" },
};

export const TButton: React.FC<TButtonProps> = ({
  variant = "primary",
  loading = false,
  size = "medium",
  startIcon,
  endIcon,
  fullWidth = false,
  children,
  disabled,
  sx,
  ...rest
}) => {
  const muiProps = variantMap[variant] || variantMap.primary;

  return (
    <Button
      {...rest}
      variant={muiProps.variant}
      color={muiProps.color}
      size={size}
      fullWidth={fullWidth}
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : startIcon}
      endIcon={endIcon}
      sx={{
        textTransform: "none",
        fontWeight: 500,
        minWidth: loading ? 120 : undefined,
        ...sx,
      }}
    >
      {children}
    </Button>
  );
};

export default TButton;
