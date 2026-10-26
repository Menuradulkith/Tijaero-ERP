/**
 * Escape a value for interpolation into an HTML string.
 *
 * Print windows are built as HTML strings and written with document.write
 * into a same-origin window, so any server data (customer names, remarks,
 * descriptions...) must go through this before it is interpolated, or a
 * stored value like `<img onerror=...>` runs as script in the app's origin.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
