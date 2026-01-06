/**
 * Error handling utilities for API responses
 */

/**
 * Pydantic validation error structure from FastAPI
 */
interface ValidationError {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: any;
  ctx?: Record<string, any>;
}

/**
 * Format API error for display
 * Handles both string errors and Pydantic validation error arrays
 */
export function formatErrorMessage(error: any): string {
  // If error has a response (axios error)
  if (error.response?.data) {
    const { detail } = error.response.data;

    // If detail is a string, return it
    if (typeof detail === "string") {
      return detail;
    }

    // If detail is an array of validation errors (422 from Pydantic)
    if (Array.isArray(detail)) {
      return formatValidationErrors(detail);
    }

    // If detail is an object, try to extract a message
    if (typeof detail === "object" && detail !== null) {
      return detail.msg || detail.message || JSON.stringify(detail);
    }
  }

  // If error has a message property
  if (error.message) {
    return error.message;
  }

  // Fallback
  return "An unexpected error occurred";
}

/**
 * Format Pydantic validation errors into a readable message
 */
function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return "Validation error occurred";
  }

  if (errors.length === 1) {
    const error = errors[0];
    const field = error.loc.slice(1).join(".") || "field";
    return `${field}: ${error.msg}`;
  }

  // Multiple errors - format as a list
  return errors
    .map((error) => {
      const field = error.loc.slice(1).join(".") || "field";
      return `${field}: ${error.msg}`;
    })
    .join("; ");
}

/**
 * Extract field-specific error messages from validation errors
 * Useful for form field validation
 */
export function extractFieldErrors(
  error: any
): Record<string, string> | null {
  if (!error.response?.data?.detail || !Array.isArray(error.response.data.detail)) {
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
