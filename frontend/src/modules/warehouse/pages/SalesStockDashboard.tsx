/**
 * SalesStockDashboard - Comprehensive Sales Stock Management
 *
 * OPTIMIZED: Uses aggregated reference data endpoint to reduce API calls
 * BEFORE: 6 separate API calls (branches, brands, categories, locations, products, salesStock)
 * AFTER: 2 API calls (reference-data, salesStock)
 */

import apiClient from "@/api/client";
import { fmtLKR } from "@/components/tijaero";
import { LocationRef, REFERENCE_DATA_PRESETS, useReferenceData } from "@/hooks";
import { salesStockApi } from "@/modules/inventory/api";
import {
    Brand,
    Category,
    Product,
    SalesStock,
    StockTrackingEvent,
} from "@/modules/inventory/types";
import {
    Warning as AlertIcon,
    Close as CloseIcon,
    ExpandLess as CollapseIcon,
    FileDownload as DownloadIcon,
    ExpandMore as ExpandIcon,
    Inventory as PackageIcon,
    Refresh as RefreshIcon,
    AssignmentReturn as ReturnIcon,
    Search as SearchIcon,
} from "@mui/icons-material";
import {
    Autocomplete,
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    Drawer,
    Grid,
    IconButton,
    InputAdornment,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";

// Summary Card Component
interface SummaryCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const SummaryCard = ({
  title,
  value,
  icon,
  color,
  bgColor,
}: SummaryCardProps) => (
  <Paper
    elevation={0}
    sx={{
      p: 2,
      borderRadius: 2,
      border: "1px solid",
      borderColor: "divider",
      borderLeft: `4px solid ${color}`,
    }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Box>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        <Typography variant="h5" fontWeight="bold">
          {value.toLocaleString()}
        </Typography>
      </Box>
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: bgColor,
          color: color,
        }}
      >
        {icon}
      </Box>
    </Box>
  </Paper>
);

// Status Chip Component
const StatusChip = ({ status }: { status: string }) => {
  const statusConfig: Record<
    string,
    {
      label: string;
      color: "success" | "warning" | "info" | "error" | "default";
    }
  > = {
    available: { label: "Available", color: "success" },
    reserved: { label: "Reserved", color: "warning" },
    sold: { label: "Sold", color: "info" },
    returned_to_supplier: { label: "Returned to Supplier", color: "info" },
    return_pending: { label: "Return Pending", color: "warning" },
    transferred: { label: "Transferred", color: "info" },
    damaged: { label: "Damaged", color: "error" },
  };

  const config = statusConfig[status?.toLowerCase()] || {
    label: status || "Unknown",
    color: "default" as const,
  };

  return (
    <Chip
      label={config.label}
      color={config.color}
      size="small"
      sx={{ fontWeight: 500 }}
    />
  );
};

// Stock Details Panel Component
interface StockDetailsPanelProps {
  stock: SalesStock | null;
  product: Product | null;
  brandName: string;
  categoryName: string;
  isOpen: boolean;
  onClose: () => void;
}

const StockDetailsPanel = ({
  stock,
  product,
  brandName,
  categoryName,
  isOpen,
  onClose,
}: StockDetailsPanelProps) => {
  // Fetch real tracking data from API when panel is open
  const { data: trackingEvents, isLoading: trackingLoading } = useQuery<
    StockTrackingEvent[]
  >({
    queryKey: ["stock-tracking", stock?.id],
    queryFn: () => salesStockApi.getTracking(stock!.id),
    enabled: isOpen && !!stock,
    staleTime: 30_000, // 30s — refetch if panel reopened after a while
  });

  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 450 }, p: 3 },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 3,
        }}
      >
        <Typography variant="h6">Stock Details</Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      {stock && product && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Product Info */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Product Information
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Grid container spacing={2}>
                {/* Product image — full width at top */}
                <Grid item xs={12}>
                  <Box
                    sx={{
                      width: "100%",
                      height: 180,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "action.hover",
                    }}
                  >
                    {product.image_url ? (
                      <Box
                        component="img"
                        src={product.image_url}
                        alt={product.name}
                        onError={(
                          e: React.SyntheticEvent<HTMLImageElement>,
                        ) => {
                          e.currentTarget.style.display = "none";
                          const fallback = document.getElementById(
                            `img-fallback-${stock.id}`,
                          );
                          if (fallback) fallback.style.display = "flex";
                        }}
                        sx={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                        }}
                      />
                    ) : null}
                    <Box
                      id={`img-fallback-${stock.id}`}
                      sx={{
                        display: product.image_url ? "none" : "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 0.5,
                        color: "text.disabled",
                      }}
                    >
                      <Typography variant="caption">No image</Typography>
                    </Box>
                  </Box>
                </Grid>
                {/* Image URL */}
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">
                    Image URL
                  </Typography>
                  {product.image_url ? (
                    <Typography
                      variant="body2"
                      component="a"
                      href={product.image_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        display: "block",
                        color: "primary.main",
                        wordBreak: "break-all",
                        textDecoration: "none",
                        "&:hover": { textDecoration: "underline" },
                      }}
                    >
                      {product.image_url}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.disabled">
                      Not set
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Product Name
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {product.name}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Item Code
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {product.item_code || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Brand
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {brandName || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Category
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {categoryName || "N/A"}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Box>

          {/* Stock Info */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Stock Information
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Barcode
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    fontFamily="monospace"
                  >
                    {stock.barcode}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Status
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <StatusChip status={stock.status} />
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Branch
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.branch_code}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    GRN No
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.grn_no || stock.good_received_note_id || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Warranty
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.warranty_month
                      ? `${stock.warranty_month} months`
                      : "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Received Date
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {format(parseISO(stock.added_date), "dd MMM yyyy")}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Box>

          {/* Tracking Timeline */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Tracking Timeline
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {trackingLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : !trackingEvents || trackingEvents.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 1 }}
                >
                  No tracking events found
                </Typography>
              ) : (
                trackingEvents.map((evt, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: "flex",
                      gap: 2,
                      mb: index < trackingEvents.length - 1 ? 2 : 0,
                    }}
                  >
                    {/* Timeline connector */}
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        pt: 0.5,
                      }}
                    >
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: evt.color,
                          flexShrink: 0,
                        }}
                      />
                      {index < trackingEvents.length - 1 && (
                        <Box
                          sx={{
                            width: 2,
                            flex: 1,
                            bgcolor: "divider",
                            mt: 0.5,
                          }}
                        />
                      )}
                    </Box>
                    {/* Event content */}
                    <Box
                      sx={{
                        flex: 1,
                        pb: index < trackingEvents.length - 1 ? 1 : 0,
                      }}
                    >
                      <Typography variant="body2" fontWeight={600}>
                        {evt.action}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {evt.details}
                      </Typography>
                      {evt.date && (
                        <Typography
                          variant="caption"
                          display="block"
                          color="text.secondary"
                        >
                          {format(parseISO(evt.date), "dd MMM yyyy HH:mm")}
                        </Typography>
                      )}
                      {/* Extra details */}
                      {evt.extra && Object.keys(evt.extra).length > 0 && (
                        <Box
                          sx={{
                            mt: 0.5,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 0.5,
                          }}
                        >
                          {evt.extra.po_no && (
                            <Chip
                              label={`PO: ${evt.extra.po_no}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.location && (
                            <Chip
                              label={`Location: ${evt.extra.location}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.branch && (
                            <Chip
                              label={`Branch: ${evt.extra.branch}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.selling_price != null && (
                            <Chip
                              label={`Rs. ${Number(evt.extra.selling_price).toFixed(2)}`}
                              size="small"
                              color="success"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.return_price != null && (
                            <Chip
                              label={`Return: Rs. ${Number(evt.extra.return_price).toFixed(2)}`}
                              size="small"
                              color="warning"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.condition && (
                            <Chip
                              label={`Condition: ${evt.extra.condition}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.from_location && evt.extra.to_location && (
                            <Chip
                              label={`${evt.extra.from_location} → ${evt.extra.to_location}`}
                              size="small"
                              color="secondary"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.status && (
                            <Chip
                              label={String(evt.extra.status)}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                        </Box>
                      )}
                    </Box>
                  </Box>
                ))
              )}
            </Paper>
          </Box>
        </Box>
      )}
    </Drawer>
  );
};

// Main Component
export default function SalesStockDashboard() {
  // Filter States
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
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
  const [selectedStock, setSelectedStock] = useState<SalesStock | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

  // OPTIMIZED: Fetch all reference data in a single API call
  const {
    data: refData,
    isLoading: isLoadingRefData,
    filteredBranches,
    defaultBranchCode,
  } = useReferenceData(REFERENCE_DATA_PRESETS.DASHBOARD, {
    productsLimit: 1000,
  });

  // Set default branch filter from user's assigned branch
  useEffect(() => {
    if (defaultBranchCode && !selectedBranch) {
      setSelectedBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wait until branch default is resolved before firing the query
  const branchResolved =
    defaultBranchCode === undefined || selectedBranch !== "";

  // Fetch sales stock data (still separate as it depends on branch filter)
  const {
    data: salesStockData,
    isLoading: isLoadingStock,
    refetch: refetchStock,
  } = useQuery({
    queryKey: ["salesStock", selectedBranch],
    queryFn: async () => {
      const params: { branch_code?: string } = {};
      if (selectedBranch) {
        params.branch_code = selectedBranch;
      }
      const result = await salesStockApi.getAll(params);
      return result;
    },
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Extract data from aggregated reference data response
  const branches = filteredBranches || [];
  const brands = (refData?.brands || []) as Brand[];
  const categories = (refData?.categories || []) as Category[];
  const locations = refData?.locations || [];
  const products = (refData?.products || []) as Product[];
  const salesStock = salesStockData || [];

  // Loading state combines reference data and stock loading
  const isLoadingBranches = isLoadingRefData;
  const isLoadingLocations = isLoadingRefData;

  // Product lookup helper
  const getProduct = (productId: number): Product | undefined => {
    return products.find((p: Product) => p.id === productId);
  };

  // Brand lookup helper
  const getBrand = (brandId: number): Brand | undefined => {
    return brands.find((b: Brand) => b.id === brandId);
  };

  // Category lookup helper
  const getCategory = (categoryId: number): Category | undefined => {
    return categories.find((c: Category) => c.id === categoryId);
  };

  // Get brand name for a product
  const getProductBrandName = (product: Product | undefined): string => {
    if (!product) return "-";
    const brandId = product.items_brand_id;
    if (!brandId) return "-";
    const brand = getBrand(brandId);
    return brand?.brand_name || "-";
  };

  // Get category name for a product
  const getProductCategoryName = (product: Product | undefined): string => {
    if (!product) return "-";
    const category = getCategory(product.category_id);
    return category?.name || "-";
  };

  // Filter stock data
  const filteredStock = useMemo(() => {
    let filtered = [...salesStock];

    // Search filter (barcode, serial, item code)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((stock: SalesStock) => {
        const product = getProduct(stock.product_id);
        return (
          stock.barcode?.toLowerCase().includes(query) ||
          product?.item_code?.toLowerCase().includes(query) ||
          product?.name?.toLowerCase().includes(query)
        );
      });
    }

    // Brand filter
    if (selectedBrand !== "all") {
      filtered = filtered.filter((stock: SalesStock) => {
        const product = getProduct(stock.product_id);
        return (
          product?.items_brand_id?.toString() === selectedBrand ||
          (product as any)?.brand_id?.toString() === selectedBrand
        );
      });
    }

    // Product filter
    if (selectedProduct !== "all") {
      filtered = filtered.filter((stock: SalesStock) => {
        return stock.product_id?.toString() === selectedProduct;
      });
    }

    // Status filter
    if (selectedStatus !== "all") {
      filtered = filtered.filter(
        (stock: SalesStock) =>
          stock.status?.toLowerCase() === selectedStatus.toLowerCase(),
      );
    }

    // Date range filter
    if (dateFrom) {
      filtered = filtered.filter(
        (stock: SalesStock) => stock.added_date >= dateFrom,
      );
    }
    if (dateTo) {
      filtered = filtered.filter(
        (stock: SalesStock) => stock.added_date <= dateTo,
      );
    }

    // Location filter - now working with location_name from backend
    if (selectedLocation !== "all") {
      filtered = filtered.filter(
        (stock: SalesStock) =>
          (stock as any).location_name === selectedLocation,
      );
    }

    return filtered;
  }, [
    salesStock,
    searchQuery,
    selectedBrand,
    selectedProduct,
    selectedStatus,
    dateFrom,
    dateTo,
    selectedLocation,
    products,
  ]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const inStock = filteredStock.filter(
      (s: SalesStock) =>
        s.status?.toLowerCase() === "in_stock" ||
        s.status?.toLowerCase() === "available",
    ).length;
    const reserved = filteredStock.filter(
      (s: SalesStock) => s.status?.toLowerCase() === "reserved",
    ).length;
    const soldToday = filteredStock.filter((s: SalesStock) => {
      if (s.status?.toLowerCase() !== "sold") return false;
      const today = new Date().toISOString().split("T")[0];
      return (
        (s as any).updated_at?.startsWith(today) ||
        s.added_date?.startsWith(today)
      );
    }).length;

    // Returned items calculation (returned_to_supplier + return_pending)
    const returnedItems = filteredStock.filter(
      (s: SalesStock) =>
        s.status?.toLowerCase() === "returned_to_supplier" ||
        s.status?.toLowerCase() === "return_pending",
    ).length;

    return { inStock, reserved, soldToday, returnedItems };
  }, [filteredStock]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [
    searchQuery,
    selectedBrand,
    selectedProduct,
    selectedStatus,
    dateFrom,
    dateTo,
    selectedLocation,
    selectedBranch,
  ]);

  // ─── CSV Export ─────────────────────────────────────────────────────────
  const exportToCSV = async () => {
    try {
      const branchParam = selectedBranch
        ? `&branch_code=${selectedBranch}`
        : "";
      const statusParam = selectedStatus ? `&status=${selectedStatus}` : "";
      const productParam = selectedProduct
        ? `&product_id=${selectedProduct}`
        : "";

      const response = await apiClient.get<Blob>(
        `/inventory/sales-stock/export-csv?limit=100000${branchParam}${statusParam}${productParam}`,
        {
          responseType: "blob",
        },
      );

      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sales_stock_${selectedBranch || "all"}_${format(new Date(), "yyyy-MM-dd_HHmmss")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery("");
    setSelectedBrand("all");
    setSelectedProduct("all");
    setSelectedStatus("all");
    setDateFrom("");
    setDateTo("");
    setSelectedLocation("all");
  };

  // Get paginated data
  const paginatedStock = filteredStock.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 2,
        p: 2,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="h5" fontWeight={600}>
          Sales Stock
        </Typography>
        <Stack direction="row" spacing={1}>
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
            disabled={filteredStock.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => refetchStock()}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <SummaryCard
            title="In Stock"
            value={summaryStats.inStock}
            icon={<PackageIcon />}
            color="#4CAF50"
            bgColor="rgba(76, 175, 80, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <SummaryCard
            title="Reserved"
            value={summaryStats.reserved}
            icon={<AlertIcon />}
            color="#FF9800"
            bgColor="rgba(255, 152, 0, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <SummaryCard
            title="Sold Today"
            value={summaryStats.soldToday}
            icon={<PackageIcon />}
            color="#2196F3"
            bgColor="rgba(33, 150, 243, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <SummaryCard
            title="Returned Items"
            value={summaryStats.returnedItems}
            icon={<ReturnIcon />}
            color="#9C27B0"
            bgColor="rgba(156, 39, 176, 0.1)"
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
                value={
                  branches.find(
                    (branch: any) => branch.branch_code === selectedBranch,
                  ) || null
                }
                onChange={(_, value: any) =>
                  setSelectedBranch(value?.branch_code || "")
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    placeholder="Search branches..."
                  />
                )}
                noOptionsText={
                  isLoadingBranches ? "Loading..." : "No branches found"
                }
              />
            </Grid>

            {/* Location */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={locations}
                getOptionLabel={(option: LocationRef) => option.name || ""}
                value={
                  locations.find(
                    (location: LocationRef) =>
                      location.name === selectedLocation,
                  ) || null
                }
                onChange={(_, value: LocationRef | null) =>
                  setSelectedLocation(value?.name || "all")
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Location"
                    placeholder="Search locations..."
                  />
                )}
                noOptionsText={
                  isLoadingLocations ? "Loading..." : "No locations found"
                }
              />
            </Grid>

            {/* Search */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TextField
                fullWidth
                size="small"
                label="Search"
                placeholder="Barcode, Serial, Item Code..."
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
                value={
                  brands.find(
                    (brand: Brand) => brand.id.toString() === selectedBrand,
                  ) || null
                }
                onChange={(_, value: Brand | null) =>
                  setSelectedBrand(value?.id.toString() || "all")
                }
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
                value={
                  products.find(
                    (product: Product) =>
                      product.id.toString() === selectedProduct,
                  ) || null
                }
                onChange={(_, value: Product | null) =>
                  setSelectedProduct(value?.id.toString() || "all")
                }
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
                  { value: "sold", label: "Sold" },
                  { value: "reserved", label: "Reserved" },
                  {
                    value: "returned_to_supplier",
                    label: "Returned to Supplier",
                  },
                  { value: "return_pending", label: "Return Pending" },
                  { value: "transferred", label: "Transferred" },
                  { value: "damaged", label: "Damaged" },
                ]}
                getOptionLabel={(option) => option.label}
                value={
                  [
                    { value: "available", label: "Available" },
                    { value: "sold", label: "Sold" },
                    { value: "reserved", label: "Reserved" },
                    {
                      value: "returned_to_supplier",
                      label: "Returned to Supplier",
                    },
                    { value: "return_pending", label: "Return Pending" },
                    { value: "transferred", label: "Transferred" },
                    { value: "damaged", label: "Damaged" },
                  ].find((s) => s.value === selectedStatus) || null
                }
                onChange={(_, value) =>
                  setSelectedStatus(value?.value || "all")
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Status"
                    placeholder="Search status..."
                  />
                )}
                renderOption={(props, option) => (
                  <Box component="li" {...props}>
                    <StatusChip status={option.value} />
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
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {/* Table Header */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="subtitle1" fontWeight={500}>
            Stock Items ({filteredStock.length.toLocaleString()})
          </Typography>
        </Box>

        {/* Table Content */}
        {isLoadingStock ? (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress />
          </Box>
        ) : paginatedStock.length === 0 ? (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 2,
              py: 8,
            }}
          >
            <PackageIcon sx={{ fontSize: 64, opacity: 0.3 }} />
            <Typography color="text.secondary">No stock items found</Typography>
            <Typography variant="body2" color="text.secondary">
              {salesStock.length === 0
                ? "Sales stock is created when Goods Received Notes (GRN) are approved. Add inventory through the Purchasing → GRN workflow."
                : "Try adjusting your filters"}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ flex: 1 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Barcode</TableCell>
                  <TableCell>Product</TableCell>
                  <TableCell>Item Code</TableCell>
                  <TableCell>Brand</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>GRN No</TableCell>
                  <TableCell>Received Date</TableCell>
                  <TableCell align="right">Cost Price (Rs.)</TableCell>
                  <TableCell align="right">Selling Price (Rs.)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedStock.map((stock: SalesStock) => {
                  const product = getProduct(stock.product_id);
                  const brandName = stock.brand_id
                    ? getBrand(stock.brand_id)?.brand_name
                    : null;

                  return (
                    <TableRow
                      key={stock.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => {
                        setSelectedStock(stock);
                        setIsDetailsPanelOpen(true);
                      }}
                    >
                      <TableCell
                        sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}
                      >
                        {stock.barcode}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          {product?.image_url && (
                            <Box
                              component="img"
                              src={product.image_url}
                              alt={product.name}
                              onError={(
                                e: React.SyntheticEvent<HTMLImageElement>,
                              ) => {
                                e.currentTarget.style.display = "none";
                              }}
                              sx={{
                                width: 32,
                                height: 32,
                                objectFit: "contain",
                                borderRadius: 0.5,
                                border: "1px solid",
                                borderColor: "divider",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          {stock.product_name || product?.name || "Unknown"}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {stock.item_code || product?.item_code || "-"}
                      </TableCell>
                      <TableCell>
                        {brandName || getProductBrandName(product) || "-"}
                      </TableCell>
                      <TableCell>{stock.branch_code}</TableCell>
                      <TableCell>{stock.location_name || "-"}</TableCell>
                      <TableCell>
                        <StatusChip status={stock.status} />
                      </TableCell>
                      <TableCell>{stock.grn_no || "-"}</TableCell>
                      <TableCell>
                        {format(parseISO(stock.added_date), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell align="right">
                        {stock.cost_price ? fmtLKR(stock.cost_price) : "-"}
                      </TableCell>
                      <TableCell align="right">
                        {stock.selling_price
                          ? fmtLKR(stock.selling_price)
                          : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pagination */}
        {filteredStock.length > 0 && (
          <TablePagination
            component="div"
            count={filteredStock.length}
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

      {/* Stock Details Panel */}
      <StockDetailsPanel
        stock={selectedStock}
        product={
          selectedStock ? getProduct(selectedStock.product_id) || null : null
        }
        brandName={
          selectedStock
            ? getProductBrandName(getProduct(selectedStock.product_id))
            : ""
        }
        categoryName={
          selectedStock
            ? getProductCategoryName(getProduct(selectedStock.product_id))
            : ""
        }
        isOpen={isDetailsPanelOpen}
        onClose={() => setIsDetailsPanelOpen(false)}
      />
    </Box>
  );
}
