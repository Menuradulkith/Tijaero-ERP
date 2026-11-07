/**
 * VatReturnPage — VAT on sales minus VAT on purchases for a period.
 *
 * Every taxed sale, sale return and supplier invoice writes a row to the tax
 * ledger; this page totals them by tax code, shows the documents behind each
 * line, checks the totals against the VAT accounts in the GL, and settles the
 * period (moves the net VAT to "VAT due to tax authority").
 *
 * Same layout as the other report pages: period in the header row, sections
 * below. The summary leads with what is still to pay (the amount Settle would
 * clear); the Settle button sits with the settlement section at the bottom.
 */

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { usePermission } from "@/auth/permissions";
import {
  FormSection,
  MasterDetailLayout,
  TChip,
  TConfirmDialog,
  TCurrency,
  TDataGrid,
  type TDataGridColumn,
  handleApiError,
  showSuccessToast,
  useConfirmDialog,
  TDatePicker,
} from "@/components/tijaero";
import { vatReturnApi } from "@/modules/finance/api";
import { displayDate, localDateISO, startOfMonthISO, todayISO } from "@/utils/formatters";
import { submitOnce } from "@/modules/finance/submitOnce";
import type { TaxTransaction, VatReturnLine, VatSettlement } from "@/modules/finance/types";
import { invalidateLedgerQueries } from "@/modules/finance/ledgerQueries";

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthStart = () => startOfMonthISO();
const monthEnd = () => {
  const t = new Date();
  return localDateISO(new Date(t.getFullYear(), t.getMonth() + 1, 0));
};

const DIRECTION_LABEL = { output: "VAT on sales (output VAT)", input: "VAT on purchases (input VAT)" } as const;

const lineId = (l: VatReturnLine) => `${l.direction}-${l.tax_code}-${l.tax_rate}`;

function Figure({ label, value, hint, color }: { label: string; value: number; hint?: string; color?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <TCurrency value={value} showSymbol={false} variant="subtitle1" fontWeight={700} sx={{ color }} />
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

const amountCol = (field: string, header: string) => ({
  field,
  header,
  width: 160,
  align: "right" as const,
  headerAlign: "right" as const,
  renderCell: (p: { value?: unknown }) => fmt(p.value as number),
});

export default function VatReturnPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  const canSettle = usePermission("accounting_periods", "update");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(monthEnd);
  const [drill, setDrill] = useState<VatReturnLine | null>(null);

  const valid = !!dateFrom && !!dateTo && dateFrom <= dateTo;
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["vat-return", dateFrom, dateTo],
    queryFn: () => vatReturnApi.get({ date_from: dateFrom, date_to: dateTo }),
    enabled: valid,
  });
  const { data: txns, isFetching: loadingTxns } = useQuery({
    queryKey: ["vat-return-transactions", dateFrom, dateTo, drill?.direction, drill?.tax_code, drill?.tax_rate],
    queryFn: () =>
      vatReturnApi.transactions({
        date_from: dateFrom,
        date_to: dateTo,
        direction: drill!.direction,
        tax_code: drill!.tax_code,
        tax_rate: drill!.tax_rate ?? undefined,
        limit: 500,
      }),
    enabled: valid && !!drill,
  });
  const { data: settlements = [] } = useQuery({ queryKey: ["vat-settlements"], queryFn: vatReturnApi.settlements });

  const settle = useMutation({
    mutationFn: () => vatReturnApi.settle({ date_to: dateTo }),
    onSuccess: (s) => {
      showSuccessToast(`VAT settled as ${s.settlement_no}.`);
      queryClient.invalidateQueries({ queryKey: ["vat-return"] });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["vat-settlements"] });
      queryClient.invalidateQueries({ queryKey: ["vat-return-transactions"] });
    },
    onError: (err) => handleApiError(err, "Could not settle VAT"),
  });

  const unsettledNet = data ? Number(data.unsettled_output_tax) - Number(data.unsettled_input_tax) : 0;
  const hasUnsettled = !!data && (Number(data.unsettled_output_tax) !== 0 || Number(data.unsettled_input_tax) !== 0);
  const todayStr = todayISO();
  const periodNotEnded = dateTo > todayStr;
  // Why Settle is greyed out (null = it can be pressed).
  const settleBlockedReason = !hasUnsettled
    ? `Nothing to settle: all VAT up to ${displayDate(dateTo)} is already settled.`
    : periodNotEnded
      ? `The period runs until ${displayDate(dateTo)}, which has not ended yet. Settle once it has ended, or set the "to" date to today or earlier.`
      : null;

  const handleSettle = async () => {
    if (!data) return;
    const ok = await confirmDialog.confirm({
      title: `Settle VAT up to ${displayDate(dateTo)}?`,
      message:
        `All VAT not yet settled up to ${displayDate(dateTo)} (from any earlier date too) is cleared: ` +
        `VAT on sales ${fmt(data.unsettled_output_tax)} minus VAT on purchases ${fmt(data.unsettled_input_tax)} = ` +
        `${fmt(Math.abs(unsettledNet))} ${unsettledNet >= 0 ? "to pay to" : "to claim back from"} the tax authority. ` +
        `This posts a journal entry and marks those rows as settled.`,
      confirmText: "Settle VAT",
    });
    if (ok) submitOnce("VatReturnPage-settle", settle);
  };

  const net = Number(data?.net_tax ?? 0);

  const lineColumns: TDataGridColumn<VatReturnLine>[] = [
    {
      field: "tax_code",
      header: "Tax Code",
      minWidth: 220,
      flex: 2,
      renderCell: (p) => (
        <Box component="span">
          <TChip size="small" variant="outlined" label={p.row.tax_code} sx={{ mr: 1 }} />
          {p.row.tax_name}
        </Box>
      ),
    },
    {
      field: "tax_rate",
      header: "Rate",
      width: 100,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => (p.row.tax_rate != null ? `${Number(p.row.tax_rate)}%` : "—"),
    },
    { field: "count", header: "Documents", width: 120, type: "number" },
    amountCol("base_amount", "Value before VAT"),
    amountCol("tax_amount", "VAT"),
  ];

  const txnColumns: TDataGridColumn<TaxTransaction>[] = [
    { field: "transaction_date", header: "Date", width: 120, renderCell: (p) => displayDate(p.row.transaction_date) },
    {
      field: "reference_no",
      header: "Document",
      minWidth: 200,
      flex: 1.5,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2 }}>
          {p.row.reference_no || `${p.row.reference_type} #${p.row.reference_id}`}
          <Typography variant="caption" color="text.secondary" display="block">
            {p.row.reference_type}
          </Typography>
        </Box>
      ),
    },
    { field: "journal_entry_no", header: "Journal Entry", minWidth: 150, flex: 1 },
    { field: "branch_code", header: "Branch", width: 110, renderCell: (p) => p.row.branch_code || "—" },
    amountCol("base_amount", "Value before VAT"),
    amountCol("tax_amount", "VAT"),
    {
      field: "settlement_id",
      header: "Settled",
      width: 100,
      align: "center",
      headerAlign: "center",
      renderCell: (p) => (p.row.settlement_id ? <TChip size="small" color="success" label="Yes" /> : "—"),
    },
  ];

  const settlementColumns: TDataGridColumn<VatSettlement>[] = [
    { field: "settlement_no", header: "Settlement", minWidth: 150, flex: 1 },
    { field: "date_to", header: "Up to", width: 120, renderCell: (p) => displayDate(p.row.date_to) },
    amountCol("output_tax", "Sales VAT"),
    amountCol("input_tax", "Purchase VAT"),
    {
      field: "net_tax",
      header: "Net",
      width: 200,
      align: "right",
      headerAlign: "right",
      renderCell: (p) =>
        `${fmt(Math.abs(Number(p.row.net_tax)))} ${Number(p.row.net_tax) >= 0 ? "payable" : "refundable"}`,
    },
  ];

  return (
    <MasterDetailLayout
      title="VAT Return"
      titleSlot={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <TDatePicker
            size="small"
            value={dateFrom}
            onChange={(v) => setDateFrom(v ?? "")}
            inputProps={{ "aria-label": "From date" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
          <Typography variant="body2" color="text.secondary">
            to
          </Typography>
          <TDatePicker
            size="small"
            value={dateTo}
            onChange={(v) => setDateTo(v ?? "")}
            inputProps={{ "aria-label": "To date" }}
            sx={{ width: 150, flexShrink: 0 }}
          />
        </Box>
      }
      onRefresh={valid ? () => refetch() : undefined}
      isLoading={isFetching}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!valid && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            The "From" date must be on or before the "To" date.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            Could not load the VAT return.
          </Alert>
        )}

        {data && (
          <>
            <FormSection title="Summary" columns={3}>
              <Figure
                label={unsettledNet >= 0 ? "VAT to pay (not yet settled)" : "VAT to claim back (not yet settled)"}
                value={Math.abs(unsettledNet)}
                hint={`Everything unsettled up to ${displayDate(dateTo)}, including earlier months`}
                color={unsettledNet > 0 ? "error.main" : unsettledNet < 0 ? "success.main" : undefined}
              />
              <Figure
                label="VAT on sales in this period"
                value={data.output_tax}
                hint={`Charged to customers, ${displayDate(dateFrom)} – ${displayDate(dateTo)}`}
              />
              <Figure
                label="VAT on purchases in this period"
                value={data.input_tax}
                hint={`Paid to suppliers, claimable · net ${fmt(Math.abs(net))} ${net >= 0 ? "to pay" : "to claim"}`}
              />
            </FormSection>

            {data.warnings.map((w) => (
              <Alert key={w} severity="warning" sx={{ mb: 1.5 }}>
                {w}
              </Alert>
            ))}

            {(["output", "input"] as const).map((dir) => {
              const lines = data.lines.filter((l) => l.direction === dir);
              const total = dir === "output" ? data.output_tax : data.input_tax;
              return (
                <FormSection
                  key={dir}
                  title={DIRECTION_LABEL[dir]}
                  columns={1}
                  titleAction={
                    <Typography variant="body2" fontWeight={700}>
                      Total {fmt(total)}
                    </Typography>
                  }
                >
                  <TDataGrid<VatReturnLine>
                    rows={lines}
                    columns={lineColumns}
                    getRowId={lineId}
                    onRowClick={(l) => setDrill(drill && lineId(drill) === lineId(l) ? null : l)}
                    pageSizeOptions={[10, 25, 50]}
                    pageSize={10}
                    emptyMessage="Nothing in this period."
                    autoHeight
                  />
                </FormSection>
              );
            })}

            {drill && (
              <FormSection
                title={`Documents: ${drill.tax_code} · ${DIRECTION_LABEL[drill.direction]}`}
                columns={1}
                titleAction={
                  <Button size="small" startIcon={<CloseIcon fontSize="small" />} onClick={() => setDrill(null)} sx={{ textTransform: "none" }}>
                    Close
                  </Button>
                }
              >
                <TDataGrid<TaxTransaction>
                  rows={txns?.items ?? []}
                  columns={txnColumns}
                  loading={loadingTxns || !txns}
                  pageSizeOptions={[10, 25, 50, 100]}
                  pageSize={25}
                  emptyMessage="No documents."
                  autoHeight
                />
              </FormSection>
            )}

            <FormSection title="Settlement" columns={1} isLast>
              <Typography variant="body2" color="text.secondary">
                {hasUnsettled
                  ? `Not yet settled up to ${displayDate(dateTo)}: sales VAT ${fmt(data.unsettled_output_tax)}, purchase VAT ${fmt(
                      data.unsettled_input_tax
                    )} → ${fmt(Math.abs(unsettledNet))} ${unsettledNet >= 0 ? "to pay" : "to claim back"}.`
                  : `All VAT up to ${displayDate(dateTo)} is settled.`}{" "}
                Settling moves it to “VAT due to tax authority”; record the actual payment to the tax authority from
                that account.
              </Typography>
              {canSettle && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", my: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={settle.isPending ? <CircularProgress size={16} /> : <AccountBalanceIcon />}
                    disabled={!!settleBlockedReason || settle.isPending}
                    onClick={handleSettle}
                  >
                    Settle VAT up to {displayDate(dateTo)}
                  </Button>
                  {settleBlockedReason && (
                    <Typography variant="caption" color="text.secondary">
                      {settleBlockedReason}
                    </Typography>
                  )}
                  {periodNotEnded && hasUnsettled && (
                    <Button
                      size="small"
                      onClick={() => setDateTo(todayStr < dateFrom ? dateFrom : todayStr)}
                      sx={{ textTransform: "none" }}
                    >
                      Use today as the end date
                    </Button>
                  )}
                </Box>
              )}
              {settlements.length > 0 && (
                <TDataGrid<VatSettlement>
                  rows={settlements}
                  columns={settlementColumns}
                  pageSizeOptions={[10, 25, 50]}
                  pageSize={10}
                  autoHeight
                />
              )}
            </FormSection>
          </>
        )}
      </Box>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </MasterDetailLayout>
  );
}
