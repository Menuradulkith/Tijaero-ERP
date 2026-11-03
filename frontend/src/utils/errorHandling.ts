/**
 * Centralized Error Handling Utilities for Tijaero ERP
 *
 * Provides a single, consistent way to extract user-friendly error messages
 * from API responses (Axios errors), native Error objects, and unknown throws.
 *
 * Usage:
 *   import { handleApiError } from "@/utils/errorHandling";
 *
 *   // In a try/catch block:
 *   catch (error) {
 *     showErrorToast(handleApiError(error, "Failed to save record"));
 *   }
 *
 *   // In a TanStack Query mutation:
 *   onError: (error) => showErrorToast(handleApiError(error, "Failed to create order")),
 */

import axios from "axios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pydantic validation error structure returned by FastAPI (HTTP 422) */
interface ValidationError {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core utility – handleApiError
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from any caught error.
 *
 * Resolution order:
 *  1. Axios response  →  `error.response.data.detail`  (string / array / object)
 *  2. Axios response  →  `error.response.data.message`
 *  3. Native `Error.message`
 *  4. The provided `fallback` string
 *
 * The `error` parameter is typed as `unknown` so callers never need `any`.
 */
export function handleApiError(error: unknown, fallback: string): string {
  // 1. Axios error with a server response
  if (axios.isAxiosError(error) && error.response?.data) {
    const { detail, message: msg, messages } = error.response.data;

    // FastAPI's global 422 handler (see app/main.py validation_exception_handler)
    // always sends a generic "Data validation failed" as `detail`, with the
    // actual per-field reasons in `messages` — check that first, or every
    // validation failure shows the same unhelpful generic text.
    if (
      detail === "Data validation failed" &&
      Array.isArray(messages) &&
      messages.length > 0
    ) {
      return formatFieldMessages(messages as { field: string; message: string }[]);
    }

    // detail is a plain string  →  use it directly
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }

    // detail is an array of Pydantic validation errors (422)
    if (Array.isArray(detail) && detail.length > 0) {
      return formatValidationErrors(detail as ValidationError[]);
    }

    // detail is some other object  →  try known keys
    if (typeof detail === "object" && detail !== null) {
      const d = detail as Record<string, unknown>;
      if (typeof d.msg === "string") return d.msg;
      if (typeof d.message === "string") return d.message;
      return JSON.stringify(detail);
    }

    // No detail but there is a top-level message
    if (typeof msg === "string" && msg.length > 0) {
      return msg;
    }
  }

  // 2. Axios error without a response (network error, timeout, etc.)
  if (axios.isAxiosError(error) && error.message) {
    return error.message;
  }

  // 3. Native Error object
  if (error instanceof Error && error.message) {
    return error.message;
  }

  // 4. String thrown directly
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  // 5. Fallback
  return fallback;
}

// ---------------------------------------------------------------------------
// Legacy wrapper – formatErrorMessage  (kept for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `handleApiError(error, fallbackMessage)` instead.
 */
export function formatErrorMessage(error: unknown): string {
  return handleApiError(error, "An unexpected error occurred");
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Format Pydantic validation errors into a readable message.
 */
function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return "Validation error occurred";
  }
  return errors.map((err) => friendlyFieldError(err.loc, err.msg)).join("; ");
}

/** "transaction_date" → "Transaction date", "account_id" → "Account". */
export function humanizeFieldName(name: string): string {
  const words = name.replace(/_id$/, "").replace(/[_\s]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : "";
}

/**
 * Turn one Pydantic error (loc path + msg) into a plain sentence, e.g.
 * (["body","rate"], "Input should be less than or equal to 100") → "Rate must be 100 or less".
 */
export function friendlyFieldError(loc: (string | number)[] | string, rawMsg: string): string {
  const parts = (Array.isArray(loc) ? loc.map(String) : String(loc || "").split(/\s*->\s*|\./))
    .filter((p) => p && !["body", "query", "path"].includes(p));
  const name = [...parts].reverse().find((p) => !/^\d+$/.test(p));
  const index = parts.find((p) => /^\d+$/.test(p));
  const F = name ? humanizeFieldName(name) : "This value";
  let msg = String(rawMsg || "").trim();

  // A validator's own text is already meant for people.
  const custom = msg.match(/^(?:Value error|Assertion failed),\s*([\s\S]*)$/);
  if (custom) msg = custom[1];

  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^Field required$/i, () => `${F} is required`],
    [/^Input should be less than or equal to (.+)$/i, (m) => `${F} must be ${m[1]} or less`],
    [/^Input should be less than (.+)$/i, (m) => `${F} must be less than ${m[1]}`],
    [/^Input should be greater than or equal to (.+)$/i, (m) => `${F} must be ${m[1]} or more`],
    [/^Input should be greater than (.+)$/i, (m) => `${F} must be more than ${m[1]}`],
    [/^String should have at most (\d+) characters?$/i, (m) => `${F} can be at most ${m[1]} characters`],
    [/^String should have at least (\d+) characters?$/i, (m) => (m[1] === "1" ? `${F} is required` : `${F} must be at least ${m[1]} characters`)],
    [/^List should have at least (\d+) items?/i, (m) => `${F} needs at least ${m[1]} item(s)`],
    [/^Input should be a valid (date|datetime|date or datetime|time)\b/i, () => `${F} is not a valid date`],
    [/^Input should be a valid integer/i, () => `${F} must be a whole number`],
    [/^Input should be a valid (number|decimal)/i, () => `${F} must be a number`],
    [/^Decimal input should have no more than (\d+) decimal places?/i, (m) => `${F} can have at most ${m[1]} decimals`],
    [/^Decimal input should have no more than (\d+) digits?/i, () => `${F} is too large`],
    [/^Input should be a valid boolean/i, () => `${F} must be yes or no`],
    [/^Input should be (.+)$/i, (m) => `${F} must be ${m[1].replace(/'/g, "")}`],
    [/^String should match pattern/i, () => `${F} has an invalid format`],
    [/^value is not a valid email address/i, () => `${F} is not a valid email address`],
  ];
  if (!custom) {
    for (const [re, fmt] of rules) {
      const m = msg.match(re);
      if (m) {
        msg = fmt(m);
        break;
      }
    }
    if (msg === String(rawMsg || "").trim() && name) msg = `${F}: ${msg}`;
  }
  msg = msg.charAt(0).toUpperCase() + msg.slice(1);
  // Rows of a list ("lines -> 1") read as "Line 2", unless the text already says which line.
  if (index !== undefined && !/^(line|row)\s+\d+/i.test(msg)) msg = `Line ${Number(index) + 1}: ${msg}`;
  return msg;
}

/**
 * Format the `{field, message}[]` shape sent by the backend's global 422
 * handler (already-normalized Pydantic errors). `field` is the raw
 * "body -> fieldName" loc path joined by the backend — strip the leading
 * "body -> " so the message reads as just the field name.
 */
function formatFieldMessages(errors: { field: string; message: string }[]): string {
  return errors.map((err) => friendlyFieldError(err.field || "", err.message)).join("; ");
}

/**
 * Extract field-specific error messages from validation errors.
 * Useful for form field validation display.
 */
export function extractFieldErrors(
  error: unknown
): Record<string, string> | null {
  if (
    !axios.isAxiosError(error) ||
    !error.response?.data?.detail ||
    !Array.isArray(error.response.data.detail)
  ) {
    return null;
  }

  const fieldErrors: Record<string, string> = {};
  const errors = error.response.data.detail as ValidationError[];

  errors.forEach((err) => {
    const field = err.loc.slice(1).join(".");
    if (field) {
      fieldErrors[field] = err.msg;
    }
  });

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}
