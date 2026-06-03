/**
 * BankTransferVerifyPage - Bank Transfer Verification for Finance Manager
 * Shows bank transfer payments pending verification for approval/rejection
 * Follows the same UI pattern as SalesOrderApprovalsPage
 */

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  TextField,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Grid,
  Divider,
  Tooltip,
  IconButton,
} from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ReceiptIcon from "@mui/icons-material/Receipt";
import MenuBookIcon from "@mui/icons-material/MenuBook";

// Import tijaero components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  handleApiError,
  EmptyState,
  SortOption,
  TDetailSkeleton,
  TConfirmDialog,
  showSuccessToast,
  showErrorToast,
  modernTableStyles,
  useTConfirmDialog,
  useCrudMutation,
  fmtLKR,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import { bankTransferApi, PendingBankTransfer } from "@/modules/finance/api/bankTransfer";
import { customersApi } from "@/modules/customers/api";
import { useReferenceData } from "@/hooks";
import { Customer } from "@/modules/customers/types";
import { Product } from "@/modules/inventory/types";
import { format } from "date-fns";
import { salesApi } from "@/modules/sales/api";
import { InvoiceWithItems } from "@/modules/sales/types";
import { commissionsApi } from "@/modules/sales/commission-api";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "invoice_no", label: "Invoice Number" },
  { value: "bank_transfer_amount", label: "Amount" },
];

// Status options for filtering
const BT_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending_verification", label: "Pending Verification" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

export default function BankTransferVerifyPage() {
  const canViewCustomers = usePermission("customers", "view");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");
  const [selectedTransfer, setSelectedTransfer] = useState<PendingBankTransfer | null>(null);

  // Confirm dialogs
  const verifyDialog = useTConfirmDialog();
  const rejectDialog = useTConfirmDialog();

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>("all");

  // Reject reason dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Fetch products and branches — resolved BEFORE query fires
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
  const products = (refData?.products || []) as Product[];
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Fetch pending bank transfers
  const { data: transfers = [], isLoading, error: _error } = useQuery({
    queryKey: ["pendingBankTransfers", filterBranch],
    queryFn: () => bankTransferApi.getPending(filterBranch || undefined),
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
    enabled: canViewCustomers,
  });

  // Load full invoice details when selectedTransfer changes
  const [selectedOrder, setSelectedOrder] = useState<InvoiceWithItems | null>(null);
  const [isOrderLoading, setIsOrderLoading] = useState(false);
  const [currentItemRemark, setCurrentItemRemark] = useState("");
  const [itemRemarkModalOpen, setItemRemarkModalOpen] = useState(false);

  useEffect(() => {
    const fetchFullOrder = async () => {
      if (!selectedTransfer) {
        setSelectedOrder(null);
        return;
      }
      setIsOrderLoading(true);
      try {
        const fullOrder = await salesApi.getById(selectedTransfer.id);
        setSelectedOrder(fullOrder);
      } catch {
        showErrorToast("Failed to load order details");
        setSelectedOrder(null);
      } finally {
        setIsOrderLoading(false);
      }
    };
    fetchFullOrder();
  }, [selectedTransfer]);

  // Load agent commission for this invoice if applicable
  const { data: invoiceCommissions } = useQuery({
    queryKey: ["invoice-commissions", selectedOrder?.invoice_no],
    queryFn: () => commissionsApi.getAll({ search: selectedOrder?.invoice_no }),
    enabled: !!selectedOrder?.invoice_no && !!selectedOrder?.customer_agent_id,
  });

  const invoiceCommission = invoiceCommissions?.items?.find(
    (c: any) => c.invoice_id === selectedOrder?.id
  );

  // Create lookup maps
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

  // Verify mutation
  const verifyMutation = useCrudMutation({
    mutationFn: (invoiceId: number) => bankTransferApi.verify(invoiceId),
    invalidateQueryKeys: [["pendingBankTransfers"]],
    getSuccessMessage: (data) => data.message,
    errorMessage: "Failed to verify bank transfer",
    onSuccess: (data) => {
      setSelectedTransfer(null);
    },
  });

  // Reject mutation
  const rejectMutation = useCrudMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: number; reason: string }) =>
      bankTransferApi.reject(invoiceId, reason),
    invalidateQueryKeys: [["pendingBankTransfers"]],
    getSuccessMessage: (data) => data.message,
    errorMessage: "Failed to reject bank transfer",
    onSuccess: (data) => {
      setSelectedTransfer(null);
      setRejectDialogOpen(false);
      setRejectReason("");
    },
  });

  // Get status chip properties
  const getStatusChip = (status: string) => {
    switch (status) {
      case "verified":
        return { label: "Verified", color: "success" as const };
      case "rejected":
        return { label: "Rejected", color: "error" as const };
      case "pending_verification":
      default:
        return { label: "Pending Verification", color: "warning" as const };
    }
  };

  // Filter and sort transfers
  const filteredTransfers = useMemo(() => {
    let filtered = [...transfers];

    // Status filter
    if (filterStatus && filterStatus !== "all") {
      filtered = filtered.filter((transfer) => transfer.bank_transfer_status === filterStatus);
    }

    // Search filter
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter((transfer) => {
        const customer = customerMap.get(transfer.customer_id);
        return (
          transfer.invoice_no.toLowerCase().includes(lowerQuery) ||
          transfer.customer_name?.toLowerCase().includes(lowerQuery) ||
          customer?.customer_name?.toLowerCase().includes(lowerQuery) ||
          transfer.bank_transfer_ref?.toLowerCase().includes(lowerQuery) ||
          transfer.bank_name?.toLowerCase().includes(lowerQuery)
        );
      });
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortField) {
        case "invoice_no":
          return a.invoice_no.localeCompare(b.invoice_no);
        case "bank_transfer_amount":
          return b.bank_transfer_amount - a.bank_transfer_amount;
        case "created_date":
        default:
          return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
      }
    });

    return filtered;
  }, [transfers, searchQuery, sortField, customerMap, filterStatus]);

  // Auto-select first (latest) transfer
  useEffect(() => {
    if (filteredTransfers.length > 0 && !selectedTransfer) {
      setSelectedTransfer(filteredTransfers[0]);
    }
  }, [filteredTransfers, selectedTransfer]);

  // Handlers
  const handleSelectTransfer = (transfer: PendingBankTransfer) => {
    setSelectedTransfer(transfer);
  };

  const handleVerify = () => {
    if (!selectedTransfer) return;
    verifyDialog.open(
      "Verify Bank Transfer",
      `Are you sure you want to verify the bank transfer for invoice ${selectedTransfer.invoice_no}? 
       Amount: Rs. ${fmtLKR(selectedTransfer.bank_transfer_amount)}
       Bank: ${selectedTransfer.bank_name || "N/A"}
       Reference: ${selectedTransfer.bank_transfer_ref || "N/A"}`,
      () => verifyMutation.mutate(selectedTransfer.id)
    );
  };

  const handleConfirmReject = () => {
    if (!selectedTransfer) return;
    rejectMutation.mutate({
      invoiceId: selectedTransfer.id,
      reason: rejectReason,
    });
  };

  // Get customer for selected transfer
  const customer = selectedTransfer ? customerMap.get(selectedTransfer.customer_id) : null;

  // Format currency
  const formatCurrency = (amount: number | undefined | null) => {
    if (amount === undefined || amount === null) return `Rs. ${fmtLKR(0)}`;
    return `Rs. ${fmtLKR(amount)}`;
  };

  // Format date
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "N/A";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy HH:mm");
    } catch {
      return dateStr;
    }
  };

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredTransfers}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search transfers..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedTransfer}
      onSelectItem={handleSelectTransfer}
      emptyMessage="No pending bank transfers found"
      listHeader={
        <SalesFilterPanel
          statusOptions={BT_STATUS_FILTER_OPTIONS}
          statusValue={filterStatus}
          onStatusChange={setFilterStatus}
          branches={branches}
          branchValue={filterBranch}
          onBranchChange={setFilterBranch}
        />
      }
      renderItem={(transfer, isSelected) => {
        const transferCustomer = customerMap.get(transfer.customer_id);
        const statusChip = getStatusChip(transfer.bank_transfer_status);
        return (
          <SelectableListItem
            key={transfer.id}
            id={transfer.id}
            isSelected={isSelected}
            onClick={() => handleSelectTransfer(transfer)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{transfer.invoice_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Invoice No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {transferCustomer?.customer_name || transfer.customer_name || "Unknown Customer"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Customer)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {formatDate(transfer.created_date)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption" fontWeight="bold">
                        {formatCurrency(transfer.bank_transfer_amount)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={statusChip.label}
                        size="small"
                        color={statusChip.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected ? (
                <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <span>{transferCustomer?.customer_name || transfer.customer_name}</span>
                  <span>{formatCurrency(transfer.bank_transfer_amount)}</span>
                </Box>
              ) : undefined
            }
            statusChip={!isSelected ? statusChip : undefined}
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
          { label: "Finance" },
          { label: "Bank Transfer Verification", href: "/finance/bank-transfer-verify" },
          ...(selectedTransfer ? [{ label: selectedTransfer.invoice_no }] : []),
        ]}
        title={selectedTransfer?.invoice_no || ""}
        titleIcon={<AccountBalanceIcon color="primary" />}
        noSelectionTitle="Select a Transfer to Review"
        chips={
          selectedTransfer
            ? (() => {
                const statusChip = getStatusChip(selectedTransfer.bank_transfer_status);
                return [{ label: statusChip.label, color: statusChip.color }];
              })()
            : []
        }
      />

      {/* Action Buttons - Only show for pending transfers */}
      {selectedTransfer && selectedTransfer.bank_transfer_status === "pending_verification" && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Button
            variant="contained"
            color="success"
            startIcon={<CheckCircleIcon />}
            onClick={handleVerify}
            disabled={verifyMutation.isPending}
          >
            Verify Transfer
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={rejectMutation.isPending}
          >
            Reject Transfer
          </Button>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedTransfer ? (
          <EmptyState message="Select a bank transfer from the list to review and verify" />
        ) : (isLoading || isOrderLoading || !selectedOrder) ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Order Information */}
            <FormSection title="Order Information" columns={3}>
              <TextField label="Invoice Number" size="small" value={selectedOrder.invoice_no} disabled />
              <TextField label="Branch" size="small" value={selectedOrder.branch_code} disabled />
              <TextField label="Payment Method" size="small" value={selectedOrder.payment_method} disabled />
            </FormSection>

            {/* Verification Status - Show for verified/rejected transfers */}
            {selectedTransfer.bank_transfer_status !== "pending_verification" && (
              <FormSection
                title={selectedTransfer.bank_transfer_status === "verified" ? "Verification Details" : "Rejection Details"}
                columns={2}
              >
                <TextField
                  label={selectedTransfer.bank_transfer_status === "verified" ? "Verified By" : "Rejected By"}
                  size="small"
                  value={selectedTransfer.bank_transfer_verified_by_name || "N/A"}
                  disabled
                />
                <TextField
                  label={selectedTransfer.bank_transfer_status === "verified" ? "Verified Date" : "Rejected Date"}
                  size="small"
                  value={selectedTransfer.bank_transfer_verified_at ? formatDate(selectedTransfer.bank_transfer_verified_at) : "N/A"}
                  disabled
                />
                {selectedTransfer.bank_transfer_status === "rejected" && selectedTransfer.bank_transfer_rejection_reason && (
                  <TextField
                    label="Rejection Reason"
                    size="small"
                    value={selectedTransfer.bank_transfer_rejection_reason}
                    disabled
                    fullWidth
                    sx={{ gridColumn: "1 / -1" }}
                  />
                )}
              </FormSection>
            )}

            {/* Customer Information */}
            <FormSection title="Customer Information" columns={2}>
              <TextField label="Customer Name" size="small" value={customer?.customer_name || selectedTransfer.customer_name || ""} disabled />
              <TextField label="Company" size="small" value={customer?.company_name || "N/A"} disabled />
              <TextField label="Contact" size="small" value={customer?.mobile_contact_number || ""} disabled />
              <TextField label="Email" size="small" value={customer?.email || "N/A"} disabled />
              {customer?.payment_address && (
                <TextField label="Payment Address" size="small" value={customer.payment_address} disabled />
              )}
              {customer?.delivery_address && (
                <TextField label="Delivery Address" size="small" value={customer.delivery_address} disabled />
              )}
            </FormSection>

            {/* Tracking */}
            <FormSection title="Tracking" columns={2}>
              <TextField
                label="Created Date"
                size="small"
                value={selectedOrder.created_at ? new Date(selectedOrder.created_at).toLocaleString() : ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Created By"
                size="small"
                value={selectedTransfer.created_by_name || "N/A"}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            {/* Order Items */}
            <FormSection title="Order Items" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell sx={{ width: 110 }}>Barcode</TableCell>
                      <TableCell sx={{ width: 200 }}>Product</TableCell>
                      <TableCell align="right" sx={{ width: 60 }}>Qty</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Unit Price (Rs.)</TableCell>
                      <TableCell align="right" sx={{ width: 70 }}>Disc %</TableCell>
                      <TableCell align="center" sx={{ width: 80 }}>Warranty</TableCell>
                      <TableCell sx={{ width: 120 }}>Remark</TableCell>
                      <TableCell align="right" sx={{ width: 140 }}>Net Amount (Rs.)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedOrder.items?.map((item: any, index) => {
                      const product = productMap.get(item.product_id);
                      const isTaxInclusive = selectedOrder.is_tax_invoice;
                      const taxRate = selectedOrder.tax_rate || 0;

                      const displaySellingPrice = isTaxInclusive && taxRate > 0
                        ? item.selling_price / (1 + taxRate / 100)
                        : item.selling_price;

                      const lineGross = item.quantity * displaySellingPrice;
                      const discAmt = item.discount_amount > 0
                        ? (isTaxInclusive && taxRate > 0 ? item.discount_amount / (1 + taxRate / 100) : item.discount_amount)
                        : lineGross * ((item.discount_percent || 0) / 100);
                      const netAmount = item.line_total > 0
                        ? (isTaxInclusive && taxRate > 0 ? item.line_total / (1 + taxRate / 100) : item.line_total)
                        : lineGross - discAmt;

                      return (
                        <TableRow key={index} sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: "monospace",
                                color: item.barcode ? "success.main" : "text.disabled",
                                fontWeight: item.barcode ? 500 : 400
                              }}
                            >
                              {item.barcode || "-"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {product?.name || `Product #${item.product_id}`}
                          </TableCell>
                          <TableCell align="right">
                            {item.quantity}
                          </TableCell>
                          <TableCell align="right">
                            {fmtLKR(displaySellingPrice)}
                          </TableCell>
                          <TableCell align="right">
                            {(item.discount_percent || 0) > 0 ? (
                              <Typography variant="body2" color="warning.main" fontWeight="medium">
                                {Number(item.discount_percent).toFixed(1)}%
                              </Typography>
                            ) : (
                              <Typography variant="body2" color="text.disabled">—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="center">
                            {item.warrenty_month || "0"} mo
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <Typography variant="body2" sx={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.remark || "-"}
                              </Typography>
                              <Tooltip title="View Remark">
                                <IconButton size="small" onClick={() => { setCurrentItemRemark(item.remark || ""); setItemRemarkModalOpen(true); }}>
                                  <MenuBookIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Box sx={{ textAlign: "right" }}>
                              <Typography variant="body2" fontWeight="medium">
                                {fmtLKR(netAmount)}
                              </Typography>
                              {(item.discount_percent || 0) > 0 && (
                                <Typography variant="caption" color="text.disabled" sx={{ textDecoration: "line-through" }}>
                                  {fmtLKR(lineGross)}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={7} align="right">
                        <strong>Total:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>
                          {fmtLKR(selectedOrder.items?.reduce((sum, item: any) => {
                            const isTaxInclusive = selectedOrder.is_tax_invoice;
                            const taxRate = selectedOrder.tax_rate || 0;
                            const displaySellingPrice = isTaxInclusive && taxRate > 0 ? item.selling_price / (1 + taxRate / 100) : item.selling_price;
                            const lineGross = item.quantity * displaySellingPrice;
                            const discAmt = item.discount_amount > 0 ? (isTaxInclusive && taxRate > 0 ? item.discount_amount / (1 + taxRate / 100) : item.discount_amount) : lineGross * ((item.discount_percent || 0) / 100);
                            const netAmount = item.line_total > 0 ? (isTaxInclusive && taxRate > 0 ? item.line_total / (1 + taxRate / 100) : item.line_total) : lineGross - discAmt;
                            return sum + netAmount;
                          }, 0) || 0)}
                        </strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>

            {/* Payment Breakdown */}
            <FormSection title="Payment Breakdown" columns={1}>
              <Grid container spacing={3}>
                {/* Settlement Breakdown */}
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderRadius: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>
                      Settlement Breakdown
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      {selectedOrder.cash_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">Cash Payment</Typography>
                          <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.cash_amount)}</Typography>
                        </Box>
                      )}
                      {selectedOrder.card_visa_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">Card Payment (Visa)</Typography>
                          <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.card_visa_amount)}</Typography>
                        </Box>
                      )}
                      {selectedOrder.card_mastercard_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">Card Payment (Mastercard)</Typography>
                          <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.card_mastercard_amount)}</Typography>
                        </Box>
                      )}
                      {selectedOrder.card_amex_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">Card Payment (Amex)</Typography>
                          <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.card_amex_amount)}</Typography>
                        </Box>
                      )}
                      {selectedOrder.cheque_amount > 0 && (
                        <Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="body2" color="text.secondary">Cheque Payment</Typography>
                            <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.cheque_amount)}</Typography>
                          </Box>
                          {(selectedOrder.cheque_number || selectedOrder.cheque_bank || selectedOrder.cheque_date) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                              {selectedOrder.cheque_bank ? `${selectedOrder.cheque_bank} ` : ""}
                              {selectedOrder.cheque_number ? `#${selectedOrder.cheque_number} ` : ""}
                              {selectedOrder.cheque_date ? `(Due: ${new Date(selectedOrder.cheque_date).toLocaleDateString()})` : ""}
                            </Typography>
                          )}
                        </Box>
                      )}
                      {selectedOrder.bank_transfer_amount > 0 && (
                        <Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="body2" color="text.secondary">Bank Transfer</Typography>
                            <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.bank_transfer_amount)}</Typography>
                          </Box>
                          {(selectedOrder.bank_name || selectedOrder.bank_transfer_ref) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                              {selectedOrder.bank_name ? `${selectedOrder.bank_name} ` : ""}
                              {selectedOrder.bank_transfer_ref ? `Ref: ${selectedOrder.bank_transfer_ref}` : ""}
                            </Typography>
                          )}
                        </Box>
                      )}
                      {selectedOrder.credit_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="warning.main" fontWeight="medium">Credit (Owed)</Typography>
                          <Typography variant="body2" fontWeight="bold" color="warning.main">Rs. {fmtLKR(selectedOrder.credit_amount)}</Typography>
                        </Box>
                      )}
                      {selectedOrder.gift_voucher_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="secondary.main">Gift Voucher</Typography>
                          <Typography variant="body2" fontWeight="medium" color="secondary.main">Rs. {fmtLKR(selectedOrder.gift_voucher_amount)}</Typography>
                        </Box>
                      )}
                      {selectedOrder.credit_note_amount > 0 && (
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="success.main">Credit Note Redeemed</Typography>
                          <Typography variant="body2" fontWeight="medium" color="success.main">Rs. {fmtLKR(selectedOrder.credit_note_amount)}</Typography>
                        </Box>
                      )}
                    </Box>
                  </Paper>
                </Grid>

                {/* Order Financials */}
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderRadius: 2, bgcolor: "grey.50" }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>
                      Order Financials
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      {(() => {
                        const isTaxInclusive = selectedOrder.is_tax_invoice;
                        const taxRate = selectedOrder.tax_rate || 0;
                        const grossTotal = selectedOrder.items?.reduce((sum: number, item: any) => sum + (item.quantity * item.selling_price), 0) || 0;
                        const itemDiscounts = selectedOrder.items?.reduce((sum: number, item: any) => sum + (item.discount_amount || (item.selling_price * item.quantity * (item.discount_percent || 0) / 100)), 0) || 0;

                        const displayGrossTotal = isTaxInclusive && taxRate > 0 ? grossTotal / (1 + taxRate / 100) : grossTotal;
                        const displayItemDiscounts = isTaxInclusive && taxRate > 0 ? itemDiscounts / (1 + taxRate / 100) : itemDiscounts;
                        const displaySubtotal = displayGrossTotal - displayItemDiscounts;

                        return (
                          <>
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="text.secondary">Gross Total</Typography>
                              <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(displayGrossTotal)}</Typography>
                            </Box>
                            {displayItemDiscounts > 0 && (
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="body2" color="error.main">Item Discounts</Typography>
                                <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(displayItemDiscounts)}</Typography>
                              </Box>
                            )}
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                              <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(displaySubtotal)}</Typography>
                            </Box>
                            {selectedOrder.cupon_amount > 0 && (
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="body2" color="error.main">Coupon Discount</Typography>
                                <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(selectedOrder.cupon_amount)}</Typography>
                              </Box>
                            )}
                            {selectedOrder.discount_amount > 0 && (
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="body2" color="error.main">
                                  Invoice Discount {selectedOrder.discount_percent > 0 ? `(${selectedOrder.discount_percent}%)` : ""}
                                </Typography>
                                <Typography variant="body2" color="error.main" fontWeight="medium">-Rs. {fmtLKR(selectedOrder.discount_amount)}</Typography>
                              </Box>
                            )}
                            {selectedOrder.tax_amount > 0 && (
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="body2" color="text.secondary">
                                  Tax ({selectedOrder.tax_rate}%) {isTaxInclusive ? "(Included)" : ""}
                                </Typography>
                                <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.tax_amount)}</Typography>
                              </Box>
                            )}
                            {selectedOrder.service_charge_amount > 0 && (
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="body2" color="text.secondary">Service Charge ({(selectedOrder.service_charge_rate * 100).toFixed(1)}%)</Typography>
                                <Typography variant="body2" fontWeight="medium">Rs. {fmtLKR(selectedOrder.service_charge_amount)}</Typography>
                              </Box>
                            )}
                            <Divider sx={{ my: 0.5 }} />
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="subtitle2" fontWeight="bold">Grand Total</Typography>
                              <Typography variant="subtitle2" fontWeight="bold">Rs. {fmtLKR(selectedOrder.grand_total)}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                              <Typography variant="body2" fontWeight="medium" color="success.main">Amount Paid</Typography>
                              <Typography variant="body2" fontWeight="medium" color="success.main">Rs. {fmtLKR(selectedOrder.paid_amount)}</Typography>
                            </Box>
                            {selectedOrder.balance_due > 0 && (
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="body2" fontWeight="medium" color="error.main">Balance Due</Typography>
                                <Typography variant="body2" fontWeight="medium" color="error.main">Rs. {fmtLKR(selectedOrder.balance_due)}</Typography>
                              </Box>
                            )}
                          </>
                        );
                      })()}
                    </Box>
                  </Paper>
                </Grid>
              </Grid>
            </FormSection>

            {/* Agent Commission Section */}
            {selectedOrder.customer_agent_id && (
              <FormSection title="Agent Commission" columns={1}>
                <Paper variant="outlined" sx={{ p: 2.5, borderColor: "primary.main", borderWidth: 1, borderRadius: 2 }}>
                  {(() => {
                    const agent = customers?.find((c) => c.id === selectedOrder.customer_agent_id);
                    return (
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={4}>
                          <Typography variant="body2" color="text.secondary">Agent Name</Typography>
                          <Typography variant="body1" fontWeight={500}>{agent?.customer_name || `Agent #${selectedOrder.customer_agent_id}`}</Typography>
                        </Grid>
                        <Grid item xs={6} sm={2}>
                          <Typography variant="body2" color="text.secondary">Commission Rate</Typography>
                          <Typography variant="body1" fontWeight={500}>
                            {invoiceCommission ? `${Number(invoiceCommission.commission_rate).toFixed(1)}%` : `${Number(agent?.commission_rate || 0).toFixed(1)}%`}
                          </Typography>
                        </Grid>
                        <Grid item xs={6} sm={2}>
                          <Typography variant="body2" color="text.secondary">Status</Typography>
                          <Box sx={{ mt: 0.5 }}>
                            <Chip
                              size="small"
                              label={invoiceCommission?.status ? invoiceCommission.status.toUpperCase() : "PENDING"}
                              color={
                                invoiceCommission?.status === "paid"
                                  ? "success"
                                  : invoiceCommission?.status === "approved"
                                  ? "info"
                                  : invoiceCommission?.status === "cancelled"
                                  ? "error"
                                  : "warning"
                              }
                            />
                          </Box>
                        </Grid>
                        <Grid item xs={12} sm={4} sx={{ textAlign: { sm: "right" } }}>
                          <Typography variant="body2" color="text.secondary">Commission Amount</Typography>
                          <Typography variant="h6" fontWeight="bold" color="primary.main">
                            Rs. {fmtLKR(invoiceCommission ? Number(invoiceCommission.commission_amount) : (selectedOrder.grand_total * ((agent?.commission_rate || 0) / 100)))}
                          </Typography>
                        </Grid>
                      </Grid>
                    );
                  })()}
                </Paper>
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout masterPanel={masterPanel} detailPanel={detailPanel} title="Bank Transfer Verification" />

      {/* Confirm Dialogs */}
      <TConfirmDialog {...verifyDialog.dialogProps} confirmColor="success" />
      <TConfirmDialog {...rejectDialog.dialogProps} confirmColor="error" />

      {/* Reject Reason Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Bank Transfer</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Please provide a reason for rejecting the bank transfer for invoice{" "}
            <strong>{selectedTransfer?.invoice_no}</strong>.
          </Typography>
          <TextField
            autoFocus
            multiline
            rows={3}
            fullWidth
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter the reason for rejection..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleConfirmReject}
            color="error"
            variant="contained"
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            {rejectMutation.isPending ? "Rejecting..." : "Reject Transfer"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Item Remark Modal */}
      <Dialog
        open={itemRemarkModalOpen}
        onClose={() => setItemRemarkModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MenuBookIcon />
          Item Remark
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            value={currentItemRemark || "No remark"}
            InputProps={{ readOnly: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemRemarkModalOpen(false)} variant="outlined">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
