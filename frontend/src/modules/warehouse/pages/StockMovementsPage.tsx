/**
 * Warehouse > Stock Movements: the stock ledger — every receipt, issue, sale,
 * transfer and adjustment. Filters live in the URL so other pages can deep-link
 * (material_id, product_id, stock_id, movement_type, reference_type, reference_id, dates...).
 * Stock is keyed by Item Catalog item, so the visible filter is "Item" (material_id);
 * old links with product_id still work and show as a removable chip.
 */
import { usePermission } from "@/auth/permissions";
import { TDataGrid, handleApiError } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { materialsApi } from "@/modules/materials/api";
import { useCurrencyStore } from "@/state/currencyStore";
import { Download as DownloadIcon, Search as SearchIcon } from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { buildMovementColumns } from "../components/movementColumns";
import { numParam, useDebouncedUrlText, useUrlFilters } from "../components/useUrlFilters";
import {
  MOVEMENT_TYPES,
  REFERENCE_TYPE_OPTIONS,
  fetchAllPages,
  referenceTypeLabel,
  warehouseStockApi,
  type MovementParams,
} from "../stockApi";

const FILTER_KEYS = [
  "q",
  "product_id",
  "material_id",
  "stock_id",
  "branch_code",
  "location_id",
  "movement_type",
  "reference_type",
  "reference_id",
  "date_from",
  "date_to",
] as const;

const ALL = "all";

export default function StockMovementsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canViewCost = usePermission("cost_price", "view");
  const { filters, setFilters } = useUrlFilters(FILTER_KEYS);

  const {
    isLoading: isLoadingRef,
    filteredBranches,
    filteredLocations,
    defaultBranchCode,
  } = useReferenceData(["branches", "locations"]);
  const branches = filteredBranches || [];
  const allLocations = filteredLocations || [];
  // Active Item Catalog items for the Item filter.
  const { data: items = [], isLoading: isLoadingItems } = useQuery({
    queryKey: ["materials", "picker", "active"],
    queryFn: () => materialsApi.getAll(0, 100000, true),
    staleTime: 5 * 60 * 1000,
  });

  // A link scoped to one unit or document should not be narrowed to the user's
  // branch; otherwise default to the user's own branch like the other pages.
  const scopedLink = !!(filters.stock_id || filters.reference_id);
  const branch =
    filters.branch_code === ALL ? "" : filters.branch_code || (scopedLink ? "" : defaultBranchCode || "");
  const locations = branch ? allLocations.filter((l) => l.branch_code === branch) : allLocations;

  const [searchText, setSearchText] = useDebouncedUrlText(filters.q, (v) => setFilters({ q: v.trim() }));

  const [paging, setPaging] = useState({ page: 0, pageSize: 25 });
  const filterSig = FILTER_KEYS.map((k) => filters[k]).join("|");
  useEffect(() => {
    setPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [filterSig]);

  const params: MovementParams = {
    q: filters.q || undefined,
    product_id: numParam(filters.product_id),
    material_id: numParam(filters.material_id),
    stock_id: numParam(filters.stock_id),
    branch_code: branch || undefined,
    location_id: numParam(filters.location_id),
    movement_type: filters.movement_type || undefined,
    reference_type: filters.reference_type || undefined,
    reference_id: numParam(filters.reference_id),
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["warehouseStock", "movements", params, paging.page, paging.pageSize],
    queryFn: () => warehouseStockApi.getMovements({ ...params, page: paging.page + 1, size: paging.pageSize }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo(() => buildMovementColumns({ currencySymbol, canViewCost }), [currencySymbol, canViewCost]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await warehouseStockApi.exportMovementsCsv(params);
    } catch (error) {
      handleApiError(error, "Could not export the stock movements");
    } finally {
      setExporting(false);
    }
  };

  const selectedItem = items.find((m) => String(m.id) === filters.material_id) || null;
  const firstRow = data?.items?.[0];
  // Item outside the loaded (active) list: still show which item is filtered.
  const itemFallback =
    filters.material_id && !selectedItem
      ? firstRow && String(firstRow.material_id) === filters.material_id
        ? `${firstRow.item_code || ""} ${firstRow.item_name || ""}`.trim() || `Item #${filters.material_id}`
        : `Item #${filters.material_id}`
      : null;
  // Old links filter by product: show it as a chip (no visible control).
  const productChip = filters.product_id ? `Product #${filters.product_id}` : null;

  const hasActiveFilters = FILTER_KEYS.some((k) => k !== "branch_code" && !!filters[k]);

  const clearFilters = () => {
    setSearchText("");
    const patch: Partial<Record<(typeof FILTER_KEYS)[number], string>> = {};
    FILTER_KEYS.forEach((k) => {
      if (k !== "branch_code") patch[k] = "";
    });
    setFilters(patch);
  };

  // Filters that come only from a link (no visible control): show them as removable chips.
  const linkChips: { key: (typeof FILTER_KEYS)[number] | "reference"; label: string }[] = [];
  if (filters.stock_id) linkChips.push({ key: "stock_id", label: `Stock unit #${filters.stock_id}` });
  if (filters.reference_id)
    linkChips.push({
      key: "reference",
      label: `${referenceTypeLabel(filters.reference_type) || "Document"} #${filters.reference_id}`,
    });
  if (productChip) linkChips.push({ key: "product_id", label: productChip });

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
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>
            Stock Movements
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every receipt, issue, sale, transfer and adjustment, newest first.
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={exportCsv}
          disabled={exporting || !data?.total}
        >
          {exporting ? "Exporting..." : "Export CSV"}
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <TextField
              fullWidth
              size="small"
              label="Search"
              placeholder="Item, batch, serial, reference..."
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
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <Autocomplete
              size="small"
              options={items}
              getOptionLabel={(o) => [o.item_code, o.name].filter(Boolean).join(" — ")}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              value={selectedItem}
              onChange={(_, v) => setFilters({ material_id: v ? String(v.id) : "", product_id: "" })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Item"
                  placeholder={itemFallback || "All items"}
                  InputLabelProps={itemFallback ? { ...params.InputLabelProps, shrink: true } : params.InputLabelProps}
                />
              )}
              noOptionsText={isLoadingItems ? "Loading..." : "No items found"}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
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
          <Grid item xs={12} sm={6} md={4} lg={2}>
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
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Movement type"
              value={filters.movement_type}
              onChange={(e) => setFilters({ movement_type: e.target.value })}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">All types</MenuItem>
              {MOVEMENT_TYPES.map((m) => (
                <MenuItem key={m.value} value={m.value}>
                  {m.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Document type"
              value={filters.reference_type}
              onChange={(e) => setFilters({ reference_type: e.target.value })}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">All documents</MenuItem>
              {/* Keep an unknown linked value selectable so the field shows it. */}
              {filters.reference_type && !REFERENCE_TYPE_OPTIONS.some((o) => o.value === filters.reference_type) && (
                <MenuItem value={filters.reference_type}>{referenceTypeLabel(filters.reference_type)}</MenuItem>
              )}
              {REFERENCE_TYPE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={6} md={4} lg={2}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Date from"
              value={filters.date_from}
              onChange={(e) => setFilters({ date_from: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={6} sm={6} md={4} lg={2}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Date to"
              value={filters.date_to}
              onChange={(e) => setFilters({ date_to: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={2}>
            <Button variant="outlined" size="small" fullWidth onClick={clearFilters} sx={{ height: 40 }} disabled={!hasActiveFilters}>
              Clear Filters
            </Button>
          </Grid>
        </Grid>
        {linkChips.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
            {linkChips.map((c) => (
              <Chip
                key={c.key}
                size="small"
                label={c.label}
                onDelete={() =>
                  c.key === "reference"
                    ? setFilters({ reference_id: "", reference_type: "" })
                    : setFilters({ [c.key]: "" })
                }
              />
            ))}
          </Box>
        )}
      </Paper>

      {isError && <Alert severity="error">Could not load stock movements. Try again in a moment.</Alert>}

      <Box sx={{ flex: 1, minHeight: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TDataGrid
          rows={data?.items || []}
          columns={columns}
          loading={isLoading}
          getRowId={(r) => r.id}
          emptyMessage={hasActiveFilters ? "No stock movements match your filters" : "No stock movements yet"}
          autoHeight={false}
          height="100%"
          exportFileName="stock_movements"
          exportAllRows={() => fetchAllPages((page, size) => warehouseStockApi.getMovements({ ...params, page, size }))}
          serverPagination={{
            rowCount: data?.total || 0,
            paginationModel: paging,
            onPaginationModelChange: setPaging,
          }}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </Box>
    </Box>
  );
}
