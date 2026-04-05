/**
 * TPrintButton - Reusable print/report button for documents
 * 
 * Provides a standardized print button with tooltip and disabled state handling.
 * Supports various document types across the ERP system.
 * 
 * @example
 * ```tsx
 * // Basic usage
 * <TPrintButton
 *   documentType="purchase-order"
 *   documentId={poId}
 * />
 * 
 * // With status check
 * <TPrintButton
 *   documentType="grn"
 *   documentId={grnId}
 *   disabled={!canPrintDocument(status)}
 *   disabledReason={getPrintDisabledReason(status)}
 * />
 * ```
 */

import PrintIcon from "@mui/icons-material/Print";
import { IconButton, Tooltip } from "@mui/material";
import React from "react";

/** Supported document types for printing */
export type TPrintDocumentType =
  | "purchase-order"
  | "grn"
  | "purchase-return"
  | "invoice"
  | "quotation"
  | "credit-note"
  | "journal-entry"
  | "payroll"
  | "expense"
  | "item-transfer-note"
  | "voucher";

export interface TPrintButtonProps {
  /** Document type for generating report URL */
  documentType: TPrintDocumentType;
  /** Document ID */
  documentId: number;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Reason for disabled state (shown in tooltip) */
  disabledReason?: string;
  /** Button size */
  size?: "small" | "medium" | "large";
  /** Custom tooltip for enabled state */
  tooltip?: string;
  /** Custom icon */
  icon?: React.ReactNode;
  /** Base API URL (defaults to VITE_API_URL) */
  baseUrl?: string;
  /** Custom onClick handler (overrides default behavior) */
  onClick?: () => void;
}

/**
 * Get the report URL for a document
 * 
 * @param documentType - Type of document
 * @param documentId - Document ID
 * @param baseUrl - Optional base URL override
 * @returns Full report URL
 */
export function getReportUrl(
  documentType: TPrintDocumentType,
  documentId: number,
  baseUrl?: string
): string {
  const resolvedBaseUrl = baseUrl || (
    import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1"
  ).replace(/\/api\/v1$/, "");
  return `${resolvedBaseUrl}/api/v1/reporting/documents/${documentType}/${documentId}`;
}

/** Statuses that are always non-printable (pending approval or draft) */
export const PENDING_APPROVAL_STATUSES = [
  "draft",
  "pending",
  "pending_approval",
  "pending_bank_verification",
  "return_pending",
];

/**
 * Determine if a document can be printed based on status.
 * Any document in a pending-approval state is blocked by default.
 *
 * @param status - Document status
 * @param additionalBlockedStatuses - Extra statuses to block (merged with pending defaults)
 * @returns Whether document can be printed
 */
export function canPrintDocument(
  status?: string,
  additionalBlockedStatuses: string[] = []
): boolean {
  if (!status) return false;
  const blocked = [...PENDING_APPROVAL_STATUSES, ...additionalBlockedStatuses];
  return !blocked.includes(status.toLowerCase());
}

/**
 * Get the disabled reason for printing based on status
 *
 * @param status - Document status
 * @param additionalBlockedStatuses - Extra statuses to block
 * @returns Disabled reason string or undefined if printable
 */
export function getPrintDisabledReason(
  status?: string,
  additionalBlockedStatuses: string[] = []
): string | undefined {
  if (!canPrintDocument(status, additionalBlockedStatuses)) {
    const s = (status || "").toLowerCase();
    if (s.includes("pending_approval")) return "Cannot print: document is pending approval";
    if (s.includes("pending_bank")) return "Cannot print: bank transfer is pending verification";
    if (s === "pending") return "Cannot print: document is pending";
    if (s === "draft") return "Cannot print draft documents";
    return `Cannot print documents in '${status}' status`;
  }
  return undefined;
}

export const TPrintButton: React.FC<TPrintButtonProps> = ({
  documentType,
  documentId,
  disabled = false,
  disabledReason = "Cannot print this document",
  size = "small",
  tooltip = "Print / Preview Report",
  icon = <PrintIcon />,
  baseUrl,
  onClick,
}) => {
  const handlePrint = () => {
    if (onClick) {
      onClick();
    } else {
      const reportUrl = getReportUrl(documentType, documentId, baseUrl);
      window.open(reportUrl, "_blank");
    }
  };

  const tooltipTitle = disabled ? disabledReason : tooltip;

  return (
    <Tooltip title={tooltipTitle}>
      <span>
        <IconButton size={size} disabled={disabled} onClick={handlePrint}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
};

export default TPrintButton;
