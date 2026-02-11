/**
 * CashFlowStatementsPage - Cash Flow Statement Management
 *
 * Generate, finalize, and approve cash flow statements.
 * Uses MasterDetailLayout with Tijaero components.
 */

import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
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
  TConfirmDialog,
  useTConfirmDialog,
  type SortOption,
} from "@/components/tijaero";

import { cashFlowStatementsApi } from "@/modules/finance/api";
import type {
  CashFlowStatement,
  CashFlowStatementStatus,
} from "@/modules/finance/types";

// ─── Configuration ───────────────────────────────────────────────────────────

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

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<number | "">(new Date().getFullYear());
  const [selectedStatement, setSelectedStatement] = useState<CashFlowStatement | null>(null);

  // Dialogs
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [genStartDate, setGenStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(0, 1);
    return d.toISOString().split("T")[0];
  });
  const [genEndDate, setGenEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  const deleteDialog = useTConfirmDialog();
  const finalizeDialog = useTConfirmDialog();
  const approveDialog = useTConfirmDialog();

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: statements = [], isLoading } = useQuery({
    queryKey: ["cash-flow-statements", filterStatus, filterYear],
    queryFn: () =>
      cashFlowStatementsApi.getAll({
        status: filterStatus ?? undefined,
        fiscal_year: filterYear || undefined,
        limit: 500,
      }),
  });

  const { data: statementDetail } = useQuery({
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
      filtered = filtered.filter(
        (s) => s.statement_no?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      if (sortField === "fiscal_year") return b.fiscal_year - a.fiscal_year;
      if (sortField === "statement_no")
        return (b.statement_no || "").localeCompare(a.statement_no || "");
      return (
        new Date(b.created_at || "").getTime() -
        new Date(a.created_at || "").getTime()
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

  const handleFinalize = useCallback(() => {
    if (!selectedStatement) return;
    finalizeDialog.open(
      "Finalize Statement",
      `Finalize "${selectedStatement.statement_no}"?`,
      () => finalizeMutation.mutate(selectedStatement.id)
    );
  }, [selectedStatement, finalizeDialog, finalizeMutation]);

  const handleApprove = useCallback(() => {
    if (!selectedStatement) return;
    approveDialog.open(
      "Approve Statement",
      `Approve "${selectedStatement.statement_no}"? This is the final step.`,
      () => approveMutation.mutate(selectedStatement.id)
    );
  }, [selectedStatement, approveDialog, approveMutation]);

  const handleDelete = useCallback(() => {
    if (!selectedStatement) return;
    deleteDialog.open(
      "Delete Statement",
      `Delete "${selectedStatement.statement_no}"?`,
      () => deleteMutation.mutate(selectedStatement.id)
    );
  }, [selectedStatement, deleteDialog, deleteMutation]);

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={filteredStatements}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search statements..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      listHeader={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setGenerateDialogOpen(true)}
            >
              Generate
            </Button>
          </Box>
          <TextField
            select
            size="small"
            label="Status"
            value={filterStatus || ""}
            onChange={(e) => setFilterStatus(e.target.value || null)}
            fullWidth
          >
            <MenuItem value="">All Statuses</MenuItem>
            <MenuItem value="draft">Draft</MenuItem>
            <MenuItem value="final">Final</MenuItem>
            <MenuItem value="approved">Approved</MenuItem>
          </TextField>
          <TextField
            label="Fiscal Year"
            type="number"
            size="small"
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value ? Number(e.target.value) : "")}
            fullWidth
          />
        </Box>
      }
      renderItem={(stmt: CashFlowStatement, isSelected: boolean) => (
        <SelectableListItem
          key={stmt.id}
          id={stmt.id}
          isSelected={isSelected}
          onClick={() => setSelectedStatement(stmt)}
          primaryText={
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <span>{stmt.statement_no}</span>
              <Chip
                label={stmt.status}
                size="small"
                color={getStatusColor(stmt.status)}
                variant="outlined"
              />
            </Box>
          }
          secondaryText={
            !isSelected
              ? `FY ${stmt.fiscal_year} | ${format(new Date(stmt.start_date), "dd/MM")} - ${format(new Date(stmt.end_date), "dd/MM/yyyy")}`
              : undefined
          }
        />
      )}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detail = statementDetail || selectedStatement;

  // Group lines by section
  const operatingLines = detail?.lines?.filter((l) => l.section === "Operating") || [];
  const investingLines = detail?.lines?.filter((l) => l.section === "Investing") || [];
  const financingLines = detail?.lines?.filter((l) => l.section === "Financing") || [];

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance" },
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

      {detail && (
        <>
          {/* Action Buttons */}
          <Box sx={{ display: "flex", gap: 1, p: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", flexWrap: "wrap" }}>
            {detail.status === "draft" && (
              <>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<LockIcon />}
                  onClick={handleFinalize}
                >
                  Finalize
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </>
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

          <Box sx={{ p: 2, overflow: "auto" }}>
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
            <FormSection title="Statement Information">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: 180 }}>Period</TableCell>
                    <TableCell>
                      {format(new Date(detail.start_date), "dd/MM/yyyy")} -{" "}
                      {format(new Date(detail.end_date), "dd/MM/yyyy")}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Fiscal Year</TableCell>
                    <TableCell>{detail.fiscal_year}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Method</TableCell>
                    <TableCell>{detail.method}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </FormSection>

            {/* Cash Flow Sections */}
            <FormSection title="Cash from Operating Activities">
              <SectionTable
                lines={operatingLines}
                netAmount={detail.net_cash_from_operating}
              />
            </FormSection>

            <FormSection title="Cash from Investing Activities">
              <SectionTable
                lines={investingLines}
                netAmount={detail.net_cash_from_investing}
              />
            </FormSection>

            <FormSection title="Cash from Financing Activities">
              <SectionTable
                lines={financingLines}
                netAmount={detail.net_cash_from_financing}
              />
            </FormSection>
          </Box>
        </>
      )}

      {!detail && (
        <EmptyState message="Select a cash flow statement from the list to view details" />
      )}
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <MasterDetailLayout
        title="Cash Flow Statements"
        icon={<MonetizationOnIcon color="primary" />}
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

      <TConfirmDialog {...deleteDialog.dialogProps} />
      <TConfirmDialog {...finalizeDialog.dialogProps} />
      <TConfirmDialog {...approveDialog.dialogProps} />
    </Box>
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
    <Paper variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Description</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.line_number}>
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
          <TableRow sx={{ bgcolor: "action.hover" }}>
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
