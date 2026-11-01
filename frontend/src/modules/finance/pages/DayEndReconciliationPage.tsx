/**
 * DayEndReconciliationPage — "Do the books balance?"
 *
 * A single end-of-day screen that asserts, for a chosen date (and optional
 * branch):
 *   1. Trial balance — total GL debits == total GL credits.
 *   2. Cash reconciliation — GL cash/bank movement reconciles with the cashbook.
 *   3. Posting health — no pending GL posting failures, no unposted journal
 *      entries dated on the day.
 *
 * Shows one prominent "Books Balanced" / "Not Balanced" banner plus the
 * supporting numbers and any discrepancies. Same layout as the other report
 * pages: filters in the header row, sections below.
 */

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import { Alert, AlertTitle, Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  FormSection,
  MasterDetailLayout,
  TBranchFilter,
  TChip,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { reconciliationApi } from "@/modules/finance/api";
import type { DayEndReconciliation } from "@/modules/finance/types";

const money = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(Number(n || 0));

const todayIso = () => new Date().toISOString().slice(0, 10);

// ─── Compact check tile (sits inside a FormSection grid) ─────────────────────
interface TileProps {
  title: string;
  ok: boolean;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  onClick?: () => void;
}

function StatTile({ title, ok, icon, primary, secondary, onClick }: TileProps) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.25,
        border: "1px solid",
        borderRadius: 1,
        borderColor: ok ? "success.light" : "error.light",
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow .2s",
        "&:hover": onClick ? { boxShadow: 2 } : undefined,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        <Box sx={{ color: ok ? "success.main" : "error.main", display: "flex" }}>{icon}</Box>
        <Typography variant="caption" color="text.secondary">
          {title}
        </Typography>
        <Box flexGrow={1} />
        <TChip size="small" color={ok ? "success" : "error"} label={ok ? "OK" : "Check"} />
      </Stack>
      <Typography variant="subtitle1" fontWeight={700}>
        {primary}
      </Typography>
      {secondary && (
        <Typography variant="caption" color="text.secondary">
          {secondary}
        </Typography>
      )}
    </Box>
  );
}

interface BreakdownRow {
  id: string;
  label: string;
  amount: number;
  strong?: boolean;
}

interface FindingRow {
  id: string;
  kind: "discrepancy" | "warning";
  message: string;
}

export default function DayEndReconciliationPage() {
  const navigate = useNavigate();
  const { filteredBranches } = useReferenceData(["branches"]);
  const [reconDate, setReconDate] = useState<string>(todayIso());
  const [branchCode, setBranchCode] = useState<string>("");

  const { data, isFetching, refetch } = useQuery<DayEndReconciliation>({
    queryKey: ["day-end-reconciliation", reconDate, branchCode],
    queryFn: () =>
      reconciliationApi.dayEnd({
        date: reconDate || undefined,
        branch_code: branchCode || undefined,
      }),
  });

  const breakdown: BreakdownRow[] = data
    ? [
        { id: "gl-cash", label: "GL — Cash on Hand (1010)", amount: data.gl_cash_movement },
        { id: "gl-bank", label: "GL — Bank Account (1020)", amount: data.gl_bank_movement },
        { id: "gl-net", label: "GL cash + bank net", amount: data.gl_cash_bank_net, strong: true },
        { id: "cb-in", label: "Cashbook money in", amount: data.cashbook_money_in },
        { id: "cb-out", label: "Cashbook money out", amount: data.cashbook_money_out },
        { id: "cb-net", label: "Cashbook net", amount: data.cashbook_net },
        { id: "cb-dep", label: "+ Bank deposits (internal transfer)", amount: data.cashbook_bank_deposits },
        {
          id: "expected",
          label: "Expected GL net",
          amount: data.cashbook_net + data.cashbook_bank_deposits,
          strong: true,
        },
        { id: "diff", label: "Difference", amount: data.cash_difference, strong: true },
      ]
    : [];

  const findings: FindingRow[] = data
    ? [
        ...data.discrepancies.map((m, i) => ({ id: `d-${i}`, kind: "discrepancy" as const, message: m })),
        ...data.warnings.map((m, i) => ({ id: `w-${i}`, kind: "warning" as const, message: m })),
      ]
    : [];

  const breakdownColumns: TDataGridColumn<BreakdownRow>[] = [
    {
      field: "label",
      header: "Item",
      minWidth: 240,
      flex: 2,
      sortable: false,
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={p.row.strong ? 700 : 400}>
          {p.row.label}
        </Typography>
      ),
    },
    {
      field: "amount",
      header: "Amount",
      width: 180,
      align: "right",
      headerAlign: "right",
      sortable: false,
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={p.row.strong ? 700 : 500}>
          {money(p.row.amount)}
        </Typography>
      ),
    },
  ];

  const findingColumns: TDataGridColumn<FindingRow>[] = [
    {
      field: "kind",
      header: "Type",
      width: 130,
      renderCell: (p) => (
        <TChip
          size="small"
          color={p.row.kind === "discrepancy" ? "error" : "warning"}
          label={p.row.kind === "discrepancy" ? "Discrepancy" : "Warning"}
        />
      ),
    },
    { field: "message", header: "Finding", minWidth: 300, flex: 1, sortable: false },
  ];

  return (
    <MasterDetailLayout
      title="Day-End Reconciliation"
      titleSlot={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <TextField
            type="date"
            size="small"
            value={reconDate}
            onChange={(e) => setReconDate(e.target.value)}
            inputProps={{ "aria-label": "Date" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
          <Box sx={{ width: 150, flexShrink: 0 }}>
            <TBranchFilter
              branches={filteredBranches || []}
              value={branchCode || null}
              onChange={(v) => setBranchCode(v ?? "")}
              label=""
              size="small"
            />
          </Box>
        </Box>
      }
      onRefresh={() => refetch()}
      isLoading={isFetching}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!data ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Banner */}
            <Alert
              icon={data.is_balanced ? <CheckCircleIcon fontSize="inherit" /> : <ReportProblemIcon fontSize="inherit" />}
              severity={data.is_balanced ? "success" : "error"}
              sx={{ mb: 1.5, alignItems: "center", "& .MuiAlert-message": { width: "100%" } }}
            >
              <AlertTitle sx={{ fontWeight: 700, mb: 0 }}>
                {data.is_balanced ? "Books Balanced ✓" : "Books NOT Balanced"}
              </AlertTitle>
              <Typography variant="body2">
                {data.reconciliation_date}
                {data.branch_code ? ` · Branch ${data.branch_code}` : " · All branches"}
              </Typography>
            </Alert>

            <FormSection title="Checks" columns={4}>
              <StatTile
                title="Trial Balance"
                ok={data.trial_balanced}
                icon={<FactCheckIcon fontSize="small" />}
                primary={data.trial_balanced ? "Balanced" : "Out of balance"}
                secondary={`Dr ${money(data.gl_total_debit)} · Cr ${money(data.gl_total_credit)}`}
              />
              <StatTile
                title="Cash & Bank"
                ok={data.cash_reconciled}
                icon={<AccountBalanceIcon fontSize="small" />}
                primary={data.cash_reconciled ? "Reconciled" : `Off by ${money(data.cash_difference)}`}
                secondary={`GL net ${money(data.gl_cash_bank_net)}`}
              />
              <StatTile
                title="Posting Failures"
                ok={data.posting_failures_pending === 0}
                icon={<ReportProblemIcon fontSize="small" />}
                primary={`${data.posting_failures_pending} pending`}
                secondary={data.posting_failures_pending ? "Click to review & retry" : "None"}
                onClick={() => navigate("/finance/posting-failures")}
              />
              <StatTile
                title="Unposted Entries"
                ok={data.unposted_je_count === 0}
                icon={<ReceiptLongIcon fontSize="small" />}
                primary={`${data.unposted_je_count} unposted`}
                secondary={`${data.submitted_je_count} awaiting approval`}
              />
            </FormSection>

            <FormSection title="Cash / Bank Reconciliation" columns={1}>
              <Typography variant="caption" color="text.secondary">
                GL cash &amp; bank movement should equal the cashbook net plus bank deposits.
              </Typography>
              <TDataGrid<BreakdownRow>
                rows={breakdown}
                columns={breakdownColumns}
                pageSizeOptions={[25]}
                pageSize={25}
                disableColumnMenu
                autoHeight
              />
            </FormSection>

            <FormSection title="Findings" columns={1} isLast>
              {findings.length === 0 ? (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "success.main" }}>
                  <CheckCircleIcon fontSize="small" />
                  <Typography variant="body2">No issues found for this day.</Typography>
                </Stack>
              ) : (
                <TDataGrid<FindingRow>
                  rows={findings}
                  columns={findingColumns}
                  pageSizeOptions={[25, 50]}
                  pageSize={25}
                  autoHeight
                />
              )}
            </FormSection>
          </>
        )}
      </Box>
    </MasterDetailLayout>
  );
}
