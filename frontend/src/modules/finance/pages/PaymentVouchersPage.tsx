/**
 * PaymentVouchersPage - Payment voucher management
 * Handles creation, approval, and payment of vouchers
 *
 * Same layout as the purchasing / sales pages: a full-width list with filters,
 * a full-page detail with breadcrumb and actions, and a full-page create form.
 */

import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  getStatusProps,
  MasterDetailLayout,
  showErrorToast,
  TCurrency,
  TDataGrid,
  type TDataGridColumn,
  TDate,
  TSearchableSelect,
  useRecordParam,
  TDatePicker,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CancelIcon from "@mui/icons-material/Cancel";
import ReceiptIcon from "@mui/icons-material/Receipt";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { format } from "date-fns";
import { useMemo, useState } from "react";

type Voucher = {
  id: number;
  voucher_no: string;
  branch_code: string;
  payee_name: string;
  amount: number;
  status: string;
  created_date: string;
  category: string;
  created_by: string;
  paid_date?: string;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "default" as const },
  { value: "approved", label: "Approved", color: "success" as const },
  { value: "paid", label: "Paid", color: "primary" as const },
  { value: "rejected", label: "Rejected", color: "error" as const },
];

const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Payment Vouchers", href: "/finance/payment-vouchers" },
];

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentVouchersPage() {
  const canCreate = usePermission("payment_voucher", "create");
  const { filteredBranches, defaultBranchCode } = useReferenceData();

  // UI State
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dialog states
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState(false);

  // Form states
  const emptyForm = () => ({
    // The user's own branch, or blank for all-branch users: never silently the first branch.
    branch_code: defaultBranchCode ?? "",
    payee_name: "",
    amount: 0,
    payment_date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    category: "general",
  });
  const [formData, setFormData] = useState(emptyForm);

  const [approvalNotes, setApprovalNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Payment Vouchers has no backend yet (no model / API / migration). This
  // screen is a placeholder: it must NOT show fabricated rows or pretend that
  // create/approve/reject/pay succeeded. Keep the list empty until the API
  // exists, and surface the not-implemented state to the user (banner below).
  const NOT_IMPLEMENTED_MSG =
    "Payment Vouchers isn't available yet — this screen is a placeholder and nothing was saved.";
  const mockVouchers: Voucher[] = [];

  // Filter vouchers
  const filteredVouchers = useMemo(() => {
    return mockVouchers.filter((voucher) => {
      const matchesSearch =
        voucher.voucher_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        voucher.payee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        voucher.branch_code.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = !statusFilter || voucher.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [searchTerm, statusFilter]);

  const selectedVoucher = mockVouchers.find((v) => v.id === selectedVoucherId);

  const back = () => {
    setSelectedVoucherId(null);
    setCreating(false);
    setFormData(emptyForm());
  };

  // Handlers
  const handleCreateVoucher = async () => {
    if (!formData.payee_name) {
      showErrorToast("Payee name is required");
      return;
    }
    if (!formData.amount || formData.amount <= 0) {
      showErrorToast("Amount must be greater than 0");
      return;
    }

    // No backend — do not fake success.
    showErrorToast(NOT_IMPLEMENTED_MSG);
    setCreating(false);
  };

  const handleApproveVoucher = async () => {
    showErrorToast(NOT_IMPLEMENTED_MSG);
    setShowApproveDialog(false);
  };

  const handleRejectVoucher = async () => {
    showErrorToast(NOT_IMPLEMENTED_MSG);
    setShowRejectDialog(false);
  };

  const handlePayVoucher = async () => {
    showErrorToast(NOT_IMPLEMENTED_MSG);
    setShowPayDialog(false);
  };

  const detailMode = creating || !!selectedVoucher;
  const createValid = !!formData.payee_name && !!formData.amount && formData.amount > 0;

  const columns: TDataGridColumn<Voucher>[] = [
    { field: "voucher_no", header: "Voucher No", minWidth: 150, flex: 1 },
    { field: "created_date", header: "Date", width: 120, type: "date" },
    { field: "payee_name", header: "Payee", minWidth: 180, flex: 1.4 },
    { field: "category", header: "Category", minWidth: 130, flex: 1 },
    { field: "branch_code", header: "Branch", width: 120 },
    { field: "amount", header: "Amount", width: 130, type: "currency", align: "right", headerAlign: "right" },
    { field: "status", header: "Status", width: 120, type: "status", statusMap: "expenseStatus" },
  ];

  const notImplementedBanner = (
    <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
      Payment Vouchers is not yet implemented. This screen is a placeholder — no vouchers are stored and the actions
      here do not save anything.
    </Alert>
  );

  const createForm = (
    <>
      {notImplementedBanner}
      <FormSection title="Voucher" columns={3}>
        <TextField
          label="Branch"
          select
          size="small"
          value={formData.branch_code}
          onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
        >
          {filteredBranches.map((branch) => (
            <MenuItem key={branch.branch_code} value={branch.branch_code}>
              {branch.branch_name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Payee Name"
          size="small"
          required
          value={formData.payee_name}
          onChange={(e) => setFormData({ ...formData, payee_name: e.target.value })}
        />
        <TextField
          label="Amount"
          type="number"
          size="small"
          required
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
          inputProps={{ step: "0.01", min: "0" }}
        />
        <TextField
          label="Category"
          select
          size="small"
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
        >
          <MenuItem value="general">General</MenuItem>
          <MenuItem value="supplies">Supplies</MenuItem>
          <MenuItem value="maintenance">Maintenance</MenuItem>
          <MenuItem value="utilities">Utilities</MenuItem>
          <MenuItem value="travel">Travel</MenuItem>
          <MenuItem value="other">Other</MenuItem>
        </TextField>
        <TDatePicker
          label="Payment Date"
          size="small"
          value={formData.payment_date}
          onChange={(v) => setFormData({ ...formData, payment_date: v ?? "" })}
        />
      </FormSection>
      <FormSection title="Description" columns={1}>
        <TextField
          label="Description"
          size="small"
          multiline
          rows={3}
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      </FormSection>
    </>
  );

  const viewDetail = selectedVoucher && (
    <>
      <FormSection title="Voucher Information" columns={3}>
        <TextField label="Voucher No" size="small" value={selectedVoucher.voucher_no} disabled />
        <TextField label="Date" size="small" value={selectedVoucher.created_date} disabled />
        <TextField label="Branch" size="small" value={selectedVoucher.branch_code} disabled />
        <TextField label="Payee Name" size="small" value={selectedVoucher.payee_name} disabled />
        <TextField label="Amount" size="small" value={fmt(selectedVoucher.amount)} disabled />
        <TextField label="Category" size="small" value={selectedVoucher.category} disabled />
        <TextField label="Created By" size="small" value={selectedVoucher.created_by} disabled />
      </FormSection>
      {selectedVoucher.status === "paid" && (
        <Alert severity="success" variant="outlined">
          Paid on <TDate value={selectedVoucher.paid_date || ""} />
        </Alert>
      )}
    </>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...BREADCRUMBS, { label: creating ? "New Voucher" : selectedVoucher?.voucher_no ?? "" }]}
        title={selectedVoucher?.voucher_no ?? ""}
        titleIcon={<ReceiptIcon color="primary" />}
        isCreating={creating}
        createTitle="New Payment Voucher"
        noSelectionTitle="Select a voucher"
        chips={selectedVoucher && !creating ? [getStatusProps(selectedVoucher.status, "expenseStatus")] : []}
      />
      <ActionToolbar
        hasSelectedItem={!!selectedVoucher}
        isCreating={creating}
        isEditing={false}
        isSaving={isSubmitting}
        isFormValid={createValid}
        onSave={creating ? handleCreateVoucher : undefined}
        onCancel={creating ? back : undefined}
        endActions={
          !creating && selectedVoucher?.status === "pending" ? (
            <>
              <Button size="small" variant="outlined" color="success" onClick={() => setShowApproveDialog(true)}>
                Approve
              </Button>
              <Button size="small" variant="outlined" color="error" onClick={() => setShowRejectDialog(true)}>
                Reject
              </Button>
            </>
          ) : !creating && selectedVoucher?.status === "approved" ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setPaymentDate(format(new Date(), "yyyy-MM-dd"));
                setShowPayDialog(true);
              }}
            >
              Record Payment
            </Button>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{creating ? createForm : viewDetail}</Box>
    </Box>
  );

  const listPanel = (
    <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", p: 1.5, pb: 0 }}>
      {notImplementedBanner}
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Voucher>
          rows={filteredVouchers}
          columns={columns}
          onRowClick={(row) => setSelectedVoucherId(row.id)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="Payment Vouchers is not available yet."
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Open record lives in the URL (?id= / ?new=1): browser Back returns to the list.
  useRecordParam({
    current: selectedVoucher?.id,
    creating,
    items: mockVouchers,
    onOpen: (v) => {
      setCreating(false);
      setSelectedVoucherId(v.id);
    },
    onClose: back,
    onNew: canCreate ? () => {
      setFormData(emptyForm());
      setCreating(true);
    } : undefined,
  });

  return (
    <>
      <MasterDetailLayout
        title="Payment Vouchers"
        titleSlot={
          detailMode ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
              Back to Payment Vouchers
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search vouchers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as string | null)}
                  options={STATUS_OPTIONS}
                  showAllOption
                  allOptionLabel="All Statuses"
                  placeholder="Search status..."
                  size="small"
                />
              </Box>
              {(searchTerm || statusFilter) && (
                <Button
                  size="small"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter(null);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          !detailMode && canCreate ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                setFormData(emptyForm());
                setCreating(true);
              }}
              sx={{ mr: 1 }}
            >
              New Voucher
            </Button>
          ) : undefined
        }
      >
        {detailMode ? detailPanel : listPanel}
      </MasterDetailLayout>

      {/* Approve Dialog */}
      <Dialog
        open={showApproveDialog}
        onClose={() => setShowApproveDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Approve Voucher</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="Approval Notes"
            multiline
            rows={3}
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            placeholder="Optional approval notes..."
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setShowApproveDialog(false)}>Cancel</Button>
          <Button
            onClick={handleApproveVoucher}
            variant="contained"
            color="success"
            disabled={isSubmitting}
          >
            Approve
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={showRejectDialog}
        onClose={() => setShowRejectDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject Voucher</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="Rejection Reason"
            multiline
            rows={3}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Please provide a reason for rejection..."
            required
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setShowRejectDialog(false)}>Cancel</Button>
          <Button
            onClick={handleRejectVoucher}
            variant="contained"
            color="error"
            disabled={isSubmitting}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog
        open={showPayDialog}
        onClose={() => setShowPayDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Record Payment</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Amount: <TCurrency value={selectedVoucher?.amount} />
          </Typography>

          <TDatePicker
            fullWidth
            label="Payment Date"
            value={paymentDate}
            onChange={(v) => setPaymentDate(v ?? "")}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setShowPayDialog(false)}>Cancel</Button>
          <Button
            onClick={handlePayVoucher}
            variant="contained"
            disabled={isSubmitting}
          >
            Record Payment
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
