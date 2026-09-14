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
import { useTimezoneStore } from "@/state/timezoneStore";

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

/**
 * Convert a Date into a "fake local" Date whose local getters (getFullYear,
 * getHours, etc.) return the wall-clock values it would show in the given
 * IANA timezone — so date-fns's format()/formatDistanceToNow() (which only
 * ever read local getters, with no timeZone option of their own) render as
 * if running in that zone, without pulling in a date-fns-tz dependency.
 */
const toZonedDate = (date: Date, timeZone: string): Date => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  // "24" from hour12:false at midnight needs folding back to 0.
  const hour = Number(get("hour")) % 24;

  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    hour,
    Number(get("minute")),
    Number(get("second")),
    date.getMilliseconds(),
  );
};

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

// Format date based on format type. "relative" and "iso" are timezone-agnostic
// (a duration and a UTC-normalized string, respectively) so they use the raw
// date; every other format renders the wall-clock time in the given zone.
const formatDate = (date: Date, formatType: string, timeZone: string): string => {
  switch (formatType) {
    case "relative":
      return formatDistanceToNow(date, { addSuffix: true });
    case "iso":
      return date.toISOString();
    default: {
      const zoned = toZonedDate(date, timeZone);
      switch (formatType) {
        case "short":
          return format(zoned, "MMM dd, yyyy");
        case "long":
          return format(zoned, "MMMM dd, yyyy");
        case "datetime":
          return format(zoned, "MMM dd, yyyy HH:mm");
        case "time":
          return format(zoned, "HH:mm:ss");
        default:
          // Custom format string
          return format(zoned, formatType);
      }
    }
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
  const { timezone } = useTimezoneStore();
  const date = parseDate(value);

  // Handle invalid date
  if (!date) {
    return (
      <Typography {...rest} sx={{ ...sx }}>
        {placeholder}
      </Typography>
    );
  }

  const formatted = formatDate(date, formatType, timezone);
  const fullDate = format(toZonedDate(date, timezone), "MMMM dd, yyyy 'at' HH:mm:ss");

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
