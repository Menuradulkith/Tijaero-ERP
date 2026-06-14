/**
 * AgentCommissionsPage � Simple list of agent commission records.
 * Each record can be paid individually. Status: pending | paid.
 */

import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PERMISSIONS, usePermission } from "@/auth/permissions";
import { customersApi } from "@/modules/customers/api";
import { showSuccessToast, showErrorToast, handleApiError } from "@/components/tijaero";
import { exportToCSV } from "@/utils/csvExport";
import DownloadIcon from "@mui/icons-material/FileDownload";
import { commissionsApi, commissionPaymentsApi } from "@/modules/sales/commission-api";
import type { CustomerAgentCommissionWithDetails } from "@/modules/sales/commission-types";

const STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error"> = {
  pending: "warning",
  paid: "success",
  cancelled: "error",
};

function fmtAmount(val: number) {
  return val?.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "0.00";
}

export default function AgentCommissionsPage() {
  const queryClient = useQueryClient();
  const canView = usePermission(
    PERMISSIONS.AGENT_COMMISSIONS_VIEW.resource,
    PERMISSIONS.AGENT_COMMISSIONS_VIEW.action
  );
  const canPay = usePermission(
    PERMISSIONS.AGENT_COMMISSIONS_CREATE.resource,
    PERMISSIONS.AGENT_COMMISSIONS_CREATE.action
  );
  const canApprove = usePermission(
    PERMISSIONS.COMMISSION_APPROVALS_APPROVE.resource,
    PERMISSIONS.COMMISSION_APPROVALS_APPROVE.action
  );

  const [filterAgent, setFilterAgent] = useState<number | "">("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payingCommission, setPayingCommission] = useState<CustomerAgentCommissionWithDetails | null>(null);
  const [payMethod, setPayMethod] = useState("Cash");
  const [payReference, setPayReference] = useState("");
  const [payAmountOverride, setPayAmountOverride] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });
  const agents = (customers as any[]).filter((c: any) => c.is_customer_agent && c.active);

  const { data: commissionsData, isLoading } = useQuery({
    queryKey: ["agent-commissions", filterAgent, filterStatus],
    queryFn: () =>
      commissionsApi.getAll({
        agent_id: filterAgent || undefined,
        status: filterStatus || undefined,
        limit: 200,
      }),
    enabled: canView,
  });
  const commissions: CustomerAgentCommissionWithDetails[] = (commissionsData?.items ?? commissionsData ?? []) as CustomerAgentCommissionWithDetails[];

  const totalPending = commissions
    .filter((c) => c.status === "pending" || c.status === "approved")
    .reduce((s, c) => s + (c.commission_amount ?? 0), 0);
  const totalPaid = commissions
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + (c.commission_amount ?? 0), 0);

  const handleOpenPay = (commission: CustomerAgentCommissionWithDetails) => {
    setPayingCommission(commission);
    setPayMethod("Cash");
    setPayReference("");
    setPayAmountOverride(null);
    setPayError("");
    setPayDialogOpen(true);
  };

  const handleApprove = async (commission: CustomerAgentCommissionWithDetails) => {
    setApprovingId(commission.id);
    try {
      await commissionsApi.approve(commission.id);
      showSuccessToast("Commission approved. It can now be paid.");
      queryClient.invalidateQueries({ queryKey: ["agent-commissions"] });
    } catch (err: any) {
      showErrorToast(handleApiError(err, "Approval failed"));
    } finally {
      setApprovingId(null);
    }
  };

  const handlePay = async () => {
    if (!payingCommission) return;
    const maxAmount = payingCommission.commission_amount ?? 0;
    const requested = payAmountOverride !== null ? payAmountOverride : maxAmount;
    if (requested <= 0) {
      setPayError("Payment amount must be greater than zero.");
      return;
    }
    if (requested - maxAmount > 0.01) {
      setPayError(`Amount cannot exceed the commission of Rs. ${fmtAmount(maxAmount)}.`);
      return;
    }
    setPaying(true);
    setPayError("");
    try {
      await commissionPaymentsApi.create({
        customer_agent_id: payingCommission.customer_agent_id,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: payMethod,
        payment_amount: requested,
        reference_number: payReference || undefined,
        branch_code: "MAIN",
        remarks: `Commission for Invoice ${payingCommission.invoice_no ?? payingCommission.invoice_id}`,
        items: [
          { commission_id: payingCommission.id, paid_amount: requested },
        ],
      });
      setPayDialogOpen(false);
      showSuccessToast("Payment recorded \u2014 pending finance verification.");
      queryClient.invalidateQueries({ queryKey: ["agent-commissions"] });
    } catch (err: any) {
      setPayError(handleApiError(err, "Payment failed"));
    } finally {
      setPaying(false);
    }
  };

  const handleExportCSV = () => {
    const headers = [
      "Invoice",
      "Agent",
      "Customer",
      "Invoice Amount",
      "Rate",
      "Commission",
      "Date",
      "Status"
    ];

    const rows = commissions.map(c => [
      c.invoice_no || `#${c.invoice_id}`,
      c.agent_name || `Agent #${c.customer_agent_id}`,
      c.customer_name || "",
      c.invoice_amount ?? 0,
      c.commission_rate ? `${c.commission_rate}%` : "",
      c.commission_amount ?? 0,
      (c as any).created_at ? new Date((c as any).created_at).toLocaleDateString() : "",
      c.status
    ]);

    exportToCSV({
      filename: `agent_commissions_${new Date().toISOString().split("T")[0]}`,
      headers,
      rows
    });
  };

  if (!canView) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">You do not have permission to view agent commissions.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <MonetizationOnIcon color="primary" sx={{ fontSize: 28 }} />
          <Typography variant="h5" fontWeight="bold">
            Agent Commissions
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          onClick={handleExportCSV}
          disabled={commissions.length === 0}
        >
          Export CSV
        </Button>
      </Box>

      {/* Summary */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, display: "flex", gap: 2, alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">Unpaid</Typography>
          <Typography variant="h6" fontWeight="bold" color="warning.main">
            Rs. {fmtAmount(totalPending)}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, display: "flex", gap: 2, alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">Paid</Typography>
          <Typography variant="h6" fontWeight="bold" color="success.main">
            Rs. {fmtAmount(totalPaid)}
          </Typography>
        </Paper>
      </Box>

      {/* Filters */}
      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label="Agent"
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value as any)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All Agents</MenuItem>
          {agents.map((a: any) => (
            <MenuItem key={a.id} value={a.id}>
              {a.customer_name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="pending">Pending</MenuItem>
          <MenuItem value="approved">Approved</MenuItem>
          <MenuItem value="paid">Paid</MenuItem>
          <MenuItem value="cancelled">Cancelled</MenuItem>
        </TextField>
      </Box>

      {/* Table */}
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "grey.50" }}>
              <TableCell>Invoice</TableCell>
              <TableCell>Agent</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell align="right">Invoice Amount</TableCell>
              <TableCell align="right">Rate</TableCell>
              <TableCell align="right">Commission</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="center">Status</TableCell>
              {(canPay || canApprove) && <TableCell align="center">Action</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 3, color: "text.secondary" }}>
                  Loading�
                </TableCell>
              </TableRow>
            ) : commissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No commission records found.
                </TableCell>
              </TableRow>
            ) : (
              commissions.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                      {c.invoice_no || `#${c.invoice_id}`}
                    </Typography>
                  </TableCell>
                  <TableCell>{c.agent_name || `Agent #${c.customer_agent_id}`}</TableCell>
                  <TableCell>{c.customer_name || "�"}</TableCell>
                  <TableCell align="right">Rs. {fmtAmount(c.invoice_amount ?? 0)}</TableCell>
                  <TableCell align="right">
                    {c.commission_rate ? `${c.commission_rate}%` : "�"}
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      fontWeight="medium"
                      color={c.status === "pending" ? "warning.main" : "success.main"}
                      variant="body2"
                    >
                      Rs. {fmtAmount(c.commission_amount ?? 0)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {(c as any).created_at
                      ? new Date((c as any).created_at).toLocaleDateString()
                      : "�"}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={
                        c.status === "pending" ? "Unpaid" :
                        c.status === "paid" ? "Paid" :
                        c.status === "cancelled" ? "Cancelled" :
                        c.status === "approved" ? "Approved" :
                        c.status
                      }
                      size="small"
                      color={STATUS_COLOR[c.status] ?? "default"}
                      variant={c.status === "paid" ? "filled" : "outlined"}
                    />
                  </TableCell>
                  {(canPay || canApprove) && (
                    <TableCell align="center">
                      {c.status === "pending" ? (
                        canApprove ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            disabled={approvingId === c.id}
                            onClick={() => handleApprove(c)}
                          >
                            {approvingId === c.id ? "Approving\u2026" : "Approve"}
                          </Button>
                        ) : (
                          <Typography variant="caption" color="warning.main">Awaiting approval</Typography>
                        )
                      ) : c.status === "approved" ? (
                        canPay ? (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() => handleOpenPay(c)}
                          >
                            Pay
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.disabled">\u2014</Typography>
                        )
                      ) : c.status === "cancelled" ? (
                        <Typography variant="caption" color="error">Cancelled</Typography>
                      ) : (
                        <Typography variant="caption" color="text.disabled">\u2014</Typography>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* Pay Dialog */}
      <Dialog
        open={payDialogOpen}
        onClose={() => !paying && setPayDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Record Commission Payment</DialogTitle>
        <DialogContent>
          {payingCommission && (
            <Box sx={{ pt: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Recording payment to{" "}
                <strong>{payingCommission.agent_name ?? `Agent #${payingCommission.customer_agent_id}`}</strong>{" "}
                for invoice{" "}
                <strong>{payingCommission.invoice_no ?? `#${payingCommission.invoice_id}`}</strong>
              </Typography>

              <Alert severity="info" sx={{ py: 0.5 }}>
                This payment is created as <strong>pending</strong> and only posts to the
                ledger after finance verifies it.
              </Alert>

              {/* Editable amount */}
              <TextField
                size="small"
                label="Payment Amount"
                type="number"
                value={payAmountOverride !== null ? payAmountOverride : (payingCommission.commission_amount ?? 0)}
                onChange={(e) => setPayAmountOverride(parseFloat(e.target.value) || 0)}
                fullWidth
                inputProps={{ min: 0, max: payingCommission.commission_amount ?? 0, step: 0.01 }}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
                helperText={`Commission amount: Rs. ${fmtAmount(payingCommission.commission_amount ?? 0)} \u2014 partial payments allowed, cannot exceed this.`}
              />

              <TextField
                select
                size="small"
                label="Payment Method"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                fullWidth
              >
                {["Cash", "Bank Transfer", "Cheque"].map((m) => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </TextField>

              <TextField
                size="small"
                label="Reference / Note (optional)"
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                fullWidth
              />

              {payError && (
                <Alert severity="error" sx={{ mt: 0 }}>
                  {payError}
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialogOpen(false)} disabled={paying}>
            Cancel
          </Button>
          <Button variant="contained" color="success" onClick={handlePay} disabled={paying}>
            {paying ? "Recording\u2026" : "Confirm Payment"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

