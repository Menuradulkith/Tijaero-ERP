/**
 * PaymentVouchersPage - Payment voucher management
 * Handles creation, approval, and payment of vouchers
 */

import { usePermission } from "@/auth/permissions";
import {
  EmptyState,
  showErrorToast,
  showSuccessToast,
  TCurrency,
  TDate,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import {
  Add as AddIcon,
  Receipt as ReceiptIcon,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";

export default function PaymentVouchersPage() {
  const queryClient = useQueryClient();
  const canCreate = usePermission("payment_voucher", "create");
  const { filteredBranches } = useReferenceData();

  // UI State
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    branch_code: filteredBranches[0]?.branch_code || "MAIN",
    payee_name: "",
    amount: 0,
    payment_date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    category: "general",
  });

  const [approvalNotes, setApprovalNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Mock data - Replace with actual API calls
  const mockVouchers = [
    {
      id: 1,
      voucher_no: "PV001",
      branch_code: "MAIN",
      payee_name: "Office Supplies Ltd",
      amount: 5000,
      status: "pending",
      created_date: "2024-01-15",
      category: "supplies",
      created_by: "admin",
    },
    {
      id: 2,
      voucher_no: "PV002",
      branch_code: "BRANCH1",
      payee_name: "Maintenance Services",
      amount: 8500,
      status: "approved",
      created_date: "2024-01-14",
      category: "maintenance",
      created_by: "admin",
    },
    {
      id: 3,
      voucher_no: "PV003",
      branch_code: "MAIN",
      payee_name: "Utilities Provider",
      amount: 12000,
      status: "paid",
      created_date: "2024-01-13",
      category: "utilities",
      created_by: "admin",
      paid_date: "2024-01-13",
    },
  ];

  // Filter vouchers
  const filteredVouchers = useMemo(() => {
    return mockVouchers.filter((voucher) => {
      const matchesSearch =
        voucher.voucher_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        voucher.payee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        voucher.branch_code.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === "" || voucher.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [searchTerm, statusFilter]);

  const selectedVoucher = mockVouchers.find((v) => v.id === selectedVoucherId);

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

    setIsSubmitting(true);
    try {
      // TODO: Call API to create voucher
      showSuccessToast("Payment voucher created successfully");
      setFormData({
        branch_code: filteredBranches[0]?.branch_code || "MAIN",
        payee_name: "",
        amount: 0,
        payment_date: format(new Date(), "yyyy-MM-dd"),
        description: "",
        category: "general",
      });
      setShowCreateDialog(false);
      queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to create voucher");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveVoucher = async () => {
    if (!selectedVoucherId) return;

    setIsSubmitting(true);
    try {
      // TODO: Call API to approve voucher
      showSuccessToast("Voucher approved successfully");
      setApprovalNotes("");
      setShowApproveDialog(false);
      queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
      queryClient.invalidateQueries({
        queryKey: ["payment-voucher", selectedVoucherId],
      });
    } catch (error: any) {
      showErrorToast(
        error.response?.data?.detail || "Failed to approve voucher"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectVoucher = async () => {
    if (!selectedVoucherId || !rejectionReason) {
      showErrorToast("Rejection reason is required");
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: Call API to reject voucher
      showSuccessToast("Voucher rejected successfully");
      setRejectionReason("");
      setShowRejectDialog(false);
      queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
      queryClient.invalidateQueries({
        queryKey: ["payment-voucher", selectedVoucherId],
      });
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to reject voucher");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayVoucher = async () => {
    if (!selectedVoucherId) return;

    setIsSubmitting(true);
    try {
      // TODO: Call API to pay voucher
      showSuccessToast("Payment recorded successfully");
      setPaymentDate(format(new Date(), "yyyy-MM-dd"));
      setShowPayDialog(false);
      queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
      queryClient.invalidateQueries({
        queryKey: ["payment-voucher", selectedVoucherId],
      });
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Empty state
  if (filteredVouchers.length === 0 && !showCreateDialog) {
    return (
      <Box sx={{ p: 3 }}>
        <Box
          sx={{
            mb: 3,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="h4">Payment Vouchers</Typography>
          {canCreate && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setShowCreateDialog(true)}
            >
              Create Voucher
            </Button>
          )}
        </Box>

        <EmptyState
          message="No payment vouchers yet. Create your first voucher to get started."
          icon={<ReceiptIcon sx={{ fontSize: 64 }} />}
        />

        {/* Create Voucher Dialog */}
        <Dialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Create Payment Voucher</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Branch"
              select
              value={formData.branch_code}
              onChange={(e) =>
                setFormData({ ...formData, branch_code: e.target.value })
              }
              margin="normal"
            >
              {filteredBranches.map((branch) => (
                <MenuItem key={branch.branch_code} value={branch.branch_code}>
                  {branch.branch_name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label="Payee Name"
              value={formData.payee_name}
              onChange={(e) =>
                setFormData({ ...formData, payee_name: e.target.value })
              }
              margin="normal"
            />

            <TextField
              fullWidth
              label="Amount"
              type="number"
              value={formData.amount}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  amount: parseFloat(e.target.value),
                })
              }
              margin="normal"
              inputProps={{ step: "0.01", min: "0" }}
            />

            <TextField
              fullWidth
              label="Category"
              select
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
              margin="normal"
            >
              <MenuItem value="general">General</MenuItem>
              <MenuItem value="supplies">Supplies</MenuItem>
              <MenuItem value="maintenance">Maintenance</MenuItem>
              <MenuItem value="utilities">Utilities</MenuItem>
              <MenuItem value="travel">Travel</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </TextField>

            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={formData.payment_date}
              onChange={(e) =>
                setFormData({ ...formData, payment_date: e.target.value })
              }
              margin="normal"
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              fullWidth
              label="Description"
              multiline
              rows={3}
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              margin="normal"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreateVoucher}
              variant="contained"
              disabled={isSubmitting}
            >
              Create
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // Main layout
  return (
    <Box sx={{ p: 3 }}>
      <Box
        sx={{
          mb: 3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h4">Payment Vouchers</Typography>
        {canCreate && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowCreateDialog(true)}
          >
            Create Voucher
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {/* Left: Vouchers List */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Vouchers
              </Typography>

              <TextField
                fullWidth
                placeholder="Search..."
                size="small"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Status"
                select
                size="small"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                sx={{ mb: 2 }}
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
              </TextField>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Voucher #</TableCell>
                    <TableCell>Amount</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredVouchers.map((voucher) => (
                    <TableRow
                      key={voucher.id}
                      onClick={() => setSelectedVoucherId(voucher.id)}
                      sx={{
                        cursor: "pointer",
                        backgroundColor:
                          selectedVoucherId === voucher.id
                            ? "action.selected"
                            : "inherit",
                        "&:hover": {
                          backgroundColor: "action.hover",
                        },
                      }}
                    >
                      <TableCell sx={{ fontWeight: "bold" }}>
                        {voucher.voucher_no}
                      </TableCell>
                      <TableCell>
                        {TCurrency({ value: voucher.amount })}
                      </TableCell>
                      <TableCell>
                        <TStatusChip status={voucher.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Voucher Details */}
        <Grid item xs={12} md={8}>
          {selectedVoucher ? (
            <Card>
              <CardContent>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "start",
                    mb: 2,
                  }}
                >
                  <Box>
                    <Typography variant="h6">
                      {selectedVoucher.voucher_no}
                    </Typography>
                    <Typography color="textSecondary" variant="body2">
                      {selectedVoucher.branch_code} •{" "}
                      {TDate({ value: selectedVoucher.created_date })}
                    </Typography>
                  </Box>
                  <TStatusChip status={selectedVoucher.status} />
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Voucher Details */}
                <Grid container spacing={2} sx={{ mb: 3 }}>
                  <Grid item xs={12} sm={6}>
                    <Box>
                      <Typography color="textSecondary" variant="caption">
                        Payee Name
                      </Typography>
                      <Typography variant="body1">
                        {selectedVoucher.payee_name}
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Box>
                      <Typography color="textSecondary" variant="caption">
                        Amount
                      </Typography>
                      <Typography variant="h6">
                        {TCurrency({ value: selectedVoucher.amount })}
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Box>
                      <Typography color="textSecondary" variant="caption">
                        Category
                      </Typography>
                      <Typography variant="body1">
                        {selectedVoucher.category}
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Box>
                      <Typography color="textSecondary" variant="caption">
                        Created By
                      </Typography>
                      <Typography variant="body1">
                        {selectedVoucher.created_by}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>

                {/* Action Buttons */}
                {selectedVoucher.status === "pending" && (
                  <Box sx={{ mb: 3, display: "flex", gap: 1, flexWrap: "wrap" }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      onClick={() => {
                        setShowApproveDialog(true);
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => {
                        setShowRejectDialog(true);
                      }}
                    >
                      Reject
                    </Button>
                  </Box>
                )}

                {selectedVoucher.status === "approved" && (
                  <Box sx={{ mb: 3 }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        setPaymentDate(format(new Date(), "yyyy-MM-dd"));
                        setShowPayDialog(true);
                      }}
                    >
                      Record Payment
                    </Button>
                  </Box>
                )}

                {selectedVoucher.status === "paid" && (
                  <Box
                    sx={{
                      mb: 3,
                      p: 2,
                      backgroundColor: "success.light",
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="body2" color="success.dark">
                      Paid on{" "}
                      {TDate({
                        value: selectedVoucher.paid_date || "",
                      })}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState message="Select a voucher to view details" />
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>

      {/* Create Voucher Dialog */}
      <Dialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Payment Voucher</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="Branch"
            select
            value={formData.branch_code}
            onChange={(e) =>
              setFormData({ ...formData, branch_code: e.target.value })
            }
            margin="normal"
          >
            {filteredBranches.map((branch) => (
              <MenuItem key={branch.branch_code} value={branch.branch_code}>
                {branch.branch_name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            label="Payee Name"
            value={formData.payee_name}
            onChange={(e) =>
              setFormData({ ...formData, payee_name: e.target.value })
            }
            margin="normal"
          />

          <TextField
            fullWidth
            label="Amount"
            type="number"
            value={formData.amount}
            onChange={(e) =>
              setFormData({
                ...formData,
                amount: parseFloat(e.target.value),
              })
            }
            margin="normal"
            inputProps={{ step: "0.01", min: "0" }}
          />

          <TextField
            fullWidth
            label="Category"
            select
            value={formData.category}
            onChange={(e) =>
              setFormData({ ...formData, category: e.target.value })
            }
            margin="normal"
          >
            <MenuItem value="general">General</MenuItem>
            <MenuItem value="supplies">Supplies</MenuItem>
            <MenuItem value="maintenance">Maintenance</MenuItem>
            <MenuItem value="utilities">Utilities</MenuItem>
            <MenuItem value="travel">Travel</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </TextField>

          <TextField
            fullWidth
            label="Payment Date"
            type="date"
            value={formData.payment_date}
            onChange={(e) =>
              setFormData({ ...formData, payment_date: e.target.value })
            }
            margin="normal"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            fullWidth
            label="Description"
            multiline
            rows={3}
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCreateDialog(false)}>Cancel</Button>
          <Button
            onClick={handleCreateVoucher}
            variant="contained"
            disabled={isSubmitting}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

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
          <Button onClick={() => setShowApproveDialog(false)}>Cancel</Button>
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
          <Button onClick={() => setShowRejectDialog(false)}>Cancel</Button>
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
            Amount: {TCurrency({ value: selectedVoucher?.amount })}
          </Typography>

          <TextField
            fullWidth
            label="Payment Date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            margin="normal"
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPayDialog(false)}>Cancel</Button>
          <Button
            onClick={handlePayVoucher}
            variant="contained"
            disabled={isSubmitting}
          >
            Record Payment
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
