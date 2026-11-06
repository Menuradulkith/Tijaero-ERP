/**
 * ReimbursementsPage - Employee Reimbursement Processing
 * Full 8-step workflow: Submit → Items → Receipts → Review → Approve/Reject → Verify → Pay → Complete
 * Uses Tijaero component library for consistent ERP UI.
 */

import { formatDate, formatDateTimeReadable } from "@/utils/formatters";
import {
    Add as AddIcon,
    CheckCircle as ApproveIcon,
    Delete as DeleteIcon,
    Payment as PaymentIcon,
    Receipt as ReceiptIcon,
    Cancel as RejectIcon,
    Verified as VerifyIcon,
    Search as SearchIcon,
    ArrowBack as ArrowBackIcon,
    OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
    Box,
    Button,
    IconButton,
    InputAdornment,
    MenuItem,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Tijaero components
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    FormSection,
    getStatusProps,
    handleApiError,
    MasterDetailLayout,
    modernTableStyles,
    REIMBURSEMENT_EXPENSE_TYPES,
    REIMBURSEMENT_PAYMENT_METHODS,
    REIMBURSEMENT_STATUS_FILTER_OPTIONS,
    REIMBURSEMENT_TYPES,
    showErrorToast,
    showSuccessToast,
    TBranchFilter,
    TConfirmDialog,
    TCurrency,
    TDataGrid,
    type TDataGridColumn,
    TSidePanel,
    TStatusChip,
    TStatusFilter,
    useConfirmDialog,
    useMasterDetailState,
    fmtLKR,
    TRemarkField,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { reimbursementsApi } from "@/modules/hr/api";
import { usePermission } from "@/auth/permissions";
import type {
    Reimbursement,
    ReimbursementCreate,
    ReimbursementItemCreate,
} from "@/modules/hr/types";
import { useCurrencyStore } from "@/state/currencyStore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_LINE_AMOUNT = 999_999_999.99;
const lineAmountError = (v: number | string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount above zero";
  if (n > MAX_LINE_AMOUNT) return "Amount is too large";
  return null;
};

interface ReimbursementFormData extends ReimbursementCreate {
  status?: string;
}

const INITIAL_FORM_DATA: ReimbursementFormData = {
  employee_id: "",
  branch_code: "",
  claim_date: formatDate(new Date()),   // local date (toISOString is UTC: yesterday before 05:30 in Sri Lanka)
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
  // approve / verify / pay need reimbursement_approvals:approve on the server; delete needs reimbursements:delete
  const canResolve = usePermission("reimbursement_approvals", "approve");
  const canRemove = usePermission("reimbursements", "delete");
  const confirmDialog = useConfirmDialog();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  // Filter states - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterBranch(null);
    setFilterStatus(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    selectedItem,
    setSelectedItem,
    isCreating,
    setIsCreating,
    setIsEditing,
    formData,
    setFormData,
    handleSelectItem,
    handleNew,
  } = useMasterDetailState<Reimbursement, ReimbursementFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
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
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
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
  // Cancelling out of "New Claim" should return to the browse table, not
  // auto-open the first reimbursement the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here).
  const handleCancel = useCallback(() => {
    setIsCreating(false);
    setIsEditing(false);
    setSelectedItem(null);
    setLineItems([]);
  }, [setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToReimbursements = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // Tracks the most recently requested reimbursement so a slower, stale
  // response (e.g. switching from A to B before A's request resolves) can't
  // overwrite the currently-selected claim's detail/line items.
  const latestReimbursementRequestRef = useRef<number | null>(null);

  const handleSelectReimbursement = useCallback(
    async (item: Reimbursement) => {
      const selected = await handleSelectItem(item);
      if (!selected) return;
      latestReimbursementRequestRef.current = item.id;
      try {
        const detail = await reimbursementsApi.getById(item.id);
        if (latestReimbursementRequestRef.current !== item.id) return;
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
        if (latestReimbursementRequestRef.current !== item.id) return;
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
  const savingRef = useRef(false);
  const handleSave = () => {
    if (createMutation.isPending || savingRef.current) return;
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      items: lineItems.map(({ _id, ...rest }) => ({
        ...rest,
        amount: Number(rest.amount),
        receipt_date: rest.receipt_date || undefined,
        receipt_number: rest.receipt_number || undefined,
      })),
    };
    savingRef.current = true;
    createMutation.mutate(payload, { onSettled: () => { savingRef.current = false; } });
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
    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.claim_date || "").getTime() - new Date(a.claim_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [reimbursements, searchQuery, filterBranch, filterStatus]);

  // Whether we're showing a single reimbursement's detail view (selected or
  // being created) instead of the browse table.
  const isReimbursementDetailMode = !!selectedItem || isCreating;

  // The table sorts by whichever column the user clicks via the grid's own
  // column-header menu, not a separate "Sort by" control.
  const reimbursementColumns: TDataGridColumn<Reimbursement>[] = useMemo(
    () => [
      { field: "reimbursement_no", header: "Claim No", width: 130 },
      {
        field: "employee_name",
        header: "Employee",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<Reimbursement>) =>
          params.row.employee_name || params.row.employee_id,
      },
      {
        field: "reimbursement_type",
        header: "Category",
        width: 130,
        renderCell: (params: GridRenderCellParams<Reimbursement>) =>
          REIMBURSEMENT_TYPES.find((t) => t.value === params.row.reimbursement_type)?.label ||
          params.row.reimbursement_type,
      },
      {
        field: "claim_date",
        header: "Date",
        width: 120,
        renderCell: (params: GridRenderCellParams<Reimbursement>) =>
          params.row.claim_date ? new Date(params.row.claim_date).toLocaleDateString() : "-",
      },
      {
        field: "total_amount",
        header: "Amount",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<Reimbursement>) => (
          <TCurrency value={params.row.total_amount} />
        ),
      },
      {
        field: "status",
        header: "Status",
        width: 140,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Reimbursement>) => (
          <TStatusChip status={params.row.status} statusMap="reimbursementStatus" size="small" />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<Reimbursement>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectReimbursement(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectReimbursement]
  );

  // ---------------------------------------------------------------------------
  // RENDER: Browse Table
  // ---------------------------------------------------------------------------
  const renderTablePanel = () => (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Reimbursement>
          rows={filteredItems}
          columns={reimbursementColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectReimbursement(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No reimbursement claims found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // ---------------------------------------------------------------------------
  // RENDER: Detail body (view mode)
  // ---------------------------------------------------------------------------
  const renderDetailBody = (item: Reimbursement) => (
    <>
      {/* Claim Details */}
      <FormSection title="Claim Details" columns={1}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              Claim No
            </Typography>
            <Typography variant="body2">{item.reimbursement_no}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Employee
            </Typography>
            <Typography variant="body2">
              {item.employee_name || item.employee_id}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Branch
            </Typography>
            <Typography variant="body2">
              {item.branch_name || item.branch_code}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Claim Date
            </Typography>
            <Typography variant="body2">
              {item.claim_date
                ? new Date(item.claim_date).toLocaleDateString()
                : "-"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Type
            </Typography>
            <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
              {REIMBURSEMENT_TYPES.find(
                (t) => t.value === item.reimbursement_type,
              )?.label || item.reimbursement_type}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Status
            </Typography>
            <Box>
              <TStatusChip status={item.status} statusMap="reimbursementStatus" />
            </Box>
          </Box>
        </Box>

        {item.description && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Description
            </Typography>
            <Typography variant="body2">{item.description}</Typography>
          </Box>
        )}
      </FormSection>

      {/* Amounts */}
      <FormSection title="Amount Summary" columns={3}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Total Claimed
          </Typography>
          <Typography variant="h6" fontWeight="bold">
            <TCurrency value={item.total_amount} />
          </Typography>
        </Box>
        {item.approved_amount != null && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Approved Amount
            </Typography>
            <Typography variant="h6" color="success.main">
              <TCurrency value={item.approved_amount} />
            </Typography>
          </Box>
        )}
        {item.paid_amount != null && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Paid Amount
            </Typography>
            <Typography variant="h6" color="primary.main">
              <TCurrency value={item.paid_amount} />
            </Typography>
          </Box>
        )}
      </FormSection>

      {/* Line Items Table */}
      <FormSection title="Expense Items" columns={1}>
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
            {(item.items || []).map((line, idx) => (
              <TableRow key={line.id || idx}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell sx={{ textTransform: "capitalize" }}>
                  {REIMBURSEMENT_EXPENSE_TYPES.find(
                    (t) => t.value === line.expense_type,
                  )?.label || line.expense_type}
                </TableCell>
                <TableCell>{line.item_description || "-"}</TableCell>
                <TableCell align="right">
                  <TCurrency value={Number(line.amount)} />
                </TableCell>
                <TableCell>{line.receipt_number || "-"}</TableCell>
                <TableCell>
                  {line.receipt_date
                    ? new Date(line.receipt_date).toLocaleDateString()
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
            {(!item.items || item.items.length === 0) && (
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
      {(item.approved_date ||
        item.rejection_reason ||
        item.verified_date ||
        item.payment_date) && (
        <FormSection title="Workflow History">
          {item.approved_date && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Approved Date
              </Typography>
              <Typography variant="body2">
                {new Date(item.approved_date).toLocaleString()}
              </Typography>
            </Box>
          )}
          {item.rejection_reason && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Rejection Reason
              </Typography>
              <Typography variant="body2" color="error.main">
                {item.rejection_reason}
              </Typography>
            </Box>
          )}
          {item.verified_date && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Verified Date
              </Typography>
              <Typography variant="body2">
                {new Date(item.verified_date).toLocaleString()}
              </Typography>
            </Box>
          )}
          {item.payment_date && (
            <>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Payment Date
                </Typography>
                <Typography variant="body2">
                  {new Date(item.payment_date).toLocaleString()}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Payment Method
                </Typography>
                <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                  {REIMBURSEMENT_PAYMENT_METHODS.find(
                    (m) => m.value === item.payment_method,
                  )?.label || item.payment_method}
                </Typography>
              </Box>
              {item.payment_reference && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Payment Reference
                  </Typography>
                  <Typography variant="body2">{item.payment_reference}</Typography>
                </Box>
              )}
            </>
          )}
        </FormSection>
      )}

      {item.remark && (
        <FormSection title="Remarks" columns={1}>
          <Typography variant="body2">{item.remark}</Typography>
        </FormSection>
      )}

      {/* Activity History */}
      <FormSection title="Activity History" columns={2} isLast>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Created
          </Typography>
          <Typography variant="body2">
            {formatDateTimeReadable(item.created_at) || "-"}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Last Modified
          </Typography>
          <Typography variant="body2">
            {formatDateTimeReadable(item.updated_at) || "-"}
          </Typography>
        </Box>
      </FormSection>
    </>
  );

  // ---------------------------------------------------------------------------
  // RENDER: Create body (full-page "New Claim")
  // ---------------------------------------------------------------------------
  const renderCreateBody = () => (
    <>
      <FormSection title="Claim Information">
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
          {employees.map((emp) => (
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
          {branches.map((b) => (
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

        <Box sx={{ gridColumn: "1 / -1" }}>
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

        <Box sx={{ gridColumn: "1 / -1" }}>
          <TRemarkField
            label="Remarks"
            value={formData.remark}
            onChange={(value) =>
              setFormData((prev) => ({ ...prev, remark: value }))
            }
            size="small"
            fullWidth
            multiline
            rows={2}
          />
        </Box>
      </FormSection>

      {/* Line Items */}
      <FormSection
        title="Expense Items"
        columns={1}
        isLast
        titleAction={
          <Button size="small" startIcon={<AddIcon />} onClick={addLineItem} disabled={createMutation.isPending}>
            Add Item
          </Button>
        }
      >
        <Box>
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
                        updateLineItem(item._id, "item_description", e.target.value)
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
                      value={Number(item.amount)}
                      onChange={(e) =>
                        updateLineItem(item._id, "amount", Number(e.target.value))
                      }
                      fullWidth
                      variant="standard"
                      inputProps={{ step: "0.01", min: 0.01, max: MAX_LINE_AMOUNT }}
                      error={Number(item.amount) !== 0 && Boolean(lineAmountError(item.amount))}
                      helperText={Number(item.amount) !== 0 ? lineAmountError(item.amount) ?? undefined : undefined}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={item.receipt_number}
                      onChange={(e) =>
                        updateLineItem(item._id, "receipt_number", e.target.value)
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
                      disabled={createMutation.isPending}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {lineItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No items yet. Click &ldquo;Add Item&rdquo; to add expense
                      items.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {lineItems.length > 0 && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1, pr: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                Total: <TCurrency value={lineItemsTotal} />
              </Typography>
            </Box>
          )}
        </Box>
      </FormSection>
    </>
  );

  // ---------------------------------------------------------------------------
  // RENDER: Detail / Create page (header + toolbar + scrollable body)
  // ---------------------------------------------------------------------------
  const renderDetailPanel = () => {
    if (!selectedItem && !isCreating) {
      return <EmptyState message="Select a reimbursement claim to view details" />;
    }

    const status = selectedItem?.status || "";
    const canApprove = canResolve && !isCreating && status === "pending";
    const canVerify = canResolve && !isCreating && ["approved", "partial_approved"].includes(status);
    const canPay = canResolve && !isCreating && status === "verified";
    const canDelete = canRemove && !isCreating && ["pending", "rejected"].includes(status);
    const anyWorkflowPending =
      approveMutation.isPending ||
      rejectMutation.isPending ||
      verifyMutation.isPending ||
      paymentMutation.isPending ||
      deleteMutation.isPending;

    const statusProps = selectedItem
      ? getStatusProps(selectedItem.status, "reimbursementStatus")
      : null;

    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          breadcrumbs={[
            { label: "HR" },
            { label: "Reimbursements", href: "/hr/reimbursements" },
            { label: isCreating ? "New Claim" : selectedItem?.reimbursement_no || "" },
          ]}
          title={selectedItem && !isCreating ? selectedItem.reimbursement_no : ""}
          titleIcon={<ReceiptIcon color="primary" />}
          isCreating={isCreating}
          createTitle="New Reimbursement Claim"
          noSelectionTitle="Select a Reimbursement"
          chips={
            statusProps && !isCreating
              ? [{ label: statusProps.label, color: statusProps.color }]
              : []
          }
        />

        <ActionToolbar
          hasSelectedItem={!!selectedItem}
          isCreating={isCreating}
          isEditing={false}
          isSaving={createMutation.isPending}
          isFormValid={!!formData.employee_id && !!formData.branch_code && !lineItems.some((i) => lineAmountError(i.amount))}
          canCreate={false}
          canUpdate={false}
          canDelete={false}
          canDuplicate={false}
          onSave={isCreating ? handleSave : undefined}
          onCancel={isCreating ? handleCancel : undefined}
          endActions={
            !isCreating && selectedItem && (canApprove || canVerify || canPay || canDelete) ? (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {canApprove && (
                  <>
                    <Button
                      size="small"
                      color="success"
                      variant="contained"
                      startIcon={<ApproveIcon />}
                      onClick={openApproveDialog}
                      disabled={anyWorkflowPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      startIcon={<RejectIcon />}
                      onClick={openRejectDialog}
                      disabled={anyWorkflowPending}
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
                    disabled={anyWorkflowPending}
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
                    disabled={anyWorkflowPending}
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
                    disabled={anyWorkflowPending}
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Delete"}
                  </Button>
                )}
              </Box>
            ) : undefined
          }
        />

        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {isCreating ? renderCreateBody() : selectedItem ? renderDetailBody(selectedItem) : null}
        </Box>
      </Box>
    );
  };

  // ---------------------------------------------------------------------------
  // RENDER: Main Layout
  // ---------------------------------------------------------------------------
  return (
    <>
      <MasterDetailLayout
        title="Employee Reimbursements"
        icon={<ReceiptIcon />}
        titleSlot={
          isReimbursementDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={handleBackToReimbursements}
              sx={{ textTransform: "none" }}
              disabled={createMutation.isPending}
            >
              Back to Reimbursements
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search by no, employee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  placeholder="All Branches"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TStatusFilter
                  options={REIMBURSEMENT_STATUS_FILTER_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Statuses"
                  size="small"
                />
              </Box>
              {(searchQuery || filterBranch || filterStatus) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          isReimbursementDetailMode ? undefined : (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleNew}
              sx={{ mr: 1 }}
            >
              Add Reimbursement
            </Button>
          )
        }
      >
        {isReimbursementDetailMode ? renderDetailPanel() : renderTablePanel()}
      </MasterDetailLayout>

      {/* ---- APPROVE PANEL ---- */}
      <TSidePanel
        open={approveDialogOpen}
        onClose={() => setApproveDialogOpen(false)}
        title="Approve Reimbursement"
        submitText="Approve"
        isSubmitting={approveMutation.isPending}
        submitDisabled={approveMutation.isPending}
        onSubmit={() => {
          if (!selectedItem || approveMutation.isPending) return;
          approveMutation.mutate({
            id: selectedItem.id,
            data: {
              approved_amount: approveAmount ? Number(approveAmount) : undefined,
              remarks: approveRemarks || undefined,
            },
          });
        }}
      >
        <FormSection title="Approval" columns={1} isLast>
          <Typography variant="body2">
            Claimed amount:{" "}
            <strong>
              {currencySymbol} {fmtLKR(selectedItem?.total_amount || 0)}
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
          />
          <TRemarkField
            label="Remarks (optional)"
            value={approveRemarks}
            onChange={(value) => setApproveRemarks(value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
        </FormSection>
      </TSidePanel>

      {/* ---- REJECT PANEL ---- */}
      <TSidePanel
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title="Reject Reimbursement"
        submitText="Reject"
        isSubmitting={rejectMutation.isPending}
        submitDisabled={rejectMutation.isPending || !rejectReason}
        onSubmit={() => {
          if (!selectedItem || rejectMutation.isPending || !rejectReason) return;
          rejectMutation.mutate({
            id: selectedItem.id,
            data: { rejection_reason: rejectReason },
          });
        }}
      >
        <FormSection title="Rejection" columns={1} isLast>
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
          />
        </FormSection>
      </TSidePanel>

      {/* ---- VERIFY PANEL ---- */}
      <TSidePanel
        open={verifyDialogOpen}
        onClose={() => setVerifyDialogOpen(false)}
        title="Finance Verification"
        submitText="Verify"
        isSubmitting={verifyMutation.isPending}
        submitDisabled={verifyMutation.isPending}
        onSubmit={() => {
          if (!selectedItem || verifyMutation.isPending) return;
          verifyMutation.mutate({
            id: selectedItem.id,
            data: { remarks: verifyRemarks || undefined },
          });
        }}
      >
        <FormSection title="Verification" columns={1} isLast>
          <Typography variant="body2">
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
          />
        </FormSection>
      </TSidePanel>

      {/* ---- PAYMENT PANEL ---- */}
      <TSidePanel
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        title="Process Payment"
        submitText="Process Payment"
        isSubmitting={paymentMutation.isPending}
        submitDisabled={paymentMutation.isPending || !paymentAmount}
        onSubmit={() => {
          if (!selectedItem || paymentMutation.isPending || !paymentAmount) return;
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
        <FormSection title="Payment Details" columns={1} isLast>
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
          <TextField
            label="Payment Remarks (optional)"
            value={paymentRemarks}
            onChange={(e) => setPaymentRemarks(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
        </FormSection>
      </TSidePanel>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
