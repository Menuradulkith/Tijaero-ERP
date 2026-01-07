/**
 * TTable - Standardized table component
 * 
 * Simple table for displaying tabular data without the overhead of DataGrid.
 * Best for smaller datasets or simple read-only displays.
 * 
 * @example
 * ```tsx
 * <TTable
 *   data={items}
 *   columns={[
 *     { field: "name", header: "Name" },
 *     { field: "quantity", header: "Qty", align: "right" },
 *     { field: "price", header: "Price", type: "currency" },
 *   ]}
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
  Paper,
  Typography,
  Box,
  Skeleton,
} from "@mui/material";
import { TStatusChip, StatusMapName } from "../base/TStatusChip";
import { format } from "date-fns";

export interface TTableColumn<T = Record<string, unknown>> {
  /** Field name in data object */
  field: string;
  /** Column header */
  header: string;
  /** Column width */
  width?: number | string;
  /** Text alignment */
  align?: "left" | "center" | "right";
  /** Column type */
  type?: "text" | "number" | "currency" | "date" | "datetime" | "boolean" | "status";
  /** Status map for status type */
  statusMap?: StatusMapName;
  /** Custom render function */
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
}

export interface TTableProps<T = Record<string, unknown>> {
  /** Table data */
  data: T[];
  /** Column definitions */
  columns: TTableColumn<T>[];
  /** Row click handler */
  onRowClick?: (row: T, index: number) => void;
  /** Loading state */
  loading?: boolean;
  /** Loading skeleton rows */
  loadingRows?: number;
  /** Empty message */
  emptyMessage?: string;
  /** Table size */
  size?: "small" | "medium";
  /** Sticky header */
  stickyHeader?: boolean;
  /** Max height for scrollable table */
  maxHeight?: number | string;
  /** Get row key */
  getRowKey?: (row: T, index: number) => string | number;
  /** Hover effect on rows */
  hover?: boolean;
  /** Striped rows */
  striped?: boolean;
  /** Dense padding */
  dense?: boolean;
}

// Format cell value based on type
const formatValue = (
  value: unknown,
  type?: TTableColumn["type"]
): React.ReactNode => {
  if (value === null || value === undefined) return "-";

  switch (type) {
    case "currency":
      const num = Number(value);
      if (isNaN(num)) return "-";
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(num);

    case "date":
      try {
        return format(new Date(String(value)), "MMM dd, yyyy");
      } catch {
        return "-";
      }

    case "datetime":
      try {
        return format(new Date(String(value)), "MMM dd, yyyy HH:mm");
      } catch {
        return "-";
      }

    case "number":
      const n = Number(value);
      return isNaN(n) ? "-" : n.toLocaleString();

    case "boolean":
      return value ? "Yes" : "No";

    default:
      return String(value);
  }
};

export function TTable<T = Record<string, unknown>>({
  data,
  columns,
  onRowClick,
  loading = false,
  loadingRows = 5,
  emptyMessage = "No data available",
  size = "medium",
  stickyHeader = false,
  maxHeight,
  getRowKey,
  hover = true,
  striped = false,
  dense = false,
}: TTableProps<T>) {
  const tableSize = dense ? "small" : size;

  // Get cell value from row
  const getCellValue = (row: T, field: string): unknown => {
    const keys = field.split(".");
    let value: unknown = row;
    for (const key of keys) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return value;
  };

  // Render loading skeleton
  if (loading) {
    return (
      <TableContainer component={Paper} sx={{ maxHeight }}>
        <Table size={tableSize} stickyHeader={stickyHeader}>
          <TableHead>
            <TableRow>
              {columns.map((col, idx) => (
                <TableCell
                  key={idx}
                  align={col.align}
                  style={{ width: col.width }}
                >
                  {col.header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: loadingRows }).map((_, rowIdx) => (
              <TableRow key={rowIdx}>
                {columns.map((_, colIdx) => (
                  <TableCell key={colIdx}>
                    <Skeleton variant="text" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  // Render empty state
  if (data.length === 0) {
    return (
      <TableContainer component={Paper}>
        <Table size={tableSize}>
          <TableHead>
            <TableRow>
              {columns.map((col, idx) => (
                <TableCell
                  key={idx}
                  align={col.align}
                  style={{ width: col.width }}
                >
                  {col.header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell colSpan={columns.length} align="center">
                <Box sx={{ py: 4 }}>
                  <Typography color="text.secondary">{emptyMessage}</Typography>
                </Box>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <TableContainer component={Paper} sx={{ maxHeight }}>
      <Table size={tableSize} stickyHeader={stickyHeader}>
        <TableHead>
          <TableRow>
            {columns.map((col, idx) => (
              <TableCell
                key={idx}
                align={col.align}
                style={{ width: col.width }}
                sx={{ fontWeight: 600 }}
              >
                {col.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((row, rowIdx) => (
            <TableRow
              key={getRowKey ? getRowKey(row, rowIdx) : rowIdx}
              hover={hover}
              onClick={() => onRowClick?.(row, rowIdx)}
              sx={{
                cursor: onRowClick ? "pointer" : "default",
                ...(striped && rowIdx % 2 === 1 && {
                  backgroundColor: "action.hover",
                }),
              }}
            >
              {columns.map((col, colIdx) => {
                const value = getCellValue(row, col.field);
                const align = col.align || (col.type === "number" || col.type === "currency" ? "right" : "left");

                return (
                  <TableCell key={colIdx} align={align}>
                    {col.render ? (
                      col.render(value, row, rowIdx)
                    ) : col.type === "status" ? (
                      <TStatusChip
                        status={String(value || "")}
                        statusMap={col.statusMap || "orderStatus"}
                      />
                    ) : col.type === "boolean" ? (
                      <TStatusChip status={!!value} statusMap="yesNo" />
                    ) : (
                      formatValue(value, col.type)
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default TTable;
