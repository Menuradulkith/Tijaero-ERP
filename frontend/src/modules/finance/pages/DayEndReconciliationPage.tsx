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
import { Alert, AlertTitle, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { displayDate, formatCurrency, todayISO } from "@/utils/formatters";

import {
  FormSection,
  MasterDetailLayout,
  TBranchFilter,
  TChip,
  TDataGrid,
  type TDataGridColumn,
  TDatePicker,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { reconciliationApi } from "@/modules/finance/api";
import type { DayEndReconciliation } from "@/modules/finance/types";

// "Rs. 1,000.00" like the rest of the app.
const money = (n: number | null | undefined) => formatCurrency(Number(n || 0));

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
  const [reconDate, setReconDate] = useState<string>(todayISO());
  const [branchCode, setBranchCode] = useState<string>("");

  const { data, isFetching, refetch } = useQuery<DayEndReconciliation>({
    queryKey: ["day-end-reconciliation", reconDate, branchCode],
    queryFn: () =>
      reconciliationApi.dayEnd({
        date: reconDate || undefined,
        branch_code: branchCode || undefined,
      }),
  });

  // Cheques taken but not yet banked = the rest of the ledger's cash + bank change.
  const chequeMovement = data ? data.gl_cash_bank_net - data.gl_cash_movement - data.gl_bank_movement : 0;
  const breakdown: BreakdownRow[] = data
    ? [
        { id: "gl-cash", label: "Cash in till (change on the day)", amount: data.gl_cash_movement },
        { id: "gl-bank", label: "Bank (change on the day)", amount: data.gl_bank_movement },
        ...(Math.abs(chequeMovement) > 0.005
          ? [{ id: "gl-chq", label: "Cheques in hand (change on the day)", amount: chequeMovement }]
          : []),
        { id: "gl-net", label: "Ledger says", amount: data.gl_cash_bank_net, strong: true },
        { id: "cb-in", label: "Money in", amount: data.cashbook_money_in },
        { id: "cb-out", label: "Money out", amount: -data.cashbook_money_out },
        { id: "cb-dep", label: "Cash taken to the bank (not money out)", amount: data.cashbook_bank_deposits },
        {
          id: "expected",
          label: "Cashbook says",
          amount: data.cashbook_net + data.cashbook_bank_deposits,
          strong: true,
        },
        { id: "diff", label: "Difference", amount: data.cash_difference, strong: true },
      ]
    : [];

  // "Do the books balance?" is about the day's figures. Old posting failures and
  // unposted entries need attention but do not make today's books wrong.
  const booksBalance = !!data && data.trial_balanced && data.cash_reconciled;
  const attention: { text: string; to: string; link: string }[] = data
    ? [
        ...(data.posting_failures_pending
          ? [{
              text: `${data.posting_failures_pending} posting${data.posting_failures_pending === 1 ? "" : "s"} need${data.posting_failures_pending === 1 ? "s" : ""} attention`,
              to: "/finance/posting-failures",
              link: "Posting Failures",
            }]
          : []),
        ...(data.unposted_je_count
          ? [{
              text: `${data.unposted_je_count} journal entr${data.unposted_je_count === 1 ? "y is" : "ies are"} not posted yet`,
              to: "/finance/journal-entries",
              link: "Journal Entries",
            }]
          : []),
      ]
    : [];
  const headline = !data
    ? ""
    : !booksBalance
      ? "The books do not balance for this day"
      : attention.length
        ? `The books balance for this day — ${attention.map((a) => a.text).join(", ")}`
        : "The books balance for this day";
  const severity = !booksBalance ? "error" : attention.length ? "warning" : "success";

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
          label={p.row.kind === "discrepancy" ? "Problem" : "Note"}
        />
      ),
    },
    { field: "message", header: "What we found", minWidth: 300, flex: 1, sortable: false },
  ];

  return (
    <MasterDetailLayout
      title="Day-End Reconciliation"
      titleSlot={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <Box sx={{ flexShrink: 0 }}>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
              Day-End Reconciliation
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Do the day&apos;s cash, bank and entries add up?
            </Typography>
          </Box>
          <TDatePicker
            size="small"
            value={reconDate}
            onChange={(v) => setReconDate(v ?? "")}
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
              icon={booksBalance ? <CheckCircleIcon fontSize="inherit" /> : <ReportProblemIcon fontSize="inherit" />}
              severity={severity}
              sx={{ mb: 1.5, alignItems: "center", "& .MuiAlert-message": { width: "100%" } }}
              action={
                attention.length ? (
                  <Stack direction="row" spacing={1}>
                    {attention.map((a) => (
                      <Button key={a.to} size="small" color="inherit" onClick={() => navigate(a.to)} sx={{ textTransform: "none" }}>
                        Open {a.link}
                      </Button>
                    ))}
                  </Stack>
                ) : undefined
              }
            >
              <AlertTitle sx={{ fontWeight: 700, mb: 0 }}>{headline}</AlertTitle>
              <Typography variant="body2">
                {displayDate(data.reconciliation_date)}
                {data.branch_code ? ` · Branch ${data.branch_code}` : " · All branches"}
              </Typography>
            </Alert>

            <FormSection title="Checks" columns={4}>
              <StatTile
                title="Entries add up"
                ok={data.trial_balanced}
                icon={<FactCheckIcon fontSize="small" />}
                primary={data.trial_balanced ? "Yes" : "No"}
                secondary={
                  data.trial_balanced
                    ? `${money(data.gl_total_debit)} on both sides`
                    : `${money(data.gl_total_debit)} vs ${money(data.gl_total_credit)}`
                }
              />
              <StatTile
                title="Cash & Bank match the cashbook"
                ok={data.cash_reconciled}
                icon={<AccountBalanceIcon fontSize="small" />}
                primary={data.cash_reconciled ? "Yes" : `Off by ${money(data.cash_difference)}`}
                secondary={`Change on the day ${money(data.gl_cash_bank_net)}`}
              />
              <StatTile
                title="Posting Failures"
                ok={data.posting_failures_pending === 0}
                icon={<ReportProblemIcon fontSize="small" />}
                primary={`${data.posting_failures_pending} to fix`}
                secondary={data.posting_failures_pending ? "Any day — click to review & retry" : "None"}
                onClick={() => navigate("/finance/posting-failures")}
              />
              <StatTile
                title="Unposted Entries"
                ok={data.unposted_je_count === 0}
                icon={<ReceiptLongIcon fontSize="small" />}
                primary={`${data.unposted_je_count} not posted`}
                secondary={`${data.submitted_je_count} waiting for approval`}
                onClick={data.unposted_je_count ? () => navigate("/finance/journal-entries") : undefined}
              />
            </FormSection>

            <FormSection title="Cash & Bank Check" columns={1}>
              <Typography variant="caption" color="text.secondary">
                What the ledger says should equal what the cashbook says. Cash taken to the bank is not money out — it
                only moves from the till to the bank.
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
