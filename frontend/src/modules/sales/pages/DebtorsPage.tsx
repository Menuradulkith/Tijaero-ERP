/**
 * Debtors Management Page
 * 
 * Allows sales officers to view debtors, check outstanding balances,
 * aging reports, and manage follow-ups with customers
 */

import React, { useState, useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  TextField,
  MenuItem,
  Typography,
  CircularProgress,
  Alert,
  Pagination,
  LinearProgress,
} from "@mui/material";
import {
  Call as CallIcon,
  Email as EmailIcon,
  FileDownload as FileDownloadIcon,
  Edit as EditIcon,
  Payment as PaymentIcon,
  Description as InvoiceIcon,
} from "@mui/icons-material";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MasterDetailLayout,
  ActionToolbar,
  showSuccessToast,
  showErrorToast,
  handleApiError,
} from "@/components/tijaero";
import { format, parse } from "date-fns";
import { debtorsApi } from "../api/debtors-api";
import {
  DebtorSummary,
  CustomerDebtDetails,
  DebtorSummaryRequest,
  FollowupRecord,
} from "../types/debtors";

const DEBTORS_STATUS_COLORS: Record<string, "success" | "warning" | "error"> = {
  current: "success",
  overdue: "warning",
  critical: "error",
};

const SORT_OPTIONS = [
  { value: "outstanding_balance", label: "Outstanding Balance (High to Low)" },
  { value: "days_overdue", label: "Days Overdue (Most)" },
  { value: "customer_name", label: "Customer Name (A-Z)" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Debtors" },
  { value: "current", label: "Current" },
  { value: "overdue", label: "Overdue" },
  { value: "critical", label: "Critical" },
];

export default function DebtorsPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "current" | "overdue" | "critical"
  >("all");
  const [sortBy, setSortBy] = useState<
    "outstanding_balance" | "days_overdue" | "customer_name"
  >("outstanding_balance");
  const [selectedDebtor, setSelectedDebtor] = useState<DebtorSummary | null>(
    null
  );
  const [showDetails, setShowDetails] = useState(false);
  const [showFollowupDialog, setShowFollowupDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  const ITEMS_PER_PAGE = 10;
  const skip = (page - 1) * ITEMS_PER_PAGE;

  // Fetch debtors list
  const debtorsQuery = useQuery({
    queryKey: [
      "debtors",
      statusFilter,
      sortBy,
      skip,
      ITEMS_PER_PAGE,
      searchQuery,
    ],
    queryFn: () =>
      debtorsApi.getDebtorsList({
        status_filter: statusFilter,
        sort_by: sortBy,
        sort_order: "desc",
        skip,
        limit: ITEMS_PER_PAGE,
      }),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch detailed debt info when debtor is selected
  const debtDetailsQuery = useQuery({
    queryKey: ["debtor-details", selectedDebtor?.customer_id],
    queryFn: () =>
      selectedDebtor
        ? debtorsApi.getCustomerDebtDetails(selectedDebtor.customer_id)
        : null,
    enabled: !!selectedDebtor && showDetails,
    staleTime: 1000 * 60 * 5,
  });

  // Mutations
  const followupMutation = useMutation({
    mutationFn: (followup: FollowupRecord) =>
      debtorsApi.saveFollowup(selectedDebtor!.customer_id, followup),
    onSuccess: () => {
      showSuccessToast("Follow-up saved successfully");
      setShowFollowupDialog(false);
      debtorsQuery.refetch();
    },
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to save follow-up"));
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (data: any) =>
      debtorsApi.recordPayment(selectedDebtor!.customer_id, data),
    onSuccess: () => {
      showSuccessToast("Payment recorded successfully");
      setShowPaymentDialog(false);
      debtorsQuery.refetch();
      if (selectedDebtor) {
        debtDetailsQuery.refetch();
      }
    },
    onError: (error) => {
      showErrorToast(handleApiError(error, "Failed to record payment"));
    },
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      debtorsApi.exportDebtorsCSV({
        status_filter: statusFilter,
        sort_by: sortBy,
      }),
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `debtors-${format(new Date(), "yyyy-MM-dd")}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      showSuccessToast("Debtors list exported");
    },
    onError: () => {
      showErrorToast("Failed to export debtors");
    },
  });

  const invoiceMutation = useMutation({
    mutationFn: () =>
      debtorsApi.generateAgingInvoice(selectedDebtor!.customer_id),
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `aging-invoice-${selectedDebtor?.customer_id}-${format(new Date(), "yyyy-MM-dd")}.pdf`
      );
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      showSuccessToast("Aging invoice generated");
    },
    onError: () => {
      showErrorToast("Failed to generate aging invoice");
    },
  });

  // Filter debtors based on search query
  const filteredDebtors = useMemo(() => {
    if (!debtorsQuery.data?.debtors) return [];
    if (!searchQuery) return debtorsQuery.data.debtors;

    return debtorsQuery.data.debtors.filter(
      (debtor) =>
        debtor.customer_name
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        debtor.company_name
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase())
    );
  }, [debtorsQuery.data?.debtors, searchQuery]);

  const getSummaryStats = () => {
    const data = debtorsQuery.data;
    if (!data) return null;

    return (
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Debtors
              </Typography>
              <Typography variant="h4">
                {data.total_debtors || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Outstanding
              </Typography>
              <Typography variant="h5" color="warning.main">
                Rs. {data.total_outstanding?.toLocaleString() || "0"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Overdue
              </Typography>
              <Typography variant="h5" color="error.main">
                Rs. {data.total_overdue?.toLocaleString() || "0"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Critical Accounts
              </Typography>
              <Typography variant="h4" color="error.main">
                {data.critical_count || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    );
  };

  const debtorActions = [
    {
      label: "Details",
      action: (debtor: DebtorSummary) => {
        setSelectedDebtor(debtor);
        setShowDetails(true);
      },
      icon: EditIcon,
    },
    {
      label: "Follow-up",
      action: (debtor: DebtorSummary) => {
        setSelectedDebtor(debtor);
        setShowFollowupDialog(true);
      },
      icon: CallIcon,
    },
    {
      label: "Record Payment",
      action: (debtor: DebtorSummary) => {
        setSelectedDebtor(debtor);
        setShowPaymentDialog(true);
      },
      icon: PaymentIcon,
    },
    {
      label: "Aging Invoice",
      action: (debtor: DebtorSummary) => {
        setSelectedDebtor(debtor);
        invoiceMutation.mutate();
      },
      icon: InvoiceIcon,
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header and Toolbar */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
          Debtors Management
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            placeholder="Search by customer name or company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ flex: 1, minWidth: 250 }}
            size="small"
          />
          <TextField
            select
            size="small"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(
                e.target.value as "all" | "current" | "overdue" | "critical"
              );
              setPage(1);
            }}
            label="Status"
            sx={{ minWidth: 200 }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "outstanding_balance" | "days_overdue" | "customer_name")}
            label="Sort By"
            sx={{ minWidth: 250 }}
          >
            {SORT_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            Export
          </Button>
        </Box>
      </Box>

      {/* Summary Stats */}
      {getSummaryStats()}

      {/* Loading State */}
      {debtorsQuery.isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error State */}
      {debtorsQuery.isError && (
        <Alert severity="error">
          Failed to load debtors. Please try again.
        </Alert>
      )}

      {/* Debtors Table */}
      {debtorsQuery.isSuccess && filteredDebtors.length > 0 && (
        <>
          <TableContainer component={Paper}>
            <Table>
              <TableHead sx={{ backgroundColor: "#f5f5f5" }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Customer Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Company</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Outstanding Balance
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Credit Limit
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    Days Overdue
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    Status
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredDebtors.map((debtor) => (
                  <TableRow
                    key={debtor.customer_id}
                    hover
                    sx={{
                      backgroundColor:
                        selectedDebtor?.customer_id === debtor.customer_id
                          ? "#f0f0f0"
                          : "inherit",
                    }}
                  >
                    <TableCell sx={{ fontWeight: 500 }}>
                      {debtor.customer_name}
                    </TableCell>
                    <TableCell>{debtor.company_name}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Rs. {debtor.outstanding_balance.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      Rs. {debtor.credit_limit.toLocaleString()}
                    </TableCell>
                    <TableCell align="center">
                      {debtor.days_overdue > 0 ? (
                        <Chip
                          label={`${debtor.days_overdue} days`}
                          color="error"
                          size="small"
                        />
                      ) : (
                        <Typography variant="body2" color="textSecondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={debtor.status.toUpperCase()}
                        color={
                          DEBTORS_STATUS_COLORS[
                            debtor.status as keyof typeof DEBTORS_STATUS_COLORS
                          ]
                        }
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
                        {debtorActions.map((action) => (
                          <Button
                            key={action.label}
                            size="small"
                            variant="outlined"
                            startIcon={<action.icon />}
                            onClick={() => action.action(debtor)}
                            title={action.label}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
            <Pagination
              count={Math.ceil(
                (debtorsQuery.data?.total_debtors || 0) / ITEMS_PER_PAGE
              )}
              page={page}
              onChange={(_, value) => setPage(value)}
            />
          </Box>
        </>
      )}

      {/* Empty State */}
      {debtorsQuery.isSuccess && filteredDebtors.length === 0 && (
        <Alert severity="info">
          {searchQuery
            ? "No debtors match your search criteria."
            : "No debtors found."}
        </Alert>
      )}

      {/* Debtor Details Dialog */}
      {selectedDebtor && showDetails && (
        <DebtorDetailsDialog
          debtor={selectedDebtor!}
          debtDetails={debtDetailsQuery.data}
          isLoading={debtDetailsQuery.isLoading}
          onClose={() => {
            setShowDetails(false);
            setSelectedDebtor(null);
          }}
        />
      )}

      {/* Follow-up Dialog */}
      {selectedDebtor && showFollowupDialog && (
        <FollowupDialog
          customer={selectedDebtor!}
          isLoading={followupMutation.isPending}
          onSave={(followup) => followupMutation.mutate(followup)}
          onClose={() => {
            setShowFollowupDialog(false);
            setSelectedDebtor(null);
          }}
        />
      )}

      {/* Payment Recording Dialog */}
      {selectedDebtor && showPaymentDialog && (
        <PaymentDialog
          customer={selectedDebtor!}
          isLoading={paymentMutation.isPending}
          onSave={(payment) => paymentMutation.mutate(payment)}
          onClose={() => {
            setShowPaymentDialog(false);
            setSelectedDebtor(null);
          }}
        />
      )}
    </Box>
  );
}

/**
 * Debtor Details Dialog Component
 */
function DebtorDetailsDialog({
  debtor,
  debtDetails,
  isLoading,
  onClose,
}: {
  debtor: DebtorSummary;
  debtDetails?: any;
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open maxWidth="md" fullWidth onClose={onClose}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Debt Details - {debtor.customer_name}
        </Typography>

        {isLoading && <CircularProgress />}

        {debtDetails && (
          <>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="textSecondary">
                  Company
                </Typography>
                <Typography variant="body1">{debtDetails.company_name}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="textSecondary">
                  Contact
                </Typography>
                <Typography variant="body1">{debtDetails.phone}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="textSecondary">
                  Total Outstanding
                </Typography>
                <Typography variant="h6" color="error.main">
                  Rs. {debtDetails.total_outstanding?.toLocaleString()}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="textSecondary">
                  Credit Limit
                </Typography>
                <Typography variant="h6">
                  Rs. {debtDetails.credit_limit?.toLocaleString()}
                </Typography>
              </Grid>
            </Grid>

            {/* Invoice Details Table */}
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Outstanding Invoices
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                    <TableCell sx={{ fontWeight: 600 }}>Invoice</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Amount
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Paid
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Outstanding
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Days
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {debtDetails.invoices?.map((invoice: any) => (
                    <TableRow key={invoice.invoice_id}>
                      <TableCell>{invoice.invoice_no}</TableCell>
                      <TableCell align="right">
                        Rs. {invoice.invoice_amount?.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        Rs. {invoice.amount_paid?.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        Rs. {invoice.outstanding_balance?.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">{invoice.days_outstanding}</TableCell>
                      <TableCell>
                        <Chip label={invoice.status} size="small" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

/**
 * Follow-up Dialog Component
 */
function FollowupDialog({
  customer,
  isLoading,
  onSave,
  onClose,
}: {
  customer: DebtorSummary;
  isLoading: boolean;
  onSave: (followup: FollowupRecord) => void;
  onClose: () => void;
}) {
  const [followup, setFollowup] = React.useState<FollowupRecord>({
    customer_id: customer.customer_id,
    followup_date: format(new Date(), "yyyy-MM-dd"),
    followup_type: "call",
    notes: "",
  });

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={onClose}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Record Follow-up - {customer.customer_name}
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            type="date"
            label="Follow-up Date"
            value={followup.followup_date}
            onChange={(e) =>
              setFollowup({ ...followup, followup_date: e.target.value })
            }
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            select
            label="Follow-up Type"
            value={followup.followup_type}
            onChange={(e) =>
              setFollowup({
                ...followup,
                followup_type: e.target.value as any,
              })
            }
          >
            <MenuItem value="call">Phone Call</MenuItem>
            <MenuItem value="email">Email</MenuItem>
            <MenuItem value="sms">SMS</MenuItem>
            <MenuItem value="visit">Office Visit</MenuItem>
            <MenuItem value="reminder">Reminder</MenuItem>
          </TextField>

          <TextField
            label="Notes"
            multiline
            rows={4}
            value={followup.notes}
            onChange={(e) => setFollowup({ ...followup, notes: e.target.value })}
            placeholder="Enter follow-up notes..."
          />

          <TextField
            type="number"
            label="Amount Promised (Optional)"
            value={followup.amount_promised || ""}
            onChange={(e) =>
              setFollowup({
                ...followup,
                amount_promised: e.target.value
                  ? parseFloat(e.target.value)
                  : undefined,
              })
            }
          />

          <TextField
            type="date"
            label="Promised Payment Date (Optional)"
            value={followup.promised_payment_date || ""}
            onChange={(e) =>
              setFollowup({
                ...followup,
                promised_payment_date: e.target.value || undefined,
              })
            }
            InputLabelProps={{ shrink: true }}
          />
        </Box>

        <Box sx={{ mt: 3, display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={onClose} variant="outlined">
            Cancel
          </Button>
          <Button
            onClick={() => onSave(followup)}
            variant="contained"
            disabled={isLoading}
          >
            {isLoading ? "Saving..." : "Save Follow-up"}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

/**
 * Payment Dialog Component
 */
function PaymentDialog({
  customer,
  isLoading,
  onSave,
  onClose,
}: {
  customer: DebtorSummary;
  isLoading: boolean;
  onSave: (payment: any) => void;
  onClose: () => void;
}) {
  const [payment, setPayment] = React.useState({
    amount: 0,
    payment_date: format(new Date(), "yyyy-MM-dd"),
    payment_method: "bank_transfer",
    reference_no: "",
    notes: "",
  });

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={onClose}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Record Payment - {customer.customer_name}
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          Outstanding Balance: Rs. {customer.outstanding_balance.toLocaleString()}
        </Alert>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            type="number"
            label="Payment Amount"
            value={payment.amount}
            onChange={(e) =>
              setPayment({ ...payment, amount: parseFloat(e.target.value) })
            }
            inputProps={{ step: "0.01" }}
            required
          />

          <TextField
            type="date"
            label="Payment Date"
            value={payment.payment_date}
            onChange={(e) =>
              setPayment({ ...payment, payment_date: e.target.value })
            }
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            select
            label="Payment Method"
            value={payment.payment_method}
            onChange={(e) =>
              setPayment({ ...payment, payment_method: e.target.value })
            }
          >
            <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
            <MenuItem value="cheque">Cheque</MenuItem>
            <MenuItem value="cash">Cash</MenuItem>
            <MenuItem value="credit_card">Credit Card</MenuItem>
            <MenuItem value="online">Online Payment</MenuItem>
          </TextField>

          <TextField
            label="Reference No."
            value={payment.reference_no}
            onChange={(e) =>
              setPayment({ ...payment, reference_no: e.target.value })
            }
            placeholder="e.g., Cheque No. or Transaction ID"
          />

          <TextField
            label="Notes"
            multiline
            rows={2}
            value={payment.notes}
            onChange={(e) =>
              setPayment({ ...payment, notes: e.target.value })
            }
          />
        </Box>

        <Box sx={{ mt: 3, display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={onClose} variant="outlined">
            Cancel
          </Button>
          <Button
            onClick={() => onSave(payment)}
            variant="contained"
            disabled={isLoading || payment.amount <= 0}
          >
            {isLoading ? "Recording..." : "Record Payment"}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
