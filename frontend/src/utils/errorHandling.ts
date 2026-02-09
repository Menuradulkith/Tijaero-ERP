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
    const { detail, message: msg } = error.response.data;

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

  if (errors.length === 1) {
    const err = errors[0];
    const field = err.loc.slice(1).join(".") || "field";
    return `${field}: ${err.msg}`;
  }

  return errors
    .map((err) => {
      const field = err.loc.slice(1).join(".") || "field";
      return `${field}: ${err.msg}`;
    })
    .join("; ");
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
