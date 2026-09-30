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
  GridColumnVisibilityModel,
  GridFooterContainer,
  GridPagination,
  GridPreferencePanelsValue,
  GridRowParams,
  GridPaginationModel,
  GridRowSelectionModel,
  GridSlotProps,
  GridValidRowModel,
  gridRowSelectionCountSelector,
  useGridApiContext,
  useGridSelector,
} from "@mui/x-data-grid";
import { Box, Button, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Tooltip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import DensityMediumIcon from "@mui/icons-material/DensityMedium";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import { TStatusChip, StatusMapName } from "../base/TStatusChip";
import { format } from "date-fns";
import { formatCurrency as formatCurrencyShared } from "@/utils/formatters";

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
  /**
   * Key under which this table remembers the user's row density and hidden
   * columns (per browser). Defaults to the page path + the column fields,
   * which is unique enough for one table per page; pass one explicitly when
   * a page shows several tables with the same columns.
   */
  storageKey?: string;
  /** File name (without extension) for Export CSV. Defaults to "export". */
  exportFileName?: string;
}

// Row density: the ERP list-table style uses 40px rows by default, with a
// tighter and a roomier option. Names match MUI's density prop, which pages
// already pass, so an existing `density="compact"` now means 32px rows.
type TDensity = "compact" | "standard" | "comfortable";
const DENSITY_OPTIONS: { value: TDensity; label: string; rowHeight: number; headerHeight: number }[] = [
  { value: "compact", label: "Compact", rowHeight: 32, headerHeight: 36 },
  { value: "standard", label: "Standard", rowHeight: 40, headerHeight: 40 },
  { value: "comfortable", label: "Comfortable", rowHeight: 48, headerHeight: 48 },
];

// Browser storage can be unavailable (private mode, blocked site data), so
// every access is guarded and the table works fine without it.
const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeStored = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore — the choice just won't be remembered
  }
};

declare module "@mui/x-data-grid" {
  interface FooterPropsOverrides {
    tDensity?: TDensity;
    onTDensityChange?: (density: TDensity) => void;
    exportFileName?: string;
  }
}

/**
 * Footer: table controls on the left (density, columns, export), pagination
 * on the right. Sits in the footer rather than a toolbar above the grid so
 * it adds no height — the page's own toolbar above keeps search/filters.
 */
function TDataGridFooter(props: GridSlotProps["footer"]) {
  const { tDensity = "standard", onTDensityChange, exportFileName, ...containerProps } = props;
  const apiRef = useGridApiContext();
  const [densityAnchor, setDensityAnchor] = React.useState<HTMLElement | null>(null);
  const current = DENSITY_OPTIONS.find((d) => d.value === tDensity) ?? DENSITY_OPTIONS[1];
  // Re-render when the selection changes so the Export label/behaviour
  // (all rows vs. only the ticked ones) stays in sync.
  const selectedCount = useGridSelector(apiRef, gridRowSelectionCountSelector);
  const hasSelection = selectedCount > 0;

  const controlSx = {
    color: "text.secondary",
    fontWeight: 500,
    fontSize: "0.8125rem",
    minWidth: 0,
    px: 1,
    "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } },
    "& .tdg-label": { display: { xs: "none", sm: "inline" } },
  };

  return (
    <GridFooterContainer {...containerProps} sx={{ px: 1, gap: 1, flexWrap: "wrap" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Tooltip title="Row density">
          <Button
            size="small"
            sx={controlSx}
            startIcon={<DensityMediumIcon fontSize="small" />}
            onClick={(e) => setDensityAnchor(e.currentTarget)}
            aria-haspopup="true"
            aria-expanded={Boolean(densityAnchor)}
          >
            <span className="tdg-label">{current.label}</span>
          </Button>
        </Tooltip>
        <Menu
          anchorEl={densityAnchor}
          open={Boolean(densityAnchor)}
          onClose={() => setDensityAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        >
          {DENSITY_OPTIONS.map((d) => (
            <MenuItem
              key={d.value}
              selected={d.value === tDensity}
              onClick={() => {
                onTDensityChange?.(d.value);
                setDensityAnchor(null);
              }}
            >
              <ListItemIcon>{d.value === tDensity ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
              <ListItemText primary={d.label} secondary={`${d.rowHeight}px rows`} />
            </MenuItem>
          ))}
        </Menu>
        <Tooltip title="Show or hide columns">
          <Button
            size="small"
            sx={controlSx}
            startIcon={<ViewColumnOutlinedIcon fontSize="small" />}
            onClick={() => apiRef.current.showPreferences(GridPreferencePanelsValue.columns)}
          >
            <span className="tdg-label">Columns</span>
          </Button>
        </Tooltip>
        <Tooltip title={hasSelection ? "Export the selected rows to CSV" : "Export the filtered rows to CSV"}>
          <Button
            size="small"
            sx={controlSx}
            startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
            onClick={() =>
              apiRef.current.exportDataAsCsv({
                fileName: exportFileName || "export",
                utf8WithBom: true,
                // Export only the ticked rows when any are selected —
                // otherwise every visible (filtered) row, same as before.
                getRowsToExport: hasSelection
                  ? ({ apiRef: api }) => [...api.current.getSelectedRows().keys()]
                  : undefined,
              })
            }
          >
            <span className="tdg-label">Export{hasSelection ? ` (${selectedCount})` : ""}</span>
          </Button>
        </Tooltip>
      </Box>
      <GridPagination />
    </GridFooterContainer>
  );
}

// Format currency value using the ERP's active currency (Settings > Company
// Configuration > Currency), not a hardcoded symbol/locale.
const formatCurrency = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  const num = Number(value);
  if (isNaN(num)) return "-";
  return formatCurrencyShared(num);
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

  // MUI X v8 only vertically centers plain text cells (via line-height); a
  // renderCell's content is a block element that otherwise sits at the top
  // of the row. `display: "flex"` opts the cell into the flex+centered
  // layout so custom-rendered content (chips, dates, currency, buttons)
  // lines up with the plain-text columns in the same row.
  if (base.renderCell) {
    base.display = "flex";
  }

  // A header lines up with its column's content (right-aligned amounts get
  // right-aligned headers), unless the column says otherwise. Set after the
  // type switch, which can change `align`.
  base.headerAlign = col.headerAlign || base.align;

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
  storageKey,
  exportFileName,
}: TDataGridProps<R>) {
  const [paginationModel, setPaginationModel] = React.useState<GridPaginationModel>({
    page: 0,
    pageSize,
  });

  const gridColumns = React.useMemo(
    () => columns.filter(c => !c.hide).map(toGridColDef),
    [columns]
  );

  // Per-user table preferences (density, hidden columns), remembered in this
  // browser. The key is fixed at mount so it doesn't drift if the page
  // re-orders its columns later.
  const fieldsKey = columns.map((c) => c.field).join(",");
  const prefsKey = React.useMemo(
    () => `tdg:${storageKey ?? `${window.location.pathname}:${fieldsKey}`}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fixed at mount
    []
  );
  const [tDensity, setTDensity] = React.useState<TDensity>(() =>
    readStored<TDensity>(`${prefsKey}:density`, density)
  );
  const [columnVisibilityModel, setColumnVisibilityModel] = React.useState<GridColumnVisibilityModel>(() =>
    readStored<GridColumnVisibilityModel>(`${prefsKey}:columns`, {})
  );
  const densityOption = DENSITY_OPTIONS.find((d) => d.value === tDensity) ?? DENSITY_OPTIONS[1];

  const handleDensityChange = (next: TDensity) => {
    setTDensity(next);
    writeStored(`${prefsKey}:density`, next);
  };
  const handleColumnVisibilityChange = (model: GridColumnVisibilityModel) => {
    setColumnVisibilityModel(model);
    writeStored(`${prefsKey}:columns`, model);
  };

  const handleRowClick = (params: GridRowParams<R>) => {
    onRowClick?.(params.row);
  };

  const emptyState = React.useCallback(
    () => (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          height: "100%",
          py: 5,
          px: 2,
          textAlign: "center",
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: "12px",
            display: "grid",
            placeItems: "center",
            bgcolor: "action.hover",
            color: "text.secondary",
          }}
        >
          <SearchOffIcon fontSize="small" />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {emptyMessage}
        </Typography>
      </Box>
    ),
    [emptyMessage]
  );

  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        // No explicit borderRadius here — inherits the theme's MuiPaper
        // default (12px), same as every other rounded surface in the app.
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      {toolbar && (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
          {toolbar}
        </Box>
      )}
      <Box sx={{ height: autoHeight ? "auto" : height, width: "100%" }}>
        {/* Row/header colours, lines, hover and selected styles come from
            the theme (MuiDataGrid in styles/theme.ts) so every grid in the
            app — including ones not built with TDataGrid — looks the same. */}
        <DataGrid
          rows={rows}
          columns={gridColumns}
          loading={loading}
          // Row height is set explicitly per density; MUI's own density
          // multiplier is left at "standard" so the heights are exact.
          density="standard"
          rowHeight={densityOption.rowHeight}
          columnHeaderHeight={densityOption.headerHeight}
          autoHeight={autoHeight}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={pageSizeOptions}
          disableColumnMenu={disableColumnMenu}
          // Always true: selection must only happen via the checkbox itself
          // (still clickable either way). Without this, clicking anywhere on
          // a row both opens it (onRowClick) AND toggles its checkbox, which
          // is not what a user clicking a row to view it expects.
          disableRowSelectionOnClick
          checkboxSelection={selectionMode === "multiple"}
          rowSelectionModel={selectedRows}
          onRowSelectionModelChange={onSelectionChange}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={handleColumnVisibilityChange}
          onRowClick={onRowClick ? handleRowClick : undefined}
          getRowId={getRowId}
          slots={{
            footer: TDataGridFooter,
            noRowsOverlay: emptyState,
            noResultsOverlay: emptyState,
          }}
          slotProps={{
            footer: { tDensity, onTDensityChange: handleDensityChange, exportFileName },
            loadingOverlay: { variant: "skeleton", noRowsVariant: "skeleton" },
          }}
          sx={{
            // The surrounding Paper draws the border and radius.
            border: "none",
            borderRadius: 0,
            "& .MuiDataGrid-row": {
              cursor: onRowClick ? "pointer" : "default",
            },
            // A center-aligned header's title+sort-icon container is itself
            // centered, but the icon's reserved space still pulls the label
            // off-center visually — pull the icon out of the flex flow so
            // the label alone centers within the header cell.
            "& .MuiDataGrid-columnHeader--alignCenter .MuiDataGrid-columnHeaderTitleContainer": {
              position: "relative",
              justifyContent: "center",
            },
            "& .MuiDataGrid-columnHeader--alignCenter .MuiDataGrid-columnHeaderTitleContainerContent": {
              flex: "0 1 auto",
            },
            "& .MuiDataGrid-columnHeader--alignCenter .MuiDataGrid-iconButtonContainer": {
              position: "absolute",
              right: 0,
            },
          }}
        />
      </Box>
    </Paper>
  );
}

export default TDataGrid;
