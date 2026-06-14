/**
 * TExportButton - Reusable, standardized "Export CSV" button.
 *
 * Wraps the canonical {@link exportToCSV} utility (RFC-4180 compliant: quote
 * escaping, UTF-8 BOM, CRLF line endings) so every table across the ERP exports
 * CSV the same way. `rows` may be an array or a function evaluated lazily on
 * click (useful when rows are derived from the current filtered view).
 *
 * @example
 * ```tsx
 * <TExportButton
 *   filename="card_payments"
 *   headers={["Ref", "Amount", "Date"]}
 *   rows={() => filteredPayments.map(p => [p.ref_number, p.amount, p.date_time])}
 *   disabled={filteredPayments.length === 0}
 * />
 * ```
 */

import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { Button } from "@mui/material";
import React from "react";

import { exportToCSV } from "@/utils/csvExport";

export interface TExportButtonProps {
  /** Output file name (with or without the .csv extension). */
  filename: string;
  /** Column headers. */
  headers: string[];
  /** Row data, or a function returning it (evaluated on click). */
  rows: any[][] | (() => any[][]);
  /** Disable the button (e.g. when there is nothing to export). */
  disabled?: boolean;
  /** Button label. Defaults to "Export CSV". */
  label?: string;
  /** MUI button size. Defaults to "small". */
  size?: "small" | "medium" | "large";
  /** MUI button variant. Defaults to "outlined". */
  variant?: "text" | "outlined" | "contained";
  /** Optional tooltip/title. */
  title?: string;
}

export const TExportButton: React.FC<TExportButtonProps> = ({
  filename,
  headers,
  rows,
  disabled,
  label = "Export CSV",
  size = "small",
  variant = "outlined",
  title,
}) => {
  const handleClick = () => {
    const resolvedRows = typeof rows === "function" ? rows() : rows;
    if (!resolvedRows || resolvedRows.length === 0) return;
    exportToCSV({ filename, headers, rows: resolvedRows });
  };

  return (
    <Button
      size={size}
      variant={variant}
      startIcon={<FileDownloadIcon />}
      onClick={handleClick}
      disabled={disabled}
      title={title}
    >
      {label}
    </Button>
  );
};

export default TExportButton;
