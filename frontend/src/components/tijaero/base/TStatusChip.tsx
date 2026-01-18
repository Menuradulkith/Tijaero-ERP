/**
 * TStatusChip - Standardized status indicator chip
 * 
 * Provides consistent status display with predefined status maps
 * for common ERP status types.
 * 
 * @example
 * ```tsx
 * <TStatusChip status="active" statusMap="activeInactive" />
 * <TStatusChip status="approved" statusMap="orderStatus" />
 * <TStatusChip 
 *   status="custom" 
 *   customMap={{ custom: { label: "Custom", color: "info" }}} 
 * />
 * ```
 */

import { Chip, ChipProps } from "@mui/material";
import React from "react";

// Status color type
type StatusColor = "default" | "primary" | "secondary" | "success" | "error" | "warning" | "info";

// Status map entry
interface StatusMapEntry {
  label: string;
  color: StatusColor;
}

// Predefined status maps for common ERP scenarios
export const STATUS_MAPS = {
  // Active/Inactive status
  activeInactive: {
    active: { label: "Active", color: "success" as StatusColor },
    inactive: { label: "Inactive", color: "default" as StatusColor },
    true: { label: "Active", color: "success" as StatusColor },
    false: { label: "Inactive", color: "default" as StatusColor },
  },

  // Order/Document status
  orderStatus: {
    draft: { label: "Draft", color: "default" as StatusColor },
    pending: { label: "Pending", color: "warning" as StatusColor },
    pending_approval: { label: "Pending Approval", color: "warning" as StatusColor },
    approved: { label: "Approved", color: "info" as StatusColor },
    rejected: { label: "Rejected", color: "error" as StatusColor },
    cancelled: { label: "Cancelled", color: "default" as StatusColor },
    completed: { label: "Completed", color: "success" as StatusColor },
    closed: { label: "Closed", color: "default" as StatusColor },
  },

  // Purchase order status
  purchaseStatus: {
    draft: { label: "Draft", color: "default" as StatusColor },
    submitted: { label: "Submitted", color: "info" as StatusColor },
    pending_approval: { label: "Pending Approval", color: "warning" as StatusColor },
    approved: { label: "Approved", color: "success" as StatusColor },
    rejected: { label: "Rejected", color: "error" as StatusColor },
    partially_received: { label: "Partially Received", color: "info" as StatusColor },
    received: { label: "Received", color: "success" as StatusColor },
    cancelled: { label: "Cancelled", color: "default" as StatusColor },
  },

  // Payment status
  paymentStatus: {
    unpaid: { label: "Unpaid", color: "error" as StatusColor },
    partial: { label: "Partial", color: "warning" as StatusColor },
    paid: { label: "Paid", color: "success" as StatusColor },
    overdue: { label: "Overdue", color: "error" as StatusColor },
    refunded: { label: "Refunded", color: "info" as StatusColor },
  },

  // Verification status
  verificationStatus: {
    unverified: { label: "Unverified", color: "warning" as StatusColor },
    verified: { label: "Verified", color: "success" as StatusColor },
    pending: { label: "Pending", color: "info" as StatusColor },
    failed: { label: "Failed", color: "error" as StatusColor },
  },

  // Priority levels
  priority: {
    low: { label: "Low", color: "default" as StatusColor },
    medium: { label: "Medium", color: "info" as StatusColor },
    high: { label: "High", color: "warning" as StatusColor },
    urgent: { label: "Urgent", color: "error" as StatusColor },
    critical: { label: "Critical", color: "error" as StatusColor },
  },

  // Stock status
  stockStatus: {
    in_stock: { label: "In Stock", color: "success" as StatusColor },
    low_stock: { label: "Low Stock", color: "warning" as StatusColor },
    out_of_stock: { label: "Out of Stock", color: "error" as StatusColor },
    reserved: { label: "Reserved", color: "info" as StatusColor },
  },

  // Employee status
  employeeStatus: {
    active: { label: "Active", color: "success" as StatusColor },
    on_leave: { label: "On Leave", color: "warning" as StatusColor },
    suspended: { label: "Suspended", color: "error" as StatusColor },
    terminated: { label: "Terminated", color: "default" as StatusColor },
  },

  // Yes/No boolean
  yesNo: {
    true: { label: "Yes", color: "success" as StatusColor },
    false: { label: "No", color: "default" as StatusColor },
    yes: { label: "Yes", color: "success" as StatusColor },
    no: { label: "No", color: "default" as StatusColor },
  },

  // Purchase order (alias for purchaseStatus)
  purchaseOrder: {
    draft: { label: "Draft", color: "default" as StatusColor },
    submitted: { label: "Submitted", color: "info" as StatusColor },
    pending_approval: { label: "Pending Approval", color: "warning" as StatusColor },
    approved: { label: "Approved", color: "info" as StatusColor },
    rejected: { label: "Rejected", color: "error" as StatusColor },
    partially_received: { label: "Partially Received", color: "info" as StatusColor },
    received: { label: "Received", color: "success" as StatusColor },
    cancelled: { label: "Cancelled", color: "default" as StatusColor },
    pending: { label: "Pending", color: "warning" as StatusColor },
    completed: { label: "Completed", color: "success" as StatusColor },
    closed: { label: "Closed", color: "default" as StatusColor },
  },

  // Quote/Proforma status
  quoteStatus: {
    draft: { label: "Draft", color: "default" as StatusColor },
    pending_approval: { label: "Pending Approval", color: "warning" as StatusColor },
    approved: { label: "Approved", color: "info" as StatusColor },
    sent: { label: "Sent", color: "secondary" as StatusColor },
    accepted: { label: "Accepted", color: "success" as StatusColor },
    rejected: { label: "Rejected", color: "error" as StatusColor },
    expired: { label: "Expired", color: "warning" as StatusColor },
    converted: { label: "Converted", color: "success" as StatusColor },
    cancelled: { label: "Cancelled", color: "default" as StatusColor },
    revised: { label: "Revised", color: "default" as StatusColor },
  },

  // Purchase return status
  purchaseReturn: {
    draft: { label: "Draft", color: "default" as StatusColor },
    pending: { label: "Pending", color: "warning" as StatusColor },
    approved: { label: "Approved", color: "info" as StatusColor },
    rejected: { label: "Rejected", color: "error" as StatusColor },
  },

  // Sales return status
  salesReturn: {
    pending: { label: "Pending", color: "warning" as StatusColor },
    approved: { label: "Approved", color: "info" as StatusColor },
    processed: { label: "Processed", color: "success" as StatusColor },
    rejected: { label: "Rejected", color: "error" as StatusColor },
  },

  // GRN (Goods Received Note) status
  grn: {
    draft: { label: "Draft", color: "default" as StatusColor },
    received: { label: "Received", color: "success" as StatusColor },
    partial: { label: "Partial", color: "warning" as StatusColor },
    complete: { label: "Complete", color: "info" as StatusColor },
  },

  // Sales order status
  salesOrder: {
    draft: { label: "Draft", color: "default" as StatusColor },
    pending: { label: "Pending", color: "warning" as StatusColor },
    confirmed: { label: "Confirmed", color: "info" as StatusColor },
    processing: { label: "Processing", color: "info" as StatusColor },
    shipped: { label: "Shipped", color: "primary" as StatusColor },
    delivered: { label: "Delivered", color: "success" as StatusColor },
    cancelled: { label: "Cancelled", color: "error" as StatusColor },
  },

  // Invoice status
  invoice: {
    draft: { label: "Draft", color: "default" as StatusColor },
    pending: { label: "Pending", color: "warning" as StatusColor },
    sent: { label: "Sent", color: "info" as StatusColor },
    paid: { label: "Paid", color: "success" as StatusColor },
    overdue: { label: "Overdue", color: "error" as StatusColor },
    cancelled: { label: "Cancelled", color: "default" as StatusColor },
  },

  // Service job status
  serviceJob: {
    accepted_by_technician: { label: "Accepted by Technician", color: "info" as StatusColor },
    check_in_progress: { label: "Check in Progress", color: "info" as StatusColor },
    repair_in_progress_: { label: "Repair in Progress", color: "primary" as StatusColor },
    received_from_supplier: { label: "Received from Supplier", color: "info" as StatusColor },
    parts_pending: { label: "Parts Pending", color: "warning" as StatusColor },
    sent_to_supplier: { label: "Sent to Supplier", color: "info" as StatusColor },
    supplier_pending: { label: "Supplier Pending", color: "warning" as StatusColor },
    rejected_by_supplier: { label: "Rejected by Supplier", color: "error" as StatusColor },
    replacement_accepted: { label: "Replacement Accepted", color: "success" as StatusColor },
    warranty_rejected: { label: "Warranty Rejected", color: "error" as StatusColor },
    cannot_repair: { label: "Cannot Repair", color: "error" as StatusColor },
    ready_to_collect: { label: "Ready to Collect", color: "success" as StatusColor },
    informed_to_customer: { label: "Informed to Customer", color: "info" as StatusColor },
    rejected_by_customer: { label: "Rejected by Customer", color: "error" as StatusColor },
    estimate_approval_pending_of_customer: { label: "Estimate Approval Pending", color: "warning" as StatusColor },
    estimate_approved_by_customer: { label: "Estimate Approved", color: "success" as StatusColor },
    estimate_pending_sales_division: { label: "Estimate Pending - Sales", color: "warning" as StatusColor },
    closed: { label: "Closed", color: "default" as StatusColor },
  },
} as const;

export type StatusMapName = keyof typeof STATUS_MAPS;

export interface TStatusChipProps extends Omit<ChipProps, "color" | "label"> {
  /** Status value */
  status: string | boolean | number;
  /** Predefined status map name */
  statusMap?: StatusMapName;
  /** Custom status map (overrides statusMap) */
  customMap?: Record<string, StatusMapEntry>;
  /** Fallback label if status not found */
  fallbackLabel?: string;
  /** Chip size */
  size?: "small" | "medium";
  /** Chip variant */
  variant?: "filled" | "outlined";
}

/**
 * Get status props (label and color) from a status value and map
 * Useful for passing to other components that need status display info
 * 
 * @example
 * ```tsx
 * const { label, color } = getStatusProps("approved", "purchaseOrder");
 * // returns { label: "Approved", color: "success" }
 * ```
 */
export function getStatusProps(
  status: string | boolean | number,
  statusMap: StatusMapName = "activeInactive",
  fallbackLabel?: string
): { label: string; color: StatusColor } {
  const statusKey = String(status).toLowerCase().replace(/\s+/g, "_");
  const map = STATUS_MAPS[statusMap] || STATUS_MAPS.activeInactive;
  const entry = (map as Record<string, StatusMapEntry>)[statusKey];

  return {
    label: entry?.label || fallbackLabel || String(status),
    color: entry?.color || "default",
  };
}

export const TStatusChip: React.FC<TStatusChipProps> = ({
  status,
  statusMap = "activeInactive",
  customMap,
  fallbackLabel,
  size = "small",
  variant = "filled",
  sx,
  ...rest
}) => {
  // Normalize status to string
  const statusKey = String(status).toLowerCase().replace(/\s+/g, "_");

  // Get the map to use
  const map = customMap || STATUS_MAPS[statusMap] || STATUS_MAPS.activeInactive;

  // Find the status entry
  const entry = (map as Record<string, StatusMapEntry>)[statusKey];

  // Determine label and color
  const label = entry?.label || fallbackLabel || String(status);
  const color = entry?.color || "default";

  return (
    <Chip
      {...rest}
      label={label}
      color={color}
      size={size}
      variant={variant}
      sx={{
        fontWeight: 500,
        textTransform: "capitalize",
        ...sx,
      }}
    />
  );
};

export default TStatusChip;
