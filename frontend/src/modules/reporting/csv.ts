export type CsvValue = string | number | null | undefined;

/** One CSV cell: quoted when it holds a comma, quote or line break, and kept from
 * running as a spreadsheet formula when it starts with = + - @ (names, vendors and
 * remarks are user-entered). Plain numbers stay numbers. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text (CRLF rows, UTF-8 BOM so Excel reads non-ASCII names correctly). */
export function toCsv(rows: CsvValue[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
