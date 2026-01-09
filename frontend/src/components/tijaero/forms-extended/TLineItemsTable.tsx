/**
 * TLineItemsTable - Standardized line items table for orders, invoices, etc.
 * 
 * Editable table for managing order lines, invoice lines, and similar
 * multi-line documents.
 * 
 * @example
 * ```tsx
 * <TLineItemsTable
 *   items={lineItems}
 *   columns={[
 *     { field: "product", header: "Product", type: "autocomplete", options: products },
 *     { field: "quantity", header: "Qty", type: "number", width: 100 },
 *     { field: "unitPrice", header: "Unit Price", type: "currency" },
 *     { field: "total", header: "Total", type: "computed", compute: (row) => row.quantity * row.unitPrice },
 *   ]}
 *   onAdd={handleAddItem}
 *   onRemove={handleRemoveItem}
 *   onUpdate={handleUpdateItem}
 * />
 * ```
 */

import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableFooter,
  Paper,
  TextField,
  Autocomplete,
  Typography,
  Box,
  IconButton,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { TButton } from "../base/TButton";

export interface TLineItemColumn<T = Record<string, unknown>> {
  /** Field name */
  field: string;
  /** Column header */
  header: string;
  /** Column width */
  width?: number | string;
  /** Column type */
  type?: "text" | "number" | "currency" | "autocomplete" | "computed" | "readonly";
  /** Options for autocomplete */
  options?: unknown[];
  /** Get option label for autocomplete */
  getOptionLabel?: (option: unknown) => string;
  /** Compute function for computed fields */
  compute?: (row: T, index: number) => React.ReactNode;
  /** Text alignment */
  align?: "left" | "center" | "right";
  /** Required field */
  required?: boolean;
  /** Placeholder */
  placeholder?: string;
  /** Min value for number */
  min?: number;
  /** Max value for number */
  max?: number;
  /** Step for number */
  step?: number;
}

export interface TLineItemsTableProps<T = Record<string, unknown>> {
  /** Line items */
  items: T[];
  /** Column definitions */
  columns: TLineItemColumn<T>[];
  /** Add new item handler */
  onAdd?: () => void;
  /** Remove item handler */
  onRemove?: (item: T, index: number) => void;
  /** Update item handler */
  onUpdate?: (index: number, field: string, value: unknown) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Add button label */
  addLabel?: string;
  /** Show add button */
  showAddButton?: boolean;
  /** Show row numbers */
  showRowNumbers?: boolean;
  /** Get row key */
  getRowKey?: (item: T, index: number) => string | number;
  /** Footer content (e.g., totals) */
  footer?: React.ReactNode;
  /** Empty message */
  emptyMessage?: string;
  /** Table size */
  size?: "small" | "medium";
}

// Format currency
const formatCurrency = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  const num = Number(value);
  if (isNaN(num)) return "-";
  return `Rs. ${new Intl.NumberFormat("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)}`;
};

export function TLineItemsTable<T = Record<string, unknown>>({
  items,
  columns,
  onAdd,
  onRemove,
  onUpdate,
  disabled = false,
  addLabel = "Add Item",
  showAddButton = true,
  showRowNumbers = false,
  getRowKey,
  footer,
  emptyMessage = "No items added",
  size = "small",
}: TLineItemsTableProps<T>) {
  // Get cell value
  const getCellValue = (item: T, field: string): unknown => {
    return (item as Record<string, unknown>)[field];
  };

  // Handle cell change
  const handleCellChange = (index: number, field: string, value: unknown) => {
    onUpdate?.(index, field, value);
  };

  // Render cell content based on column type
  const renderCell = (
    item: T,
    col: TLineItemColumn<T>,
    index: number
  ): React.ReactNode => {
    const value = getCellValue(item, col.field);

    // Computed columns
    if (col.type === "computed" && col.compute) {
      const computed = col.compute(item, index);
      if (typeof computed === "number") {
        return formatCurrency(computed);
      }
      return computed;
    }

    // Readonly columns
    if (col.type === "readonly" || disabled) {
      if (col.type === "currency") {
        return formatCurrency(value);
      }
      return String(value ?? "");
    }

    // Editable columns
    switch (col.type) {
      case "autocomplete":
        return (
          <Autocomplete
            value={value || null}
            options={col.options || []}
            getOptionLabel={col.getOptionLabel || ((opt) => String(opt))}
            onChange={(_, newValue) =>
              handleCellChange(index, col.field, newValue)
            }
            size="small"
            fullWidth
            disabled={disabled}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={col.placeholder}
                variant="standard"
                sx={{ minWidth: 150 }}
              />
            )}
          />
        );

      case "number":
        return (
          <TextField
            type="number"
            value={value ?? ""}
            onChange={(e) =>
              handleCellChange(
                index,
                col.field,
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
            size="small"
            variant="standard"
            disabled={disabled}
            placeholder={col.placeholder}
            inputProps={{
              min: col.min,
              max: col.max,
              step: col.step,
              style: { textAlign: col.align || "right" },
            }}
            sx={{ width: col.width || 100 }}
          />
        );

      case "currency":
        return (
          <TextField
            type="number"
            value={value ?? ""}
            onChange={(e) =>
              handleCellChange(
                index,
                col.field,
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
            size="small"
            variant="standard"
            disabled={disabled}
            placeholder={col.placeholder}
            inputProps={{
              min: 0,
              step: 0.01,
              style: { textAlign: "right" },
            }}
            sx={{ width: col.width || 120 }}
          />
        );

      default:
        return (
          <TextField
            value={value ?? ""}
            onChange={(e) => handleCellChange(index, col.field, e.target.value)}
            size="small"
            variant="standard"
            disabled={disabled}
            placeholder={col.placeholder}
            fullWidth
          />
        );
    }
  };

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size={size}>
          <TableHead>
            <TableRow>
              {showRowNumbers && (
                <TableCell sx={{ width: 50, fontWeight: 600 }}>#</TableCell>
              )}
              {columns.map((col, idx) => (
                <TableCell
                  key={idx}
                  align={col.align}
                  sx={{ fontWeight: 600, width: col.width }}
                >
                  {col.header}
                  {col.required && (
                    <Typography component="span" color="error.main">
                      {" "}
                      *
                    </Typography>
                  )}
                </TableCell>
              ))}
              {!disabled && onRemove && (
                <TableCell sx={{ width: 60 }} />
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={
                    columns.length +
                    (showRowNumbers ? 1 : 0) +
                    (!disabled && onRemove ? 1 : 0)
                  }
                  align="center"
                >
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    {emptyMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, index) => (
                <TableRow key={getRowKey ? getRowKey(item, index) : index}>
                  {showRowNumbers && (
                    <TableCell sx={{ color: "text.secondary" }}>
                      {index + 1}
                    </TableCell>
                  )}
                  {columns.map((col, colIdx) => (
                    <TableCell key={colIdx} align={col.align}>
                      {renderCell(item, col, index)}
                    </TableCell>
                  ))}
                  {!disabled && onRemove && (
                    <TableCell>
                      <Tooltip title="Remove">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onRemove(item, index)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
          {footer && (
            <TableFooter>
              <TableRow>
                <TableCell
                  colSpan={
                    columns.length +
                    (showRowNumbers ? 1 : 0) +
                    (!disabled && onRemove ? 1 : 0)
                  }
                  sx={{ borderBottom: "none" }}
                >
                  {footer}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>

      {/* Add Button */}
      {showAddButton && !disabled && onAdd && (
        <Box sx={{ mt: 1 }}>
          <TButton
            variant="text"
            startIcon={<AddIcon />}
            onClick={onAdd}
            size="small"
          >
            {addLabel}
          </TButton>
        </Box>
      )}
    </Box>
  );
}

export default TLineItemsTable;
