/**
 * AccountingPeriodsPage - Fiscal Period Management
 *
 * Generate, close, reopen, and lock accounting periods.
 * Uses DataGrid pattern.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Paper,
  Card,
  CardContent,
  Typography,
  TextField,
  MenuItem,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AddIcon from "@mui/icons-material/Add";
import {
  TPageHeader,
  TConfirmDialog,
  useTConfirmDialog,
  handleApiError,
  showErrorToast,
  showSuccessToast,
} from "@/components/tijaero";
import { accountingPeriodsApi } from "@/modules/finance/api";
import type { AccountingPeriod, PeriodStatus } from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const getStatusColor = (status: PeriodStatus) => {
  switch (status) {
    case "open": return "success" as const;
    case "closed": return "warning" as const;
    case "locked": return "error" as const;
    default: return "default" as const;
  }
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AccountingPeriodsPage() {
  const queryClient = useQueryClient();

  // State
  const [filterYear, setFilterYear] = useState<number | "">(new Date().getFullYear());
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [genStartMonth, setGenStartMonth] = useState(1);

  const confirmDialog = useTConfirmDialog();

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ["accounting-periods", filterYear, filterStatus],
    queryFn: () =>
      accountingPeriodsApi.getAll({
        fiscal_year: filterYear || undefined,
        status: filterStatus || undefined,
      }),
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["accounting-periods"] });
  };

  const generateMutation = useMutation({
    mutationFn: accountingPeriodsApi.generate,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Accounting periods generated successfully");
      setGenerateDialogOpen(false);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to generate periods")),
  });

  const closeMutation = useMutation({
    mutationFn: accountingPeriodsApi.close,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Period closed");
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to close period")),
  });

  const reopenMutation = useMutation({
    mutationFn: accountingPeriodsApi.reopen,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Period reopened");
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reopen period")),
  });

  const lockMutation = useMutation({
    mutationFn: accountingPeriodsApi.lock,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Period locked");
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to lock period")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleClose = (period: AccountingPeriod) => {
    confirmDialog.open(
      "Close Period",
      `Close "${period.period_name}"? No new transactions will be posted to this period.`,
      () => closeMutation.mutate(period.id)
    );
  };

  const handleReopen = (period: AccountingPeriod) => {
    confirmDialog.open(
      "Reopen Period",
      `Reopen "${period.period_name}"? This will allow new transactions.`,
      () => reopenMutation.mutate(period.id)
    );
  };

  const handleLock = (period: AccountingPeriod) => {
    confirmDialog.open(
      "Lock Period",
      `Permanently lock "${period.period_name}"? This cannot be undone.`,
      () => lockMutation.mutate(period.id)
    );
  };

  // ─── Columns ───────────────────────────────────────────────────────────────

  const columns: GridColDef[] = [
    {
      field: "fiscal_year",
      headerName: "Fiscal Year",
      width: 110,
    },
    {
      field: "period_number",
      headerName: "Period",
      width: 80,
    },
    {
      field: "period_name",
      headerName: "Period Name",
      width: 180,
    },
    {
      field: "start_date",
      headerName: "Start Date",
      width: 120,
      valueFormatter: (value: string) =>
        value ? new Date(value).toLocaleDateString() : "-",
    },
    {
      field: "end_date",
      headerName: "End Date",
      width: 120,
      valueFormatter: (value: string) =>
        value ? new Date(value).toLocaleDateString() : "-",
    },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => (
        <Chip
          label={params.value.charAt(0).toUpperCase() + params.value.slice(1)}
          size="small"
          color={getStatusColor(params.value)}
        />
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 280,
      sortable: false,
      renderCell: (params) => {
        const period = params.row as AccountingPeriod;
        return (
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {period.status === "open" && (
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<CheckCircleIcon />}
                onClick={() => handleClose(period)}
              >
                Close
              </Button>
            )}
            {period.status === "closed" && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  startIcon={<LockOpenIcon />}
                  onClick={() => handleReopen(period)}
                >
                  Reopen
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<LockIcon />}
                  onClick={() => handleLock(period)}
                >
                  Lock
                </Button>
              </>
            )}
            {period.status === "locked" && (
              <Chip label="Permanently Locked" size="small" color="error" variant="outlined" />
            )}
          </Box>
        );
      },
    },
  ];

  // ─── Summary ───────────────────────────────────────────────────────────────

  const openCount = periods.filter((p) => p.status === "open").length;
  const closedCount = periods.filter((p) => p.status === "closed").length;
  const lockedCount = periods.filter((p) => p.status === "locked").length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ p: 3 }}>
      <TPageHeader
        title="Accounting Periods"
        subtitle="Manage fiscal periods for transaction posting"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setGenerateDialogOpen(true)}
          >
            Generate Periods
          </Button>
        }
      />

      {/* Summary Cards */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, mb: 2 }}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">Total Periods</Typography>
            <Typography variant="h5">{periods.length}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">Open</Typography>
            <Typography variant="h5" color="success.main">{openCount}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">Closed</Typography>
            <Typography variant="h5" color="warning.main">{closedCount}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">Locked</Typography>
            <Typography variant="h5" color="error.main">{lockedCount}</Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Filters */}
      <Box sx={{ mb: 2, display: "flex", gap: 2 }}>
        <TextField
          label="Fiscal Year"
          type="number"
          size="small"
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value ? Number(e.target.value) : "")}
          sx={{ width: 150 }}
        />
        <TextField
          select
          label="Status"
          size="small"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          sx={{ width: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="closed">Closed</MenuItem>
          <MenuItem value="locked">Locked</MenuItem>
        </TextField>
      </Box>

      {/* Data Grid */}
      <Paper sx={{ height: 500 }}>
        <DataGrid
          rows={periods}
          columns={columns}
          loading={isLoading}
          initialState={{
            sorting: { sortModel: [{ field: "period_number", sort: "asc" }] },
          }}
        />
      </Paper>

      {/* Generate Dialog */}
      <Dialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Generate Accounting Periods</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="Fiscal Year"
              type="number"
              size="small"
              fullWidth
              value={genYear}
              onChange={(e) => setGenYear(Number(e.target.value))}
            />
            <TextField
              label="Start Month"
              select
              size="small"
              fullWidth
              value={genStartMonth}
              onChange={(e) => setGenStartMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <MenuItem key={i + 1} value={i + 1}>
                  {new Date(2000, i).toLocaleString("default", { month: "long" })}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              This will generate 12 monthly periods for the fiscal year.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              generateMutation.mutate({
                fiscal_year: genYear,
                start_month: genStartMonth,
              })
            }
            disabled={generateMutation.isPending}
          >
            Generate
          </Button>
        </DialogActions>
      </Dialog>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
