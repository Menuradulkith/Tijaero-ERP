/**
 * TChip - Standardized chip/tag component
 * 
 * Provides consistent chip styling with predefined sizes.
 * 
 * @example
 * ```tsx
 * <TChip label="New" color="info" />
 * <TChip label="Featured" color="primary" onDelete={handleDelete} />
 * ```
 */

import React from "react";
import { Chip, ChipProps } from "@mui/material";

export interface TChipProps extends Omit<ChipProps, "color"> {
  /** Chip label */
  label: string;
  /** Chip color */
  color?: "default" | "primary" | "secondary" | "success" | "error" | "warning" | "info";
  /** Chip variant */
  variant?: "filled" | "outlined";
  /** Chip size */
  size?: "small" | "medium";
  /** Delete handler (shows delete icon when provided) */
  onDelete?: () => void;
  /** Click handler */
  onClick?: () => void;
  /** Custom icon */
  icon?: React.ReactElement;
}

export const TChip: React.FC<TChipProps> = ({
  label,
  color = "default",
  variant = "filled",
  size = "small",
  onDelete,
  onClick,
  icon,
  sx,
  ...rest
}) => {
  return (
    <Chip
      {...rest}
      label={label}
      color={color}
      variant={variant}
      size={size}
      onDelete={onDelete}
      onClick={onClick}
      icon={icon}
      sx={{
        fontWeight: 500,
        ...sx,
      }}
    />
  );
};

export default TChip;
