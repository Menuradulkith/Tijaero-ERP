/**
 * PurchasingDashboard - Overview dashboard for purchasing module
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Grid,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Skeleton,
  Paper,
  Divider,
  Autocomplete,
  TextField,
  Card,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";

import { suppliersApi, purchaseOrdersApi, goodReceivedNotesApi, purchaseReturnsApi } from "@/modules/purchasing/api";
import { branchApi } from "@/modules/branches/api";
import type { Branch } from "@/api/types";
import { TStatCard, TStatusChip, TPageHeader, TChip } from "@/components/tijaero";

interface RecentItemProps {
  primary: string;
  secondary: string;
  status: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function RecentItem({ primary, secondary, status, icon, onClick }: RecentItemProps) {
  return (
    <ListItemButton onClick={onClick} sx={{ borderRadius: 1 }}>
      <ListItemIcon sx={{ minWidth: 40 }}>{icon}</ListItemIcon>
      <ListItemText 
        primary={primary} 
        secondary={secondary}
        primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
        secondaryTypographyProps={{ variant: "caption" }}
      />
      <TStatusChip 
        status={status} 
        statusMap="purchaseOrder"
        size="small"
      />
    </ListItemButton>
  );
}

export default function PurchasingDashboard() {
  const navigate = useNavigate();
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const { data: branchesResponse } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });
  const branches = branchesResponse?.items || [];

  const { data: suppliers, isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => purchaseOrdersApi.getAll(),
  });

  const { data: grns, isLoading: grnsLoading } = useQuery({
    queryKey: ["goodReceivedNotes"],
    queryFn: () => goodReceivedNotesApi.getAll(),
  });

  const { data: returns, isLoading: returnsLoading } = useQuery({
    queryKey: ["purchaseReturns"],
    queryFn: () => purchaseReturnsApi.getAll(),
  });

  // Filter data by branch
  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    if (!filterBranch) return orders;
    return orders.filter((o) => o.branch_code === filterBranch);
  }, [orders, filterBranch]);

  const filteredGRNs = useMemo(() => {
    if (!grns) return [];
    if (!filterBranch) return grns;
    return grns.filter((g) => g.branch_code === filterBranch);
  }, [grns, filterBranch]);

  const filteredReturns = useMemo(() => {
    if (!returns) return [];
    if (!filterBranch) return returns;
    return returns.filter((r) => r.branch_code === filterBranch);
  }, [returns, filterBranch]);

  const stats = useMemo(() => {
    const activeSuppliers = suppliers?.filter((s) => s.active).length || 0;
    const pendingOrders = filteredOrders.filter((o) => o.status === "pending" || o.status === "draft").length || 0;
    const totalGRNs = filteredGRNs.length;
    const totalReturns = filteredReturns.length;

    return { activeSuppliers, pendingOrders, totalGRNs, totalReturns };
  }, [suppliers, filteredOrders, filteredGRNs, filteredReturns]);

  const recentOrders = useMemo(() => {
    if (!filteredOrders.length) return [];
    return [...filteredOrders]
      .sort((a, b) => new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime())
      .slice(0, 5);
  }, [filteredOrders]);

  const recentGRNs = useMemo(() => {
    if (!filteredGRNs.length) return [];
    return [...filteredGRNs]
      .sort((a, b) => new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime())
      .slice(0, 5);
  }, [filteredGRNs]);

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers?.find((s) => s.id === supplierId);
    return supplier?.full_name || "Unknown";
  };

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <TPageHeader
        title="Purchasing Dashboard"
        subtitle={
          filterBranch
            ? `Overview of purchasing activities - ${branches.find((b) => b.branch_code === filterBranch)?.branch_name || filterBranch}`
            : "Overview of purchasing activities and pending items"
        }
        actions={
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find((b) => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} label="Filter by Branch" placeholder="All Branches" />
            )}
            sx={{ minWidth: 250 }}
          />
        }
      />

      {/* Stats Row */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Active Suppliers"
            value={stats.activeSuppliers}
            icon={<BusinessIcon />}
            color="primary"
            onClick={() => navigate("/purchasing/suppliers")}
            loading={suppliersLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Pending Orders"
            value={stats.pendingOrders}
            icon={<ShoppingCartIcon />}
            color="warning"
            onClick={() => navigate("/purchasing/orders")}
            loading={ordersLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total GRNs"
            value={stats.totalGRNs}
            icon={<ReceiptLongIcon />}
            color="info"
            onClick={() => navigate("/purchasing/grn")}
            loading={grnsLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TStatCard
            title="Total Returns"
            value={stats.totalReturns}
            icon={<AssignmentReturnIcon />}
            color="error"
            onClick={() => navigate("/purchasing/returns")}
            loading={returnsLoading}
          />
        </Grid>
      </Grid>

      {/* Recent Items Row */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6" fontWeight="bold">
                Recent Purchase Orders
              </Typography>
              <TChip
                label={`${filteredOrders.length} total`}
                size="small"
                color="primary"
                variant="outlined"
              />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {ordersLoading ? (
              <Box>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={60} sx={{ my: 1 }} />
                ))}
              </Box>
            ) : recentOrders.length === 0 ? (
              <Box textAlign="center" py={4}>
                <ShoppingCartIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography color="text.secondary">No purchase orders yet</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {recentOrders.map((order) => (
                  <RecentItem
                    key={order.id}
                    primary={order.purchasing_order_no || `PO-${order.id}`}
                    secondary={`${getSupplierName(order.first_suppliers_id)} • ${new Date(order.purchasing_order_date || "").toLocaleDateString()}`}
                    status={order.status}
                    icon={<ShoppingCartIcon fontSize="small" color="action" />}
                    onClick={() => navigate("/purchasing/orders")}
                  />
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
              <Typography variant="h6" fontWeight="bold">
                Recent Good Received Notes
              </Typography>
              <TChip
                label={`${filteredGRNs.length} total`}
                size="small"
                color="info"
                variant="outlined"
              />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {grnsLoading ? (
              <Box>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={60} sx={{ my: 1 }} />
                ))}
              </Box>
            ) : recentGRNs.length === 0 ? (
              <Box textAlign="center" py={4}>
                <ReceiptLongIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography color="text.secondary">No GRNs yet</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {recentGRNs.map((grn) => (
                  <RecentItem
                    key={grn.id}
                    primary={grn.good_received_no || `GRN-${grn.id}`}
                    secondary={`PO: ${grn.purchasingorders_id} • ${new Date(grn.good_received_date || "").toLocaleDateString()}`}
                    status="received"
                    icon={<ReceiptLongIcon fontSize="small" color="action" />}
                    onClick={() => navigate("/purchasing/grn")}
                  />
                ))}
              </List>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Box mt={4}>
        <Typography variant="h6" fontWeight="bold" gutterBottom>
          Quick Actions
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/purchasing/suppliers")}
            >
              <BusinessIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Manage Suppliers
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/purchasing/orders")}
            >
              <ShoppingCartIcon color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                New Purchase Order
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/purchasing/grn")}
            >
              <ReceiptLongIcon color="info" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Receive Goods
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card
              sx={{
                cursor: "pointer",
                textAlign: "center",
                p: 2,
                transition: "all 0.2s",
                "&:hover": { bgcolor: "action.hover", transform: "translateY(-2px)" },
              }}
              onClick={() => navigate("/purchasing/returns")}
            >
              <AssignmentReturnIcon color="error" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2" fontWeight="500">
                Process Return
              </Typography>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
