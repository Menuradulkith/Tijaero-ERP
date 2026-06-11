/**
 * PostingFailuresPage — GL posting-failure outbox (recovery console).
 *
 * Every time an automatic GL posting fails (missing account, imbalance,
 * closed period, unexpected error), it is durably recorded in
 * `gl_posting_failures` instead of being silently swallowed. This page lets
 * finance staff review those failures and either:
 *   • Retry — re-attempt the posting through the central gateway, or
 *   • Ignore — mark it as deliberately not posted.
 *
 * Keeping this list at zero is part of the day-end "books balanced" check.
 */

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import BlockIcon from "@mui/icons-material/Block";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  TConfirmDialog,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useConfirmDialog,
} from "@/components/tijaero";
import { postingFailuresApi } from "@/modules/finance/api";
import type { GLPostingFailure, GLPostingFailureStatus } from "@/modules/finance/types";

type StatusFilter = GLPostingFailureStatus | "all";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
];

const statusColor = (s: GLPostingFailureStatus): "warning" | "success" | "default" => {
  if (s === "pending") return "warning";
  if (s === "resolved") return "success";
  return "default";
};

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-LK", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function PostingFailuresPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const [status, setStatus] = useState<StatusFilter>("pending");

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["gl-posting-failures", status],
    queryFn: () =>
      postingFailuresApi.getAll({ status: status === "all" ? undefined : status }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["gl-posting-failures"] });
    queryClient.invalidateQueries({ queryKey: ["day-end-reconciliation"] });
  };

  const retryMutation = useMutation({
    mutationFn: (id: number) => postingFailuresApi.retry(id),
    onSuccess: (res) => {
      if (res.status === "resolved") {
        showSuccessToast(
          res.journal_entry_no
            ? `Posted successfully as ${res.journal_entry_no}.`
            : "Posted successfully."
        );
      } else {
        showErrorToast(res.error_message || "Retry failed — the posting still cannot be made.");
      }
      invalidate();
    },
    onError: (err) => handleApiError(err, "Failed to retry posting"),
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: number) => postingFailuresApi.ignore(id),
    onSuccess: () => {
      showSuccessToast("Failure marked as ignored.");
      invalidate();
    },
    onError: (err) => handleApiError(err, "Failed to ignore posting"),
  });

  const handleIgnore = async (row: GLPostingFailure) => {
    const confirmed = await confirmDialog.confirm({
      title: "Ignore Posting Failure",
      message: `Mark the failed ${row.reference_type} #${row.reference_id} posting as ignored? It will no longer count against the day-end balance check.`,
      confirmText: "Ignore",
      confirmColor: "error",
    });
    if (confirmed) ignoreMutation.mutate(row.id);
  };

  const rows = data?.items ?? [];
  const busy = retryMutation.isPending || ignoreMutation.isPending;

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
        mb={2}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            GL Posting Failures
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Automatic ledger postings that could not be completed. Resolve these to keep the
            books balanced.
          </Typography>
        </Box>
        <Box flexGrow={1} />
        {data && (
          <Chip
            color={data.pending_count > 0 ? "warning" : "success"}
            label={`${data.pending_count} pending`}
            sx={{ fontWeight: 600 }}
          />
        )}
        <Button
          variant="outlined"
          startIcon={isFetching ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          Refresh
        </Button>
      </Stack>

      {/* Status filter */}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={status}
        onChange={(_, v) => v && setStatus(v)}
        sx={{ mb: 2 }}
      >
        {STATUS_TABS.map((t) => (
          <ToggleButton key={t.value} value={t.value}>
            {t.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Reference</TableCell>
              <TableCell>Module</TableCell>
              <TableCell>Error</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell align="center">Attempts</TableCell>
              <TableCell>Last Attempt</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!data ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <Stack alignItems="center" spacing={1}>
                    <AccountTreeIcon sx={{ fontSize: 40, color: "success.light" }} />
                    <Typography variant="body2" color="text.secondary">
                      No {status === "all" ? "" : status} posting failures. The ledger is clean.
                    </Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.reference_type} #{row.reference_id}
                    </Typography>
                    {row.reference_no && (
                      <Typography variant="caption" color="text.secondary">
                        {row.reference_no}
                        {row.posting_marker ? ` · ${row.posting_marker}` : ""}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.source_module}</Typography>
                    {row.transaction_type && (
                      <Typography variant="caption" color="text.secondary">
                        {row.transaction_type}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Chip size="small" label={row.error_code} variant="outlined" sx={{ mb: 0.5 }} />
                    <Tooltip title={row.error_message}>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {row.error_message}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>{row.branch_code || "—"}</TableCell>
                  <TableCell align="center">{row.attempts}</TableCell>
                  <TableCell>
                    <Typography variant="caption">{fmtDateTime(row.last_attempt_at)}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip size="small" color={statusColor(row.status)} label={row.status} />
                  </TableCell>
                  <TableCell align="right">
                    {row.status === "pending" ? (
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<ReplayIcon />}
                          disabled={busy}
                          onClick={() => retryMutation.mutate(row.id)}
                        >
                          Retry
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<BlockIcon />}
                          disabled={busy}
                          onClick={() => handleIgnore(row)}
                        >
                          Ignore
                        </Button>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {row.status === "resolved" && row.resolved_je_id
                          ? `JE #${row.resolved_je_id}`
                          : "—"}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
