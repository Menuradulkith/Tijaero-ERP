/**
 * BankTransferVerifyPage - Bank Transfer Verification for Finance Manager
 * Shows bank transfer payments pending verification for approval/rejection
 * Follows the same UI pattern as SalesOrderApprovalsPage
 */

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ReceiptIcon from "@mui/icons-material/Receipt";

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
  fmtLKR,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import { bankTransferApi, PendingBankTransfer } from "@/modules/finance/api/bankTransfer";
import { customersApi } from "@/modules/customers/api";
import { useReferenceData } from "@/hooks";
import { Customer } from "@/modules/customers/types";
import { Product } from "@/modules/inventory/types";
import { format } from "date-fns";

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
  const queryClient = useQueryClient();
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

  // Fetch pending bank transfers
  const { data: transfers = [], isLoading, error: _error } = useQuery({
    queryKey: ["pendingBankTransfers", filterBranch],
    queryFn: () => bankTransferApi.getPending(filterBranch || undefined),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // Fetch products and branches
  const { data: refData, filteredBranches } = useReferenceData(["products", "branches"]);
  const products = (refData?.products || []) as Product[];
  const branches = filteredBranches || [];

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
  const verifyMutation = useMutation({
    mutationFn: (invoiceId: number) => bankTransferApi.verify(invoiceId),
    onSuccess: (data) => {
      showSuccessToast(data.message);
      queryClient.invalidateQueries({ queryKey: ["pendingBankTransfers"] });
      setSelectedTransfer(null);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to verify bank transfer"));
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: number; reason: string }) =>
      bankTransferApi.reject(invoiceId, reason),
    onSuccess: (data) => {
      showSuccessToast(data.message);
      queryClient.invalidateQueries({ queryKey: ["pendingBankTransfers"] });
      setSelectedTransfer(null);
      setRejectDialogOpen(false);
      setRejectReason("");
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to reject bank transfer"));
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
        ) : isLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            {/* Bank Transfer Details */}
            <FormSection title="Bank Transfer Details" icon={<AccountBalanceIcon />}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Bank Name
            </Typography>
            <Typography variant="body1" fontWeight="medium">
              {selectedTransfer.bank_name || "N/A"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Reference Number
            </Typography>
            <Typography variant="body1" fontWeight="medium">
              {selectedTransfer.bank_transfer_ref || "N/A"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Transfer Amount
            </Typography>
            <Typography variant="body1" fontWeight="bold" color="primary">
              {formatCurrency(selectedTransfer.bank_transfer_amount)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Grand Total
            </Typography>
            <Typography variant="body1" fontWeight="bold">
              {formatCurrency(selectedTransfer.grand_total)}
            </Typography>
          </Box>
        </Box>
      </FormSection>

      {/* Verification Status - Show for verified/rejected transfers */}
      {selectedTransfer.bank_transfer_status !== "pending_verification" && (
        <FormSection 
          title={selectedTransfer.bank_transfer_status === "verified" ? "Verification Details" : "Rejection Details"}
          icon={selectedTransfer.bank_transfer_status === "verified" ? <CheckCircleIcon /> : <CancelIcon />}
        >
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {selectedTransfer.bank_transfer_status === "verified" ? "Verified By" : "Rejected By"}
              </Typography>
              <Typography variant="body1" fontWeight="medium">
                {selectedTransfer.bank_transfer_verified_by_name || "N/A"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {selectedTransfer.bank_transfer_status === "verified" ? "Verified At" : "Rejected At"}
              </Typography>
              <Typography variant="body1">
                {selectedTransfer.bank_transfer_verified_at 
                  ? formatDate(selectedTransfer.bank_transfer_verified_at)
                  : "N/A"}
              </Typography>
            </Box>
            {selectedTransfer.bank_transfer_status === "rejected" && selectedTransfer.bank_transfer_rejection_reason && (
              <Box sx={{ gridColumn: "1 / -1" }}>
                <Typography variant="caption" color="text.secondary">
                  Rejection Reason
                </Typography>
                <Typography variant="body1" color="error">
                  {selectedTransfer.bank_transfer_rejection_reason}
                </Typography>
              </Box>
            )}
          </Box>
        </FormSection>
      )}

      {/* Customer Information */}
      <FormSection title="Customer Information" icon={<ReceiptIcon />}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Customer Name
            </Typography>
            <Typography variant="body1">
              {customer?.customer_name || selectedTransfer.customer_name || "N/A"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Phone
            </Typography>
            <Typography variant="body1">{customer?.mobile_contact_number || "N/A"}</Typography>
          </Box>
          <Box sx={{ gridColumn: "1 / -1" }}>
            <Typography variant="caption" color="text.secondary">
              Delivery Address
            </Typography>
            <Typography variant="body1">{customer?.delivery_address || customer?.payment_address || "N/A"}</Typography>
          </Box>
        </Box>
      </FormSection>

      {/* Invoice Information */}
      <FormSection title="Invoice Information">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Created Date
            </Typography>
            <Typography variant="body1">{formatDate(selectedTransfer.created_date)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Created By
            </Typography>
            <Typography variant="body1">{selectedTransfer.created_by_name || "N/A"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Branch
            </Typography>
            <Typography variant="body1">{selectedTransfer.branch_code}</Typography>
          </Box>
        </Box>
      </FormSection>

      {/* Invoice Items (if available) */}
      {selectedTransfer.items && selectedTransfer.items.length > 0 && (
        <FormSection title="Invoice Items">
          <Paper variant="outlined" sx={{ overflow: "hidden" }}>
            <Table size="small" sx={modernTableStyles}>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Unit Price</TableCell>
                  <TableCell align="right">Line Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {selectedTransfer.items.map((item, index) => {
                  const product = productMap.get(item.product_id);
                  return (
                    <TableRow key={item.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">{formatCurrency(item.selling_price)}</TableCell>
                      <TableCell align="right">{formatCurrency(item.line_total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
    </>
  );
}
