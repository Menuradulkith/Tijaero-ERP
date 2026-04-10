/**
 * ReimbursementsPage - Employee Reimbursement Processing
 * Full 8-step workflow: Submit → Items → Receipts → Review → Approve/Reject → Verify → Pay → Complete
 * Uses Tijaero component library for consistent ERP UI.
 */

import { formatDateTimeReadable } from "@/utils/formatters";
import {
    Add as AddIcon,
    CheckCircle as ApproveIcon,
    Delete as DeleteIcon,
    Payment as PaymentIcon,
    Receipt as ReceiptIcon,
    Cancel as RejectIcon,
    Verified as VerifyIcon,
} from "@mui/icons-material";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    MenuItem,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

// Tijaero components
import {
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    getStatusProps,
    handleApiError,
    MasterDetailLayout,
    modernTableStyles,
    REIMBURSEMENT_EXPENSE_TYPES,
    REIMBURSEMENT_PAYMENT_METHODS,
    REIMBURSEMENT_STATUS_FILTER_OPTIONS,
    REIMBURSEMENT_TYPES,
    SearchableList,
    SelectableListItem,
    showErrorToast,
    showSuccessToast,
    type SortOption,
    TBranchFilter,
    TConfirmDialog,
    TCurrency,
    TFilterPanel,
    TStatCard,
    TStatusChip,
    useConfirmDialog,
    useMasterDetailState,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { reimbursementsApi } from "@/modules/hr/api";
import type {
    Reimbursement,
    ReimbursementCreate,
    ReimbursementItemCreate,
} from "@/modules/hr/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SORT_OPTIONS: SortOption[] = [
  { value: "claim_date", label: "Claim Date" },
  { value: "reimbursement_no", label: "Reimbursement No" },
  { value: "total_amount", label: "Amount" },
];

interface ReimbursementFormData extends ReimbursementCreate {
  status?: string;
}

const INITIAL_FORM_DATA: ReimbursementFormData = {
  employee_id: "",
  branch_code: "",
  claim_date: new Date().toISOString().split("T")[0],
  description: "",
  reimbursement_type: "general",
  remark: "",
  items: [],
};

interface LineItem extends ReimbursementItemCreate {
  _id: string;
}

const resetFormFromItem = (item: Reimbursement): ReimbursementFormData => ({
  employee_id: item.employee_id,
  branch_code: item.branch_code,
  claim_date: item.claim_date?.split("T")[0] || "",
  description: item.description || "",
  reimbursement_type: item.reimbursement_type || "general",
  remark: item.remark || "",
  items:
    item.items?.map((i) => ({
      expense_type: i.expense_type,
      item_description: i.item_description || "",
      amount: i.amount,
      receipt_date: i.receipt_date || "",
      receipt_number: i.receipt_number || "",
    })) || [],
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ReimbursementsPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Workflow dialog states
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Workflow form fields
  const [approveAmount, setApproveAmount] = useState<string>("");
  const [approveRemarks, setApproveRemarks] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [verifyRemarks, setVerifyRemarks] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentRemarks, setPaymentRemarks] = useState("");

  // Line items for create form
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // Reference data
  const {
    data: refData,
    filteredBranches,
    defaultBranchCode,
  } = useReferenceData(["branches", "employees"]);
  const branches = filteredBranches || [];
  const employees = refData?.employees || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Master-detail state
  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem,
    setSelectedItem,
    isCreating,
    formData,
    setFormData,
    handleSelectItem,
    handleCancel: handleCancelBase,
  } = useMasterDetailState<Reimbursement, ReimbursementFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "reimbursements_favorites",
    defaultSortField: "claim_date",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
    extraDirty: lineItems.length > 0,
    onDiscard: () => {
      setLineItems([]);
    },
  });

  // Set default branch when creating new reimbursement
  useEffect(() => {
    if (isCreating && defaultBranchCode && !formData.branch_code) {
      setFormData((prev) => ({ ...prev, branch_code: defaultBranchCode }));
    }
  }, [isCreating, defaultBranchCode, formData.branch_code, setFormData]);

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data query
  const { data: reimbursements, isLoading } = useQuery({
    queryKey: ["reimbursements", filterBranch, filterStatus],
    queryFn: () =>
      reimbursementsApi.getAll({
        branch_code: filterBranch ?? undefined,
        status: filterStatus ?? undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: reimbursementsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      showSuccessToast("Reimbursement claim submitted successfully");
      handleCancelBase(reimbursements || []);
      setLineItems([]);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create reimbursement"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: reimbursementsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      showSuccessToast("Reimbursement deleted");
      setSelectedItem(null);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete reimbursement"));
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { approved_amount?: number; remarks?: string };
    }) => reimbursementsApi.approve(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      showSuccessToast("Reimbursement approved");
      setApproveDialogOpen(false);
      setSelectedItem(updated);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to approve"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { rejection_reason: string };
    }) => reimbursementsApi.reject(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      showSuccessToast("Reimbursement rejected");
      setRejectDialogOpen(false);
      setSelectedItem(updated);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to reject"));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { remarks?: string } }) =>
      reimbursementsApi.verify(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      showSuccessToast("Reimbursement verified by finance");
      setVerifyDialogOpen(false);
      setSelectedItem(updated);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to verify"));
    },
  });

  const paymentMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        payment_method: string;
        payment_reference?: string;
        paid_amount: number;
        remarks?: string;
      };
    }) => reimbursementsApi.processPayment(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["reimbursements"] });
      showSuccessToast("Payment processed successfully");
      setPaymentDialogOpen(false);
      setSelectedItem(updated);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to process payment"));
    },
  });

  // Handlers
  const handleCancel = useCallback(
    (items: Reimbursement[]) => {
      handleCancelBase(items);
      setLineItems([]);
    },
    [handleCancelBase],
  );

  const handleSelectReimbursement = useCallback(
    async (item: Reimbursement) => {
      const selected = await handleSelectItem(item);
      if (!selected) return;
      try {
        const detail = await reimbursementsApi.getById(item.id);
        setSelectedItem(detail);
        setLineItems(
          (detail.items || []).map((i, idx) => ({
            _id: `existing-${idx}`,
            expense_type: i.expense_type,
            item_description: i.item_description || "",
            amount: i.amount,
            receipt_date: i.receipt_date || "",
            receipt_number: i.receipt_number || "",
          })),
        );
      } catch {
        setLineItems([]);
      }
    },
    [handleSelectItem, setSelectedItem],
  );

  // Line item management
  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        _id: `new-${Date.now()}`,
        expense_type: "transport",
        item_description: "",
        amount: 0,
        receipt_date: "",
        receipt_number: "",
      },
    ]);
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item._id !== id));
  };

  const updateLineItem = (
    id: string,
    field: keyof ReimbursementItemCreate,
    value: string | number,
  ) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item._id === id ? { ...item, [field]: value } : item,
      ),
    );
  };

  const lineItemsTotal = useMemo(
    () => lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [lineItems],
  );

  // Submit handler
  const handleSave = () => {
    if (!formData.employee_id || !formData.branch_code) {
      showErrorToast("Employee and Branch are required");
      return;
    }
    if (lineItems.length === 0) {
      showErrorToast("Add at least one expense item");
      return;
    }
    const payload: ReimbursementCreate = {
      ...formData,
      items: lineItems.map(({ _id, ...rest }) => ({
        ...rest,
        amount: Number(rest.amount),
        receipt_date: rest.receipt_date || undefined,
        receipt_number: rest.receipt_number || undefined,
      })),
    };
    createMutation.mutate(payload);
  };

  const handleDelete = () => {
    if (!selectedItem) return;
    confirmDialog.open(
      "Delete Reimbursement",
      `Delete ${selectedItem.reimbursement_no}? This cannot be undone.`,
      () => deleteMutation.mutate(selectedItem.id),
    );
  };

  // Workflow action openers
  const openApproveDialog = () => {
    setApproveAmount(String(selectedItem?.total_amount || 0));
    setApproveRemarks("");
    setApproveDialogOpen(true);
  };
  const openRejectDialog = () => {
    setRejectReason("");
    setRejectDialogOpen(true);
  };
  const openVerifyDialog = () => {
    setVerifyRemarks("");
    setVerifyDialogOpen(true);
  };
  const openPaymentDialog = () => {
    setPaymentMethod("bank_transfer");
    setPaymentReference("");
    setPaymentAmount(
      String(selectedItem?.approved_amount || selectedItem?.total_amount || 0),
    );
    setPaymentRemarks("");
    setPaymentDialogOpen(true);
  };

  // Filtered + sorted list
  const filteredItems = useMemo(() => {
    if (!reimbursements) return [];
    let filtered = reimbursements.filter(
      (r) =>
        r.reimbursement_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.employee_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.employee_id?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    if (filterBranch)
      filtered = filtered.filter((r) => r.branch_code === filterBranch);
    if (filterStatus)
      filtered = filtered.filter((r) => r.status === filterStatus);
    filtered.sort((a, b) => {
      if (sortField === "claim_date") {
        return (
          new Date(b.claim_date || "").getTime() -
          new Date(a.claim_date || "").getTime()
        );
      }
      if (sortField === "total_amount")
        return (b.total_amount || 0) - (a.total_amount || 0);
      const fa = a[sortField as keyof Reimbursement] || "";
      const fb = b[sortField as keyof Reimbursement] || "";
      return String(fa).localeCompare(String(fb));
    });
    return filtered;
  }, [reimbursements, searchQuery, sortField, filterBranch, filterStatus]);

  // Stats
  const stats = useMemo(() => {
    const all = reimbursements || [];
    return {
      total: all.length,
      pending: all.filter((r) => r.status === "pending").length,
      approved: all.filter((r) =>
        ["approved", "partial_approved"].includes(r.status),
      ).length,
      completed: all.filter((r) => r.status === "completed").length,
      totalAmount: all.reduce((s, r) => s + (r.total_amount || 0), 0),
    };
  }, [reimbursements]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredItems.length > 0 && !selectedItem && !isCreating) {
      handleSelectReimbursement(filteredItems[0]);
    }
  }, [filteredItems, selectedItem, isCreating]);

  // ---------------------------------------------------------------------------
  // RENDER: List Panel
  // ---------------------------------------------------------------------------
  const renderListPanel = () => (
    <Box sx={{ height: "100%" }}>
      {/* Stat Cards */}
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <TStatCard title="Total Claims" value={stats.total} />
        <TStatCard title="Pending" value={stats.pending} color="warning" />
        <TStatCard title="Approved" value={stats.approved} color="info" />
        <TStatCard title="Completed" value={stats.completed} color="success" />
      </Box>

      {/* Filters */}
      <TFilterPanel>
        <TBranchFilter
          branches={branches}
          value={filterBranch}
          onChange={setFilterBranch}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={filterStatus || ""}
          onChange={(e) => setFilterStatus(e.target.value || null)}
          sx={{ minWidth: 150 }}
        >
          {REIMBURSEMENT_STATUS_FILTER_OPTIONS.map((opt) => (
            <MenuItem key={String(opt.value)} value={opt.value || ""}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      </TFilterPanel>

      {/* List */}
      <SearchableList
        items={filteredItems}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        placeholder="Search by no, employee..."
        sortOptions={SORT_OPTIONS}
        sortField={sortField}
        onSortChange={setSortField}
        isLoading={isLoading}
        renderItem={(item, isSelected) => (
          <SelectableListItem
            key={item.id}
            id={item.id}
            isSelected={isSelected}
            onClick={() => handleSelectReimbursement(item)}
            primaryText={item.reimbursement_no}
            secondaryText={
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {item.employee_name || item.employee_id}
                </Typography>
                <Typography variant="caption" fontWeight={600}>
                  Rs. {fmtLKR(item.total_amount)}
                </Typography>
              </Box>
            }
            statusChip={{
              ...getStatusProps(item.status, "reimbursementStatus"),
              size: "small" as const,
            }}
          />
        )}
      >
        {!isLoading && filteredItems.length === 0 && (
          <EmptyState message="No reimbursement claims found" />
        )}
      </SearchableList>
    </Box>
  );

  // ---------------------------------------------------------------------------
  // RENDER: Detail Panel (view mode)
  // ---------------------------------------------------------------------------
  const renderDetailView = () => {
    if (!selectedItem) {
      return (
        <EmptyState message="Select a reimbursement claim to view details" />
      );
    }

    const canApprove = selectedItem.status === "pending";
    const canVerify = ["approved", "partial_approved"].includes(
      selectedItem.status,
    );
    const canPay = selectedItem.status === "verified";
    const canDelete = ["pending", "rejected"].includes(selectedItem.status);

    return (
      <Box>
        <DetailPanelHeader
          breadcrumbs={[
            { label: "HR" },
            { label: "Reimbursements", href: "/hr/reimbursements" },
            { label: selectedItem.reimbursement_no },
          ]}
          title={selectedItem.reimbursement_no}
          titleIcon={<ReceiptIcon color="primary" />}
          chips={[
            {
              label:
                selectedItem.status.charAt(0).toUpperCase() +
                selectedItem.status.slice(1),
              color: getStatusProps(selectedItem.status, "reimbursementStatus")
                .color,
            },
          ]}
        />

        {/* Action Buttons */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            flexWrap: "wrap",
          }}
        >
          {canApprove && (
            <>
              <Button
                size="small"
                color="success"
                variant="contained"
                startIcon={<ApproveIcon />}
                onClick={openApproveDialog}
              >
                Approve
              </Button>
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<RejectIcon />}
                onClick={openRejectDialog}
              >
                Reject
              </Button>
            </>
          )}
          {canVerify && (
            <Button
              size="small"
              color="info"
              variant="contained"
              startIcon={<VerifyIcon />}
              onClick={openVerifyDialog}
            >
              Finance Verify
            </Button>
          )}
          {canPay && (
            <Button
              size="small"
              color="primary"
              variant="contained"
              startIcon={<PaymentIcon />}
              onClick={openPaymentDialog}
            >
              Process Payment
            </Button>
          )}
          {canDelete && (
            <Button
              size="small"
              color="error"
              variant="text"
              startIcon={<DeleteIcon />}
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
        </Box>

        {/* Claim Details */}
        <FormSection title="Claim Details">
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary">
                Claim No
              </Typography>
              <Typography variant="body2">
                {selectedItem.reimbursement_no}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Employee
              </Typography>
              <Typography variant="body2">
                {selectedItem.employee_name || selectedItem.employee_id}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Branch
              </Typography>
              <Typography variant="body2">
                {selectedItem.branch_name || selectedItem.branch_code}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Claim Date
              </Typography>
              <Typography variant="body2">
                {selectedItem.claim_date
                  ? new Date(selectedItem.claim_date).toLocaleDateString()
                  : "-"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Type
              </Typography>
              <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                {REIMBURSEMENT_TYPES.find(
                  (t) => t.value === selectedItem.reimbursement_type,
                )?.label || selectedItem.reimbursement_type}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Status
              </Typography>
              <TStatusChip
                status={selectedItem.status}
                statusMap="reimbursementStatus"
              />
            </Box>
          </Box>

          {selectedItem.description && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Description
              </Typography>
              <Typography variant="body2">
                {selectedItem.description}
              </Typography>
            </Box>
          )}
        </FormSection>

        {/* Amounts */}
        <FormSection title="Amount Summary">
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary">
                Total Claimed
              </Typography>
              <Typography variant="h6" fontWeight="bold">
                <TCurrency value={selectedItem.total_amount} />
              </Typography>
            </Box>
            {selectedItem.approved_amount != null && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Approved Amount
                </Typography>
                <Typography variant="h6" color="success.main">
                  <TCurrency value={selectedItem.approved_amount} />
                </Typography>
              </Box>
            )}
            {selectedItem.paid_amount != null && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Paid Amount
                </Typography>
                <Typography variant="h6" color="primary.main">
                  <TCurrency value={selectedItem.paid_amount} />
                </Typography>
              </Box>
            )}
          </Box>
        </FormSection>

        {/* Line Items Table */}
        <FormSection title="Expense Items">
          <Table size="small" sx={modernTableStyles}>
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Expense Type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Receipt No</TableCell>
                <TableCell>Receipt Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(selectedItem.items || []).map((item, idx) => (
                <TableRow key={item.id || idx}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell sx={{ textTransform: "capitalize" }}>
                    {REIMBURSEMENT_EXPENSE_TYPES.find(
                      (t) => t.value === item.expense_type,
                    )?.label || item.expense_type}
                  </TableCell>
                  <TableCell>{item.item_description || "-"}</TableCell>
                  <TableCell align="right">
                    <TCurrency value={item.amount} />
                  </TableCell>
                  <TableCell>{item.receipt_number || "-"}</TableCell>
                  <TableCell>
                    {item.receipt_date
                      ? new Date(item.receipt_date).toLocaleDateString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {(!selectedItem.items || selectedItem.items.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary">
                      No expense items
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </FormSection>

        {/* Approval/Verification/Payment Info */}
        {(selectedItem.approved_date ||
          selectedItem.rejection_reason ||
          selectedItem.verified_date ||
          selectedItem.payment_date) && (
          <FormSection title="Workflow History">
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 2,
              }}
            >
              {selectedItem.approved_date && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Approved Date
                  </Typography>
                  <Typography variant="body2">
                    {new Date(selectedItem.approved_date).toLocaleString()}
                  </Typography>
                </Box>
              )}
              {selectedItem.rejection_reason && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Rejection Reason
                  </Typography>
                  <Typography variant="body2" color="error.main">
                    {selectedItem.rejection_reason}
                  </Typography>
                </Box>
              )}
              {selectedItem.verified_date && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Verified Date
                  </Typography>
                  <Typography variant="body2">
                    {new Date(selectedItem.verified_date).toLocaleString()}
                  </Typography>
                </Box>
              )}
              {selectedItem.payment_date && (
                <>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Payment Date
                    </Typography>
                    <Typography variant="body2">
                      {new Date(selectedItem.payment_date).toLocaleString()}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Payment Method
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ textTransform: "capitalize" }}
                    >
                      {REIMBURSEMENT_PAYMENT_METHODS.find(
                        (m) => m.value === selectedItem.payment_method,
                      )?.label || selectedItem.payment_method}
                    </Typography>
                  </Box>
                  {selectedItem.payment_reference && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Payment Reference
                      </Typography>
                      <Typography variant="body2">
                        {selectedItem.payment_reference}
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          </FormSection>
        )}

        {selectedItem.remark && (
          <FormSection title="Remarks">
            <Typography variant="body2">{selectedItem.remark}</Typography>
          </FormSection>
        )}

        {/* Record Information */}
        <FormSection title="Record Information" columns={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Created
            </Typography>
            <Typography variant="body2">
              {formatDateTimeReadable(selectedItem.created_at) || "-"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Last Modified
            </Typography>
            <Typography variant="body2">
              {formatDateTimeReadable(selectedItem.updated_at) || "-"}
            </Typography>
          </Box>
        </FormSection>
      </Box>
    );
  };

  // ---------------------------------------------------------------------------
  // RENDER: Create Form
  // ---------------------------------------------------------------------------
  const renderCreateForm = () => (
    <Box>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR" },
          { label: "Reimbursements", href: "/hr/reimbursements" },
          { label: "New Claim" },
        ]}
        title="New Reimbursement Claim"
        titleIcon={<ReceiptIcon color="primary" />}
      />

      <FormSection title="Claim Information">
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 2,
          }}
        >
          <TextField
            select
            label="Employee"
            value={formData.employee_id}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, employee_id: e.target.value }))
            }
            required
            size="small"
            fullWidth
          >
            {employees.map((emp: any) => (
              <MenuItem key={emp.employee_id} value={emp.employee_id}>
                {emp.first_name} {emp.last_name} ({emp.employee_id})
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Branch"
            value={formData.branch_code}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, branch_code: e.target.value }))
            }
            required
            size="small"
            fullWidth
          >
            {branches.map((b: any) => (
              <MenuItem key={b.branch_code} value={b.branch_code}>
                {b.branch_name || b.branch_code}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Claim Date"
            type="date"
            value={formData.claim_date}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, claim_date: e.target.value }))
            }
            required
            size="small"
            fullWidth
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            select
            label="Reimbursement Type"
            value={formData.reimbursement_type}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                reimbursement_type: e.target.value,
              }))
            }
            size="small"
            fullWidth
          >
            {REIMBURSEMENT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ gridColumn: "span 2" }}>
            <TextField
              label="Description"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              size="small"
              fullWidth
              multiline
              rows={2}
            />
          </Box>

          <Box sx={{ gridColumn: "span 2" }}>
            <TextField
              label="Remarks"
              value={formData.remark}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, remark: e.target.value }))
              }
              size="small"
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </Box>
      </FormSection>

      {/* Line Items */}
      <Box sx={{ mb: 2 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1,
          }}
        >
          <Typography variant="subtitle2">Expense Items</Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={addLineItem}>
            Add Item
          </Button>
        </Box>
        <FormSection title="">
          <Table size="small" sx={modernTableStyles}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 40 }}>#</TableCell>
                <TableCell sx={{ width: 160 }}>Type</TableCell>
                <TableCell>Description</TableCell>
                <TableCell sx={{ width: 120 }} align="right">
                  Amount
                </TableCell>
                <TableCell sx={{ width: 130 }}>Receipt No</TableCell>
                <TableCell sx={{ width: 140 }}>Receipt Date</TableCell>
                <TableCell sx={{ width: 50 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lineItems.map((item, idx) => (
                <TableRow key={item._id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={item.expense_type}
                      onChange={(e) =>
                        updateLineItem(item._id, "expense_type", e.target.value)
                      }
                      fullWidth
                      variant="standard"
                    >
                      {REIMBURSEMENT_EXPENSE_TYPES.map((t) => (
                        <MenuItem key={t.value} value={t.value}>
                          {t.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={item.item_description}
                      onChange={(e) =>
                        updateLineItem(
                          item._id,
                          "item_description",
                          e.target.value,
                        )
                      }
                      fullWidth
                      variant="standard"
                      placeholder="Description..."
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      type="number"
                      value={item.amount}
                      onChange={(e) =>
                        updateLineItem(
                          item._id,
                          "amount",
                          Number(e.target.value),
                        )
                      }
                      fullWidth
                      variant="standard"
                      inputProps={{ step: "0.01", min: 0 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={item.receipt_number}
                      onChange={(e) =>
                        updateLineItem(
                          item._id,
                          "receipt_number",
                          e.target.value,
                        )
                      }
                      fullWidth
                      variant="standard"
                      placeholder="Receipt #"
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      type="date"
                      value={item.receipt_date}
                      onChange={(e) =>
                        updateLineItem(item._id, "receipt_date", e.target.value)
                      }
                      fullWidth
                      variant="standard"
                      InputLabelProps={{ shrink: true }}
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeLineItem(item._id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {lineItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ py: 2 }}
                    >
                      No items yet. Click &ldquo;Add Item&rdquo; to add expense
                      items.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {lineItems.length > 0 && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                mt: 1,
                pr: 1,
              }}
            >
              <Typography variant="subtitle1" fontWeight="bold">
                Total: <TCurrency value={lineItemsTotal} />
              </Typography>
            </Box>
          )}
        </FormSection>
      </Box>

      {/* Form Actions */}
      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
        <Button
          variant="outlined"
          onClick={() => handleCancel(reimbursements || [])}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={createMutation.isPending}
          startIcon={<ReceiptIcon />}
        >
          {createMutation.isPending ? "Submitting..." : "Submit Claim"}
        </Button>
      </Box>
    </Box>
  );

  // ---------------------------------------------------------------------------
  // RENDER: Main Layout
  // ---------------------------------------------------------------------------
  return (
    <>
      <MasterDetailLayout
        title="Employee Reimbursements"
        icon={<ReceiptIcon />}
        masterPanel={renderListPanel()}
        detailPanel={isCreating ? renderCreateForm() : renderDetailView()}
      />

      {/* ---- APPROVE DIALOG ---- */}
      <Dialog
        open={approveDialogOpen}
        onClose={() => setApproveDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Approve Reimbursement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Claimed amount:{" "}
            <strong>
              Rs.{" "}
              {Number(selectedItem?.total_amount || 0).toLocaleString("en-LK", {
                minimumFractionDigits: 2,
              })}
            </strong>
          </Typography>
          <TextField
            label="Approved Amount"
            type="number"
            value={approveAmount}
            onChange={(e) => setApproveAmount(e.target.value)}
            fullWidth
            size="small"
            inputProps={{ step: "0.01", min: 0 }}
            helperText="Leave as-is for full approval, or reduce for partial approval"
            sx={{ mb: 2 }}
          />
          <TextField
            label="Remarks (optional)"
            value={approveRemarks}
            onChange={(e) => setApproveRemarks(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            disabled={approveMutation.isPending}
            onClick={() => {
              if (!selectedItem) return;
              approveMutation.mutate({
                id: selectedItem.id,
                data: {
                  approved_amount: approveAmount
                    ? Number(approveAmount)
                    : undefined,
                  remarks: approveRemarks || undefined,
                },
              });
            }}
          >
            {approveMutation.isPending ? "Approving..." : "Approve"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- REJECT DIALOG ---- */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject Reimbursement</DialogTitle>
        <DialogContent>
          <TextField
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={3}
            required
            error={!rejectReason}
            helperText="Reason is required for rejection"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={rejectMutation.isPending || !rejectReason}
            onClick={() => {
              if (!selectedItem) return;
              rejectMutation.mutate({
                id: selectedItem.id,
                data: { rejection_reason: rejectReason },
              });
            }}
          >
            {rejectMutation.isPending ? "Rejecting..." : "Reject"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- VERIFY DIALOG ---- */}
      <Dialog
        open={verifyDialogOpen}
        onClose={() => setVerifyDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Finance Verification</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Verify receipts and amounts for {selectedItem?.reimbursement_no}
          </Typography>
          <TextField
            label="Verification Remarks (optional)"
            value={verifyRemarks}
            onChange={(e) => setVerifyRemarks(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerifyDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="info"
            disabled={verifyMutation.isPending}
            onClick={() => {
              if (!selectedItem) return;
              verifyMutation.mutate({
                id: selectedItem.id,
                data: { remarks: verifyRemarks || undefined },
              });
            }}
          >
            {verifyMutation.isPending ? "Verifying..." : "Verify"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- PAYMENT DIALOG ---- */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Process Payment</DialogTitle>
        <DialogContent>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 2,
              mt: 1,
            }}
          >
            <TextField
              select
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              fullWidth
              size="small"
              required
            >
              {REIMBURSEMENT_PAYMENT_METHODS.map((m) => (
                <MenuItem key={m.value} value={m.value}>
                  {m.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Payment Reference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              fullWidth
              size="small"
              placeholder="e.g. TXN-12345"
            />
            <TextField
              label="Paid Amount"
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              fullWidth
              size="small"
              required
              inputProps={{ step: "0.01", min: 0 }}
            />
            <Box />
            <Box sx={{ gridColumn: "span 2" }}>
              <TextField
                label="Payment Remarks (optional)"
                value={paymentRemarks}
                onChange={(e) => setPaymentRemarks(e.target.value)}
                fullWidth
                size="small"
                multiline
                rows={2}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={paymentMutation.isPending || !paymentAmount}
            onClick={() => {
              if (!selectedItem) return;
              paymentMutation.mutate({
                id: selectedItem.id,
                data: {
                  payment_method: paymentMethod,
                  payment_reference: paymentReference || undefined,
                  paid_amount: Number(paymentAmount),
                  remarks: paymentRemarks || undefined,
                },
              });
            }}
          >
            {paymentMutation.isPending ? "Processing..." : "Process Payment"}
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
