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
  Paper,
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
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

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

// ─── Constants ───────────────────────────────────────────────────────────────

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date (Latest)" },
  { value: "invoice_no", label: "Invoice Number" },
  { value: "grand_total", label: "Amount" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval", color: "warning" as const },
  { value: "approved", label: "Approved", color: "success" as const },
  { value: "completed", label: "Completed", color: "info" as const },
  { value: "cancelled", label: "Cancelled", color: "error" as const },
];


// ─── Helper: Build order lifecycle steps ─────────────────────────────────────

interface TimelineStep {
  label: string;
  description: string;
  completed: boolean;
  active: boolean;
  error: boolean;
  icon: React.ReactNode;
  timestamp?: string;
}

function buildOrderTimeline(order: InvoiceWithItems): TimelineStep[] {
  const status = order.approval_status?.toLowerCase() || "";
  const isCancelled = status === "cancelled";

  const steps: TimelineStep[] = [
    {
      label: "Created",
      description: order.created_date
        ? format(new Date(order.created_date), "dd MMM yyyy, hh:mm a")
        : "Order placed",
      completed: true,
      active: false,
      error: false,
      icon: <ShoppingCartIcon fontSize="small" />,
      timestamp: order.created_date,
    },
    {
      label: "Pending Approval",
      description:
        status === "pending_approval"
          ? "Awaiting management approval"
          : status === "approved" || status === "completed"
          ? "Approved"
          : isCancelled
          ? "Skipped"
          : "Awaiting approval",
      completed:
        status === "approved" || status === "completed" || isCancelled,
      active: status === "pending_approval",
      error: false,
      icon: <FactCheckIcon fontSize="small" />,
    },
    {
      label: "Approved",
      description:
        status === "approved"
          ? "Order has been approved"
          : status === "completed"
          ? "Order was approved"
          : isCancelled
          ? "Order cancelled"
          : "Pending",
      completed: status === "approved" || status === "completed",
      active: status === "approved",
      error: isCancelled,
      icon: <CheckCircleOutlineIcon fontSize="small" />,
    },
    {
      label: "Completed",
      description:
        status === "completed"
          ? "Order fulfilled"
          : isCancelled
          ? "Cancelled"
          : "Awaiting fulfilment",
      completed: status === "completed",
      active: false,
      error: isCancelled,
      icon: isCancelled ? <MoneyOffIcon fontSize="small" /> : <LocalShippingIcon fontSize="small" />,
    },
  ];

  return steps;
}

// ─── Helper: payment breakdown rows ──────────────────────────────────────────

interface PaymentBreakdownRow {
  method: string;
  amount: number;
  icon: React.ReactNode;
}

function getPaymentBreakdown(order: InvoiceWithItems): PaymentBreakdownRow[] {
  const rows: PaymentBreakdownRow[] = [];
  if (order.cash_amount > 0)
    rows.push({ method: "Cash", amount: order.cash_amount, icon: <AttachMoneyIcon fontSize="small" /> });
  if (order.card_visa_amount > 0)
    rows.push({ method: "Visa Card", amount: order.card_visa_amount, icon: <CreditCardIcon fontSize="small" /> });
  if (order.card_mastercard_amount > 0)
    rows.push({ method: "Mastercard", amount: order.card_mastercard_amount, icon: <CreditCardIcon fontSize="small" /> });
  if (order.card_amex_amount > 0)
    rows.push({ method: "Amex Card", amount: order.card_amex_amount, icon: <CreditCardIcon fontSize="small" /> });
  if (order.cheque_amount > 0)
    rows.push({ method: "Cheque", amount: order.cheque_amount, icon: <EventNoteIcon fontSize="small" /> });
  if (order.bank_transfer_amount > 0)
    rows.push({ method: "Bank Transfer", amount: order.bank_transfer_amount, icon: <AccountBalanceWalletIcon fontSize="small" /> });
  if (order.credit_amount > 0)
    rows.push({ method: "Credit", amount: order.credit_amount, icon: <PaymentIcon fontSize="small" /> });
  if (order.cupon_amount > 0)
    rows.push({ method: "Coupon", amount: order.cupon_amount, icon: <PaymentIcon fontSize="small" /> });
  if (order.credit_note_amount > 0)
    rows.push({ method: "Credit Note", amount: order.credit_note_amount, icon: <PaymentIcon fontSize="small" /> });
  if (order.gift_voucher_amount > 0)
    rows.push({ method: "Gift Voucher", amount: order.gift_voucher_amount, icon: <PaymentIcon fontSize="small" /> });
  return rows;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SalesTrackPage() {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");
  const [selectedOrder, setSelectedOrder] = useState<InvoiceWithItems | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // ─── Data Queries ────────────────────────────────────────────────────────

  // OPTIMIZED: Using aggregated endpoint for branches — resolved BEFORE query fires
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Paginated invoice list
  const {
    data: invoicesData,
    isLoading: invoicesLoading,
  } = useQuery({
    queryKey: ["sales-track-list", page, searchQuery, filterBranch, filterStatus, sortField],
    queryFn: () =>
      salesApi.getPaginated({
        page,
        pageSize: 50,
        search: searchQuery || undefined,
        branchCode: filterBranch || undefined,
        status: filterStatus || undefined,
        sortBy: sortField,
        sortDesc: true,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const invoices = invoicesData?.items || [];

  // Customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
    staleTime: 300000,
  });

  // Products
  const { data: productsResult } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(1, 1000),
    staleTime: 300000,
  });
  const products: Product[] =
    (productsResult as { items?: Product[] })?.items ||
    (Array.isArray(productsResult) ? productsResult : []);

  // Payment history for selected order
  const { data: paymentHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ["payment-history", selectedOrder?.id],
    queryFn: () => salesApi.getPaymentHistory(selectedOrder!.id),
    enabled: !!selectedOrder,
  });

  // Returns for selected order
  const { data: orderReturns = [], isLoading: returnsLoading } = useQuery({
    queryKey: ["order-returns", selectedOrder?.id],
    queryFn: () => saleReturnsApi.getByInvoice(selectedOrder!.id),
    enabled: !!selectedOrder,
  });

  // ─── Lookup maps ─────────────────────────────────────────────────────────

  const customerMap = useMemo(() => {
    const map = new Map<number, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b: { branch_code: string; branch_name: string }) =>
      map.set(b.branch_code, b.branch_name)
    );
    return map;
  }, [branches]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleSelectOrder = useCallback(async (order: Invoice) => {
    try {
      const fullOrder = await salesApi.getById(order.id);
      setSelectedOrder(fullOrder);
    } catch {
      showErrorToast("Failed to load order details");
    }
  }, []);

  // Auto-select first when list loads
  useEffect(() => {
    if (invoices.length > 0 && !selectedOrder) {
      handleSelectOrder(invoices[0]);
    }
  }, [invoices, selectedOrder, handleSelectOrder]);

  // ─── Derived data ────────────────────────────────────────────────────────

  const customer = selectedOrder ? customerMap.get(selectedOrder.customer_id) : null;
  const timeline = selectedOrder ? buildOrderTimeline(selectedOrder) : [];
  const paymentBreakdown = selectedOrder ? getPaymentBreakdown(selectedOrder) : [];

  const paymentPercent = selectedOrder
    ? selectedOrder.grand_total > 0
      ? Math.min(100, Math.round((selectedOrder.paid_amount / selectedOrder.grand_total) * 100))
      : 0
    : 0;

  // ─── Master Panel (left) ─────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={invoices}
      isLoading={invoicesLoading}
      searchValue={searchQuery}
      onSearchChange={(q: string) => {
        setSearchQuery(q);
        setPage(1);
      }}
      placeholder="Search invoice number, customer..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedOrder}
      emptyMessage="No invoices found"
      listHeader={
        <SalesFilterPanel
          statusOptions={STATUS_FILTER_OPTIONS}
          statusValue={filterStatus}
          onStatusChange={(s: string | null) => {
            setFilterStatus(s);
            setPage(1);
          }}
          branches={branches}
          branchValue={filterBranch}
          onBranchChange={(b: string | null) => {
            setFilterBranch(b);
            setPage(1);
          }}
        />
      }
      renderItem={(order: Invoice, isSelected: boolean) => {
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
                  <Typography variant="body2" fontWeight={600}>
                    {order.invoice_no}
                  </Typography>
                  <Chip
                    label={approvalChip.label}
                    size="small"
                    color={approvalChip.color}
                    sx={{ height: 20, fontSize: "0.65rem" }}
                  />
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="caption" color="text.secondary">
                    {orderCustomer?.customer_name || "Unknown"}
                  </Typography>
                  <Typography variant="caption" fontWeight={600} color="primary">
                    {fmtLKR(order.grand_total)}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="caption" color="text.secondary">
                    {order.created_date
                      ? format(new Date(order.created_date), "dd MMM yyyy")
                      : "—"}
                  </Typography>
                  <Chip
                    label={paymentChip.label}
                    size="small"
                    color={paymentChip.color}
                    variant="outlined"
                    sx={{ height: 18, fontSize: "0.6rem" }}
                  />
                </Box>
              </Box>
            }
          />
        );
      }}
    />
  );

  // ─── Detail Panel (right) ────────────────────────────────────────────────

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales" },
          { label: "Track", href: "/sales/track" },
          ...(selectedOrder ? [{ label: selectedOrder.invoice_no }] : []),
        ]}
        title={selectedOrder?.invoice_no || ""}
        titleIcon={<TimelineIcon color="primary" />}
        noSelectionTitle="Select an Invoice to Track"
        chips={
          selectedOrder
            ? [
                {
                  label: selectedOrder.approval_status || "pending",
                  color: selectedOrder.approval_status === "completed"
                    ? "success"
                    : selectedOrder.approval_status === "cancelled"
                    ? "error"
                    : selectedOrder.approval_status === "approved"
                    ? "info"
                    : "warning",
                },
                {
                  label: `Payment: ${selectedOrder.payment_status || "unpaid"}`,
                  color: selectedOrder.payment_status === "paid"
                    ? "success"
                    : selectedOrder.payment_status === "partial"
                    ? "warning"
                    : "error",
                },
              ]
            : []
        }
      />

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedOrder ? (
          <EmptyState
            message="Select an invoice from the list to view its full tracking details"
          />
        ) : historyLoading ? (
          <TDetailSkeleton sections={3} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <Stack spacing={2.5}>
            {/* ── Summary Stat Cards ─────────────────────────── */}
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Grand Total"
                  value={selectedOrder.grand_total}
                  icon={<ReceiptLongIcon />}
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
                  color={selectedOrder.balance_due > 0 ? "error" : "success"}
                  isCurrency
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TStatCard
                  title="Items"
                  value={selectedOrder.items?.length || 0}
                  icon={<ShoppingCartIcon />}
                  color="info"
                  subtitle={`${selectedOrder.items?.reduce((sum, i) => sum + i.quantity, 0) || 0} units`}
                />
              </Grid>
            </Grid>

            {/* ── Order Lifecycle Timeline ────────────────────── */}
            <TInfoCard
              title="Order Lifecycle"
              icon={<TimelineIcon />}
              subtitle="Track the order through each stage"
            >
              <Box sx={{ py: 1 }}>
                {/* Horizontal Timeline */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    position: "relative",
                    px: 2,
                  }}
                >
                  {/* Connector line */}
                  <Box
                    sx={{
                      position: "absolute",
                      top: 20,
                      left: "10%",
                      right: "10%",
                      height: 3,
                      bgcolor: theme.palette.divider,
                      zIndex: 0,
                    }}
                  />
                  {/* Filled portion */}
                  <Box
                    sx={{
                      position: "absolute",
                      top: 20,
                      left: "10%",
                      width: `${
                        (timeline.filter((s) => s.completed).length /
                          Math.max(timeline.length - 1, 1)) *
                        80
                      }%`,
                      height: 3,
                      bgcolor: timeline.some((s) => s.error)
                        ? theme.palette.error.main
                        : theme.palette.success.main,
                      zIndex: 1,
                      transition: "width 0.5s ease",
                    }}
                  />

                  {timeline.map((step, idx) => {
                    const isActive = step.active;
                    const isDone = step.completed;
                    const isErr = step.error;

                    let bgColor = theme.palette.grey[300];
                    let textColor = theme.palette.text.secondary;
                    if (isDone && !isErr) {
                      bgColor = theme.palette.success.main;
                      textColor = theme.palette.success.main;
                    } else if (isActive) {
                      bgColor = theme.palette.primary.main;
                      textColor = theme.palette.primary.main;
                    } else if (isErr) {
                      bgColor = theme.palette.error.main;
                      textColor = theme.palette.error.main;
                    }

                    return (
                      <Box
                        key={idx}
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          zIndex: 2,
                          flex: 1,
                        }}
                      >
                        <Tooltip title={step.description} arrow>
                          <Avatar
                            sx={{
                              width: 40,
                              height: 40,
                              bgcolor: bgColor,
                              color: "#fff",
                              mb: 1,
                              boxShadow: isActive
                                ? `0 0 0 4px ${theme.palette.primary.light}`
                                : "none",
                              transition: "all 0.3s ease",
                            }}
                          >
                            {step.icon}
                          </Avatar>
                        </Tooltip>
                        <Typography
                          variant="caption"
                          fontWeight={isActive || isDone ? 700 : 400}
                          color={textColor}
                          textAlign="center"
                        >
                          {step.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          textAlign="center"
                          sx={{ fontSize: "0.65rem", mt: 0.25 }}
                        >
                          {step.description}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </TInfoCard>

            {/* ── Payment Progress ────────────────────────────── */}
            <TInfoCard
              title="Payment Progress"
              icon={<PaymentIcon />}
              subtitle={`${paymentPercent}% collected`}
              headerActions={
                <TStatusChip
                  status={selectedOrder.payment_status || "unpaid"}
                  statusMap="paymentStatus"
                />
              }
            >
              <Box sx={{ px: 1, py: 1.5 }}>
                {/* Progress bar */}
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      Paid: {fmtLKR(selectedOrder.paid_amount)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total: {fmtLKR(selectedOrder.grand_total)}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={paymentPercent}
                    sx={{
                      height: 10,
                      borderRadius: 5,
                      bgcolor: theme.palette.grey[200],
                      "& .MuiLinearProgress-bar": {
                        borderRadius: 5,
                        bgcolor:
                          paymentPercent >= 100
                            ? theme.palette.success.main
                            : paymentPercent > 0
                            ? theme.palette.warning.main
                            : theme.palette.error.main,
                      },
                    }}
                  />
                  {selectedOrder.balance_due > 0 && (
                    <Typography variant="caption" color="error" sx={{ mt: 0.5, display: "block" }}>
                      Outstanding: {fmtLKR(selectedOrder.balance_due)}
                    </Typography>
                  )}
                </Box>

                {/* Payment breakdown table */}
                {paymentBreakdown.length > 0 && (
                  <>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Payment Breakdown
                    </Typography>
                    <Table size="small" sx={modernTableStyles}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Method</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paymentBreakdown.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                {row.icon}
                                {row.method}
                              </Box>
                            </TableCell>
                            <TableCell align="right">{fmtLKR(row.amount)}</TableCell>
                          </TableRow>
                        ))}
                        {/* Adjustments */}
                        {selectedOrder.payment_adjustments !== 0 && (
                          <TableRow>
                            <TableCell>
                              <Typography variant="body2" fontStyle="italic">
                                Adjustments
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              {fmtLKR(selectedOrder.payment_adjustments)}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </>
                )}
              </Box>
            </TInfoCard>

            {/* ── Order & Customer Info (two columns) ────────── */}
            <Grid container spacing={2}>
              {/* Order info */}
              <Grid item xs={12} md={6}>
                <TInfoCard title="Order Information" icon={<InfoOutlinedIcon />} variant="outlined">
                  <Table size="small">
                    <TableBody>
                      <InfoRow label="Invoice No" value={selectedOrder.invoice_no} />
                      <InfoRow
                        label="Branch"
                        value={`${selectedOrder.branch_code} – ${branchMap.get(selectedOrder.branch_code) || ""}`}
                      />
                      <InfoRow
                        label="Date"
                        value={
                          selectedOrder.created_date
                            ? format(new Date(selectedOrder.created_date), "dd MMM yyyy, hh:mm a")
                            : "—"
                        }
                      />
                      <InfoRow label="Payment Method" value={selectedOrder.payment_method} />
                      <InfoRow
                        label="Approval Status"
                        value={
                          <TStatusChip
                            status={selectedOrder.approval_status || "pending_approval"}
                            statusMap="invoice"
                          />
                        }
                      />
                      <InfoRow
                        label="Special"
                        value={selectedOrder.special ? "Yes" : "No"}
                      />
                      {selectedOrder.remarks && (
                        <InfoRow label="Remarks" value={selectedOrder.remarks} />
                      )}
                    </TableBody>
                  </Table>
                </TInfoCard>
              </Grid>

              {/* Customer info */}
              <Grid item xs={12} md={6}>
                <TInfoCard title="Customer Information" icon={<PersonIcon />} variant="outlined">
                  {customer ? (
                    <Table size="small">
                      <TableBody>
                        <InfoRow label="Name" value={customer.customer_name} />
                        {customer.company_name && (
                          <InfoRow label="Company" value={customer.company_name} />
                        )}
                        {customer.email && <InfoRow label="Email" value={customer.email} />}
                        {customer.mobile_contact_number && <InfoRow label="Phone" value={customer.mobile_contact_number} />}
                        {customer.payment_address && <InfoRow label="Address" value={customer.payment_address} />}
                      </TableBody>
                    </Table>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                      Customer ID: {selectedOrder.customer_id}
                    </Typography>
                  )}
                </TInfoCard>
              </Grid>
            </Grid>

            {/* ── Financial Summary ──────────────────────────── */}
            <TInfoCard title="Financial Summary" icon={<AttachMoneyIcon />} variant="outlined">
              <Table size="small" sx={modernTableStyles}>
                <TableBody>
                  <InfoRow label="Subtotal" value={fmtLKR(selectedOrder.subtotal)} />
                  {selectedOrder.discount_amount > 0 && (
                    <InfoRow
                      label={`Discount (${selectedOrder.discount_percent}%)`}
                      value={`-${fmtLKR(selectedOrder.discount_amount)}`}
                    />
                  )}
                  {selectedOrder.tax_amount > 0 && (
                    <InfoRow
                      label={`Tax (${selectedOrder.tax_rate}%)`}
                      value={fmtLKR(selectedOrder.tax_amount)}
                    />
                  )}
                  {selectedOrder.service_charge_amount > 0 && (
                    <InfoRow
                      label={`Service Charge (${selectedOrder.service_charge_rate}%)`}
                      value={fmtLKR(selectedOrder.service_charge_amount)}
                    />
                  )}
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, borderTop: "2px solid", borderColor: "divider" }}>
                      Grand Total
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 700, borderTop: "2px solid", borderColor: "divider", color: "primary.main" }}
                    >
                      {fmtLKR(selectedOrder.grand_total)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TInfoCard>

            {/* ── Line Items ─────────────────────────────────── */}
            <TInfoCard
              title={`Line Items (${selectedOrder.items?.length || 0})`}
              icon={<ShoppingCartIcon />}
              collapsible
              variant="outlined"
            >
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={modernTableStyles}>
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Product</TableCell>
                      <TableCell align="center">Qty</TableCell>
                      <TableCell align="right">Unit Price</TableCell>
                      <TableCell align="right">Discount</TableCell>
                      <TableCell align="right">Line Total</TableCell>
                      <TableCell>Warranty</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedOrder.items?.map((item, idx) => {
                      const product = productMap.get(item.product_id);
                      const discountAmt = item.discount_amount || 0;
                      const lineTotal = item.quantity * item.selling_price - discountAmt;
                      return (
                        <TableRow key={item.id || idx}>
                          <TableCell>{idx + 1}</TableCell>
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
                          <TableCell align="center">{item.quantity}</TableCell>
                          <TableCell align="right">{fmtLKR(item.selling_price)}</TableCell>
                          <TableCell align="right">
                            {discountAmt > 0 ? fmtLKR(discountAmt) : "—"}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {fmtLKR(lineTotal)}
                          </TableCell>
                          <TableCell>
                            {item.warrenty_month ? `${item.warrenty_month} months` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Totals row */}
                    <TableRow>
                      <TableCell colSpan={5} align="right" sx={{ fontWeight: 700 }}>
                        Total
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: "primary.main" }}>
                        {fmtLKR(selectedOrder.subtotal)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            </TInfoCard>

            {/* ── Payment History (Settlement Timeline) ──────── */}
            <TInfoCard
              title="Payment History"
              icon={<AccessTimeIcon />}
              collapsible
              subtitle="Settlement and payment events"
              variant="outlined"
            >
              {historyLoading ? (
                <LinearProgress />
              ) : Array.isArray(paymentHistory) && paymentHistory.length > 0 ? (
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" sx={modernTableStyles}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Reference</TableCell>
                        <TableCell>Notes</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(paymentHistory as Array<{
                        date?: string;
                        created_at?: string;
                        type?: string;
                        payment_type?: string;
                        amount?: number;
                        reference?: string;
                        ref_no?: string;
                        notes?: string;
                        description?: string;
                      }>).map((entry, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            {entry.date || entry.created_at
                              ? format(new Date(entry.date || entry.created_at || ""), "dd MMM yyyy")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={entry.type || entry.payment_type || "Payment"}
                              size="small"
                              variant="outlined"
                              sx={{ height: 22, fontSize: "0.7rem" }}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {fmtLKR(entry.amount || 0)}
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">
                              {entry.reference || entry.ref_no || "—"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {entry.notes || entry.description || "—"}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : (
                <Box sx={{ p: 2, textAlign: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    No payment history recorded yet.
                  </Typography>
                </Box>
              )}
            </TInfoCard>

            {/* ── Returns ────────────────────────────────────── */}
            <TInfoCard
              title={`Returns (${orderReturns.length})`}
              icon={<AssignmentReturnIcon />}
              collapsible
              defaultCollapsed={orderReturns.length === 0}
              variant="outlined"
            >
              {returnsLoading ? (
                <LinearProgress />
              ) : orderReturns.length > 0 ? (
                <Box sx={{ overflowX: "auto" }}>
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
                      {orderReturns.map((ret: SaleReturn) => (
                        <TableRow key={ret.id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {ret.sale_return_no}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {ret.added_date
                              ? format(new Date(ret.added_date), "dd MMM yyyy")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <TStatusChip status={ret.status} statusMap="salesReturn" />
                          </TableCell>
                          <TableCell>
                            <TStatusChip status={ret.refund_status} statusMap="paymentStatus" />
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: "error.main" }}>
                            {fmtLKR(ret.total_refund)}
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {ret.return_reason || ret.remark || "—"}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : (
                <Box sx={{ p: 2, textAlign: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    No returns associated with this invoice.
                  </Typography>
                </Box>
              )}
            </TInfoCard>

            {/* ── Timestamps ─────────────────────────────────── */}
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={3} flexWrap="wrap">
                <Typography variant="caption" color="text.secondary">
                  <strong>Created:</strong>{" "}
                  {selectedOrder.created_at
                    ? format(new Date(selectedOrder.created_at), "dd MMM yyyy, hh:mm a")
                    : "—"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  <strong>Last Updated:</strong>{" "}
                  {selectedOrder.updated_at
                    ? format(new Date(selectedOrder.updated_at), "dd MMM yyyy, hh:mm a")
                    : "—"}
                </Typography>
              </Stack>
            </Paper>
          </Stack>
        )}
      </Box>
    </Box>
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout title="Sales Track" masterPanel={masterPanel} detailPanel={detailPanel} />
    </>
  );
}

// ─── Reusable info row ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow sx={{ "&:last-child td": { borderBottom: 0 } }}>
      <TableCell
        sx={{
          width: 160,
          color: "text.secondary",
          fontWeight: 500,
          py: 0.75,
          fontSize: "0.8rem",
        }}
      >
        {label}
      </TableCell>
      <TableCell align="right" sx={{ py: 0.75, fontSize: "0.8rem" }}>
        {value}
      </TableCell>
    </TableRow>
  );
}
