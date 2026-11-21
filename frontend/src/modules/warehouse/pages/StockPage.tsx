/**
 * Warehouse > Stock: the central stock page. One server-paged grid of items
 * on hand by branch / location; click a row for the item's lots & serials
 * and its movement history. Filters live in the URL so Dashboard tiles and
 * other pages can link here pre-filtered.
 */
import { usePermission } from "@/auth/permissions";
import { TDataGrid, TDataGridColumn } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { useCurrencyStore } from "@/state/currencyStore";
import { todayISO } from "@/utils/formatters";
import { Search as SearchIcon, Warning as AlertIcon } from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ItemStockDrawer from "../components/ItemStockDrawer";
import { numParam, useDebouncedUrlText, useUrlFilters } from "../components/useUrlFilters";
import {
  STOCK_BUCKET_OPTIONS,
  fetchAllPages,
  warehouseStockApi,
  type OnHandParams,
  type OnHandRow,
  type OnHandSortField,
  type StockBucket,
} from "../stockApi";

const FILTER_KEYS = ["q", "branch_code", "location_id", "category_id", "brand_id", "bucket"] as const;

/** "all" in the URL means the user chose every branch (no default branch). */
const ALL = "all";

const SORTABLE: Record<string, OnHandSortField> = {
  item_name: "item_name",
  item_code: "item_code",
  on_hand: "on_hand",
  available: "available",
  value: "value",
  ageing_days: "ageing_days",
  nearest_expiry: "nearest_expiry",
  branch_code: "branch_code",
};

const rowKey = (r: OnHandRow) =>
  `${r.material_id != null ? `m${r.material_id}` : `p${r.product_id ?? ""}`}|${r.branch_code}|${r.location_id ?? ""}`;

export default function StockPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canViewCost = usePermission("cost_price", "view");
  const { filters, setFilters } = useUrlFilters(FILTER_KEYS);

  const {
    data: refData,
    isLoading: isLoadingRef,
    filteredBranches,
    filteredLocations,
    defaultBranchCode,
  } = useReferenceData(["branches", "categories", "brands", "locations"]);
  const branches = filteredBranches || [];
  const categories = refData?.categories || [];
  const brands = refData?.brands || [];
  const allLocations = filteredLocations || [];

  // No branch in the link: the user's own branch (superusers see all).
  const branch = filters.branch_code === ALL ? "" : filters.branch_code || defaultBranchCode || "";
  const locations = branch ? allLocations.filter((l) => l.branch_code === branch) : allLocations;

  const [searchText, setSearchText] = useDebouncedUrlText(filters.q, (v) => setFilters({ q: v.trim() }));

  const [paging, setPaging] = useState({ page: 0, pageSize: 25 });
  const [sort, setSort] = useState<{ field: string; sort: "asc" | "desc" } | null>(null);
  useEffect(() => {
    setPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [filters.q, filters.branch_code, filters.location_id, filters.category_id, filters.brand_id, filters.bucket, sort]);

  const baseParams: OnHandParams = {
    q: filters.q || undefined,
    branch_code: branch || undefined,
    location_id: numParam(filters.location_id),
    category_id: numParam(filters.category_id),
    brand_id: numParam(filters.brand_id),
    bucket: (filters.bucket || undefined) as StockBucket | undefined,
    sort_by: sort ? SORTABLE[sort.field] : undefined,
    order: sort?.sort,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["warehouseStock", "on-hand", baseParams, paging.page, paging.pageSize],
    queryFn: () => warehouseStockApi.getOnHand({ ...baseParams, page: paging.page + 1, size: paging.pageSize }),
    placeholderData: (prev) => prev,
  });

  const exportAll = () =>
    fetchAllPages((page, size) => warehouseStockApi.getOnHand({ ...baseParams, page, size }));

  const [selected, setSelected] = useState<OnHandRow | null>(null);

  const columns: TDataGridColumn<OnHandRow>[] = useMemo(() => {
    const num = (field: keyof OnHandRow, header: string, width = 100, sortable = false): TDataGridColumn<OnHandRow> => ({
      field: field as string,
      header,
      width,
      type: "number",
      sortable,
    });
    const cols: TDataGridColumn<OnHandRow>[] = [
      { field: "item_code", header: "Item Code", width: 130, renderCell: (p: GridRenderCellParams<OnHandRow>) => p.row.item_code || "-" },
      {
        field: "item_name",
        header: "Item",
        flex: 1,
        minWidth: 200,
        renderCell: (p: GridRenderCellParams<OnHandRow>) => (
          <span style={{ fontWeight: 500 }}>{p.row.item_name || "-"}</span>
        ),
      },
      { field: "category_name", header: "Category", width: 130, sortable: false, renderCell: (p: GridRenderCellParams<OnHandRow>) => p.row.category_name || "-" },
      { field: "brand_name", header: "Brand", width: 120, sortable: false, renderCell: (p: GridRenderCellParams<OnHandRow>) => p.row.brand_name || "-" },
      { field: "branch_code", header: "Branch", width: 100 },
      { field: "location_name", header: "Location", width: 130, sortable: false, renderCell: (p: GridRenderCellParams<OnHandRow>) => p.row.location_name || "-" },
      num("on_hand", "On Hand", 100, true),
      num("reserved", "Reserved"),
      {
        field: "available",
        header: "Available",
        width: 110,
        align: "right",
        headerAlign: "right",
        hideOnMobile: false,
        renderCell: (p: GridRenderCellParams<OnHandRow>) => {
          const low = filters.bucket === "low_stock";
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5, width: "100%" }}>
              {low && (
                <Tooltip title="At or below the reorder level">
                  <AlertIcon fontSize="small" color="warning" />
                </Tooltip>
              )}
              <span>{Number(p.row.available || 0).toLocaleString()}</span>
            </Box>
          );
        },
      },
      num("in_transit", "In Transit", 100),
      num("damaged", "Damaged", 100),
    ];
    if (canViewCost) {
      cols.push({ field: "value", header: `Value (${currencySymbol})`, width: 130, type: "currency" });
    }
    cols.push(
      num("ageing_days", "Ageing (days)", 120, true),
      {
        field: "nearest_expiry",
        header: "Nearest Expiry",
        width: 140,
        renderCell: (p: GridRenderCellParams<OnHandRow>) => {
          const d = p.row.nearest_expiry;
          if (!d) return "-";
          const expired = d < todayISO();
          return (
            <Box component="span" sx={{ color: expired ? "error.main" : undefined, fontWeight: expired ? 600 : 400 }}>
              {d}
            </Box>
          );
        },
      },
      { field: "unit_of_measure", header: "UOM", width: 80, sortable: false, renderCell: (p: GridRenderCellParams<OnHandRow>) => p.row.unit_of_measure || "-" },
    );
    return cols;
  }, [canViewCost, currencySymbol, filters.bucket]);

  const hasActiveFilters =
    !!filters.q || !!filters.location_id || !!filters.category_id || !!filters.brand_id || !!filters.bucket;

  const clearFilters = () => {
    setSearchText("");
    setFilters({ q: "", location_id: "", category_id: "", brand_id: "", bucket: "" });
  };

  const bucketLabel = STOCK_BUCKET_OPTIONS.find((b) => b.value === filters.bucket)?.label;

  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 2,
        p: { xs: 1.5, md: 2 },
        overflow: "auto",
        background:
          theme.palette.mode === "dark"
            ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
            : "linear-gradient(180deg, #f6f8fc 0%, #ffffff 280px)",
      })}
    >
      <Box>
        <Typography variant="h6" fontWeight={600}>
          Stock
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Items on hand by branch and location{bucketLabel ? ` — ${bucketLabel}` : ""}. Click a row for its lots, serials and movements.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <TextField
              fullWidth
              size="small"
              label="Search"
              placeholder="Item code or name..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={1.5}>
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(o) => o.branch_name || o.branch_code || ""}
              value={branches.find((b) => b.branch_code === branch) || null}
              onChange={(_, v) => setFilters({ branch_code: v?.branch_code || ALL, location_id: "" })}
              renderInput={(params) => <TextField {...params} label="Branch" placeholder="All branches" />}
              noOptionsText={isLoadingRef ? "Loading..." : "No branches found"}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={1.5}>
            <Autocomplete
              size="small"
              options={locations}
              getOptionLabel={(o) => o.name || ""}
              value={allLocations.find((l) => String(l.id) === filters.location_id) || null}
              onChange={(_, v) => setFilters({ location_id: v ? String(v.id) : "" })}
              renderInput={(params) => <TextField {...params} label="Location" placeholder="All locations" />}
              noOptionsText={isLoadingRef ? "Loading..." : "No locations found"}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={1.5}>
            <Autocomplete
              size="small"
              options={categories}
              getOptionLabel={(o) => o.name || ""}
              value={categories.find((c) => String(c.id) === filters.category_id) || null}
              onChange={(_, v) => setFilters({ category_id: v ? String(v.id) : "" })}
              renderInput={(params) => <TextField {...params} label="Category" placeholder="All categories" />}
              noOptionsText="No categories found"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={1.5}>
            <Autocomplete
              size="small"
              options={brands}
              getOptionLabel={(o) => o.brand_name || ""}
              value={brands.find((b) => String(b.id) === filters.brand_id) || null}
              onChange={(_, v) => setFilters({ brand_id: v ? String(v.id) : "" })}
              renderInput={(params) => <TextField {...params} label="Brand" placeholder="All brands" />}
              noOptionsText="No brands found"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={1.5}>
            <TextField
              select
              fullWidth
              size="small"
              label="Show"
              value={filters.bucket}
              onChange={(e) => setFilters({ bucket: e.target.value })}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">All</MenuItem>
              {STOCK_BUCKET_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={1.5}>
            <Button variant="outlined" size="small" fullWidth onClick={clearFilters} sx={{ height: 40 }} disabled={!hasActiveFilters}>
              Clear Filters
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {isError && <Alert severity="error">Could not load stock. Try again in a moment.</Alert>}

      <Box sx={{ flex: 1, minHeight: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TDataGrid<OnHandRow>
          rows={data?.items || []}
          columns={columns}
          loading={isLoading}
          getRowId={rowKey}
          onRowClick={(r) => setSelected(r)}
          emptyMessage={hasActiveFilters ? "No stock matches your filters" : "No stock on hand"}
          autoHeight={false}
          height="100%"
          exportFileName={`stock_${branch || "all"}${filters.bucket ? `_${filters.bucket}` : ""}`}
          exportAllRows={exportAll}
          serverPagination={{
            rowCount: data?.total || 0,
            paginationModel: paging,
            onPaginationModelChange: setPaging,
          }}
          onServerSortChange={(s) => setSort(s && SORTABLE[s.field] ? s : null)}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </Box>

      <ItemStockDrawer row={selected} open={!!selected} onClose={() => setSelected(null)} />
    </Box>
  );
}
