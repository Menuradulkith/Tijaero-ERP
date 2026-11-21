/**
 * Warehouse > Stock Counts: list of stock count documents. A count snapshots the
 * system quantities of a branch (optionally one location / item category); the
 * count sheet (StockCountDetailPage) records counted quantities and posts the
 * differences to stock and the GL.
 */
import { PERMISSIONS, usePermission } from "@/auth/permissions";
import { TChip, TDataGrid, fmtLKR, type TDataGridColumn } from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { useCurrencyStore } from "@/state/currencyStore";
import { Add as AddIcon, Search as SearchIcon } from "@mui/icons-material";
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
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import NewStockCountDialog from "../components/NewStockCountDialog";
import { useDebouncedUrlText, useUrlFilters } from "../components/useUrlFilters";
import {
  STOCK_COUNT_STATUS_OPTIONS,
  fmtDateTime,
  stockCountApi,
  stockCountStatusOption,
  type StockCount,
  type StockCountListParams,
} from "../stockCountApi";

const FILTER_KEYS = ["search", "branch_code", "status"] as const;
const ALL = "all";

type P = GridRenderCellParams<StockCount>;

export default function StockCountsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canViewCost = usePermission(PERMISSIONS.COST_PRICE_VIEW.resource, PERMISSIONS.COST_PRICE_VIEW.action);
  const canCreate = usePermission(PERMISSIONS.STOCK_COUNT_CREATE.resource, PERMISSIONS.STOCK_COUNT_CREATE.action);
  const { filters, setFilters } = useUrlFilters(FILTER_KEYS);

  const { isLoading: isLoadingRef, filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];
  // Default to the user's own branch like the other warehouse pages; "all" = every branch.
  const branch = filters.branch_code === ALL ? "" : filters.branch_code || defaultBranchCode || "";

  const [searchText, setSearchText] = useDebouncedUrlText(filters.search, (v) => setFilters({ search: v.trim() }));

  const [paging, setPaging] = useState({ page: 0, pageSize: 25 });
  const filterSig = FILTER_KEYS.map((k) => filters[k]).join("|");
  useEffect(() => {
    setPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [filterSig]);

  const params: StockCountListParams = {
    branch_code: branch || undefined,
    status: filters.status || undefined,
    search: filters.search || undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["stockCounts", "list", params, paging.page, paging.pageSize],
    queryFn: () => stockCountApi.list({ ...params, skip: paging.page * paging.pageSize, limit: paging.pageSize }),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  });

  const [newOpen, setNewOpen] = useState(false);

  const columns = useMemo(() => {
    const cols: TDataGridColumn<StockCount>[] = [
      {
        field: "count_no",
        header: "Count No",
        width: 140,
        sortable: false,
        renderCell: (p: P) => (
          <Typography variant="body2" fontWeight={600} color="primary.main">
            {p.row.count_no}
          </Typography>
        ),
      },
      {
        field: "branch_name",
        header: "Branch",
        width: 150,
        sortable: false,
        renderCell: (p: P) => p.row.branch_name || p.row.branch_code || "-",
      },
      {
        field: "location_name",
        header: "Location",
        width: 150,
        sortable: false,
        renderCell: (p: P) => p.row.location_name || "All locations",
      },
      {
        field: "category_name",
        header: "Category",
        width: 140,
        sortable: false,
        renderCell: (p: P) => p.row.category_name || "All categories",
      },
      {
        field: "status",
        header: "Status",
        width: 115,
        sortable: false,
        hideOnMobile: false,
        renderCell: (p: P) => {
          const o = stockCountStatusOption(p.row.status);
          return <TChip size="small" label={o.label} color={o.color} sx={{ fontWeight: 500 }} />;
        },
      },
      { field: "line_count", header: "Lines", width: 80, type: "number", sortable: false },
      {
        field: "counted_count",
        header: "Counted",
        width: 95,
        align: "right",
        sortable: false,
        renderCell: (p: P) => `${p.row.counted_count.toLocaleString()}/${p.row.line_count.toLocaleString()}`,
      },
      { field: "difference_count", header: "Differences", width: 105, type: "number", sortable: false },
    ];
    if (canViewCost) {
      cols.push({
        field: "net_value",
        header: `Net Value (${currencySymbol})`,
        width: 140,
        align: "right",
        sortable: false,
        renderCell: (p: P) => (
          <Typography variant="body2" fontWeight={600} color={p.row.net_value < 0 ? "error.main" : undefined}>
            {fmtLKR(p.row.net_value)}
          </Typography>
        ),
      });
    }
    cols.push(
      {
        field: "created_by_name",
        header: "Created",
        width: 190,
        sortable: false,
        renderCell: (p: P) => (
          <Box sx={{ lineHeight: 1.3 }}>
            <Typography variant="body2">{p.row.created_by_name || "-"}</Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtDateTime(p.row.created_at)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "posted_at",
        header: "Posted",
        width: 150,
        sortable: false,
        renderCell: (p: P) => fmtDateTime(p.row.posted_at),
      },
    );
    return cols;
  }, [canViewCost, currencySymbol]);

  const hasActiveFilters = !!filters.search || !!filters.status;
  const clearFilters = () => {
    setSearchText("");
    setFilters({ search: "", status: "" });
  };

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
            Stock Counts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Count what is on the shelves, compare it with the system and post the differences.
          </Typography>
        </Box>
        {canCreate && (
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
            New Stock Count
          </Button>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4} lg={4}>
            <TextField
              fullWidth
              size="small"
              label="Search"
              placeholder="Count no, remark..."
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
          <Grid item xs={12} sm={6} md={3} lg={3}>
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(o) => o.branch_name || o.branch_code || ""}
              value={branches.find((b) => b.branch_code === branch) || null}
              onChange={(_, v) => setFilters({ branch_code: v?.branch_code || ALL })}
              renderInput={(params) => <TextField {...params} label="Branch" placeholder="All branches" />}
              noOptionsText={isLoadingRef ? "Loading..." : "No branches found"}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3} lg={3}>
            <TextField
              select
              fullWidth
              size="small"
              label="Status"
              value={filters.status}
              onChange={(e) => setFilters({ status: e.target.value })}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {STOCK_COUNT_STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2} lg={2}>
            <Button variant="outlined" size="small" fullWidth onClick={clearFilters} sx={{ height: 40 }} disabled={!hasActiveFilters}>
              Clear Filters
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {isError && <Alert severity="error">Could not load stock counts. Try again in a moment.</Alert>}

      <Box sx={{ flex: 1, minHeight: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TDataGrid
          rows={data?.items || []}
          columns={columns}
          loading={isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => navigate(`/warehouse/stock-counts/${r.id}`)}
          emptyMessage={hasActiveFilters ? "No stock counts match your filters" : "No stock counts yet"}
          autoHeight={false}
          height="100%"
          exportFileName="stock_counts"
          serverPagination={{
            rowCount: data?.total || 0,
            paginationModel: paging,
            onPaginationModelChange: setPaging,
          }}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </Box>

      <NewStockCountDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        defaultBranchCode={branch || defaultBranchCode || ""}
        onCreated={(count) => {
          setNewOpen(false);
          queryClient.setQueryData(["stockCounts", "detail", count.id], count);
          void queryClient.invalidateQueries({ queryKey: ["stockCounts", "list"] });
          navigate(`/warehouse/stock-counts/${count.id}`);
        }}
      />
    </Box>
  );
}
