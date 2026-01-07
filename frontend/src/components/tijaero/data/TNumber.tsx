/**
 * TNumber - Standardized number display component
 * 
 * Consistent number formatting with locale support.
 * 
 * @example
 * ```tsx
 * <TNumber value={1234567} />
 * <TNumber value={0.856} format="percent" />
 * <TNumber value={1500000} compact />
 * ```
 */

import React from "react";
import { Typography, TypographyProps, Tooltip } from "@mui/material";

export interface TNumberProps extends Omit<TypographyProps, "children"> {
  /** Numeric value */
  value: number | string | null | undefined;
  /** Number format */
  format?: "decimal" | "percent" | "compact";
  /** Locale for formatting */
  locale?: string;
  /** Minimum decimal places */
  minDecimals?: number;
  /** Maximum decimal places */
  maxDecimals?: number;
  /** Use compact notation (K, M, B) */
  compact?: boolean;
  /** Show tooltip with full number */
  tooltip?: boolean;
  /** Placeholder for null/undefined */
  placeholder?: string;
  /** Unit suffix (e.g., "kg", "pcs") */
  unit?: string;
  /** Color code positive/negative */
  colorCode?: boolean;
}

export const TNumber: React.FC<TNumberProps> = ({
  value,
  format: formatType = "decimal",
  locale = "en-US",
  minDecimals = 0,
  maxDecimals = 2,
  compact = false,
  tooltip = false,
  placeholder = "-",
  unit,
  colorCode = false,
  sx,
  ...rest
}) => {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return (
      <Typography {...rest} sx={{ ...sx }}>
        {placeholder}
      </Typography>
    );
  }

  // Parse value
  const numValue = typeof value === "string" ? parseFloat(value) : value;

  // Handle invalid numbers
  if (isNaN(numValue)) {
    return (
      <Typography {...rest} sx={{ ...sx }}>
        {placeholder}
      </Typography>
    );
  }

  // Build formatter options
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  };

  if (formatType === "percent") {
    options.style = "percent";
  } else if (compact || formatType === "compact") {
    options.notation = "compact";
    options.compactDisplay = "short";
  }

  // Format number
  const formatted = new Intl.NumberFormat(locale, options).format(
    formatType === "percent" ? numValue : numValue
  );

  // Full number for tooltip
  const fullNumber = numValue.toLocaleString(locale, {
    maximumFractionDigits: 10,
  });

  // Determine color
  let color: string | undefined;
  if (colorCode) {
    if (numValue > 0) color = "success.main";
    else if (numValue < 0) color = "error.main";
  }

  const content = (
    <Typography
      {...rest}
      sx={{
        fontVariantNumeric: "tabular-nums",
        color,
        ...sx,
      }}
    >
      {formatted}
      {unit && ` ${unit}`}
    </Typography>
  );

  if (tooltip && (compact || formatType === "compact")) {
    return <Tooltip title={fullNumber}>{content}</Tooltip>;
  }

  return content;
};

export default TNumber;
