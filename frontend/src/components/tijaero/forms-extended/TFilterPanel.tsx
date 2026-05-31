/**
 * TFilterPanel - Composable filter panel components
 * 
 * Provides simple, composable filter components for common filtering patterns.
 * Use these for simple filter panels, or use TFilterBar for config-based filtering.
 * 
 * @example
 * ```tsx
 * // Composable approach
 * <TFilterPanel>
 *   <TBranchFilter
 *     branches={branches}
 *     value={branchCode}
 *     onChange={setBranchCode}
 *   />
 *   <TStatusFilter
 *     options={statusOptions}
 *     value={status}
 *     onChange={setStatus}
 *   />
 * </TFilterPanel>
 * 
 * // Or use TFilterBar for config-based approach
 * <TFilterBar
 *   filters={[...]}
 *   values={values}
 *   onChange={handleChange}
 * />
 * ```
 */

import React, { ReactNode } from "react";
import { Box, TextField, Autocomplete } from "@mui/material";

// =============================================================================
// TFilterPanel - Container for filter controls
// =============================================================================

export interface TFilterPanelProps {
  /** Filter components to render */
  children?: ReactNode;
  /** Padding */
  padding?: number | string;
  /** Gap between filters */
  gap?: number | string;
  /** Direction */
  direction?: "row" | "column";
}

/**
 * Container for filter controls with consistent styling
 */
export const TFilterPanel: React.FC<TFilterPanelProps> = ({
  children,
  padding = "12px",
  gap = 1,
  direction = "column",
}) => {
  return (
    <Box
      sx={{
        px: typeof padding === "number" ? padding : 1.5,
        py: typeof padding === "number" ? padding * 0.67 : 1,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: direction,
        gap,
      }}
    >
      {children}
    </Box>
  );
};

// =============================================================================
// Common types
// =============================================================================

/** Branch entity for filter */
export interface TFilterBranch {
  branch_code: string;
  branch_name: string;
}

/** Supplier entity for filter */
export interface TFilterSupplier {
  id: number;
  full_name: string;
  company_name?: string;
}

/** Status option for filter */
export interface TFilterStatusOption {
  value: string | null;
  label: string;
}

// =============================================================================
// TBranchFilter - Branch autocomplete filter
// =============================================================================

export interface TBranchFilterProps {
  /** Available branches */
  branches: TFilterBranch[];
  /** Currently selected branch code */
  value: string | null;
  /** Change handler */
  onChange: (branchCode: string | null) => void;
  /** Label text */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Component size */
  size?: "small" | "medium";
  /** Full width */
  fullWidth?: boolean;
}

/**
 * Branch autocomplete filter component
 */
export const TBranchFilter: React.FC<TBranchFilterProps> = ({
  branches,
  value,
  onChange,
  label = "Filter by Branch",
  placeholder = "All Branches",
  size = "small",
  fullWidth = true,
}) => {
  return (
    <Autocomplete
      size={size}
      fullWidth={fullWidth}
      options={branches}
      getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
      value={branches.find((b) => b.branch_code === value) || null}
      onChange={(_, newValue) => onChange(newValue?.branch_code || null)}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} size={size} />
      )}
    />
  );
};

// =============================================================================
// TSupplierFilter - Supplier autocomplete filter
// =============================================================================

export interface TSupplierFilterProps {
  /** Available suppliers */
  suppliers: TFilterSupplier[];
  /** Currently selected supplier ID */
  value: number | null;
  /** Change handler */
  onChange: (supplierId: number | null) => void;
  /** Label text */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Component size */
  size?: "small" | "medium";
  /** Full width */
  fullWidth?: boolean;
}

/**
 * Supplier autocomplete filter component
 */
export const TSupplierFilter: React.FC<TSupplierFilterProps> = ({
  suppliers,
  value,
  onChange,
  label = "Filter by Supplier",
  placeholder = "All Suppliers",
  size = "small",
  fullWidth = true,
}) => {
  return (
    <Autocomplete
      size={size}
      fullWidth={fullWidth}
      options={suppliers}
      getOptionLabel={(option: TFilterSupplier) =>
        option.company_name
          ? `${option.full_name} (${option.company_name})`
          : option.full_name
      }
      value={suppliers.find((s) => s.id === value) || null}
      onChange={(_, newValue: TFilterSupplier | null) => onChange(newValue?.id || null)}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} size={size} />
      )}
    />
  );
};

// =============================================================================
// TStatusFilter - Status autocomplete filter
// =============================================================================

export interface TStatusFilterProps {
  /** Available status options */
  options: TFilterStatusOption[];
  /** Currently selected status */
  value: string | null;
  /** Change handler */
  onChange: (status: string | null) => void;
  /** Label text */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Component size */
  size?: "small" | "medium";
  /** Full width */
  fullWidth?: boolean;
}

/**
 * Status autocomplete filter component
 */
export const TStatusFilter: React.FC<TStatusFilterProps> = ({
  options,
  value,
  onChange,
  label = "Filter by Status",
  placeholder = "All Statuses",
  size = "small",
  fullWidth = true,
}) => {
  const currentOption = options.find((o) => o.value === value) || options.find((o) => o.value === null);

  return (
    <Autocomplete
      size={size}
      fullWidth={fullWidth}
      options={options}
      getOptionLabel={(option) => option.label}
      value={currentOption || null}
      onChange={(_, newValue) => onChange(newValue?.value || null)}
      isOptionEqualToValue={(option, val) => option.value === val.value}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} size={size} />
      )}
    />
  );
};

// =============================================================================
// Preset status options for common use cases
// =============================================================================

/** Purchase Order status filter options */
export const PO_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Purchase Return status filter options */
export const RETURN_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

/** GRN status filter options */
export const GRN_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "received", label: "Received" },
  { value: "partial", label: "Partial" },
  { value: "complete", label: "Complete" },
];

/** Invoice status filter options */
export const INVOICE_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];

/** Sales Order status filter options */
export const SALES_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

/** Service Job status filter options */
export const SERVICE_JOB_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "accepted_by_technician", label: "Accepted by Technician" },
  { value: "check_in_progress", label: "Check in Progress" },
  { value: "repair_in_progress_", label: "Repair in Progress" },
  { value: "parts_pending", label: "Parts Pending" },
  { value: "ready_to_collect", label: "Ready to Collect" },
  { value: "informed_to_customer", label: "Informed to Customer" },
  { value: "closed", label: "Closed" },
];

/** Reimbursement status filter options */
export const REIMBURSEMENT_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "partial_approved", label: "Partial Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "verified", label: "Verified" },
  { value: "completed", label: "Completed" },
];

/** Quotation status filter options */
export const QUOTATION_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "accepted", label: "Accepted" },
  { value: "partially_processed", label: "Partially Processed" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "converted", label: "Converted to Proforma" },
  { value: "cancelled", label: "Cancelled" },
  { value: "revised", label: "Revised" },
];

/** Proforma Invoice status filter options */
export const PROFORMA_STATUS_FILTER_OPTIONS: TFilterStatusOption[] = [
  { value: null, label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "accepted", label: "Accepted" },
  { value: "partially_processed", label: "Partially Processed" },
  { value: "completed", label: "Completed" },
  { value: "po_created", label: "PO Created" },
  { value: "item_received", label: "Item Received" },
  { value: "so_created", label: "SO Created" },
  { value: "converted_to_invoice", label: "Converted to Invoice" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export default TFilterPanel;
