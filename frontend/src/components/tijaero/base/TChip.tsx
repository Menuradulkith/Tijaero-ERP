/**
 * TChip - Standardized chip/tag component
 * 
 * Provides consistent chip styling with predefined sizes. Filled chips use
 * the same soft tinted-pill look as TStatusChip (light background, dark
 * text of the same hue) instead of MUI's solid colour fill, so every badge
 * in the ERP reads as one consistent "light colours" style.
 * 
 * @example
 * ```tsx
 * <TChip label="New" color="info" />
 * <TChip label="Featured" color="primary" onDelete={handleDelete} />
 * ```
 */

import React from "react";
import { Chip, ChipProps } from "@mui/material";
import { alpha, darken, lighten, type Theme } from "@mui/material/styles";

export interface TChipProps extends Omit<ChipProps, "color" | "label" | "onDelete"> {
  /** Chip label */
  label: React.ReactNode;
  /** Chip color */
  color?: "default" | "primary" | "secondary" | "success" | "error" | "warning" | "info";
  /** Chip variant */
  variant?: "filled" | "outlined";
  /** Chip size */
  size?: "small" | "medium";
  /** Delete handler (shows delete icon when provided) */
  onDelete?: ChipProps["onDelete"];
  /** Click handler */
  onClick?: ChipProps["onClick"];
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
  // Same tint formula as TStatusChip: a soft coloured background with
  // darkened (lightened in dark mode) text of the same hue, rather than a
  // solid block with white text.
  const tinted = (theme: Theme) => {
    const isLight = theme.palette.mode === "light";
    const main = color === "default" ? theme.palette.text.secondary : theme.palette[color].main;
    return {
      backgroundColor: color === "default" ? theme.palette.action.selected : alpha(main, isLight ? 0.14 : 0.22),
      color: color === "default" ? theme.palette.text.secondary : isLight ? darken(main, 0.45) : lighten(main, 0.35),
      "&:hover": onClick
        ? {
            backgroundColor: color === "default" ? theme.palette.action.selected : alpha(main, isLight ? 0.22 : 0.3),
          }
        : undefined,
    };
  };

  return (
    <Chip
      {...rest}
      label={label}
      color={variant === "filled" ? undefined : color}
      variant={variant}
      size={size}
      onDelete={onDelete}
      onClick={onClick}
      icon={icon}
      sx={[
        { fontWeight: 500 },
        variant === "filled" && tinted,
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
};

export default TChip;
