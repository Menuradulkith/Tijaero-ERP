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
 *
 * Same layout as the purchasing / sales pages: a full-width list with filters
 * and a full-page detail with breadcrumb and actions.
 */

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BlockIcon from "@mui/icons-material/Block";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import SearchIcon from "@mui/icons-material/Search";
import { Alert, Box, Button, InputAdornment, TextField } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TChip,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TSearchableSelect,
  TStatusChip,
  useConfirmDialog,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { usePermission } from "@/auth/permissions";
import { postingFailuresApi } from "@/modules/finance/api";
import { invalidateLedgerQueries } from "@/modules/finance/ledgerQueries";
import type { GLPostingFailure, GLPostingFailureStatus } from "@/modules/finance/types";

type StatusFilter = GLPostingFailureStatus | "all";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "warning" as const },
  { value: "resolved", label: "Resolved", color: "success" as const },
  { value: "ignored", label: "Ignored", color: "default" as const },
];

const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "GL Posting Failures", href: "/finance/posting-failures" },
];

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-LK", { dateStyle: "medium", timeStyle: "short" }) : "—";

const refLabel = (r: GLPostingFailure) => `${r.reference_type} #${r.reference_id}`;

export default function PostingFailuresPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const { filteredBranches } = useReferenceData();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState<string | null>(null);
  const [selected, setSelected] = useState<GLPostingFailure | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["gl-posting-failures", status],
    queryFn: () =>
      postingFailuresApi.getAll({ status: status === "all" ? undefined : status }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["gl-posting-failures"] });
    queryClient.invalidateQueries({ queryKey: ["day-end-reconciliation"] });
    invalidateLedgerQueries(queryClient); // a retry posts a journal
  };

  // Retry / ignore need journal_entries.update (same as the backend).
  const canResolve = usePermission("journal_entries", "update");

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
      // Keep the open detail in step (the row may drop out of the filtered list).
      setSelected((s) =>
        s && s.id === res.failure_id
          ? res.status === "resolved"
            ? { ...s, status: "resolved", attempts: s.attempts + 1 }
            : {
                ...s,
                attempts: s.attempts + 1,
                error_code: res.error_code || s.error_code,
                error_message: res.error_message || s.error_message,
              }
          : s
      );
      invalidate();
    },
    onError: (err) => handleApiError(err, "Failed to retry posting"),
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: number) => postingFailuresApi.ignore(id),
    onSuccess: (row) => {
      showSuccessToast("Failure marked as ignored.");
      setSelected((s) => (s && s.id === row?.id ? { ...s, ...row, status: "ignored" } : s));
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

  const busy = retryMutation.isPending || ignoreMutation.isPending;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (r) =>
        (!branch || r.branch_code === branch) &&
        (!q ||
          [refLabel(r), r.reference_no, r.source_module, r.transaction_type, r.error_code, r.error_message].some((v) =>
            v?.toLowerCase().includes(q)
          )),
    );
  }, [data?.items, search, branch]);

  const columns: TDataGridColumn<GLPostingFailure>[] = [
    {
      field: "reference_id",
      header: "Reference",
      minWidth: 170,
      flex: 1,
      renderCell: (p) => refLabel(p.row),
    },
    { field: "reference_no", header: "Reference No", minWidth: 150, flex: 1 },
    { field: "source_module", header: "Module", minWidth: 130, flex: 0.8 },
    { field: "error_code", header: "Error Code", minWidth: 150, flex: 0.8 },
    { field: "error_message", header: "Error", minWidth: 240, flex: 2 },
    { field: "branch_code", header: "Branch", width: 110 },
    { field: "attempts", header: "Attempts", width: 100, type: "number", align: "center", headerAlign: "center" },
    { field: "last_attempt_at", header: "Last Attempt", width: 170, type: "datetime" },
    {
      field: "status",
      header: "Status",
      width: 120,
      renderCell: (p) => <TStatusChip status={p.row.status} statusMap="financeDocument" />,
    },
  ];

  const viewDetail = selected && (
    <>
      <FormSection title="Source Document" columns={3}>
        <TextField label="Reference" size="small" value={refLabel(selected)} disabled />
        <TextField label="Reference No" size="small" value={selected.reference_no ?? ""} disabled />
        <TextField label="Posting Marker" size="small" value={selected.posting_marker ?? ""} disabled />
        <TextField label="Module" size="small" value={selected.source_module} disabled />
        <TextField label="Transaction Type" size="small" value={selected.transaction_type ?? ""} disabled />
        <TextField label="Entry Date" size="small" value={selected.entry_date ?? ""} disabled />
        <TextField label="Branch" size="small" value={selected.branch_code || "—"} disabled />
        <TextField label="Description" size="small" value={selected.description ?? ""} disabled />
      </FormSection>
      <FormSection title="Error" columns={1}>
        <Box>
          <TChip size="small" label={selected.error_code} variant="outlined" />
        </Box>
        <TextField label="Error Message" size="small" value={selected.error_message} disabled multiline minRows={2} />
      </FormSection>
      <FormSection title="Attempts" columns={3}>
        <TextField label="Attempts" size="small" value={String(selected.attempts)} disabled />
        <TextField label="Last Attempt" size="small" value={fmtDateTime(selected.last_attempt_at)} disabled />
        <TextField label="Recorded" size="small" value={fmtDateTime(selected.created_at)} disabled />
        {selected.status !== "pending" && (
          <TextField label="Closed At" size="small" value={fmtDateTime(selected.resolved_at)} disabled />
        )}
        {selected.status === "resolved" && (
          <TextField
            label="Journal Entry"
            size="small"
            value={selected.resolved_je_id ? `JE #${selected.resolved_je_id}` : "—"}
            disabled
          />
        )}
      </FormSection>
      {selected.status === "ignored" && (
        <Alert severity="info" variant="outlined">
          This posting was marked as ignored and no longer counts against the day-end balance check.
        </Alert>
      )}
    </>
  );

  const detailPanel = selected && (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...BREADCRUMBS, { label: refLabel(selected) }]}
        title={refLabel(selected)}
        titleIcon={<ErrorOutlineIcon color="primary" />}
        chips={[getStatusProps(selected.status, "financeDocument")]}
      />
      <ActionToolbar
        hasSelectedItem
        isCreating={false}
        isEditing={false}
        endActions={
          selected.status === "pending" && canResolve ? (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReplayIcon />}
                disabled={busy}
                onClick={() => retryMutation.mutate(selected.id)}
              >
                Retry
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<BlockIcon />}
                disabled={busy}
                onClick={() => handleIgnore(selected)}
              >
                Ignore
              </Button>
            </>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{viewDetail}</Box>
    </Box>
  );

  const listPanel = (
    <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
      <TDataGrid<GLPostingFailure>
        rows={rows}
        columns={columns}
        loading={!data || isFetching}
        onRowClick={(row) => setSelected(row)}
        pageSizeOptions={[10, 25, 50, 100]}
        pageSize={25}
        emptyMessage={`No ${status === "all" ? "" : status} posting failures. The ledger is clean.`}
        autoHeight={false}
        height="100%"
      />
    </Box>
  );

  const filterSet = !!search || !!branch || status !== "pending";

  return (
    <>
      <MasterDetailLayout
        title="GL Posting Failures"
        titleSlot={
          selected ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={() => setSelected(null)}
              sx={{ textTransform: "none" }}
            >
              Back to Posting Failures
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search failures..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
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
                <TBranchFilter branches={filteredBranches} value={branch} onChange={setBranch} label="" size="small" />
              </Box>
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TSearchableSelect
                  label=""
                  value={status === "all" ? null : status}
                  onChange={(v) => setStatus(((v as string | null) ?? "all") as StatusFilter)}
                  options={STATUS_OPTIONS}
                  showAllOption
                  allOptionLabel="All Statuses"
                  placeholder="Search status..."
                  size="small"
                />
              </Box>
              {filterSet && (
                <Button
                  size="small"
                  onClick={() => {
                    setSearch("");
                    setBranch(null);
                    setStatus("pending");
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
          !selected && data ? (
            <TChip
              color={data.pending_count > 0 ? "warning" : "success"}
              label={`${data.pending_count} pending`}
              sx={{ fontWeight: 600, mr: 1 }}
            />
          ) : undefined
        }
        onRefresh={() => refetch()}
        isLoading={isFetching}
      >
        {selected ? detailPanel : listPanel}
      </MasterDetailLayout>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
