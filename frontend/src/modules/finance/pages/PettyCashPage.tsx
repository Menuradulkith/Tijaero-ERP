/**
 * PettyCashPage - Full feature implementation
 * Manages petty cash funds, transactions, and reconciliation
 */

import { usePermission } from "@/auth/permissions";
import {
  EmptyState,
  FormSection,
  showErrorToast,
  showSuccessToast,
  TCurrency,
  TDate,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import {
  Add as AddIcon,
  MonetizationOn as MoneyIcon,
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
import { pettyCashApi } from "../api";
import {
  PettyCashFund,
  PettyCashFundCreate,
  PettyCashExpenseCreate,
  PettyCashReplenishCreate,
  PettyCashTransaction,
} from "../types";

export default function PettyCashPage() {
  const queryClient = useQueryClient();
  // Petty cash endpoints are gated by the cashbook permission on the backend
  // (see backend/app/modules/finance/api.py) — there is no separate
  // petty_cash permission, so the UI must check the same resource.
  const canCreate = usePermission("cashbook", "create");
  const { filteredBranches } = useReferenceData();

  // UI State
  const [selectedFundId, setSelectedFundId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [showReplenishDialog, setShowReplenishDialog] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);

  // Form states
  const [formData, setFormData] = useState<Partial<PettyCashFundCreate>>({
    branch_code: filteredBranches[0]?.branch_code || "MAIN",
    opening_balance: 0,
    opened_date: format(new Date(), "yyyy-MM-dd"),
  });

  const [expenseData, setExpenseData] = useState<Partial<PettyCashExpenseCreate>>({
    petty_cash_id: selectedFundId || 0,
    amount: 0,
    transaction_date: format(new Date(), "yyyy-MM-dd"),
  });

  const [replenishData, setReplenishData] = useState<Partial<PettyCashReplenishCreate>>({
    petty_cash_id: selectedFundId || 0,
    amount: 0,
    transaction_date: format(new Date(), "yyyy-MM-dd"),
  });

  const [closingBalance, setClosingBalance] = useState(0);

  // List funds query
  const {
    data: fundsData,
    isLoading: isLoadingFunds,
  } = useQuery({
    queryKey: ["petty-cash-funds"],
    queryFn: () =>
      pettyCashApi.listFunds({
        skip: 0,
        limit: 100,
      }),
  });

  // Get selected fund details
  const {
    data: selectedFund,
    isLoading: isLoadingDetail,
  } = useQuery({
    queryKey: ["petty-cash-fund", selectedFundId],
    queryFn: () => (selectedFundId ? pettyCashApi.getFundDetails(selectedFundId) : null),
    enabled: !!selectedFundId,
  });

  // Filter funds
  const filteredFunds = useMemo(() => {
    if (!fundsData?.items) return [];

    return fundsData.items.filter((fund: PettyCashFund) =>
      fund.petty_cash_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fund.branch_code.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [fundsData?.items, searchTerm]);

  // Handlers
  const handleCreateFund = async () => {
    if (!formData.opening_balance || formData.opening_balance <= 0) {
      showErrorToast("Opening balance must be greater than 0");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await pettyCashApi.createFund(formData);
      queryClient.invalidateQueries({ queryKey: ["petty-cash-funds"] });
      showSuccessToast(`Fund ${result.petty_cash_no} created successfully`);
      setSelectedFundId(result.id);
      setFormData({
        branch_code: filteredBranches[0]?.branch_code || "MAIN",
        opening_balance: 0,
        opened_date: format(new Date(), "yyyy-MM-dd"),
      });
      setShowCreateDialog(false);
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to create fund");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordExpense = async () => {
    if (!expenseData.amount || expenseData.amount <= 0) {
      showErrorToast("Expense amount must be greater than 0");
      return;
    }
    if (!expenseData.recipient_name || !expenseData.purpose) {
      showErrorToast("Recipient name and purpose are required");
      return;
    }

    setIsSubmitting(true);
    try {
      await pettyCashApi.recordExpense(expenseData);
      queryClient.invalidateQueries({ queryKey: ["petty-cash-fund", selectedFundId] });
      showSuccessToast("Expense recorded successfully");
      setExpenseData({
        petty_cash_id: selectedFundId || 0,
        amount: 0,
        transaction_date: format(new Date(), "yyyy-MM-dd"),
      });
      setShowExpenseDialog(false);
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to record expense");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReplenish = async () => {
    if (!replenishData.amount || replenishData.amount <= 0) {
      showErrorToast("Replenishment amount must be greater than 0");
      return;
    }

    setIsSubmitting(true);
    try {
      await pettyCashApi.replenishFund(replenishData);
      queryClient.invalidateQueries({ queryKey: ["petty-cash-fund", selectedFundId] });
      showSuccessToast("Fund replenished successfully");
      setReplenishData({
        petty_cash_id: selectedFundId || 0,
        amount: 0,
        transaction_date: format(new Date(), "yyyy-MM-dd"),
      });
      setShowReplenishDialog(false);
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to replenish fund");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReconcile = async () => {
    if (!closingBalance || closingBalance < 0) {
      showErrorToast("Valid closing balance is required");
      return;
    }
    if (!selectedFundId) return;

    setIsSubmitting(true);
    try {
      await pettyCashApi.reconcileFund(selectedFundId, {
        closing_balance: closingBalance,
      });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-funds"] });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-fund", selectedFundId] });
      showSuccessToast("Fund reconciled and closed successfully");
      setSelectedFundId(null);
      setClosingBalance(0);
      setShowReconcileDialog(false);
    } catch (error: any) {
      showErrorToast(error.response?.data?.detail || "Failed to reconcile fund");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Empty state
  if (filteredFunds.length === 0 && !isLoadingFunds && !showCreateDialog) {
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
          <Typography variant="h4">Petty Cash Management</Typography>
          {canCreate && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setShowCreateDialog(true)}
            >
              Create Fund
            </Button>
          )}
        </Box>

        <EmptyState
          message="No petty cash funds yet. Create your first fund to get started."
          icon={<MoneyIcon sx={{ fontSize: 64 }} />}
        />

        {/* Create Fund Dialog */}
        <Dialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Create New Petty Cash Fund</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Branch"
              select
              value={formData.branch_code || ""}
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
              label="Opening Balance"
              type="number"
              value={formData.opening_balance || 0}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  opening_balance: parseFloat(e.target.value),
                })
              }
              margin="normal"
              inputProps={{ step: "0.01", min: "0" }}
            />

            <TextField
              fullWidth
              label="Opened Date"
              type="date"
              value={formData.opened_date || ""}
              onChange={(e) =>
                setFormData({ ...formData, opened_date: e.target.value })
              }
              margin="normal"
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={3}
              value={formData.remarks || ""}
              onChange={(e) =>
                setFormData({ ...formData, remarks: e.target.value })
              }
              margin="normal"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreateFund}
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
        <Typography variant="h4">Petty Cash Management</Typography>
        {canCreate && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowCreateDialog(true)}
          >
            Create Fund
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {/* Left: Funds List */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Funds
              </Typography>

              <TextField
                fullWidth
                placeholder="Search funds..."
                size="small"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ mb: 2 }}
              />

              {isLoadingFunds ? (
                <LinearProgress />
              ) : filteredFunds.length === 0 ? (
                <EmptyState message="No funds found" />
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Fund #</TableCell>
                      <TableCell>Balance</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredFunds.map((fund: PettyCashFund) => (
                      <TableRow
                        key={fund.id}
                        onClick={() => setSelectedFundId(fund.id)}
                        sx={{
                          cursor: "pointer",
                          backgroundColor:
                            selectedFundId === fund.id
                              ? "action.selected"
                              : "inherit",
                          "&:hover": {
                            backgroundColor: "action.hover",
                          },
                        }}
                      >
                        <TableCell sx={{ fontWeight: "bold" }}>
                          {fund.petty_cash_no}
                        </TableCell>
                        <TableCell>
                          {TCurrency({ value: fund.current_balance })}
                        </TableCell>
                        <TableCell>
                          <TStatusChip status={fund.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Fund Details */}
        <Grid item xs={12} md={8}>
          {selectedFund ? (
            <Card>
              <CardContent>
                {isLoadingDetail ? (
                  <LinearProgress />
                ) : (
                  <>
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
                          {selectedFund.petty_cash_no}
                        </Typography>
                        <Typography color="textSecondary" variant="body2">
                          {selectedFund.branch_code} •{" "}
                          {TDate({ value: selectedFund.opened_date })}
                        </Typography>
                      </Box>
                      <TStatusChip status={selectedFund.status} />
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* Fund Summary */}
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                      <Grid item xs={12} sm={6}>
                        <Box>
                          <Typography color="textSecondary" variant="caption">
                            Opening Balance
                          </Typography>
                          <Typography variant="h6">
                            {TCurrency({
                              value: selectedFund.opening_balance,
                            })}
                          </Typography>
                        </Box>
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <Box>
                          <Typography color="textSecondary" variant="caption">
                            Current Balance
                          </Typography>
                          <Typography variant="h6">
                            {TCurrency({
                              value: selectedFund.current_balance,
                            })}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>

                    {/* Action Buttons */}
                    {selectedFund.status === "active" && (
                      <Box sx={{ mb: 3, display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setExpenseData({
                              ...expenseData,
                              petty_cash_id: selectedFundId || 0,
                            });
                            setShowExpenseDialog(true);
                          }}
                        >
                          Record Expense
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          onClick={() => {
                            setReplenishData({
                              ...replenishData,
                              petty_cash_id: selectedFundId || 0,
                            });
                            setShowReplenishDialog(true);
                          }}
                        >
                          Replenish
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => {
                            setClosingBalance(selectedFund.current_balance);
                            setShowReconcileDialog(true);
                          }}
                        >
                          Close Fund
                        </Button>
                      </Box>
                    )}

                    <Divider sx={{ my: 2 }} />

                    {/* Transactions */}
                    {selectedFund.transactions &&
                    selectedFund.transactions.length > 0 ? (
                      <FormSection title="Recent Transactions">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Date</TableCell>
                              <TableCell>Type</TableCell>
                              <TableCell>Description</TableCell>
                              <TableCell align="right">Amount</TableCell>
                              <TableCell align="right">Balance</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(selectedFund.transactions as PettyCashTransaction[]).map((txn) => (
                              <TableRow key={txn.id}>
                                <TableCell>
                                  {TDate({ value: txn.transaction_date })}
                                </TableCell>
                                <TableCell>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      color:
                                        txn.transaction_type === "expense"
                                          ? "error.main"
                                          : "success.main",
                                    }}
                                  >
                                    {txn.transaction_type === "expense"
                                      ? "Expense"
                                      : "Replenishment"}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  {txn.description || txn.purpose || "-"}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    color:
                                      txn.transaction_type === "expense"
                                        ? "error.main"
                                        : "success.main",
                                  }}
                                >
                                  {txn.transaction_type === "expense" ? "-" : "+"}
                                  {TCurrency({ value: txn.amount })}
                                </TableCell>
                                <TableCell align="right">
                                  {TCurrency({
                                    value: txn.balance_after,
                                  })}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </FormSection>
                    ) : (
                      <Typography color="textSecondary" variant="body2">
                        No transactions yet
                      </Typography>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState message="Select a fund to view details" />
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>

      {/* Create Fund Dialog */}
      <Dialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Petty Cash Fund</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="Branch"
            select
            value={formData.branch_code || ""}
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
            label="Opening Balance"
            type="number"
            value={formData.opening_balance || 0}
            onChange={(e) =>
              setFormData({
                ...formData,
                opening_balance: parseFloat(e.target.value),
              })
            }
            margin="normal"
            inputProps={{ step: "0.01", min: "0" }}
          />

          <TextField
            fullWidth
            label="Opened Date"
            type="date"
            value={formData.opened_date || ""}
            onChange={(e) =>
              setFormData({ ...formData, opened_date: e.target.value })
            }
            margin="normal"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            fullWidth
            label="Remarks"
            multiline
            rows={3}
            value={formData.remarks || ""}
            onChange={(e) =>
              setFormData({ ...formData, remarks: e.target.value })
            }
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCreateDialog(false)}>Cancel</Button>
          <Button
            onClick={handleCreateFund}
            variant="contained"
            disabled={isSubmitting}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Expense Dialog */}
      <Dialog
        open={showExpenseDialog}
        onClose={() => setShowExpenseDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Record Expense</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="Amount"
            type="number"
            value={expenseData.amount || 0}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                amount: parseFloat(e.target.value),
              })
            }
            margin="normal"
            inputProps={{ step: "0.01", min: "0" }}
          />

          <TextField
            fullWidth
            label="Recipient Name"
            value={expenseData.recipient_name || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                recipient_name: e.target.value,
              })
            }
            margin="normal"
          />

          <TextField
            fullWidth
            label="Purpose"
            value={expenseData.purpose || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                purpose: e.target.value,
              })
            }
            margin="normal"
          />

          <TextField
            fullWidth
            label="Receipt Number"
            value={expenseData.receipt_number || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                receipt_number: e.target.value,
              })
            }
            margin="normal"
          />

          <TextField
            fullWidth
            label="Transaction Date"
            type="date"
            value={expenseData.transaction_date || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                transaction_date: e.target.value,
              })
            }
            margin="normal"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            fullWidth
            label="Description"
            multiline
            rows={2}
            value={expenseData.description || ""}
            onChange={(e) =>
              setExpenseData({
                ...expenseData,
                description: e.target.value,
              })
            }
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowExpenseDialog(false)}>Cancel</Button>
          <Button
            onClick={handleRecordExpense}
            variant="contained"
            disabled={isSubmitting}
          >
            Record
          </Button>
        </DialogActions>
      </Dialog>

      {/* Replenish Fund Dialog */}
      <Dialog
        open={showReplenishDialog}
        onClose={() => setShowReplenishDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Replenish Petty Cash Fund</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="Replenishment Amount"
            type="number"
            value={replenishData.amount || 0}
            onChange={(e) =>
              setReplenishData({
                ...replenishData,
                amount: parseFloat(e.target.value),
              })
            }
            margin="normal"
            inputProps={{ step: "0.01", min: "0" }}
          />

          <TextField
            fullWidth
            label="Transaction Date"
            type="date"
            value={replenishData.transaction_date || ""}
            onChange={(e) =>
              setReplenishData({
                ...replenishData,
                transaction_date: e.target.value,
              })
            }
            margin="normal"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            fullWidth
            label="Description"
            multiline
            rows={2}
            value={replenishData.description || ""}
            onChange={(e) =>
              setReplenishData({
                ...replenishData,
                description: e.target.value,
              })
            }
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowReplenishDialog(false)}>Cancel</Button>
          <Button
            onClick={handleReplenish}
            variant="contained"
            disabled={isSubmitting}
          >
            Replenish
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reconcile Dialog */}
      <Dialog
        open={showReconcileDialog}
        onClose={() => setShowReconcileDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reconcile and Close Fund</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Current Balance:{" "}
            {TCurrency({ value: selectedFund?.current_balance })}
          </Typography>

          <TextField
            fullWidth
            label="Closing Balance"
            type="number"
            value={closingBalance}
            onChange={(e) => setClosingBalance(parseFloat(e.target.value))}
            margin="normal"
            inputProps={{ step: "0.01", min: "0" }}
          />

          {closingBalance !== selectedFund?.current_balance && (
            <Typography
              variant="body2"
              sx={{
                mt: 1,
                color:
                  closingBalance > (selectedFund?.current_balance || 0)
                    ? "success.main"
                    : "error.main",
              }}
            >
              Variance:{" "}
              {closingBalance > (selectedFund?.current_balance || 0) ? "+" : ""}
              {TCurrency({
                value: closingBalance - (selectedFund?.current_balance || 0),
              })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowReconcileDialog(false)}>Cancel</Button>
          <Button
            onClick={handleReconcile}
            variant="contained"
            color="error"
            disabled={isSubmitting}
          >
            Close Fund
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
