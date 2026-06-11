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
 * supporting numbers and any discrepancies.
 */

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { reconciliationApi } from "@/modules/finance/api";
import type { DayEndReconciliation } from "@/modules/finance/types";

const money = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(Number(n || 0));

const todayIso = () => new Date().toISOString().slice(0, 10);

// ─── Small presentational tile ───────────────────────────────────────────────
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
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderColor: ok ? "success.light" : "error.light",
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow .2s",
        "&:hover": onClick ? { boxShadow: 3 } : undefined,
      }}
      onClick={onClick}
    >
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" mb={1}>
          <Box sx={{ color: ok ? "success.main" : "error.main", display: "flex" }}>
            {icon}
          </Box>
          <Typography variant="subtitle2" color="text.secondary">
            {title}
          </Typography>
          <Box flexGrow={1} />
          <Chip
            size="small"
            color={ok ? "success" : "error"}
            label={ok ? "OK" : "Check"}
          />
        </Stack>
        <Typography variant="h6" fontWeight={700}>
          {primary}
        </Typography>
        {secondary && (
          <Typography variant="body2" color="text.secondary">
            {secondary}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Row helper for the breakdown card ───────────────────────────────────────
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={strong ? 700 : 500}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function DayEndReconciliationPage() {
  const navigate = useNavigate();
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

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
        mb={3}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Day-End Reconciliation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Confirm the books balance for the day before closing.
          </Typography>
        </Box>
        <Box flexGrow={1} />
        <TextField
          label="Date"
          type="date"
          size="small"
          value={reconDate}
          onChange={(e) => setReconDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="Branch (optional)"
          size="small"
          value={branchCode}
          onChange={(e) => setBranchCode(e.target.value)}
          placeholder="All branches"
          sx={{ minWidth: 160 }}
        />
        <Button
          variant="outlined"
          startIcon={isFetching ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          Refresh
        </Button>
      </Stack>

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
            sx={{ mb: 3, alignItems: "center", "& .MuiAlert-message": { width: "100%" } }}
          >
            <AlertTitle sx={{ fontWeight: 700, mb: 0 }}>
              {data.is_balanced ? "Books Balanced ✓" : "Books NOT Balanced"}
            </AlertTitle>
            <Typography variant="body2">
              {data.reconciliation_date}
              {data.branch_code ? ` · Branch ${data.branch_code}` : " · All branches"}
            </Typography>
          </Alert>

          {/* Stat tiles */}
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid item xs={12} sm={6} md={3}>
              <StatTile
                title="Trial Balance"
                ok={data.trial_balanced}
                icon={<FactCheckIcon />}
                primary={data.trial_balanced ? "Balanced" : "Out of balance"}
                secondary={`Dr ${money(data.gl_total_debit)} · Cr ${money(data.gl_total_credit)}`}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatTile
                title="Cash & Bank"
                ok={data.cash_reconciled}
                icon={<AccountBalanceIcon />}
                primary={data.cash_reconciled ? "Reconciled" : `Off by ${money(data.cash_difference)}`}
                secondary={`GL net ${money(data.gl_cash_bank_net)}`}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatTile
                title="Posting Failures"
                ok={data.posting_failures_pending === 0}
                icon={<ReportProblemIcon />}
                primary={`${data.posting_failures_pending} pending`}
                secondary={data.posting_failures_pending ? "Click to review & retry" : "None"}
                onClick={() => navigate("/finance/posting-failures")}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatTile
                title="Unposted Entries"
                ok={data.unposted_je_count === 0}
                icon={<ReceiptLongIcon />}
                primary={`${data.unposted_je_count} unposted`}
                secondary={`${data.submitted_je_count} awaiting approval`}
              />
            </Grid>
          </Grid>

          <Grid container spacing={2} sx={{ mt: 0 }}>
            {/* Cash reconciliation breakdown */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: "100%" }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    Cash / Bank Reconciliation
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    GL cash &amp; bank movement should equal the cashbook net plus bank deposits.
                  </Typography>
                  <Divider sx={{ my: 1.5 }} />
                  <Row label="GL — Cash on Hand (1010)" value={money(data.gl_cash_movement)} />
                  <Row label="GL — Bank Account (1020)" value={money(data.gl_bank_movement)} />
                  <Row label="GL cash + bank net" value={money(data.gl_cash_bank_net)} strong />
                  <Divider sx={{ my: 1.5 }} />
                  <Row label="Cashbook money in" value={money(data.cashbook_money_in)} />
                  <Row label="Cashbook money out" value={money(data.cashbook_money_out)} />
                  <Row label="Cashbook net" value={money(data.cashbook_net)} />
                  <Row label="+ Bank deposits (internal transfer)" value={money(data.cashbook_bank_deposits)} />
                  <Row
                    label="Expected GL net"
                    value={money(data.cashbook_net + data.cashbook_bank_deposits)}
                    strong
                  />
                  <Divider sx={{ my: 1.5 }} />
                  <Row label="Difference" value={money(data.cash_difference)} strong />
                </CardContent>
              </Card>
            </Grid>

            {/* Discrepancies & warnings */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ height: "100%" }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    Findings
                  </Typography>
                  {data.discrepancies.length === 0 && data.warnings.length === 0 ? (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "success.main", mt: 1 }}>
                      <CheckCircleIcon fontSize="small" />
                      <Typography variant="body2">No issues found for this day.</Typography>
                    </Stack>
                  ) : (
                    <List dense>
                      {data.discrepancies.map((d, i) => (
                        <ListItem key={`d-${i}`} disableGutters alignItems="flex-start">
                          <ListItemIcon sx={{ minWidth: 32, color: "error.main", mt: 0.5 }}>
                            <ErrorOutlineIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText primary={d} primaryTypographyProps={{ variant: "body2" }} />
                        </ListItem>
                      ))}
                      {data.warnings.map((w, i) => (
                        <ListItem key={`w-${i}`} disableGutters alignItems="flex-start">
                          <ListItemIcon sx={{ minWidth: 32, color: "warning.main", mt: 0.5 }}>
                            <ReportProblemIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText primary={w} primaryTypographyProps={{ variant: "body2" }} />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
}
