/**
 * Utility functions for formatting data for display
 */

/**
 * Default currency for the ERP system
 */
export const ERP_CURRENCY = "LKR";
export const ERP_CURRENCY_SYMBOL = "Rs.";
export const ERP_LOCALE = "en-LK";

/**
 * Format a number as currency with LKR and two decimal places
 * @param value - The numeric value to format
 * @returns Formatted currency string (e.g., "Rs. 12,345.60")
 */
export function formatCurrency(value: number): string {
  return `${ERP_CURRENCY_SYMBOL} ${new Intl.NumberFormat(ERP_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

/**
 * Format a number as amount without currency symbol (for use with column headers that include currency)
 * @param value - The numeric value to format
 * @returns Formatted amount string (e.g., "12,345.60")
 */
export function formatAmount(value: number): string {
  return new Intl.NumberFormat(ERP_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a number with comma separators
 * @param value - The numeric value to format
 * @returns Formatted number string (e.g., "1,234")
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a date/timestamp as relative time (e.g., "5 minutes ago")
 * @param date - The date to format (Date object or ISO string)
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === "string" ? new Date(date) : date;
  const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "just now";
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes === 1 ? "" : "s"} ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours === 1 ? "" : "s"} ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return `${diffInDays} day${diffInDays === 1 ? "" : "s"} ago`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return `${diffInMonths} month${diffInMonths === 1 ? "" : "s"} ago`;
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return `${diffInYears} year${diffInYears === 1 ? "" : "s"} ago`;
}

/**
 * Format a date as YYYY-MM-DD
 * @param date - The date to format (Date object, ISO string, or null/undefined)
 * @returns Formatted date string (e.g., "2026-01-11") or empty string if invalid
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return "";
  }
}

/**
 * Format a datetime as YYYY-MM-DD HH:MM:SS (without microseconds)
 * @param date - The datetime to format (Date object, ISO string, or null/undefined)
 * @returns Formatted datetime string (e.g., "2026-01-11 04:14:33") or empty string if invalid
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return "";
  }
}

/**
 * Format a datetime as human-readable date with time (e.g., "Jan 11, 2026 4:14 AM")
 * @param date - The datetime to format (Date object, ISO string, or null/undefined)
 * @returns Formatted datetime string or empty string if invalid
 */
export function formatDateTimeReadable(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(ERP_LOCALE, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

/**
 * Strip microseconds from a datetime string
 * Converts "2026-01-11 04:14:33.356044" to "2026-01-11 04:14:33"
 * @param dateStr - The datetime string that may contain microseconds
 * @returns Datetime string without microseconds
 */
export function stripMicroseconds(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  // Remove the microseconds part (everything after the seconds)
  return dateStr.replace(/\.\d+$/, "");
}
