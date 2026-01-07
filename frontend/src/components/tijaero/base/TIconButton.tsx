/**
 * TIconButton - Standardized icon button component
 * 
 * Provides consistent icon button styling with built-in tooltip support.
 * 
 * @example
 * ```tsx
 * <TIconButton tooltip="Edit" onClick={handleEdit}><EditIcon /></TIconButton>
 * <TIconButton tooltip="Delete" color="danger"><DeleteIcon /></TIconButton>
 * <TIconButton tooltip="Add" color="primary" size="large"><AddIcon /></TIconButton>
 * ```
 */

import React from "react";
import { IconButton, IconButtonProps, Tooltip } from "@mui/material";

export interface TIconButtonProps extends Omit<IconButtonProps, "color"> {
  /** Tooltip text */
  tooltip?: string;
  /** Button color */
  color?: "default" | "primary" | "secondary" | "success" | "danger" | "warning" | "info";
  /** Button size */
  size?: "small" | "medium" | "large";
  /** Icon element */
  children: React.ReactNode;
}

// Map our color names to MUI colors
const colorMap: Record<string, IconButtonProps["color"]> = {
  default: "default",
  primary: "primary",
  secondary: "secondary",
  success: "success",
  danger: "error",
  warning: "warning",
  info: "info",
};

export const TIconButton: React.FC<TIconButtonProps> = ({
  tooltip,
  color = "default",
  size = "small",
  children,
  disabled,
  sx,
  ...rest
}) => {
  const muiColor = colorMap[color] || "default";

  const button = (
    <IconButton
      {...rest}
      color={muiColor}
      size={size}
      disabled={disabled}
      sx={sx}
    >
      {children}
    </IconButton>
  );

  if (tooltip && !disabled) {
    return <Tooltip title={tooltip}>{button}</Tooltip>;
  }

  // Wrap in span for disabled tooltip
  if (tooltip && disabled) {
    return (
      <Tooltip title={tooltip}>
        <span>{button}</span>
      </Tooltip>
    );
  }

  return button;
};

export default TIconButton;
