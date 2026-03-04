/**
 * AccountingPeriodsPage - Fiscal Period Management
 *
 * Generate, close, reopen, and lock accounting periods.
 * Follows Purchasing/Sales Master-Detail UI pattern with ActionToolbar,
 * TFilterPanel, TSearchableSelect, expanded list items, and onRefresh.
 */

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TFilterPanel,
  TSearchableSelect,
  type SortOption,
  TDetailSkeleton,
} from "@/components/tijaero";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

import { accountingPeriodsApi } from "@/modules/finance/api";
import type { AccountingPeriod, PeriodStatus } from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "open", label: "Open", color: "success" as const },
  { value: "closed", label: "Closed", color: "warning" as const },
  { value: "locked", label: "Locked", color: "error" as const },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "period_number", label: "Period Number" },
  { value: "start_date", label: "Start Date" },
  { value: "fiscal_year", label: "Fiscal Year" },
];

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
  const confirmDialog = useConfirmDialog();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("period_number");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<number | "">(new Date().getFullYear());
  const [selectedPeriod, setSelectedPeriod] = useState<AccountingPeriod | null>(null);

  // Generate dialog
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [genStartMonth, setGenStartMonth] = useState(1);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: periods = [], isLoading, refetch } = useQuery({
    queryKey: ["accounting-periods", filterYear, filterStatus],
    queryFn: () =>
      accountingPeriodsApi.getAll({
        fiscal_year: filterYear || undefined,
        status: filterStatus ?? undefined,
      }),
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredPeriods = useMemo(() => {
    let filtered = [...periods];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((p) =>
        p.period_name?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      if (sortField === "start_date")
        return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
      if (sortField === "fiscal_year") return b.fiscal_year - a.fiscal_year;
      return a.period_number - b.period_number;
    });
    return filtered;
  }, [periods, searchQuery, sortField]);

  useEffect(() => {
    if (filteredPeriods.length > 0 && !selectedPeriod) {
      setSelectedPeriod(filteredPeriods[0]);
    }
  }, [filteredPeriods, selectedPeriod]);

  // Summary counts
  const openCount = periods.filter((p) => p.status === "open").length;
  const closedCount = periods.filter((p) => p.status === "closed").length;
  const lockedCount = periods.filter((p) => p.status === "locked").length;

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
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Period closed");
      setSelectedPeriod(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to close period")),
  });

  const reopenMutation = useMutation({
    mutationFn: accountingPeriodsApi.reopen,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Period reopened");
      setSelectedPeriod(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to reopen period")),
  });

  const lockMutation = useMutation({
    mutationFn: accountingPeriodsApi.lock,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Period locked");
      setSelectedPeriod(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to lock period")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleClose = useCallback(async () => {
    if (!selectedPeriod || selectedPeriod.status !== "open") return;
    const confirmed = await confirmDialog.confirm({
      title: "Close Period",
      message: `Close "${selectedPeriod.period_name}"? No new transactions will be posted to this period.`,
      confirmText: "Close Period",
      confirmColor: "warning",
    });
    if (confirmed) closeMutation.mutate(selectedPeriod.id);
  }, [selectedPeriod, confirmDialog, closeMutation]);

  const handleReopen = useCallback(async () => {
    if (!selectedPeriod || selectedPeriod.status !== "closed") return;
    const confirmed = await confirmDialog.confirm({
      title: "Reopen Period",
      message: `Reopen "${selectedPeriod.period_name}"? This will allow new transactions.`,
      confirmText: "Reopen",
      confirmColor: "success",
    });
    if (confirmed) reopenMutation.mutate(selectedPeriod.id);
  }, [selectedPeriod, confirmDialog, reopenMutation]);

  const handleLock = useCallback(async () => {
    if (!selectedPeriod || selectedPeriod.status !== "closed") return;
    const confirmed = await confirmDialog.confirm({
      title: "Lock Period",
      message: `Permanently lock "${selectedPeriod.period_name}"? This action cannot be undone.`,
      confirmText: "Lock Permanently",
      confirmColor: "error",
    });
    if (confirmed) lockMutation.mutate(selectedPeriod.id);
  }, [selectedPeriod, confirmDialog, lockMutation]);

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList<AccountingPeriod>
      items={filteredPeriods}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search periods..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedPeriod}
      onSelectItem={(p) => setSelectedPeriod(p)}
      emptyMessage="No accounting periods found"
      listHeader={
        <TFilterPanel>
          <TSearchableSelect
            label="Status"
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as string | null)}
            options={STATUS_FILTER_OPTIONS.map((s) => ({
              value: s.value,
              label: s.label,
              color: s.color,
            }))}
            showAllOption
            allOptionLabel="All Statuses"
            placeholder="Search status..."
          />
          <TextField
            label="Fiscal Year"
            type="number"
            size="small"
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value ? Number(e.target.value) : "")}
            fullWidth
          />
        </TFilterPanel>
      }
      renderItem={(period: AccountingPeriod, isSelected: boolean) => {
        const statusColor = getStatusColor(period.status);
        return (
          <SelectableListItem
            key={period.id}
            id={period.id}
            isSelected={isSelected}
            onClick={() => setSelectedPeriod(period)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{period.period_name}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Period Name)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        FY {period.fiscal_year} — Period {period.period_number}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Year / Period)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {format(new Date(period.start_date), "dd/MM/yyyy")} - {format(new Date(period.end_date), "dd/MM/yyyy")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date Range)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={period.status.charAt(0).toUpperCase() + period.status.slice(1)}
                        size="small"
                        color={statusColor}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `FY ${period.fiscal_year} | ${format(new Date(period.start_date), "dd/MM")} - ${format(new Date(period.end_date), "dd/MM/yyyy")}`
                : undefined
            }
            statusChip={
              !isSelected
                ? {
                    label: period.status.charAt(0).toUpperCase() + period.status.slice(1),
                    color: statusColor,
                  }
                : undefined
            }
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Accounting Periods", href: "/finance/accounting-periods" },
          ...(selectedPeriod ? [{ label: selectedPeriod.period_name }] : []),
        ]}
        title={selectedPeriod ? selectedPeriod.period_name : ""}
        titleIcon={<CalendarMonthIcon color="primary" />}
        noSelectionTitle="Select a Period"
        chips={
          selectedPeriod
            ? [
                {
                  label: selectedPeriod.status.charAt(0).toUpperCase() + selectedPeriod.status.slice(1),
                  color: getStatusColor(selectedPeriod.status),
                },
              ]
            : []
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedPeriod}
        isCreating={false}
        isEditing={false}
        isSaving={false}
        isFormValid={false}
        onNew={() => setGenerateDialogOpen(true)}
        endActions={
          selectedPeriod ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              {selectedPeriod.status === "open" && (
                <Button
                  variant="contained"
                  size="small"
                  color="warning"
                  startIcon={<CheckCircleIcon />}
                  onClick={handleClose}
                >
                  Close Period
                </Button>
              )}
              {selectedPeriod.status === "closed" && (
                <>
                  <Button
                    variant="contained"
                    size="small"
                    color="success"
                    startIcon={<LockOpenIcon />}
                    onClick={handleReopen}
                  >
                    Reopen
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    color="error"
                    startIcon={<LockIcon />}
                    onClick={handleLock}
                  >
                    Lock
                  </Button>
                </>
              )}
              {selectedPeriod.status === "locked" && (
                <Chip label="Permanently Locked" size="small" color="error" variant="outlined" />
              )}
            </Box>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedPeriod ? (
          <EmptyState message="Select an accounting period from the list or generate new periods" />
        ) : isLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            {/* Summary Cards */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, mb: 2 }}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Total Periods</Typography>
                  <Typography variant="h6">{periods.length}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Open</Typography>
                  <Typography variant="h6" color="success.main">{openCount}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Closed</Typography>
                  <Typography variant="h6" color="warning.main">{closedCount}</Typography>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography color="text.secondary" variant="caption">Locked</Typography>
                  <Typography variant="h6" color="error.main">{lockedCount}</Typography>
                </CardContent>
              </Card>
            </Box>

            {/* Period Information */}
            <FormSection title="Period Information" columns={3}>
              <TextField
                label="Period Name"
                size="small"
                value={selectedPeriod.period_name}
                disabled
              />
              <TextField
                label="Fiscal Year"
                size="small"
                value={selectedPeriod.fiscal_year}
                disabled
              />
              <TextField
                label="Period Number"
                size="small"
                value={selectedPeriod.period_number}
                disabled
              />
            </FormSection>

            <FormSection title="Date Range" columns={2}>
              <TextField
                label="Start Date"
                size="small"
                value={format(new Date(selectedPeriod.start_date), "dd/MM/yyyy")}
                disabled
              />
              <TextField
                label="End Date"
                size="small"
                value={format(new Date(selectedPeriod.end_date), "dd/MM/yyyy")}
                disabled
              />
            </FormSection>

            <FormSection title="Status Details" columns={2}>
              <TextField
                label="Status"
                size="small"
                value={selectedPeriod.status.charAt(0).toUpperCase() + selectedPeriod.status.slice(1)}
                disabled
              />
              {selectedPeriod.closed_at && (
                <TextField
                  label="Closed At"
                  size="small"
                  value={format(new Date(selectedPeriod.closed_at), "dd/MM/yyyy HH:mm")}
                  disabled
                />
              )}
            </FormSection>

            {selectedPeriod.created_at && (
              <FormSection title="Audit" columns={2}>
                <TextField
                  label="Created At"
                  size="small"
                  value={format(new Date(selectedPeriod.created_at), "dd/MM/yyyy HH:mm")}
                  disabled
                />
                {selectedPeriod.updated_at && (
                  <TextField
                    label="Last Updated"
                    size="small"
                    value={format(new Date(selectedPeriod.updated_at), "dd/MM/yyyy HH:mm")}
                    disabled
                  />
                )}
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Accounting Periods"
        icon={<CalendarMonthIcon color="primary" />}
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

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

      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
