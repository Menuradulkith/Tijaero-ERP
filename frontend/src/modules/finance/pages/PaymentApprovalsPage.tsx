/**
 * PaymentApprovalsPage - Supplier Payment Verification/Approvals
 * Shows supplier payments pending verification for approval/rejection
 * Follows the same UI pattern as POApprovalsPage
 */

import { useMemo, useCallback, useState, useEffect } from "react";
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
  IconButton,
  Tooltip,
  Chip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PaymentIcon from "@mui/icons-material/Payment";

// Import tijaero components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  TFilterPanel,
  TBranchFilter,
  TStatusFilter,
  SortOption,
  TDetailSkeleton,
  showSuccessToast,
  showErrorToast,
  modernTableStyles,
  TConfirmDialog,
  useConfirmDialog,
  fmtLKR,
} from "@/components/tijaero";

import { supplierPaymentsApi, suppliersApi, supplierCreditsSettleApi } from "@/modules/purchasing/api";
import { useReferenceData } from "@/hooks";
import { SupplierPayment, Supplier, SupplierCreditsSettle } from "@/modules/purchasing/types";


const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "payment_no", label: "Payment Number" },
  { value: "payment_amount", label: "Amount" },
];

// Payment status filter options
const PAYMENT_STATUS_FILTER_OPTIONS = [
  { value: null, label: "All Status" },
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "cancelled", label: "Cancelled" },
];

// Get status chip properties for payments
const getPaymentStatusProps = (status: string) => {
  switch (status?.toLowerCase()) {
    case "pending":
      return { label: "Pending", color: "warning" as const };
    case "verified":
      return { label: "Verified", color: "success" as const };
    case "cancelled":
      return { label: "Cancelled", color: "error" as const };
    default:
      return { label: status || "Unknown", color: "default" as const };
  }
};

export default function PaymentApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");

  // Unified payment type - both types need common display fields
  type PaymentItem = {
    id: number;
    payment_type: "payment" | "credit";
    payment_no: string;
    payment_amount: number;
    supplier_id: number;
    branch_code: string;
    created_date: string;
    status: string;
    remarks?: string;
    created_by?: number;
    verified_by?: number;
    verified_date?: string;
  } & (
    | SupplierPayment
    | SupplierCreditsSettle
  );

  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);

  // Confirm dialog for verification warning
  const confirmDialog = useConfirmDialog();

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>("pending");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

  // Fetch direct payments
  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ["supplier-payments"],
    queryFn: () => supplierPaymentsApi.getAll(),
  });

  // Fetch credit settlements
  const { data: creditSettlements = [], isLoading: creditsLoading } = useQuery({
    queryKey: ["credit-settlements"],
    queryFn: () => supplierCreditsSettleApi.getAll(),
  });

  const isLoading = paymentsLoading || creditsLoading;

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // OPTIMIZED: Single API call for branches
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create supplier lookup map
  const supplierMap = useMemo(() => {
    const map = new Map<number, Supplier>();
    suppliers.forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliers]);

  // Combine and unify payments and credit settlements
  const allPayments = useMemo((): PaymentItem[] => {
    const directPayments: PaymentItem[] = payments.map((p) => ({ 
      ...p, 
      payment_type: "payment" as const,
      payment_no: p.payment_no,
      payment_amount: p.payment_amount,
      supplier_id: p.supplier_id,
    } as PaymentItem));
    
    const creditPayments: PaymentItem[] = creditSettlements.map((c) => ({ 
      ...c, 
      payment_type: "credit" as const,
      payment_no: c.supplier_credits_settle_no,
      payment_amount: c.transactions?.reduce((sum, t) => sum + t.payment_amount, 0) || 0,
      supplier_id: c.suppliers_id,
    } as PaymentItem));
    
    return [...directPayments, ...creditPayments];
  }, [payments, creditSettlements]);

  // Filter and sort payments
  const filteredPayments = useMemo(() => {
    let filtered = allPayments.filter((payment) => {
      // Status filter
      if (filterStatus && payment.status?.toLowerCase() !== filterStatus.toLowerCase()) {
        return false;
      }
      // Branch filter
      if (filterBranch && payment.branch_code !== filterBranch) {
        return false;
      }
      // Search filter
      const supplier = supplierMap.get(payment.supplier_id);
      const paymentNo = payment.payment_type === "payment" 
        ? (payment as any).payment_no 
        : (payment as any).supplier_credits_settle_no;
      const refNo = payment.payment_type === "payment" ? (payment as any).reference_number : "";
      
      return (
        paymentNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
        supplier?.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        supplier?.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        refNo?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });

    filtered.sort((a, b) => {
      if (sortField === "payment_no") {
        const aNo = a.payment_type === "payment" ? (a as any).payment_no : (a as any).supplier_credits_settle_no;
        const bNo = b.payment_type === "payment" ? (b as any).payment_no : (b as any).supplier_credits_settle_no;
        return aNo.localeCompare(bNo);
      }
      if (sortField === "payment_amount") {
        const aAmt = (a as any).payment_amount || 0;
        const bAmt = (b as any).payment_amount || 0;
        return bAmt - aAmt;
      }
      return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
    });

    return filtered;
  }, [allPayments, searchQuery, sortField, supplierMap, filterStatus, filterBranch]);

  // Handle selection
  const handleSelectPayment = useCallback(async (payment: PaymentItem) => {
    try {
      if (payment.payment_type === "payment") {
        const fullPayment = await supplierPaymentsApi.getById(payment.id);
        setSelectedPayment({ 
          ...fullPayment, 
          payment_type: "payment",
          payment_no: fullPayment.payment_no,
          payment_amount: fullPayment.payment_amount,
          supplier_id: fullPayment.supplier_id,
        } as PaymentItem);
      } else {
        const fullSettlement = await supplierCreditsSettleApi.getById(payment.id);
        const totalAmount = fullSettlement.transactions?.reduce((sum, t) => sum + t.payment_amount, 0) || 0;
        setSelectedPayment({ 
          ...fullSettlement, 
          payment_type: "credit",
          payment_no: fullSettlement.supplier_credits_settle_no,
          payment_amount: totalAmount,
          supplier_id: fullSettlement.suppliers_id,
        } as PaymentItem);
      }
    } catch {
      showErrorToast("Failed to load payment details");
    }
  }, []);

  // Auto-select first payment
  useEffect(() => {
    if (filteredPayments.length > 0 && !selectedPayment) {
      handleSelectPayment(filteredPayments[0]);
    }
  }, [filteredPayments, selectedPayment, handleSelectPayment]);

  // Verify mutation for direct payments
  const verifyPaymentMutation = useMutation({
    mutationFn: (id: number) => supplierPaymentsApi.verify(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-payments"] });
      if (selectedPayment && selectedPayment.payment_type === "payment" && selectedPayment.id === id) {
        setSelectedPayment((prev) => prev ? { ...prev, status: "verified" } : null);
      }
      showSuccessToast("Payment verified successfully");
    },
    onError: () => showErrorToast("Failed to verify payment"),
  });

  // Verify mutation for credit settlements
  const verifyCreditMutation = useMutation({
    mutationFn: (id: number) => supplierCreditsSettleApi.verify(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["credit-settlements"] });
      if (selectedPayment && selectedPayment.payment_type === "credit" && selectedPayment.id === id) {
        setSelectedPayment((prev) => prev ? { ...prev, status: "verified" } : null);
      }
      showSuccessToast("Credit settlement verified successfully");
    },
    onError: () => showErrorToast("Failed to verify credit settlement"),
  });

  // Cancel/Reject mutation for direct payments
  const cancelPaymentMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: number; remarks?: string }) =>
      supplierPaymentsApi.update(id, { status: "cancelled", remarks }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-payments"] });
      if (selectedPayment && selectedPayment.payment_type === "payment" && selectedPayment.id === variables.id) {
        setSelectedPayment((prev) => prev ? { ...prev, status: "cancelled" } : null);
      }
      showSuccessToast("Payment cancelled successfully");
      setRejectDialogOpen(false);
      setRejectReason("");
    },
    onError: () => showErrorToast("Failed to cancel payment"),
  });

  // Cancel mutation for credit settlements
  const cancelCreditMutation = useMutation({
    mutationFn: (id: number) => supplierCreditsSettleApi.cancel(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["credit-settlements"] });
      if (selectedPayment && selectedPayment.payment_type === "credit" && selectedPayment.id === id) {
        setSelectedPayment((prev) => prev ? { ...prev, status: "cancelled" } : null);
      }
      showSuccessToast("Credit settlement cancelled successfully");
      setRejectDialogOpen(false);
      setRejectReason("");
    },
    onError: () => showErrorToast("Failed to cancel credit settlement"),
  });

  const handleVerify = async () => {
    if (!selectedPayment) return;
    
    // Check if it's a large payment amount (e.g., > 100,000)
    const isLargePayment = selectedPayment.payment_amount > 100000;
    
    if (isLargePayment) {
      const confirmed = await confirmDialog.confirm({
        title: "Large Payment Verification",
        message: `This is a large payment of Rs. ${fmtLKR(selectedPayment.payment_amount)}. Are you sure you want to verify this payment?`,
        confirmText: "Verify Anyway",
        cancelText: "Cancel",
        confirmColor: "warning",
      });
      
      if (!confirmed) return;
    }
    
    // Check if it's after business hours (6pm)
    const currentHour = new Date().getHours();
    const isAfterHours = currentHour >= 18;
    
    if (isAfterHours) {
      const confirmed = await confirmDialog.confirm({
        title: "After-Hours Verification Warning",
        message: `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Verifying payments after business hours is not recommended. Do you want to verify anyway?`,
        confirmText: "Verify Anyway",
        cancelText: "Cancel",
        confirmColor: "warning",
      });
      
      if (!confirmed) return;
    }
    
    // Verify based on payment type
    if (selectedPayment.payment_type === "payment") {
      verifyPaymentMutation.mutate(selectedPayment.id);
    } else {
      verifyCreditMutation.mutate(selectedPayment.id);
    }
  };

  const handleReject = () => {
    if (!selectedPayment) return;
    
    if ((selectedPayment as any).payment_type === "payment") {
      cancelPaymentMutation.mutate({ id: selectedPayment.id, remarks: rejectReason || undefined });
    } else {
      cancelCreditMutation.mutate(selectedPayment.id);
    }
  };

  const supplier = selectedPayment ? supplierMap.get(selectedPayment.supplier_id) : null;
  const selectedIsPending = (selectedPayment?.status || "").toLowerCase() === "pending";

  const getSupplierName = (supplierId: number) => {
    const s = supplierMap.get(supplierId);
    return s ? s.full_name || s.company_name || "Unknown" : "Unknown";
  };

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredPayments}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search payments..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedPayment}
      emptyMessage="No payments found"
      listHeader={
        <TFilterPanel>
          <TStatusFilter
            options={PAYMENT_STATUS_FILTER_OPTIONS}
            value={filterStatus}
            onChange={setFilterStatus}
          />
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
        </TFilterPanel>
      }
      renderItem={(payment, isSelected) => {
        const paymentSupplier = supplierMap.get(payment.supplier_id);
        const paymentDate = payment.payment_type === "payment"
          ? (payment as any).payment_date
          : payment.created_date;
        const paymentMethod = payment.payment_type === "payment"
          ? (payment as any).payment_method
          : "Credit Settlement";
        const paymentType = payment.payment_type === "payment" ? "Direct Payment" : "Credit Settlement";
        const statusProps = getPaymentStatusProps(payment.status || "pending");
        
        return (
          <SelectableListItem
            key={`${payment.payment_type}-${payment.id}`}
            id={payment.id}
            isSelected={isSelected}
            onClick={() => handleSelectPayment(payment)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{payment.payment_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      ({paymentType})
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {paymentSupplier?.full_name || paymentSupplier?.company_name || "Unknown Supplier"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Supplier)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {new Date(paymentDate).toLocaleDateString()}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        Rs. {fmtLKR(payment.payment_amount)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={statusProps.label}
                        size="small"
                        color={statusProps.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                      <Chip
                        label={paymentMethod}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${getSupplierName(payment.supplier_id)} - Rs. ${fmtLKR(payment.payment_amount)}`
                : undefined
            }
            statusChip={!isSelected ? statusProps : undefined}
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
          { label: "Purchasing" },
          { label: "Payment Approvals", href: "/purchasing/payment-approvals" },
          ...(selectedPayment ? [{ label: selectedPayment.payment_no }] : []),
        ]}
        title={selectedPayment?.payment_no || ""}
        titleIcon={<PaymentIcon color="primary" />}
        noSelectionTitle="Select a Payment to Review"
        chips={
          selectedPayment
            ? (() => {
                const s = getPaymentStatusProps(selectedPayment.status || "pending");
                return [{ label: s.label, color: s.color }];
              })()
            : []
        }
      />

      {/* Approval Actions */}
      {selectedPayment && selectedIsPending && (
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
            color="primary"
            startIcon={<CheckCircleIcon />}
            onClick={handleVerify}
            disabled={verifyPaymentMutation.isPending || verifyCreditMutation.isPending}
          >
            Verify
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={cancelPaymentMutation.isPending || cancelCreditMutation.isPending}
          >
            Cancel Payment
          </Button>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedPayment ? (
          <EmptyState message="Select a payment from the list to review" />
        ) : isLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Payment Information */}
            <FormSection title="Payment Information" columns={3}>
              <TextField 
                label={selectedPayment.payment_type === "payment" ? "Payment Number" : "Settlement Number"} 
                size="small" 
                value={selectedPayment.payment_no} 
                disabled 
              />
              <TextField
                label="Payment Date"
                size="small"
                value={new Date(selectedPayment.payment_type === "payment" ? (selectedPayment as any).payment_date : selectedPayment.created_date).toLocaleDateString()}
                disabled
              />
              <TextField label="Branch" size="small" value={selectedPayment.branch_code} disabled />
              <TextField 
                label="Payment Method" 
                size="small" 
                value={selectedPayment.payment_type === "payment" ? (selectedPayment as any).payment_method : "Credit Settlement"} 
                disabled 
              />
              {selectedPayment.payment_type === "payment" && (
                <TextField label="Payment For" size="small" value={(selectedPayment as any).payment_for} disabled />
              )}
              <TextField label="Status" size="small" value={selectedPayment.status} disabled />
            </FormSection>

            {/* Supplier Information */}
            <FormSection title="Supplier Information" columns={2}>
              <TextField label="Supplier Name" size="small" value={supplier?.full_name || ""} disabled />
              <TextField label="Company" size="small" value={supplier?.company_name || "N/A"} disabled />
              <TextField label="Contact" size="small" value={supplier?.mobile_contact_number || ""} disabled />
              <TextField label="Email" size="small" value={supplier?.email || "N/A"} disabled />
            </FormSection>

            {/* Payment Details */}
            <FormSection title="Payment Details" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Amount (Rs.)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow sx={modernTableStyles.bodyRow}>
                      <TableCell>Payment Amount</TableCell>
                      <TableCell align="right">{fmtLKR(selectedPayment.payment_amount)}</TableCell>
                    </TableRow>
                    {selectedPayment.payment_type === "payment" && (selectedPayment as any).reference_number && (
                      <TableRow sx={{ ...modernTableStyles.bodyRow, bgcolor: "grey.25" }}>
                        <TableCell>Reference Number</TableCell>
                        <TableCell align="right">{(selectedPayment as any).reference_number}</TableCell>
                      </TableRow>
                    )}
                    {selectedPayment.payment_type === "payment" && (selectedPayment as any).bank_name && (
                      <TableRow sx={modernTableStyles.bodyRow}>
                        <TableCell>Bank Name</TableCell>
                        <TableCell align="right">{(selectedPayment as any).bank_name}</TableCell>
                      </TableRow>
                    )}
                    {selectedPayment.payment_type === "payment" && (selectedPayment as any).invoice_reference && (
                      <TableRow sx={{ ...modernTableStyles.bodyRow, bgcolor: "grey.25" }}>
                        <TableCell>Invoice Reference</TableCell>
                        <TableCell align="right">{(selectedPayment as any).invoice_reference}</TableCell>
                      </TableRow>
                    )}
                    {selectedPayment.payment_type === "payment" && (selectedPayment as any).po_no && (
                      <TableRow sx={modernTableStyles.bodyRow}>
                        <TableCell>Purchase Order</TableCell>
                        <TableCell align="right">{(selectedPayment as any).po_no}</TableCell>
                      </TableRow>
                    )}
                    {selectedPayment.payment_type === "credit" && (selectedPayment as any).transactions && (
                      <>
                        {(selectedPayment as any).transactions.map((txn: any, idx: number) => (
                          <TableRow key={idx} sx={{ ...modernTableStyles.bodyRow, bgcolor: idx % 2 === 0 ? "grey.25" : "transparent" }}>
                            <TableCell>GRN: {txn.grn_no} | PO: {txn.po_no}</TableCell>
                            <TableCell align="right">{fmtLKR(txn.payment_amount)}</TableCell>
                          </TableRow>
                        ))}
                      </>
                    )}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell align="right">
                        <strong>Total Amount:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{fmtLKR(selectedPayment.payment_amount)}</strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>

            {/* Verification Info (if verified) */}
            {selectedPayment.status === "verified" && selectedPayment.verified_date && (
              <FormSection title="Verification Details" columns={2}>
                <TextField
                  label="Verified Date"
                  size="small"
                  value={new Date(selectedPayment.verified_date).toLocaleString()}
                  disabled
                />
                <TextField
                  label="Verified By"
                  size="small"
                  value={selectedPayment.verified_by ? `User #${selectedPayment.verified_by}` : "N/A"}
                  disabled
                />
              </FormSection>
            )}

            {/* Remarks Section with Book Icon */}
            <FormSection title="Remarks" columns={1}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                <TextField
                  multiline
                  rows={2}
                  fullWidth
                  value={selectedPayment.remarks || "No remarks"}
                  disabled
                  size="small"
                />
                <Tooltip title="View Remarks">
                  <IconButton size="small" onClick={() => setRemarksDialogOpen(true)}>
                    <MenuBookIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </FormSection>

            {/* Creation Info */}
            <FormSection title="Record Info" columns={2}>
              <TextField
                label="Created Date"
                size="small"
                value={new Date(selectedPayment.created_date).toLocaleString()}
                disabled
              />
              <TextField
                label="Created By"
                size="small"
                value={selectedPayment.created_by ? `User #${selectedPayment.created_by}` : "N/A"}
                disabled
              />
            </FormSection>
          </>
        )}
      </Box>

      {/* Reject/Cancel Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cancel Payment</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for cancelling this payment (optional).
          </Typography>
          <TextField
            autoFocus
            label="Cancellation Reason"
            multiline
            rows={4}
            fullWidth
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Back</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={cancelPaymentMutation.isPending || cancelCreditMutation.isPending}
          >
            Cancel Payment
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remarks Modal */}
      <Dialog open={remarksDialogOpen} onClose={() => setRemarksDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remarks</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={8}
            fullWidth
            placeholder="No remarks..."
            value={selectedPayment?.remarks || ""}
            InputProps={{ readOnly: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemarksDialogOpen(false)}>OK</Button>
          <Button onClick={() => setRemarksDialogOpen(false)} variant="outlined">
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Payment Approvals"
        icon={<FactCheckIcon color="primary" />}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["supplier-payments"] });
          queryClient.invalidateQueries({ queryKey: ["credit-settlements"] });
        }}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Confirm Dialog for warnings */}
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
