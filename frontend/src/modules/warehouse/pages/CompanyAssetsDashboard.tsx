/**
 * CompanyAssetsDashboard - Comprehensive Company Assets Management
 * 
 * Similar UI to SalesStockDashboard for consistency.
 * Shows all company-owned assets from GRN (saveToCompanyAssets) and 
 * non-restockable sale returns.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Typography,
  Drawer,
  Button,
  Collapse,
  Stack,
  CircularProgress,
} from "@mui/material";
import {
  Search as SearchIcon,
  Business as AssetIcon,
  Warning as AlertIcon,
  Refresh as RefreshIcon,
  FileDownload as DownloadIcon,
  Close as CloseIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  CheckCircle as AvailableIcon,
} from "@mui/icons-material";
import { companyAssetsApi } from "@/modules/inventory/api";
import { fmtLKR } from "@/components/tijaero";
import { KpiSparkCard } from "@/components/dashboard";
import { useReferenceData, REFERENCE_DATA_PRESETS } from "@/hooks";
import { CompanyAsset, Product, Brand } from "@/modules/inventory/types";
import { format, parseISO } from "date-fns";

// Status Chip Component
const AssetStatusChip = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { label: string; color: "success" | "warning" | "info" | "error" | "default" }> = {
    available: { label: "Available", color: "success" },
    in_use: { label: "In Use", color: "info" },
    retired: { label: "Retired", color: "warning" },
    disposed: { label: "Disposed", color: "error" },
    returned: { label: "Returned (Non-Restockable)", color: "warning" },
  };

  const config = statusConfig[status?.toLowerCase()] || { label: status || "Unknown", color: "default" as const };

  return (
    <Chip
      label={config.label}
      color={config.color}
      size="small"
      sx={{ fontWeight: 500 }}
    />
  );
};

// Source Chip Component
const SourceChip = ({ source }: { source?: string }) => {
  if (source === "sale_return") {
    return (
      <Chip
        label="Sale Return"
        size="small"
        variant="outlined"
        color="warning"
        sx={{ fontWeight: 500 }}
      />
    );
  }
  return (
    <Chip
      label="GRN"
      size="small"
      variant="outlined"
      color="primary"
      sx={{ fontWeight: 500 }}
    />
  );
};

// Asset Details Panel Component
interface AssetDetailsPanelProps {
  asset: CompanyAsset | null;
  isOpen: boolean;
  onClose: () => void;
}

const AssetDetailsPanel = ({ asset, isOpen, onClose }: AssetDetailsPanelProps) => {
  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 450 }, p: 3 }
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h6">Asset Details</Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      {asset && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Asset Info */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Asset Information
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Inventory No</Typography>
                  <Typography variant="body2" fontWeight={500} fontFamily="monospace">{asset.inventory_no}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <AssetStatusChip status={asset.status} />
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Item Name</Typography>
                  <Typography variant="body2" fontWeight={500}>{asset.product_name || asset.item}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Item Code</Typography>
                  <Typography variant="body2" fontWeight={500}>{asset.item_code || "N/A"}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Barcode</Typography>
                  <Typography variant="body2" fontWeight={500} fontFamily="monospace">{asset.barcode || "N/A"}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Branch</Typography>
                  <Typography variant="body2" fontWeight={500}>{asset.branch_code}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Source</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <SourceChip source={asset.source} />
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Warranty</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {asset.warranty_month ? `${asset.warranty_month} months` : "N/A"}
                  </Typography>
                </Grid>
                {asset.grn_no && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">GRN No</Typography>
                    <Typography variant="body2" fontWeight={500}>{asset.grn_no}</Typography>
                  </Grid>
                )}
                {asset.cost_price != null && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Cost Price</Typography>
                    <Typography variant="body2" fontWeight={500}>Rs. {fmtLKR(asset.cost_price)}</Typography>
                  </Grid>
                )}
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Description</Typography>
                  <Typography variant="body2" fontWeight={500}>{asset.description || "N/A"}</Typography>
                </Grid>
                {asset.added_date && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Added Date</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {format(parseISO(asset.added_date), "dd MMM yyyy")}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Paper>
          </Box>

          {/* Return Info (if from sale return) */}
          {asset.source === "sale_return" && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Return Information
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, borderColor: "warning.main" }}>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">Return Reason</Typography>
                    <Typography variant="body2" fontWeight={500} color="warning.main">
                      {asset.return_reason || "Not specified"}
                    </Typography>
                  </Grid>
                  {asset.sale_return_id && (
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Sale Return ID</Typography>
                      <Typography variant="body2" fontWeight={500}>#{asset.sale_return_id}</Typography>
                    </Grid>
                  )}
                </Grid>
              </Paper>
            </Box>
          )}
        </Box>
      )}
    </Drawer>
  );
};

// Main Component
export default function CompanyAssetsDashboard() {
  // Filter States
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState(true);

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Details Panel
  const [selectedAsset, setSelectedAsset] = useState<CompanyAsset | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

  // Fetch reference data
  const { data: refData, isLoading: isLoadingRefData, filteredBranches, defaultBranchCode } = useReferenceData(
    REFERENCE_DATA_PRESETS.DASHBOARD,
    { productsLimit: 1000 }
  );

  // Set default branch filter from user's assigned branch
  useEffect(() => {
    if (defaultBranchCode && !selectedBranch) {
      setSelectedBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch company assets data
  const { data: assetsData, isLoading: isLoadingAssets, refetch: refetchAssets } = useQuery({
    queryKey: ["companyAssets", selectedBranch],
    queryFn: async () => {
      const params: { branch_code?: string } = {};
      if (selectedBranch) {
        params.branch_code = selectedBranch;
      }
      return await companyAssetsApi.getAll(params);
    },
  });

  // Extract data
  const branches = filteredBranches || [];
  const brands = (refData?.brands || []) as Brand[];
  const products = (refData?.products || []) as Product[];
  const assets = assetsData || [];

  const isLoadingBranches = isLoadingRefData;

  // Product lookup helper
  const getProduct = (productId?: number): Product | undefined => {
    if (!productId) return undefined;
    return products.find((p: Product) => p.id === productId);
  };

  // Brand lookup helper
  const getBrand = (brandId?: number): Brand | undefined => {
    if (!brandId) return undefined;
    return brands.find((b: Brand) => b.id === brandId);
  };

  // Get brand name for a product
  const getProductBrandName = (product: Product | undefined): string => {
    if (!product) return "-";
    const brandId = product.items_brand_id;
    if (!brandId) return "-";
    const brand = getBrand(brandId);
    return brand?.brand_name || "-";
  };

  // Filter assets
  const filteredAssets = useMemo(() => {
    let filtered = [...assets];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((asset: CompanyAsset) => {
        return (
          asset.barcode?.toLowerCase().includes(query) ||
          asset.inventory_no?.toLowerCase().includes(query) ||
          asset.item?.toLowerCase().includes(query) ||
          asset.product_name?.toLowerCase().includes(query) ||
          asset.item_code?.toLowerCase().includes(query)
        );
      });
    }

    // Brand filter
    if (selectedBrand !== "all") {
      filtered = filtered.filter((asset: CompanyAsset) => {
        return asset.brand_id?.toString() === selectedBrand;
      });
    }

    // Product filter
    if (selectedProduct !== "all") {
      filtered = filtered.filter((asset: CompanyAsset) => {
        return asset.product_id?.toString() === selectedProduct;
      });
    }

    // Status filter
    if (selectedStatus !== "all") {
      filtered = filtered.filter((asset: CompanyAsset) =>
        asset.status?.toLowerCase() === selectedStatus.toLowerCase()
      );
    }

    // Date range filter
    if (dateFrom && assets.length > 0) {
      filtered = filtered.filter((asset: CompanyAsset) =>
        asset.added_date && asset.added_date >= dateFrom
      );
    }
    if (dateTo && assets.length > 0) {
      filtered = filtered.filter((asset: CompanyAsset) =>
        asset.added_date && asset.added_date <= dateTo
      );
    }

    return filtered;
  }, [assets, searchQuery, selectedBrand, selectedProduct, selectedStatus, dateFrom, dateTo]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const total = filteredAssets.length;
    const available = filteredAssets.filter((a: CompanyAsset) =>
      a.status?.toLowerCase() === "available"
    ).length;
    const inUse = filteredAssets.filter((a: CompanyAsset) =>
      a.status?.toLowerCase() === "in_use"
    ).length;
    const fromReturns = filteredAssets.filter((a: CompanyAsset) =>
      a.source === "sale_return"
    ).length;

    return { total, available, inUse, fromReturns };
  }, [filteredAssets]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [searchQuery, selectedBrand, selectedProduct, selectedStatus, dateFrom, dateTo, selectedBranch]);

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery("");
    setSelectedBrand("all");
    setSelectedProduct("all");
    setSelectedStatus("all");
    setDateFrom("");
    setDateTo("");
  };

  // Export filtered assets as CSV (same pattern as SalesStockDashboard)
  const exportToCSV = () => {
    if (filteredAssets.length === 0) return;

    const headers = [
      "Inventory No",
      "Barcode",
      "Item",
      "Item Code",
      "Brand",
      "Branch",
      "Status",
      "Source",
      "GRN No",
      "Added Date",
      "Cost Price",
    ];

    const rows = filteredAssets.map((asset: CompanyAsset) => {
      const product = getProduct(asset.product_id);
      const brandName = asset.brand_id ? getBrand(asset.brand_id)?.brand_name : null;
      return [
        asset.inventory_no || "",
        asset.barcode || "",
        asset.product_name || asset.item || "",
        asset.item_code || "",
        brandName || getProductBrandName(product) || "",
        asset.branch_code || "",
        asset.status || "",
        asset.source || "grn",
        asset.grn_no || "",
        asset.added_date ? format(parseISO(asset.added_date), "yyyy-MM-dd") : "",
        asset.cost_price != null ? String(asset.cost_price) : "",
      ];
    });

    const escapeCsv = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `company-assets-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Get paginated data
  const paginatedAssets = filteredAssets.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 2,
        p: { xs: 1.5, md: 2 },
        overflow: "auto",
        background: theme.palette.mode === "dark"
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
          : "linear-gradient(180deg, #f6f8fc 0%, #ffffff 280px)",
      })}
    >
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 1 }}
      >
        <Typography variant="h5" fontWeight={700}>Company Assets</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            size="small"
            startIcon={showFilters ? <CollapseIcon /> : <ExpandIcon />}
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? "Hide Filters" : "Show Filters"}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={exportToCSV}
            disabled={filteredAssets.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => refetchAssets()}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      {/* Summary Cards */}
      <Grid container spacing={2.25}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Total Assets"
            value={summaryStats.total.toLocaleString()}
            subtitle="All tracked company assets"
            icon={<AssetIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="Available"
            value={summaryStats.available.toLocaleString()}
            subtitle="Ready for assignment"
            icon={<AvailableIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="In Use"
            value={summaryStats.inUse.toLocaleString()}
            subtitle="Currently assigned"
            icon={<AlertIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiSparkCard
            title="From Returns"
            value={summaryStats.fromReturns.toLocaleString()}
            subtitle="Non-restockable sale returns"
            icon={<AssetIcon />}
            color="secondary"
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <Collapse in={showFilters}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Grid container spacing={2}>
            {/* Branch */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: any) => option.branch_name || ""}
                value={branches.find((branch: any) => branch.branch_code === selectedBranch) || null}
                onChange={(_, value: any) => setSelectedBranch(value?.branch_code || "")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    placeholder="Search branches..."
                  />
                )}
                noOptionsText={isLoadingBranches ? "Loading..." : "No branches found"}
              />
            </Grid>

            {/* Search */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TextField
                fullWidth
                size="small"
                label="Search"
                placeholder="Barcode, Inventory No, Item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            {/* Brand */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={brands}
                getOptionLabel={(option: Brand) => option.brand_name || ""}
                value={brands.find((brand: Brand) => brand.id.toString() === selectedBrand) || null}
                onChange={(_, value: Brand | null) => setSelectedBrand(value?.id.toString() || "all")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Brand"
                    placeholder="Search brands..."
                  />
                )}
                noOptionsText="No brands found"
              />
            </Grid>

            {/* Product */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={products}
                getOptionLabel={(option: Product) => option.name || ""}
                value={products.find((product: Product) => product.id.toString() === selectedProduct) || null}
                onChange={(_, value: Product | null) => setSelectedProduct(value?.id.toString() || "all")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Product"
                    placeholder="Search products..."
                  />
                )}
                noOptionsText="No products found"
              />
            </Grid>

            {/* Status */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={[
                  { value: "available", label: "Available" },
                  { value: "in_use", label: "In Use" },
                  { value: "retired", label: "Retired" },
                  { value: "disposed", label: "Disposed" },
                  { value: "returned", label: "Returned (Non-Restockable)" },
                ]}
                getOptionLabel={(option) => option.label}
                value={[
                  { value: "available", label: "Available" },
                  { value: "in_use", label: "In Use" },
                  { value: "retired", label: "Retired" },
                  { value: "disposed", label: "Disposed" },
                  { value: "returned", label: "Returned (Non-Restockable)" },
                ].find(s => s.value === selectedStatus) || null}
                onChange={(_, value) => setSelectedStatus(value?.value || "all")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Status"
                    placeholder="Filter by status..."
                  />
                )}
                renderOption={(props, option) => (
                  <Box component="li" {...props}>
                    <AssetStatusChip status={option.value} />
                  </Box>
                )}
              />
            </Grid>

            {/* Date From */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Date From"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Date To */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Date To"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Clear Filters */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Button
                variant="outlined"
                fullWidth
                onClick={clearFilters}
                sx={{ height: 40 }}
              >
                Clear Filters
              </Button>
            </Grid>
          </Grid>
        </Paper>
      </Collapse>

      {/* Data Table */}
      <Paper variant="outlined" sx={{ flex: 1, display: "flex", flexDirection: "column", borderRadius: 2, overflow: "hidden" }}>
        {/* Table Header */}
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle1" fontWeight={500}>
            Assets ({filteredAssets.length.toLocaleString()})
          </Typography>
        </Box>

        {/* Table Content */}
        {isLoadingAssets ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : paginatedAssets.length === 0 ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2, py: 8 }}>
            <AssetIcon sx={{ fontSize: 64, opacity: 0.3 }} />
            <Typography color="text.secondary">No company assets found</Typography>
            <Typography variant="body2" color="text.secondary">
              {assets.length === 0
                ? "Company assets are created when items are marked as 'Company Asset' during GRN, or from non-restockable sale returns."
                : "Try adjusting your filters"}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ flex: 1 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Inventory No</TableCell>
                  <TableCell>Barcode</TableCell>
                  <TableCell>Item</TableCell>
                  <TableCell>Item Code</TableCell>
                  <TableCell>Brand</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>GRN No</TableCell>
                  <TableCell>Added Date</TableCell>
                  <TableCell align="right">Cost Price (Rs.)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedAssets.map((asset: CompanyAsset) => {
                  const product = getProduct(asset.product_id);
                  const brandName = asset.brand_id ? getBrand(asset.brand_id)?.brand_name : null;

                  return (
                    <TableRow
                      key={asset.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => {
                        setSelectedAsset(asset);
                        setIsDetailsPanelOpen(true);
                      }}
                    >
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{asset.inventory_no}</TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{asset.barcode || "-"}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>
                        {asset.product_name || asset.item || "Unknown"}
                      </TableCell>
                      <TableCell>{asset.item_code || "-"}</TableCell>
                      <TableCell>{brandName || getProductBrandName(product) || "-"}</TableCell>
                      <TableCell>{asset.branch_code}</TableCell>
                      <TableCell>
                        <AssetStatusChip status={asset.status} />
                      </TableCell>
                      <TableCell>
                        <SourceChip source={asset.source} />
                      </TableCell>
                      <TableCell>{asset.grn_no || "-"}</TableCell>
                      <TableCell>
                        {asset.added_date ? format(parseISO(asset.added_date), "dd MMM yyyy") : "-"}
                      </TableCell>
                      <TableCell align="right">
                        {asset.cost_price ? fmtLKR(asset.cost_price) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pagination */}
        {filteredAssets.length > 0 && (
          <TablePagination
            component="div"
            count={filteredAssets.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50, 100]}
          />
        )}
      </Paper>

      {/* Asset Details Panel */}
      <AssetDetailsPanel
        asset={selectedAsset}
        isOpen={isDetailsPanelOpen}
        onClose={() => setIsDetailsPanelOpen(false)}
      />
    </Box>
  );
}
