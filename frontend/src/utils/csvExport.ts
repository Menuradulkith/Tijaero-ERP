/**
 * Utility to export tabular data to a CSV file professionally.
 */

/**
 * Escapes a cell value according to CSV standard RFC 4180.
 * Doubles any double quotes and wraps the cell in quotes if it contains commas, quotes, or newlines.
 */
export function escapeCSVCell(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  let strValue = "";
  if (typeof value === "object") {
    strValue = JSON.stringify(value);
  } else {
    strValue = String(value);
  }
  
  if (strValue.includes('"') || strValue.includes(',') || strValue.includes('\n') || strValue.includes('\r')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }
  return strValue;
}

export interface CSVExportOptions {
  filename: string;
  headers: string[];
  rows: any[][];
}

/**
 * Triggers a browser download of the given headers and rows in CSV format.
 */
export function exportToCSV({ filename, headers, rows }: CSVExportOptions): void {
  const headerLine = headers.map(escapeCSVCell).join(",");
  const rowLines = rows.map(row => row.map(escapeCSVCell).join(","));
  const csvContent = [headerLine, ...rowLines].join("\r\n");

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
