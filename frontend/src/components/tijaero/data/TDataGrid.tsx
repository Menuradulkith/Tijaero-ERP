/**
 * TDataGrid - Standardized data grid component
 * 
 * Wrapper around MUI X DataGrid with ERP-specific defaults and styling.
 * Includes built-in support for:
 * - Row selection
 * - Pagination
 * - Sorting
 * - Loading states
 * - Action columns
 * 
 * @example
 * ```tsx
 * <TDataGrid
 *   rows={orders}
 *   columns={[
 *     { field: "orderNumber", header: "Order #", width: 120 },
 *     { field: "customer", header: "Customer" },
 *     { field: "total", header: "Total", type: "currency" },
 *     { field: "status", header: "Status", type: "status", statusMap: "orderStatus" },
 *   ]}
 *   onRowClick={handleRowClick}
 *   loading={isLoading}
 * />
 * ```
 */

import React from "react";
import {
  DataGrid,
  GridColDef,
  GridRowParams,
  GridPaginationModel,
  GridRowSelectionModel,
  GridValidRowModel,
} from "@mui/x-data-grid";
import { Box, Paper, Typography } from "@mui/material";
import { TStatusChip, StatusMapName } from "../base/TStatusChip";
import { format } from "date-fns";

// Column type for easier configuration
export interface TDataGridColumn<R extends GridValidRowModel = GridValidRowModel> {
  /** Field name in the data object */
  field: string;
  /** Column header text */
  header: string;
  /** Column width */
  width?: number;
  /** Minimum column width */
  minWidth?: number;
  /** Allow column to grow */
  flex?: number;
  /** Column type for automatic formatting */
  type?: "text" | "number" | "currency" | "date" | "datetime" | "boolean" | "status";
  /** Status map for status type columns */
  statusMap?: StatusMapName;
  /** Custom cell renderer */
  renderCell?: GridColDef<R>["renderCell"];
  /** Sortable */
  sortable?: boolean;
  /** Text alignment */
  align?: "left" | "center" | "right";
  /** Header alignment */
  headerAlign?: "left" | "center" | "right";
  /** Hide column */
  hide?: boolean;
}

export interface TDataGridProps<R extends GridValidRowModel = GridValidRowModel> {
  /** Data rows */
  rows: R[];
  /** Column definitions */
  columns: TDataGridColumn<R>[];
  /** Row click handler */
  onRowClick?: (row: R) => void;
  /** Loading state */
  loading?: boolean;
  /** Row selection mode */
  selectionMode?: "none" | "single" | "multiple";
  /** Selected row IDs */
  selectedRows?: GridRowSelectionModel;
  /** Selection change handler */
  onSelectionChange?: (selection: GridRowSelectionModel) => void;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Initial page size */
  pageSize?: number;
  /** Show toolbar */
  showToolbar?: boolean;
  /** Get row ID */
  getRowId?: (row: R) => string | number;
  /** Auto height (fit to content) */
  autoHeight?: boolean;
  /** Fixed height */
  height?: number | string;
  /** Density */
  density?: "compact" | "standard" | "comfortable";
  /** Empty message */
  emptyMessage?: string;
  /** Disable column menu */
  disableColumnMenu?: boolean;
  /** Custom toolbar component */
  toolbar?: React.ReactNode;
}

// Format currency value
const formatCurrency = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  const num = Number(value);
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
};

// Format date value
const formatDate = (value: unknown, includeTime = false): string => {
  if (!value) return "-";
  try {
    const date = new Date(String(value));
    return format(date, includeTime ? "MMM dd, yyyy HH:mm" : "MMM dd, yyyy");
  } catch {
    return "-";
  }
};

// Convert our column config to GridColDef
const toGridColDef = <R extends GridValidRowModel>(
  col: TDataGridColumn<R>
): GridColDef<R> => {
  const base: GridColDef<R> = {
    field: col.field,
    headerName: col.header,
    width: col.width,
    minWidth: col.minWidth || (col.type === "status" ? 100 : 80),
    flex: col.flex,
    sortable: col.sortable !== false,
    align: col.align || (col.type === "number" || col.type === "currency" ? "right" : "left"),
    headerAlign: col.headerAlign || col.align || "left",
    hideable: true,
  };

  // Apply type-specific formatting
  switch (col.type) {
    case "currency":
      base.valueFormatter = (value) => formatCurrency(value);
      base.align = col.align || "right";
      break;
    case "date":
      base.valueFormatter = (value) => formatDate(value);
      break;
    case "datetime":
      base.valueFormatter = (value) => formatDate(value, true);
      break;
    case "boolean":
      base.renderCell = (params) => (
        <TStatusChip status={params.value} statusMap="yesNo" />
      );
      break;
    case "status":
      base.renderCell = (params) => (
        <TStatusChip 
          status={params.value || ""} 
          statusMap={col.statusMap || "orderStatus"} 
        />
      );
      break;
    case "number":
      base.valueFormatter = (value) => {
        if (value === null || value === undefined) return "-";
        const num = Number(value);
        return isNaN(num) ? "-" : num.toLocaleString();
      };
      base.align = col.align || "right";
      break;
  }

  // Override with custom renderer if provided
  if (col.renderCell) {
    base.renderCell = col.renderCell;
  }

  return base;
};

export function TDataGrid<R extends GridValidRowModel = GridValidRowModel>({
  rows,
  columns,
  onRowClick,
  loading = false,
  selectionMode = "none",
  selectedRows,
  onSelectionChange,
  pageSizeOptions = [10, 25, 50, 100],
  pageSize = 25,
  showToolbar: _showToolbar = false,
  getRowId,
  autoHeight = false,
  height = 500,
  density = "standard",
  emptyMessage = "No data available",
  disableColumnMenu = false,
  toolbar,
}: TDataGridProps<R>) {
  const [paginationModel, setPaginationModel] = React.useState<GridPaginationModel>({
    page: 0,
    pageSize,
  });

  const gridColumns = React.useMemo(
    () => columns.filter(c => !c.hide).map(toGridColDef),
    [columns]
  );

  const handleRowClick = (params: GridRowParams<R>) => {
    onRowClick?.(params.row);
  };

  return (
    <Paper elevation={0} sx={{ width: "100%" }}>
      {toolbar && (
        <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
          {toolbar}
        </Box>
      )}
      <Box sx={{ height: autoHeight ? "auto" : height, width: "100%" }}>
        <DataGrid
          rows={rows}
          columns={gridColumns}
          loading={loading}
          density={density}
          autoHeight={autoHeight}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={pageSizeOptions}
          disableColumnMenu={disableColumnMenu}
          disableRowSelectionOnClick={selectionMode === "none"}
          checkboxSelection={selectionMode === "multiple"}
          rowSelectionModel={selectedRows}
          onRowSelectionModelChange={onSelectionChange}
          onRowClick={onRowClick ? handleRowClick : undefined}
          getRowId={getRowId}
          slots={{
            noRowsOverlay: () => (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                }}
              >
                <Typography color="text.secondary">{emptyMessage}</Typography>
              </Box>
            ),
          }}
          sx={{
            border: "none",
            "& .MuiDataGrid-cell:focus": {
              outline: "none",
            },
            "& .MuiDataGrid-row": {
              cursor: onRowClick ? "pointer" : "default",
            },
            "& .MuiDataGrid-row:hover": {
              backgroundColor: onRowClick ? "action.hover" : undefined,
            },
          }}
        />
      </Box>
    </Paper>
  );
}

export default TDataGrid;
