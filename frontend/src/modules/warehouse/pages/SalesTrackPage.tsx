/**
 * SalesTrackPage - Comprehensive Sales Order Tracking
 *
 * A modern ERP order tracking page that allows users to search for invoices
 * and view a complete lifecycle timeline, payment breakdown, payment history,
 * returns, and line items — all in one view.
 *
 * Uses MasterDetailLayout pattern with Tijaero components.
 */

import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import EventNoteIcon from "@mui/icons-material/EventNote";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import PaymentIcon from "@mui/icons-material/Payment";
import PersonIcon from "@mui/icons-material/Person";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import TimelineIcon from "@mui/icons-material/Timeline";
import {
  Avatar,
  Box,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { usePermission } from "@/auth/permissions";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

// Import tijaero components
import {
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
  TDetailSkeleton,
  TInfoCard,
  TStatCard,
  TStatusChip,
  getStatusProps,
  modernTableStyles,
  showErrorToast,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import { useReferenceData } from "@/hooks";
import { customersApi } from "@/modules/customers/api";
import { Customer } from "@/modules/customers/types";
import { productsApi } from "@/modules/inventory/api";
import { Product } from "@/modules/inventory/types";
import { salesApi, saleReturnsApi } from "@/modules/sales/api";
import { Invoice, InvoiceWithItems, SaleReturn } from "@/modules/sales/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "invoice_no", label: "Invoice Number" },
  { value: "grand_total", label: "Amount" },
];

const APPROVAL_STATUS_FILTER_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval", color: "warning" as const },
  { value: "approved", label: "Approved", color: "info" as const },
  { value: "completed", label: "Completed", color: "success" as const },
  { value: "cancelled", label: "Cancelled", color: "error" as const },
];

// Helper component for info rows
const InfoRow = ({ label, value }: { label: string; value: string | number }) => (
  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
    <Typography variant="body2" color="text.secondary">
      {label}:
    </Typography>
    <Typography variant="body2" fontWeight={500}>
      {value}
    </Typography>
  </Box>
);

export default function SalesTrackPage() {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");
  const [selectedOrder, setSelectedOrder] = useState<InvoiceWithItems | null>(null);
  const [page] = useState(1);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // OPTIMIZED: Using aggregated endpoint for branches — resolved BEFORE query fires
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Set default branch filter from user's assigned branch
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Fetch paginated invoices
  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["sales-track-list", page, searchQuery, filterBranch, filterStatus, sortField],
    queryFn: () =>
      salesApi.getPaginated({
        page,
        pageSize: 100,
        search: searchQuery,
        branchCode: filterBranch || undefined,
        status: filterStatus || undefined,
        sortBy: sortField,
        sortDesc: true,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const orders = ordersData?.items || [];

  // Fetch customers (needed for names)
  const canViewCustomers = usePermission("customers", "view");
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
    enabled: canViewCustomers,
  });

  // Fetch products
  const canViewProducts = usePermission("products", "view");
  const { data: productsResult } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(1, 1000),
    enabled: canViewProducts,
  });
  const products = (productsResult as any)?.items || (Array.isArray(productsResult) ? productsResult : []) || [];

  // Create lookup maps
  const customerMap = useMemo(() => {
    const map = new Map<number, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p: Product) => map.set(p.id, p));
    return map;
  }, [products]);

  // Fetch payment history for selected order
  const { data: paymentHistory = [], isLoading: isDetailLoading } = useQuery({
    queryKey: ["payment-history", selectedOrder?.id],
    queryFn: () => salesApi.getPaymentHistory(selectedOrder!.id),
    enabled: !!selectedOrder,
  });

  // Fetch returns for selected order
  const { data: returns = [] } = useQuery({
    queryKey: ["order-returns", selectedOrder?.id],
    queryFn: () => saleReturnsApi.getByInvoice(selectedOrder!.id),
    enabled: !!selectedOrder,
  });

  // Filter and sort orders
  const filteredOrders = useMemo(() => {
    let filtered = orders.filter((order) => {
      const customer = customerMap.get(order.customer_id);
      return (
        order.invoice_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer?.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer?.company_name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });

    filtered.sort((a, b) => {
      if (sortField === "invoice_no") {
        return a.invoice_no.localeCompare(b.invoice_no);
      }
      if (sortField === "grand_total") {
        return b.grand_total - a.grand_total;
      }
      // Default: Date Descending (using created_date_time and id as fallback)
      const timeA = a.created_date_time ? new Date(a.created_date_time).getTime() : new Date(a.created_date).getTime();
      const timeB = b.created_date_time ? new Date(b.created_date_time).getTime() : new Date(b.created_date).getTime();
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return b.id - a.id;
    });

    return filtered;
  }, [orders, searchQuery, sortField, customerMap]);

  // Handle selection
  const handleSelectOrder = useCallback(async (order: Invoice) => {
    try {
      const fullOrder = await salesApi.getById(order.id);
      setSelectedOrder(fullOrder);
    } catch {
      showErrorToast("Failed to load order details");
    }
  }, []);

  // Auto-select first order
  useEffect(() => {
    if (filteredOrders.length > 0 && !selectedOrder) {
      handleSelectOrder(filteredOrders[0]);
    }
  }, [filteredOrders, selectedOrder, handleSelectOrder]);

  const customer = selectedOrder ? customerMap.get(selectedOrder.customer_id) : null;

  // Calculate order lifecycle step
  const getOrderStep = (order: InvoiceWithItems) => {
    if (order.approval_status === "cancelled") return 0; // Show as failed/cancelled
    if (order.approval_status === "completed") return 3;
    if (order.approval_status === "approved") return 2;
    if (order.approval_status === "pending_approval") return 1;
    return 0; // draft/created
  };

  const activeStep = selectedOrder ? getOrderStep(selectedOrder) : 0;
  const isCancelled = selectedOrder?.approval_status === "cancelled";

  // Payment breakdown
  const paymentBreakdown = selectedOrder
    ? [
        { method: "Cash", amount: selectedOrder.cash_amount },
        { method: "Visa Card", amount: selectedOrder.card_visa_amount },
        { method: "Mastercard", amount: selectedOrder.card_mastercard_amount },
        { method: "Amex Card", amount: selectedOrder.card_amex_amount },
        { method: "Cheque", amount: selectedOrder.cheque_amount },
        { method: "Bank Transfer", amount: selectedOrder.bank_transfer_amount },
        { method: "Credit", amount: selectedOrder.credit_amount },
        { method: "Coupons", amount: selectedOrder.cupon_amount },
        { method: "Credit Note", amount: selectedOrder.credit_note_amount },
        { method: "Gift Voucher", amount: selectedOrder.gift_voucher_amount },
      ].filter((p) => p.amount > 0)
    : [];

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredOrders}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search invoices..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedOrder}
      emptyMessage="No invoices found"
      listHeader={
        <SalesFilterPanel
          statusOptions={APPROVAL_STATUS_FILTER_OPTIONS}
          statusValue={filterStatus}
          onStatusChange={setFilterStatus}
          branches={branches}
          branchValue={filterBranch}
          onBranchChange={setFilterBranch}
        />
      }
      renderItem={(order, isSelected) => {
        const orderCustomer = customerMap.get(order.customer_id);
        const approvalChip = getStatusProps(order.approval_status || "pending_approval", "invoice");
        const paymentChip = getStatusProps(order.payment_status || "unpaid", "paymentStatus");
        return (
          <SelectableListItem
            key={order.id}
            id={order.id}
            isSelected={isSelected}
            onClick={() => handleSelectOrder(order)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{order.invoice_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Invoice)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {orderCustomer?.customer_name || "Unknown Customer"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Customer)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {fmtLKR(order.grand_total)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Total)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {format(new Date(order.created_date), "MMM dd, yyyy")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={approvalChip.label}
                        size="small"
                        color={approvalChip.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                      <Chip
                        label={paymentChip.label}
                        size="small"
                        color={paymentChip.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${orderCustomer?.customer_name || "Unknown"} - ${fmtLKR(order.grand_total)}`
                : undefined
            }
          />
        );
      }}
    />
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Sales Track", href: "/warehouse/sales-track" },
          ...(selectedOrder ? [{ label: selectedOrder.invoice_no }] : []),
        ]}
        title={selectedOrder?.invoice_no || ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        noSelectionTitle="Select an Invoice to Track"
        chips={
          selectedOrder
            ? [
                {
                  label: getStatusProps(selectedOrder.approval_status || "pending_approval", "invoice").label,
                  color: getStatusProps(selectedOrder.approval_status || "pending_approval", "invoice").color,
                },
              ]
            : []
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedOrder ? (
          <EmptyState message="Select an invoice from the list to view tracking details" icon={<TimelineIcon />} />
        ) : isDetailLoading ? (
          <TDetailSkeleton sections={3} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <Stack spacing={3}>
            {/* Summary Cards */}
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Grand Total"
                  value={selectedOrder.grand_total}
                  icon={<AttachMoneyIcon />}
                  color="primary"
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Paid Amount"
                  value={selectedOrder.paid_amount}
                  icon={<CheckCircleOutlineIcon />}
                  color="success"
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Balance Due"
                  value={selectedOrder.balance_due}
                  icon={<MoneyOffIcon />}
                  color={selectedOrder.balance_due > 0 ? "warning" : "success"}
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Items"
                  value={selectedOrder.items?.length || 0}
                  icon={<ShoppingCartIcon />}
                  color="info"
                />
              </Grid>
            </Grid>

            {/* Order Lifecycle Timeline */}
            <TInfoCard title="Order Lifecycle" icon={<TimelineIcon />}>
              <Box sx={{ py: 2, px: 1 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
                  {/* Progress line */}
                  <Box
                    sx={{
                      position: "absolute",
                      top: "20px",
                      left: "10%",
                      right: "10%",
                      height: 2,
                      bgcolor: "divider",
                      zIndex: 0,
                    }}
                  >
                    <Box
                      sx={{
                        height: "100%",
                        width: isCancelled ? "0%" : `${(activeStep / 3) * 100}%`,
                        bgcolor: isCancelled ? "error.main" : "primary.main",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </Box>

                  {/* Steps */}
                  {[
                    { label: "Created", icon: <EventNoteIcon />, step: 0 },
                    { label: "Pending", icon: <AccessTimeIcon />, step: 1 },
                    { label: "Approved", icon: <FactCheckIcon />, step: 2 },
                    { label: "Completed", icon: <LocalShippingIcon />, step: 3 },
                  ].map((item) => {
                    const isActive = activeStep >= item.step;
                    const isCurrent = activeStep === item.step;
                    return (
                      <Box
                        key={item.step}
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          flex: 1,
                          zIndex: 1,
                        }}
                      >
                        <Avatar
                          sx={{
                            width: 40,
                            height: 40,
                            bgcolor: isCancelled
                              ? "error.main"
                              : isActive
                              ? "primary.main"
                              : "background.paper",
                            border: 2,
                            borderColor: isCancelled
                              ? "error.main"
                              : isActive
                              ? "primary.main"
                              : "divider",
                            color: isActive || isCancelled ? "white" : "text.secondary",
                            boxShadow: isCurrent ? `0 0 0 4px ${theme.palette.primary.light}` : "none",
                          }}
                        >
                          {item.icon}
                        </Avatar>
                        <Typography
                          variant="caption"
                          sx={{
                            mt: 1,
                            fontWeight: isActive ? 600 : 400,
                            color: isCancelled ? "error.main" : isActive ? "primary.main" : "text.secondary",
                          }}
                        >
                          {isCancelled && item.step === activeStep ? "Cancelled" : item.label}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </TInfoCard>

            {/* Payment Progress */}
            <TInfoCard
              title="Payment Progress"
              icon={<PaymentIcon />}
              subtitle={`${fmtLKR(selectedOrder.paid_amount)} of ${fmtLKR(selectedOrder.grand_total)} paid`}
              headerActions={
                <TStatusChip
                  status={selectedOrder.payment_status || "unpaid"}
                  statusMap="paymentStatus"
                />
              }
            >
              <Box sx={{ py: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={(selectedOrder.paid_amount / selectedOrder.grand_total) * 100}
                      sx={{ height: 8, borderRadius: 1 }}
                    />
                  </Box>
                  <Typography variant="body2" fontWeight={600}>
                    {((selectedOrder.paid_amount / selectedOrder.grand_total) * 100).toFixed(1)}%
                  </Typography>
                </Box>

                {paymentBreakdown.length > 0 && (
                  <Box>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                      Payment Breakdown
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Method</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paymentBreakdown.map((p, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                {p.method === "Cash" && <AttachMoneyIcon fontSize="small" color="success" />}
                                {p.method.includes("Card") && <CreditCardIcon fontSize="small" color="primary" />}
                                {p.method === "Cheque" && <AccountBalanceWalletIcon fontSize="small" color="info" />}
                                <Typography variant="body2">{p.method}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight={500}>
                                {fmtLKR(p.amount)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </Box>
            </TInfoCard>

            {/* Order & Customer Details */}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TInfoCard title="Order Information" icon={<InfoOutlinedIcon />}>
                  <Box sx={{ py: 1 }}>
                    <InfoRow label="Invoice Number" value={selectedOrder.invoice_no} />
                    <InfoRow label="Branch" value={selectedOrder.branch_code} />
                    <InfoRow label="Payment Method" value={selectedOrder.payment_method} />
                    <InfoRow label="Created Date" value={format(new Date(selectedOrder.created_date), "MMM dd, yyyy")} />
                    <InfoRow
                      label="Status"
                      value={
                        <Box component="span" sx={{ display: "inline-flex" }}>
                          <TStatusChip
                            status={selectedOrder.approval_status || "pending_approval"}
                            statusMap="invoice"
                          />
                        </Box> as any
                      }
                    />
                    {selectedOrder.remarks && (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="caption" color="text.secondary">
                          Remarks:
                        </Typography>
                        <Typography variant="body2">{selectedOrder.remarks}</Typography>
                      </>
                    )}
                  </Box>
                </TInfoCard>
              </Grid>

              <Grid item xs={12} md={6}>
                <TInfoCard title="Customer Details" icon={<PersonIcon />}>
                  {customer ? (
                    <Box sx={{ py: 1 }}>
                      <InfoRow label="Name" value={customer.customer_name} />
                      {customer.company_name && <InfoRow label="Company" value={customer.company_name} />}
                      {customer.email && <InfoRow label="Email" value={customer.email} />}
                      {customer.mobile_contact_number && <InfoRow label="Phone" value={customer.mobile_contact_number} />}
                      {customer.payment_address && <InfoRow label="Address" value={customer.payment_address} />}
                      <Divider sx={{ my: 1 }} />
                      <InfoRow label="Credit Days" value={customer.credit_days} />
                      <InfoRow label="Credit Limit" value={fmtLKR(customer.max_credit_limit)} />
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Customer information not available
                    </Typography>
                  )}
                </TInfoCard>
              </Grid>
            </Grid>

            {/* Financial Summary */}
            <TInfoCard title="Financial Summary" icon={<AccountBalanceWalletIcon />}>
              <Box sx={{ py: 1 }}>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Subtotal</TableCell>
                      <TableCell align="right">{fmtLKR(selectedOrder.subtotal)}</TableCell>
                    </TableRow>
                    {selectedOrder.discount_amount > 0 && (
                      <TableRow>
                        <TableCell>
                          Discount {selectedOrder.discount_percent > 0 ? `(${selectedOrder.discount_percent}%)` : ""}
                        </TableCell>
                        <TableCell align="right" sx={{ color: "success.main" }}>
                          - {fmtLKR(selectedOrder.discount_amount)}
                        </TableCell>
                      </TableRow>
                    )}
                    {selectedOrder.tax_amount > 0 && (
                      <TableRow>
                        <TableCell>Tax ({selectedOrder.tax_rate}%)</TableCell>
                        <TableCell align="right">{fmtLKR(selectedOrder.tax_amount)}</TableCell>
                      </TableRow>
                    )}
                    {selectedOrder.service_charge_amount > 0 && (
                      <TableRow>
                        <TableCell>Service Charge ({selectedOrder.service_charge_rate}%)</TableCell>
                        <TableCell align="right">{fmtLKR(selectedOrder.service_charge_amount)}</TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell>
                        <Typography variant="body1" fontWeight={600}>
                          Grand Total
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body1" fontWeight={600}>
                          {fmtLKR(selectedOrder.grand_total)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            </TInfoCard>

            {/* Line Items */}
            <TInfoCard title="Line Items" icon={<ShoppingCartIcon />} collapsible defaultCollapsed={false}>
              <Box sx={{ overflow: "auto" }}>
                <Table size="small" sx={modernTableStyles}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Unit Price</TableCell>
                      <TableCell align="right">Discount</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell>Warranty</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedOrder.items?.map((item) => {
                      const product = productMap.get(item.product_id);
                      const lineTotal = item.quantity * item.selling_price - (item.discount_amount || 0);
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>
                              {product?.name || `Product #${item.product_id}`}
                            </Typography>
                            {product?.item_code && (
                              <Typography variant="caption" color="text.secondary">
                                {product.item_code}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">{item.quantity}</TableCell>
                          <TableCell align="right">{fmtLKR(item.selling_price)}</TableCell>
                          <TableCell align="right">
                            {item.discount_percent ? `${item.discount_percent}%` : "-"}
                            {item.discount_amount ? ` (${fmtLKR(item.discount_amount)})` : ""}
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight={600}>
                              {fmtLKR(lineTotal)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip label={`${item.warrenty_month} months`} size="small" variant="outlined" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            </TInfoCard>

            {/* Payment History */}
            {paymentHistory.length > 0 && (
              <TInfoCard title="Payment History" icon={<PaymentIcon />} collapsible defaultCollapsed>
                <Box sx={{ overflow: "auto" }}>
                  <Table size="small" sx={modernTableStyles}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Reference</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paymentHistory.map((payment: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>{format(new Date(payment.payment_date || payment.created_at), "MMM dd, yyyy HH:mm")}</TableCell>
                          <TableCell>
                            <Chip label={payment.payment_method} size="small" />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight={600} color="success.main">
                              {fmtLKR(payment.amount)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">{payment.reference || "-"}</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </TInfoCard>
            )}

            {/* Returns */}
            {returns.length > 0 && (
              <TInfoCard title="Returns" icon={<AssignmentReturnIcon />} collapsible defaultCollapsed>
                <Box sx={{ overflow: "auto" }}>
                  <Table size="small" sx={modernTableStyles}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Return No</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Refund Status</TableCell>
                        <TableCell align="right">Refund Amount</TableCell>
                        <TableCell>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {returns.map((ret: SaleReturn) => (
                        <TableRow key={ret.id}>
                          <TableCell>{ret.sale_return_no}</TableCell>
                          <TableCell>{format(new Date(ret.added_date), "MMM dd, yyyy")}</TableCell>
                          <TableCell>
                            <TStatusChip status={ret.status} statusMap="salesReturn" />
                          </TableCell>
                          <TableCell>
                            <TStatusChip status={ret.refund_status} statusMap="paymentStatus" />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight={600} color="error.main">
                              {fmtLKR(ret.total_refund)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Tooltip title={ret.return_reason || "No reason provided"}>
                              <Typography variant="caption" noWrap sx={{ maxWidth: 150, display: "block" }}>
                                {ret.return_reason || "-"}
                              </Typography>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </TInfoCard>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <MasterDetailLayout title="Sales Track" masterPanel={masterPanel} detailPanel={detailPanel} />
    </Box>
  );
}
