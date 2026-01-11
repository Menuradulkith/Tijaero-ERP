/**
 * SalesStockDashboard - Modern UI for displaying all products in sales stock
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Grid,
  Typography,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TextField,
  Autocomplete,
  Chip,
  CircularProgress,
  InputAdornment,
  IconButton,
  Tooltip,
  Fade,
  LinearProgress,
  alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import InventoryIcon from "@mui/icons-material/Inventory";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import RefreshIcon from "@mui/icons-material/Refresh";
import FilterListIcon from "@mui/icons-material/FilterList";
import QrCodeIcon from "@mui/icons-material/QrCode";
import CategoryIcon from "@mui/icons-material/Category";

import { salesStockApi, productsApi } from "@/modules/inventory/api";
import { branchApi } from "@/modules/branches/api";
import { Product } from "@/modules/inventory/types";
import { modernTableStyles } from "@/components/tijaero";

const STATUS_COLORS: Record<string, "success" | "warning" | "error" | "info" | "default"> = {
  available: "success",        // Green - ready for sale
  sold: "default",             // Grey - completed sale
  reserved: "warning",         // Orange - on hold
  return_pending: "info",      // Blue - awaiting return approval
  returned_to_supplier: "error", // Red - returned to supplier
  transferred: "info",         // Blue - moved to another branch
  damaged: "error",            // Red - damaged items
};

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color?: "primary" | "success" | "info" | "warning" | "error";
  subtitle?: string;
}

function StatCard({ title, value, icon, color = "primary", subtitle }: StatCardProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.25,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        height: "100%",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {title}
          </Typography>
          <Typography variant="h5" fontWeight="bold" sx={{ color: (theme) => theme.palette[color].main }}>
            {value.toLocaleString()}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          ) : null}
        </Box>

        <Box
          sx={(theme) => ({
            width: 44,
            height: 44,
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
            bgcolor: alpha(theme.palette[color].main, 0.12),
            color: theme.palette[color].main,
            flexShrink: 0,
          })}
        >
          {icon}
        </Box>
      </Box>
    </Paper>
  );
}

export default function SalesStockDashboard() {
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterProduct, setFilterProduct] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch all sales stock
  const { data: salesStock = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sales-stock", filterBranch, filterProduct],
    queryFn: () =>
      salesStockApi.getAll({
        branch_code: filterBranch || undefined,
        product_id: filterProduct || undefined,
      }),
  });

  // Fetch products for filtering and display
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  // Fetch branches for filtering
  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(),
  });
  const branches = branchesData?.items || [];

  // Create product lookup map
  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Filter by search query (barcode) and status
  const filteredStock = useMemo(() => {
    let filtered = salesStock;
    
    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter((item) => item.status === filterStatus);
    }
    
    // Apply search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.barcode.toLowerCase().includes(q) ||
          productMap.get(item.product_id)?.name.toLowerCase().includes(q)
      );
    }
    
    return filtered;
  }, [salesStock, searchQuery, productMap, filterStatus]);

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredStock.length;
    const available = filteredStock.filter((i) => i.status === "available").length;
    const sold = filteredStock.filter((i) => i.status === "sold").length;
    const reserved = filteredStock.filter((i) => i.status === "reserved").length;
    return { total, available, sold, reserved };
  }, [filteredStock]);

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 4,
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight="bold" color="text.primary">
            Sales Stock Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Overview of sales stock and product availability
          </Typography>
        </Box>
        <Tooltip title="Refresh data">
          <IconButton
            onClick={() => refetch()}
            disabled={isFetching}
            sx={{
              bgcolor: "background.paper",
              boxShadow: 1,
              "&:hover": { bgcolor: "grey.100" },
            }}
          >
            <RefreshIcon sx={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2.5} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Items"
            value={stats.total}
            icon={<InventoryIcon fontSize="small" />}
            color="primary"
            subtitle="In stock"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Available"
            value={stats.available}
            icon={<CheckCircleIcon fontSize="small" />}
            color="success"
            subtitle="Ready for sale"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Sold"
            value={stats.sold}
            icon={<ShoppingCartIcon fontSize="small" />}
            color="warning"
            subtitle="Completed sales"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Reserved"
            value={stats.reserved}
            icon={<BookmarkIcon fontSize="small" />}
            color="info"
            subtitle="On hold"
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 3,
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.8),
          backdropFilter: "blur(8px)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <FilterListIcon color="primary" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            FILTERS
          </Typography>
        </Box>
        
        {/* Status Filter Dropdown */}
        <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
          <Autocomplete
            size="small"
            options={[
              { value: null, label: "All Statuses" },
              { value: "available", label: "Available" },
              { value: "sold", label: "Sold" },
              { value: "reserved", label: "Reserved" },
              { value: "return_pending", label: "Return Pending" },
              { value: "returned_to_supplier", label: "Returned to Supplier" },
              { value: "transferred", label: "Transferred" },
              { value: "damaged", label: "Damaged" },
            ]}
            getOptionLabel={(option) => option.label}
            value={
              filterStatus === null
                ? { value: null, label: "All Statuses" }
                : { value: filterStatus, label: filterStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }
            }
            onChange={(_, newValue) => setFilterStatus(newValue?.value || null)}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            sx={{ minWidth: 200 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Filter by Status"
                placeholder="All Statuses"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                    bgcolor: "background.paper",
                  },
                }}
              />
            )}
          />
        </Box>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <TextField
            size="small"
            placeholder="Search by barcode or product name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{
              minWidth: 280,
              "& .MuiOutlinedInput-root": {
                borderRadius: 2,
                bgcolor: "background.paper",
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find((b) => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            sx={{ minWidth: 220 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="All Branches"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                    bgcolor: "background.paper",
                  },
                }}
              />
            )}
          />
          <Autocomplete
            size="small"
            options={products}
            getOptionLabel={(option) => option.name}
            value={products.find((p) => p.id === filterProduct) || null}
            onChange={(_, newValue) => setFilterProduct(newValue?.id || null)}
            sx={{ minWidth: 220 }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="All Products"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                    bgcolor: "background.paper",
                  },
                }}
              />
            )}
          />
        </Box>
      </Paper>

      {/* Loading indicator */}
      {isFetching && <LinearProgress sx={{ mb: 1, borderRadius: 1 }} />}

      {/* Stock Table */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 8 }}>
            <CircularProgress />
          </Box>
        ) : filteredStock.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <InventoryIcon sx={{ fontSize: 64, color: "grey.300", mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No items found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {searchQuery || filterBranch || filterProduct
                ? "Try adjusting your filters"
                : "Sales stock is empty. Items will appear here after GRN processing."}
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <QrCodeIcon fontSize="small" color="action" />
                      Barcode
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CategoryIcon fontSize="small" color="action" />
                      Product
                    </Box>
                  </TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Warranty</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Added Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredStock.map((item, index) => {
                  const product = productMap.get(item.product_id);
                  return (
                    <Fade in timeout={150 + index * 30} key={item.id}>
                      <TableRow
                        hover
                        sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                          "&:last-child td, &:last-child th": { border: 0 },
                        }}
                      >
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: "monospace",
                              fontWeight: 500,
                              bgcolor: "grey.100",
                              px: 1,
                              py: 0.5,
                              borderRadius: 1,
                              display: "inline-block",
                            }}
                          >
                            {item.barcode}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {product?.name || `Product #${item.product_id}`}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={item.branch_code}
                            size="small"
                            variant="outlined"
                            sx={{ borderRadius: 1.5 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color={item.warranty_month ? "text.primary" : "text.disabled"}>
                            {item.warranty_month ? `${item.warranty_month} months` : "—"}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={item.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            size="small"
                            color={STATUS_COLORS[item.status] || "default"}
                            sx={{ borderRadius: 1.5, fontWeight: 500 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {new Date(item.added_date).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    </Fade>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Box>
  );
}
