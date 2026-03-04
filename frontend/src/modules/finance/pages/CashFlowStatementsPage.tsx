/**
 * CashFlowStatementsPage - Cash Flow Statement Management
 *
 * Generate, finalize, and approve cash flow statements.
 * Follows the Purchasing/Sales Master-Detail UI pattern with ActionToolbar,
 * TFilterPanel, TSearchableSelect, expanded list items, and onRefresh.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LockIcon from "@mui/icons-material/Lock";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
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
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  TCurrency,
  TDetailSkeleton,
  TFilterPanel,
  TSearchableSelect,
  type SortOption,
  modernTableStyles,
} from "@/components/tijaero";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

import { cashFlowStatementsApi } from "@/modules/finance/api";
import type {
  CashFlowStatement,
  CashFlowStatementStatus,
} from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft", color: "default" as const },
  { value: "final", label: "Final", color: "info" as const },
  { value: "approved", label: "Approved", color: "success" as const },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date Created" },
  { value: "fiscal_year", label: "Fiscal Year" },
  { value: "statement_no", label: "Statement No" },
];

const getStatusColor = (status: CashFlowStatementStatus) => {
  switch (status) {
    case "draft": return "default" as const;
    case "final": return "info" as const;
    case "approved": return "success" as const;
    default: return "default" as const;
  }
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function CashFlowStatementsPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<number | "">(new Date().getFullYear());
  const [selectedStatement, setSelectedStatement] = useState<CashFlowStatement | null>(null);

  // Generate dialog
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [genStartDate, setGenStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(0, 1);
    return d.toISOString().split("T")[0];
  });
  const [genEndDate, setGenEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: statements = [], isLoading, refetch } = useQuery({
    queryKey: ["cash-flow-statements", filterStatus, filterYear],
    queryFn: () =>
      cashFlowStatementsApi.getAll({
        status: filterStatus ?? undefined,
        fiscal_year: filterYear || undefined,
        limit: 500,
      }),
  });

  const { data: statementDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["cash-flow-statement-detail", selectedStatement?.id],
    queryFn: () =>
      selectedStatement
        ? cashFlowStatementsApi.getById(selectedStatement.id)
        : Promise.resolve(null),
    enabled: !!selectedStatement,
  });

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredStatements = useMemo(() => {
    let filtered = [...statements];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((s) => s.statement_no?.toLowerCase().includes(q));
    }
    filtered.sort((a, b) => {
      if (sortField === "fiscal_year") return b.fiscal_year - a.fiscal_year;
      if (sortField === "statement_no")
        return (b.statement_no || "").localeCompare(a.statement_no || "");
      return (
        new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime()
      );
    });
    return filtered;
  }, [statements, searchQuery, sortField]);

  useEffect(() => {
    if (filteredStatements.length > 0 && !selectedStatement) {
      setSelectedStatement(filteredStatements[0]);
    }
  }, [filteredStatements, selectedStatement]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cash-flow-statements"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-statement-detail"] });
  };

  const generateMutation = useMutation({
    mutationFn: cashFlowStatementsApi.generate,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Cash flow statement generated");
      setGenerateDialogOpen(false);
      setSelectedStatement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to generate cash flow statement")),
  });

  const finalizeMutation = useMutation({
    mutationFn: cashFlowStatementsApi.finalize,
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Statement finalized");
      setSelectedStatement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to finalize statement")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => cashFlowStatementsApi.approve(id),
    onSuccess: (data) => {
      invalidate();
      showSuccessToast("Statement approved");
      setSelectedStatement(data);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to approve statement")),
  });

  const deleteMutation = useMutation({
    mutationFn: cashFlowStatementsApi.delete,
    onSuccess: () => {
      invalidate();
      showSuccessToast("Statement deleted");
      setSelectedStatement(null);
    },
    onError: (err: unknown) =>
      showErrorToast(handleApiError(err, "Failed to delete statement")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleFinalize = useCallback(async () => {
    if (!selectedStatement) return;
    const confirmed = await confirmDialog.confirm({
      title: "Finalize Statement",
      message: `Finalize "${selectedStatement.statement_no}"? Once finalized, changes cannot be made.`,
      confirmText: "Finalize",
      confirmColor: "primary",
    });
    if (confirmed) finalizeMutation.mutate(selectedStatement.id);
  }, [selectedStatement, confirmDialog, finalizeMutation]);

  const handleApprove = useCallback(async () => {
    if (!selectedStatement) return;
    const confirmed = await confirmDialog.confirm({
      title: "Approve Statement",
      message: `Approve "${selectedStatement.statement_no}"? This is the final step.`,
      confirmText: "Approve",
      confirmColor: "success",
    });
    if (confirmed) approveMutation.mutate(selectedStatement.id);
  }, [selectedStatement, confirmDialog, approveMutation]);

  const handleDelete = useCallback(async () => {
    if (!selectedStatement || selectedStatement.status !== "draft") return;
    const confirmed = await confirmDialog.confirm({
      title: "Delete Statement",
      message: `Delete draft statement "${selectedStatement.statement_no}"?`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (confirmed) deleteMutation.mutate(selectedStatement.id);
  }, [selectedStatement, confirmDialog, deleteMutation]);

  const canDelete = !!(selectedStatement && selectedStatement.status === "draft");
  const detail = statementDetail || selectedStatement;

  // Group lines by section
  const operatingLines = detail?.lines?.filter((l) => l.section === "Operating") || [];
  const investingLines = detail?.lines?.filter((l) => l.section === "Investing") || [];
  const financingLines = detail?.lines?.filter((l) => l.section === "Financing") || [];

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList<CashFlowStatement>
      items={filteredStatements}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search statements..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedStatement}
      onSelectItem={(stmt) => setSelectedStatement(stmt)}
      emptyMessage="No cash flow statements found"
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
      renderItem={(stmt: CashFlowStatement, isSelected: boolean) => {
        const statusColor = getStatusColor(stmt.status);
        return (
          <SelectableListItem
            key={stmt.id}
            id={stmt.id}
            isSelected={isSelected}
            onClick={() => setSelectedStatement(stmt)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{stmt.statement_no}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Statement No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        FY {stmt.fiscal_year}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Fiscal Year)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {format(new Date(stmt.start_date), "dd/MM/yyyy")} - {format(new Date(stmt.end_date), "dd/MM/yyyy")}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Period)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption" fontWeight={600}>
                        Closing: Rs. {fmtLKR(stmt.closing_cash_balance)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Balance)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={stmt.status.charAt(0).toUpperCase() + stmt.status.slice(1)}
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
                ? `FY ${stmt.fiscal_year} | ${format(new Date(stmt.start_date), "dd/MM")} - ${format(new Date(stmt.end_date), "dd/MM/yyyy")}`
                : undefined
            }
            statusChip={
              !isSelected
                ? {
                    label: stmt.status.charAt(0).toUpperCase() + stmt.status.slice(1),
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
          { label: "Cash Flow Statements", href: "/finance/cash-flow" },
          ...(detail ? [{ label: detail.statement_no }] : []),
        ]}
        title={detail ? detail.statement_no : ""}
        titleIcon={<MonetizationOnIcon color="primary" />}
        noSelectionTitle="Select a Statement"
        chips={
          detail
            ? [
                {
                  label: detail.status.charAt(0).toUpperCase() + detail.status.slice(1),
                  color: getStatusColor(detail.status),
                },
              ]
            : []
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedStatement}
        isCreating={false}
        isEditing={false}
        isSaving={false}
        isFormValid={false}
        onNew={() => setGenerateDialogOpen(true)}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete || false}
        endActions={
          detail ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              {detail.status === "draft" && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<LockIcon />}
                  onClick={handleFinalize}
                >
                  Finalize
                </Button>
              )}
              {detail.status === "final" && (
                <Button
                  variant="contained"
                  size="small"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  onClick={handleApprove}
                >
                  Approve
                </Button>
              )}
            </Box>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!detail ? (
          <EmptyState message="Select a cash flow statement from the list or generate a new one" />
        ) : isDetailLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Summary Cards */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, mb: 2 }}>
              <Paper sx={{ p: 2, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">Opening Cash</Typography>
                <Typography variant="h6">
                  <TCurrency value={detail.opening_cash_balance} />
                </Typography>
              </Paper>
              <Paper sx={{ p: 2, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">Net Change</Typography>
                <Typography
                  variant="h6"
                  color={
                    detail.closing_cash_balance - detail.opening_cash_balance >= 0
                      ? "success.main"
                      : "error.main"
                  }
                >
                  <TCurrency
                    value={detail.closing_cash_balance - detail.opening_cash_balance}
                  />
                </Typography>
              </Paper>
              <Paper
                sx={{
                  p: 2,
                  textAlign: "center",
                  bgcolor: "primary.50",
                  border: 1,
                  borderColor: "primary.200",
                }}
              >
                <Typography variant="body2" color="text.secondary">Closing Cash</Typography>
                <Typography variant="h6" color="primary.main" fontWeight="bold">
                  <TCurrency value={detail.closing_cash_balance} />
                </Typography>
              </Paper>
            </Box>

            {/* Statement Details */}
            <FormSection title="Statement Information" columns={3}>
              <TextField
                label="Statement No"
                size="small"
                value={detail.statement_no}
                disabled
              />
              <TextField
                label="Period"
                size="small"
                value={`${format(new Date(detail.start_date), "dd/MM/yyyy")} - ${format(new Date(detail.end_date), "dd/MM/yyyy")}`}
                disabled
              />
              <TextField
                label="Fiscal Year"
                size="small"
                value={detail.fiscal_year}
                disabled
              />
            </FormSection>

            <FormSection title="Method" columns={2}>
              <TextField
                label="Cash Flow Method"
                size="small"
                value={detail.method}
                disabled
              />
            </FormSection>

            {/* Cash Flow Sections */}
            <FormSection title="Cash from Operating Activities" columns={1}>
              <SectionTable
                lines={operatingLines}
                netAmount={detail.net_cash_from_operating}
              />
            </FormSection>

            <FormSection title="Cash from Investing Activities" columns={1}>
              <SectionTable
                lines={investingLines}
                netAmount={detail.net_cash_from_investing}
              />
            </FormSection>

            <FormSection title="Cash from Financing Activities" columns={1}>
              <SectionTable
                lines={financingLines}
                netAmount={detail.net_cash_from_financing}
              />
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Cash Flow Statements"
        icon={<MonetizationOnIcon color="primary" />}
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Generate Dialog */}
      <Dialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Generate Cash Flow Statement</DialogTitle>
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
              label="Start Date"
              type="date"
              size="small"
              fullWidth
              value={genStartDate}
              onChange={(e) => setGenStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End Date"
              type="date"
              size="small"
              fullWidth
              value={genEndDate}
              onChange={(e) => setGenEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              generateMutation.mutate({
                fiscal_year: genYear,
                start_date: genStartDate,
                end_date: genEndDate,
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

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface SectionTableProps {
  lines: { line_number: number; line_description: string; amount: number; category_name?: string }[];
  netAmount: number;
}

function SectionTable({ lines, netAmount }: SectionTableProps) {
  if (lines.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        No line items
      </Typography>
    );
  }

  return (
    <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={modernTableStyles.headerRow}>
            <TableCell>#</TableCell>
            <TableCell>Description</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.line_number} sx={modernTableStyles.bodyRow}>
              <TableCell>{line.line_number}</TableCell>
              <TableCell>{line.line_description}</TableCell>
              <TableCell
                align="right"
                sx={{
                  color: line.amount >= 0 ? "success.main" : "error.main",
                  fontWeight: 500,
                }}
              >
                {fmtLKR(line.amount)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow sx={modernTableStyles.footerRow}>
            <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
              Net Cash
            </TableCell>
            <TableCell
              align="right"
              sx={{
                fontWeight: 700,
                color: netAmount >= 0 ? "success.main" : "error.main",
              }}
            >
              {fmtLKR(netAmount)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  );
}
