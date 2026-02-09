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
  /** Show currency symbol (set to false when header already shows currency) */
  showSymbol?: boolean;
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
  showSymbol = true,
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
  let formatted: string;
  if (showSymbol) {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
      signDisplay: showSign ? "exceptZero" : "auto",
    });
    formatted = formatter.format(numValue);
  } else {
    // Format without currency symbol (for use with headers that show currency)
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
      signDisplay: showSign ? "exceptZero" : "auto",
    });
    formatted = formatter.format(numValue);
  }

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

/**
 * Utility function for formatting currency values as strings.
 * Use this when you need a formatted string (e.g., in template literals, 
 * TextField values, Chip labels) instead of a rendered component.
 * 
 * @example
 * ```tsx
 * // Simple usage
 * formatCurrency(1234.56)          // "1,234.56"
 * formatCurrency(1234.56, true)    // "Rs. 1,234.56"
 * 
 * // In template literals
 * `Total: ${formatCurrency(total, true)}`
 * 
 * // In TextField value
 * <TextField value={formatCurrency(amount, true)} />
 * ```
 */
export const formatCurrency = (
  value: number | string | null | undefined,
  withSymbol: boolean = false,
  currency: string = "LKR",
  locale: string = "en-LK",
): string => {
  if (value === null || value === undefined) return "-";
  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return "-";

  if (withSymbol) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numValue);
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
};

/**
 * Shorthand for formatting LKR currency (Sri Lankan Rupees).
 * Returns formatted string without symbol prefix.
 * 
 * @example
 * ```tsx
 * fmtLKR(1234.56)  // "1,234.56"
 * ```
 */
export const fmtLKR = (value: number | string | null | undefined): string =>
  formatCurrency(value, false);
