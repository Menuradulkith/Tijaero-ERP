/**
 * SalesStockDashboard - Comprehensive Sales Stock Management
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
  Inventory as PackageIcon,
  Warning as AlertIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  AssignmentReturn as ReturnIcon,
} from "@mui/icons-material";
import { branchApi } from "@/modules/branches/api";
import { salesStockApi, productsApi, categoriesApi, brandsApi } from "@/modules/inventory/api";
import { locationsApi, Location } from "@/modules/common/api";
import { SalesStock, Product, Brand, Category } from "@/modules/inventory/types";
import { format, parseISO } from "date-fns";

// Summary Card Component
interface SummaryCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const SummaryCard = ({ title, value, icon, color, bgColor }: SummaryCardProps) => (
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
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
  const statusConfig: Record<string, { label: string; color: "success" | "warning" | "info" | "error" | "default" }> = {
    available: { label: "Available", color: "success" },
    reserved: { label: "Reserved", color: "warning" },
    sold: { label: "Sold", color: "info" },
    returned_to_supplier: { label: "Returned to Supplier", color: "info" },
    return_pending: { label: "Return Pending", color: "warning" },
    transferred: { label: "Transferred", color: "info" },
    damaged: { label: "Damaged", color: "error" },
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

// Stock Details Panel Component
interface StockDetailsPanelProps {
  stock: SalesStock | null;
  product: Product | null;
  brandName: string;
  categoryName: string;
  isOpen: boolean;
  onClose: () => void;
}

const StockDetailsPanel = ({ stock, product, brandName, categoryName, isOpen, onClose }: StockDetailsPanelProps) => {
  // Mock timeline data - in production, this would come from an API
  const timeline = stock ? [
    { 
      date: stock.added_date, 
      action: "Received", 
      details: `Added via GRN #${stock.good_received_note_id || "N/A"}`,
      color: "#2196F3"
    },
    ...(stock.status === "sold" ? [{
      date: new Date().toISOString(),
      action: "Sold",
      details: "Sold to customer",
      color: "#4CAF50"
    }] : []),
    ...(stock.status === "reserved" ? [{
      date: new Date().toISOString(),
      action: "Reserved",
      details: "Reserved for customer",
      color: "#FF9800"
    }] : []),
    ...(stock.status === "transferred" ? [{
      date: new Date().toISOString(),
      action: "Transferred",
      details: "Transferred to another branch",
      color: "#9C27B0"
    }] : []),
    ...(stock.status === "damaged" ? [{
      date: new Date().toISOString(),
      action: "Marked Damaged",
      details: "Item marked as damaged",
      color: "#F44336"
    }] : []),
  ] : [];

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
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Product Name</Typography>
                  <Typography variant="body2" fontWeight={500}>{product.name}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Item Code</Typography>
                  <Typography variant="body2" fontWeight={500}>{product.item_code || "N/A"}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Brand</Typography>
                  <Typography variant="body2" fontWeight={500}>{brandName || "N/A"}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Category</Typography>
                  <Typography variant="body2" fontWeight={500}>{categoryName || "N/A"}</Typography>
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
                  <Typography variant="caption" color="text.secondary">Barcode</Typography>
                  <Typography variant="body2" fontWeight={500} fontFamily="monospace">{stock.barcode}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <StatusChip status={stock.status} />
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Branch</Typography>
                  <Typography variant="body2" fontWeight={500}>{stock.branch_code}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">GRN No</Typography>
                  <Typography variant="body2" fontWeight={500}>{stock.good_received_note_id || "N/A"}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Warranty</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.warranty_month ? `${stock.warranty_month} months` : "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Received Date</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {format(parseISO(stock.added_date), "dd MMM yyyy")}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Box>

          {/* Movement Timeline */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Movement Timeline
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {timeline.map((item, index) => (
                <Box key={index} sx={{ display: "flex", gap: 2, mb: index < timeline.length - 1 ? 2 : 0 }}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: item.color,
                      mt: 0.8,
                    }}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={500}>{item.action}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.details}</Typography>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {format(parseISO(item.date), "dd MMM yyyy HH:mm")}
                    </Typography>
                  </Box>
                </Box>
              ))}
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

  // Fetch Data
  const { data: branchesData, isLoading: isLoadingBranches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  const { data: brandsData } = useQuery({
    queryKey: ["brands"],
    queryFn: () => brandsApi.getAll(0, 1000),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(0, 1000),
  });

  const { data: locationsData, isLoading: isLoadingLocations } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
  });

  const { data: productsData } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(0, 1000),
  });

  const { data: salesStockData, isLoading: isLoadingStock, refetch: refetchStock } = useQuery({
    queryKey: ["salesStock", selectedBranch],
    queryFn: async () => {
      const params: { branch_code?: string } = {};
      if (selectedBranch) {
        params.branch_code = selectedBranch;
      }
      const result = await salesStockApi.getAll(params);
      return result;
    },
  });

  const branches = branchesData?.items || [];
  const brands = brandsData || [];
  const categories = categoriesData || [];
  const locations = locationsData || [];
  const products = productsData || [];
  const salesStock = salesStockData || [];

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
        return product?.items_brand_id?.toString() === selectedBrand || 
               (product as any)?.brand_id?.toString() === selectedBrand;
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
      filtered = filtered.filter((stock: SalesStock) => 
        stock.status?.toLowerCase() === selectedStatus.toLowerCase()
      );
    }

    // Date range filter
    if (dateFrom) {
      filtered = filtered.filter((stock: SalesStock) => stock.added_date >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter((stock: SalesStock) => stock.added_date <= dateTo);
    }

    // Location filter - now working with location_name from backend
    if (selectedLocation !== "all") {
      filtered = filtered.filter((stock: SalesStock) => 
        (stock as any).location_name === selectedLocation
      );
    }

    return filtered;
  }, [salesStock, searchQuery, selectedBrand, selectedProduct, selectedStatus, dateFrom, dateTo, selectedLocation, products]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const inStock = filteredStock.filter((s: SalesStock) => 
      s.status?.toLowerCase() === "in_stock" || s.status?.toLowerCase() === "available"
    ).length;
    const reserved = filteredStock.filter((s: SalesStock) => 
      s.status?.toLowerCase() === "reserved"
    ).length;
    const soldToday = filteredStock.filter((s: SalesStock) => {
      if (s.status?.toLowerCase() !== "sold") return false;
      const today = new Date().toISOString().split("T")[0];
      return (s as any).updated_at?.startsWith(today) || s.added_date?.startsWith(today);
    }).length;
    
    // Returned items calculation (returned_to_supplier + return_pending)
    const returnedItems = filteredStock.filter((s: SalesStock) => 
      s.status?.toLowerCase() === "returned_to_supplier" || s.status?.toLowerCase() === "return_pending"
    ).length;

    return { inStock, reserved, soldToday, returnedItems };
  }, [filteredStock]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [searchQuery, selectedBrand, selectedProduct, selectedStatus, dateFrom, dateTo, selectedLocation, selectedBranch]);

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
  const paginatedStock = filteredStock.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 2, p: 2 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5" fontWeight={600}>Sales Stock</Typography>
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

            {/* Location */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={locations}
                getOptionLabel={(option: Location) => option.name || ""}
                value={locations.find((location: Location) => location.name === selectedLocation) || null}
                onChange={(_, value: Location | null) => setSelectedLocation(value?.name || "all")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Location"
                    placeholder="Search locations..."
                  />
                )}
                noOptionsText={isLoadingLocations ? "Loading..." : "No locations found"}
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
                  { value: "sold", label: "Sold" },
                  { value: "reserved", label: "Reserved" },
                  { value: "returned_to_supplier", label: "Returned to Supplier" },
                  { value: "return_pending", label: "Return Pending" },
                  { value: "transferred", label: "Transferred" },
                  { value: "damaged", label: "Damaged" },
                ]}
                getOptionLabel={(option) => option.label}
                value={[
                  { value: "available", label: "Available" },
                  { value: "sold", label: "Sold" },
                  { value: "reserved", label: "Reserved" },
                  { value: "returned_to_supplier", label: "Returned to Supplier" },
                  { value: "return_pending", label: "Return Pending" },
                  { value: "transferred", label: "Transferred" },
                  { value: "damaged", label: "Damaged" },
                ].find(s => s.value === selectedStatus) || null}
                onChange={(_, value) => setSelectedStatus(value?.value || "all")}
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
      <Paper variant="outlined" sx={{ flex: 1, display: "flex", flexDirection: "column", borderRadius: 2, overflow: "hidden" }}>
        {/* Table Header */}
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle1" fontWeight={500}>
            Stock Items ({filteredStock.length.toLocaleString()})
          </Typography>
        </Box>

        {/* Table Content */}
        {isLoadingStock ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : paginatedStock.length === 0 ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2, py: 8 }}>
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
                  <TableCell align="right">Cost Price</TableCell>
                  <TableCell align="right">Selling Price</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedStock.map((stock: SalesStock) => {
                  const product = getProduct(stock.product_id);
                  
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
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{stock.barcode}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{product?.name || "Unknown"}</TableCell>
                      <TableCell>{product?.item_code || "-"}</TableCell>
                      <TableCell>{getProductBrandName(product)}</TableCell>
                      <TableCell>{stock.branch_code}</TableCell>
                      <TableCell>{stock.location_name || "-"}</TableCell>
                      <TableCell>
                        <StatusChip status={stock.status} />
                      </TableCell>
                      <TableCell>{stock.grn_no || "-"}</TableCell>
                      <TableCell>{format(parseISO(stock.added_date), "dd MMM yyyy")}</TableCell>
                      <TableCell align="right">
                        {stock.cost_price ? `Rs. ${stock.cost_price.toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell align="right">
                        {stock.selling_price ? `Rs. ${stock.selling_price.toFixed(2)}` : "-"}
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
        product={selectedStock ? getProduct(selectedStock.product_id) || null : null}
        brandName={selectedStock ? getProductBrandName(getProduct(selectedStock.product_id)) : ""}
        categoryName={selectedStock ? getProductCategoryName(getProduct(selectedStock.product_id)) : ""}
        isOpen={isDetailsPanelOpen}
        onClose={() => setIsDetailsPanelOpen(false)}
      />
    </Box>
  );
}
