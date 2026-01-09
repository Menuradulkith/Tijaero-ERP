/**
 * TCurrency - Standardized currency display component
 * 
 * Consistent currency formatting with optional color coding for
 * positive/negative values.
 * 
 * @example
 * ```tsx
 * <TCurrency value={1234.56} />
 * <TCurrency value={-500} colorCode />
 * <TCurrency value={0} currency="EUR" />
 * ```
 */

import React from "react";
import { Typography, TypographyProps } from "@mui/material";

export interface TCurrencyProps extends Omit<TypographyProps, "children"> {
  /** Numeric value */
  value: number | string | null | undefined;
  /** Currency code */
  currency?: string;
  /** Locale for formatting */
  locale?: string;
  /** Color code positive/negative values */
  colorCode?: boolean;
  /** Show + sign for positive values */
  showSign?: boolean;
  /** Minimum decimal places */
  minDecimals?: number;
  /** Maximum decimal places */
  maxDecimals?: number;
  /** Placeholder for null/undefined values */
  placeholder?: string;
}

export const TCurrency: React.FC<TCurrencyProps> = ({
  value,
  currency = "LKR",
  locale = "en-LK",
  colorCode = false,
  showSign = false,
  minDecimals = 2,
  maxDecimals = 2,
  placeholder = "-",
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

  // Format currency
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
    signDisplay: showSign ? "exceptZero" : "auto",
  });

  const formatted = formatter.format(numValue);

  // Determine color
  let color: string | undefined;
  if (colorCode) {
    if (numValue > 0) color = "success.main";
    else if (numValue < 0) color = "error.main";
  }

  return (
    <Typography
      {...rest}
      sx={{
        fontVariantNumeric: "tabular-nums",
        color,
        ...sx,
      }}
    >
      {formatted}
    </Typography>
  );
};

export default TCurrency;
