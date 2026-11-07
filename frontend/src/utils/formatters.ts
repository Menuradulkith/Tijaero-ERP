/**
 * Utility functions for formatting data for display
 */
import { useCurrencyStore } from "@/state/currencyStore";
import { useTimezoneStore } from "@/state/timezoneStore";

/**
 * Default currency for the ERP system.
 * These are fallback constants — prefer reading the active currency via
 * useCurrencyStore (or its getState() outside components) since the ERP's
 * currency is user-configurable in Settings > Company Configuration > Currency.
 */
export const ERP_CURRENCY = "LKR";
export const ERP_CURRENCY_SYMBOL = "Rs.";
export const ERP_LOCALE = "en-LK";
/**
 * Fallback timezone constant (this file's browser-local read at load time).
 * Prefer useTimezoneStore (or its getState() outside components) since the
 * ERP's display timezone is user-configurable in
 * Settings > Company Configuration > Company Details.
 */
export const ERP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Format a number as currency using the ERP's active currency and two decimal places
 * @param value - The numeric value to format
 * @returns Formatted currency string (e.g., "Rs. 12,345.60")
 */
export function formatCurrency(value: number): string {
  const { symbol, locale } = useCurrencyStore.getState();
  // Handle invalid numbers
  const numValue = Number(value);
  if (isNaN(numValue)) {
    return `${symbol} 0.00`;
  }
  return `${symbol} ${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue)}`;
}

/**
 * Format a number as amount without currency symbol (for use with column headers that include currency)
 * @param value - The numeric value to format
 * @returns Formatted amount string (e.g., "12,345.60")
 */
export function formatAmount(value: number): string {
  const { locale } = useCurrencyStore.getState();
  // Handle invalid numbers
  const numValue = Number(value);
  if (isNaN(numValue)) {
    return "0.00";
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
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

// ---------------------------------------------------------------------------
// Local calendar dates for date pickers / API filters.
// `date.toISOString().split("T")[0]` gives the UTC date: in Sri Lanka (UTC+5:30)
// that is yesterday before 05:30, and "this month" started on the 31st. Use these.
// ---------------------------------------------------------------------------

/** Today as YYYY-MM-DD in the user's own time zone. */
export function todayISO(): string {
  return formatDate(new Date());
}

/** A Date as YYYY-MM-DD in the user's own time zone (not UTC). */
export function localDateISO(date: Date): string {
  return formatDate(date);
}

/** First day of the current month, YYYY-MM-DD (local). */
export function startOfMonthISO(date: Date = new Date()): string {
  return formatDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Monday of the current week, YYYY-MM-DD (local). */
export function startOfWeekISO(date: Date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return formatDate(d);
}

/** Today minus n days, YYYY-MM-DD (local). */
export function daysAgoISO(n: number, date: Date = new Date()): string {
  return formatDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - n));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The one date format users see: "07 Nov 2026". Unambiguous (03/11 vs 11/03).
 * A plain YYYY-MM-DD string is read as a calendar day, not shifted by time zone.
 */
export function displayDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  let d: Date;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = typeof value === "string" ? new Date(value) : value;
  }
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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
 * The one date-time format users see: "07 Nov 2026, 10:03" (24-hour clock,
 * in the ERP's time zone). Same day format as displayDate().
 */
export function formatDateTimeReadable(date: Date | string | null | undefined): string {
  if (!date) return "";
  // A plain calendar day has no time to show.
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return displayDate(date);
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    const { timezone } = useTimezoneStore.getState();
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: timezone || undefined,
      }).formatToParts(d);
    } catch {
      parts = new Intl.DateTimeFormat("en-GB", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(d);
    }
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const month = MONTHS[Number(get("month")) - 1] ?? "";
    return `${get("day")} ${month} ${get("year")}, ${get("hour")}:${get("minute")}`;
  } catch {
    return "";
  }
}

/** Alias of formatDateTimeReadable: "07 Nov 2026, 10:03". */
export const displayDateTime = formatDateTimeReadable;

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

/**
 * A stored code shown as plain words: "bank_transfer" -> "Bank transfer",
 * "pending_verification" -> "Pending verification". Empty for no value.
 */
export function codeLabel(code: string | null | undefined): string {
  if (!code) return "";
  const words = String(code).replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
