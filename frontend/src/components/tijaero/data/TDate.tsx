/**
 * TDate - Standardized date display component
 * 
 * Consistent date formatting with various display formats.
 * 
 * @example
 * ```tsx
 * <TDate value={new Date()} />
 * <TDate value="2024-01-15" format="long" />
 * <TDate value={order.createdAt} format="relative" />
 * ```
 */

import React from "react";
import { Typography, TypographyProps, Tooltip } from "@mui/material";
import { format, formatDistanceToNow, parseISO, isValid } from "date-fns";

export interface TDateProps extends Omit<TypographyProps, "children"> {
  /** Date value (Date object, ISO string, or timestamp) */
  value: Date | string | number | null | undefined;
  /** Display format */
  format?: "short" | "long" | "datetime" | "time" | "relative" | "iso" | string;
  /** Show tooltip with full date */
  tooltip?: boolean;
  /** Placeholder for null/undefined values */
  placeholder?: string;
}

// Parse date value
const parseDate = (value: Date | string | number | null | undefined): Date | null => {
  if (!value) return null;
  
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    date = parseISO(value);
  } else {
    date = new Date(value);
  }

  return isValid(date) ? date : null;
};

// Format date based on format type
const formatDate = (date: Date, formatType: string): string => {
  switch (formatType) {
    case "short":
      return format(date, "MMM dd, yyyy");
    case "long":
      return format(date, "MMMM dd, yyyy");
    case "datetime":
      return format(date, "MMM dd, yyyy HH:mm");
    case "time":
      return format(date, "HH:mm:ss");
    case "relative":
      return formatDistanceToNow(date, { addSuffix: true });
    case "iso":
      return date.toISOString();
    default:
      // Custom format string
      return format(date, formatType);
  }
};

export const TDate: React.FC<TDateProps> = ({
  value,
  format: formatType = "short",
  tooltip = false,
  placeholder = "-",
  sx,
  ...rest
}) => {
  const date = parseDate(value);

  // Handle invalid date
  if (!date) {
    return (
      <Typography {...rest} sx={{ ...sx }}>
        {placeholder}
      </Typography>
    );
  }

  const formatted = formatDate(date, formatType);
  const fullDate = format(date, "MMMM dd, yyyy 'at' HH:mm:ss");

  const content = (
    <Typography
      {...rest}
      sx={{
        fontVariantNumeric: "tabular-nums",
        ...sx,
      }}
    >
      {formatted}
    </Typography>
  );

  if (tooltip) {
    return <Tooltip title={fullDate}>{content}</Tooltip>;
  }

  return content;
};

export default TDate;
