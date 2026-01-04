/**
 * PurchasingDashboard - Overview dashboard for purchasing module
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Chip,
  Skeleton,
  Paper,
  Divider,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";

import { suppliersApi, purchaseOrdersApi, goodReceivedNotesApi, purchaseReturnsApi } from "@/modules/purchasing/api";

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color?: string;
  onClick?: () => void;
  isLoading?: boolean;
}

function StatCard({ title, value, icon, color = "primary.main", onClick, isLoading }: StatCardProps) {
  return (
    <Card 
      sx={{ 
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.2s, box-shadow 0.2s",
        "&:hover": onClick ? {
          transform: "translateY(-2px)",
          boxShadow: 4,
        } : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {title}
            </Typography>
            {isLoading ? (
              <Skeleton width={60} height={40} />
            ) : (
              <Typography variant="h4" fontWeight="bold">
                {value}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: `${color}15`,
              color: color,
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

interface RecentItemProps {
  primary: string;
  secondary: string;
  status: string;
  statusColor: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";
  icon: React.ReactNode;
  onClick: () => void;
}

function RecentItem({ primary, secondary, status, statusColor, icon, onClick }: RecentItemProps) {
  return (
    <ListItemButton onClick={onClick} sx={{ borderRadius: 1 }}>
      <ListItemIcon sx={{ minWidth: 40 }}>{icon}</ListItemIcon>
      <ListItemText 
        primary={primary} 
        secondary={secondary}
        primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
        secondaryTypographyProps={{ variant: "caption" }}
      />
      <Chip 
        label={status} 
        size="small" 
        color={statusColor}
        sx={{ minWidth: 80 }}
      />
    </ListItemButton>
  );
}

export default function PurchasingDashboard() {
  const navigate = useNavigate();

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

  const stats = useMemo(() => {
    const activeSuppliers = suppliers?.filter((s) => s.active).length || 0;
    const pendingOrders = orders?.filter((o) => o.status === "pending" || o.status === "draft").length || 0;
    const totalGRNs = grns?.length || 0;
    const totalReturns = returns?.length || 0;

    return { activeSuppliers, pendingOrders, totalGRNs, totalReturns };
  }, [suppliers, orders, grns, returns]);

  const recentOrders = useMemo(() => {
    if (!orders) return [];
    return [...orders]
      .sort((a, b) => new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime())
      .slice(0, 5);
  }, [orders]);

  const recentGRNs = useMemo(() => {
    if (!grns) return [];
    return [...grns]
      .sort((a, b) => new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime())
      .slice(0, 5);
  }, [grns]);

  const getStatusColor = (status: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
    const colorMap: Record<string, "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning"> = {
      draft: "default",
      pending: "warning",
      approved: "info",
      completed: "success",
      cancelled: "error",
      inspected: "info",
      accepted: "success",
      rejected: "error",
    };
    return colorMap[status] || "default";
  };

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers?.find((s) => s.id === supplierId);
    return supplier?.full_name || "Unknown";
  };

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Purchasing Dashboard
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Overview of purchasing activities and pending items
      </Typography>

      {/* Stats Row */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Active Suppliers"
            value={stats.activeSuppliers}
            icon={<BusinessIcon fontSize="large" />}
            color="primary.main"
            onClick={() => navigate("/purchasing/suppliers")}
            isLoading={suppliersLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Pending Orders"
            value={stats.pendingOrders}
            icon={<ShoppingCartIcon fontSize="large" />}
            color="warning.main"
            onClick={() => navigate("/purchasing/orders")}
            isLoading={ordersLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total GRNs"
            value={stats.totalGRNs}
            icon={<ReceiptLongIcon fontSize="large" />}
            color="info.main"
            onClick={() => navigate("/purchasing/grn")}
            isLoading={grnsLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Returns"
            value={stats.totalReturns}
            icon={<AssignmentReturnIcon fontSize="large" />}
            color="error.main"
            onClick={() => navigate("/purchasing/returns")}
            isLoading={returnsLoading}
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
              <Chip
                label={`${orders?.length || 0} total`}
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
                    statusColor={getStatusColor(order.status)}
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
              <Chip
                label={`${grns?.length || 0} total`}
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
                    status="Received"
                    statusColor="success"
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
