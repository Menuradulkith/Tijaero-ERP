/**
 * CostCenterProfitPage — income, costs and profit per cost center for a period.
 *
 * Same layout as the other report pages: filters in the header row, totals in a
 * form section, the cost centers in a grid.
 */

import { Alert, Box, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  FormSection,
  MasterDetailLayout,
  TCurrency,
  TDataGrid,
  type TDataGridColumn,
  TDatePicker,
} from "@/components/tijaero";
import { costCentersApi } from "@/modules/finance/api/costCenters";
import { localDateISO } from "@/utils/formatters";

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const iso = (d: Date) => localDateISO(d);
const now = new Date();
const MONTH_START = iso(new Date(now.getFullYear(), now.getMonth(), 1));
const MONTH_END = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

type ProfitLine = Awaited<ReturnType<typeof costCentersApi.profitReport>>["lines"][number];

function Figure({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <TCurrency value={value} variant="subtitle1" fontWeight={700} sx={{ color }} />
    </Box>
  );
}

export default function CostCenterProfitPage() {
  const [dateFrom, setDateFrom] = useState(MONTH_START);
  const [dateTo, setDateTo] = useState(MONTH_END);
  const valid = !!dateFrom && !!dateTo && dateFrom <= dateTo;
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["profit-by-cost-center", dateFrom, dateTo],
    queryFn: () => costCentersApi.profitReport({ date_from: dateFrom, date_to: dateTo }),
    enabled: valid,
  });
  const unassigned = data?.lines.find((l) => l.cost_center_id === null);

  const columns: TDataGridColumn<ProfitLine>[] = [
    {
      field: "name",
      header: "Cost Center",
      minWidth: 220,
      flex: 2,
      renderCell: (p) => (
        <Box component="span">
          {p.row.code && (
            <Typography component="span" variant="body2" fontWeight={600} sx={{ mr: 1 }}>
              {p.row.code}
            </Typography>
          )}
          {p.row.name}
        </Box>
      ),
    },
    { field: "income", header: "Income", width: 160, type: "currency", align: "right", headerAlign: "right" },
    { field: "costs", header: "Costs", width: 160, type: "currency", align: "right", headerAlign: "right" },
    {
      field: "profit",
      header: "Profit",
      width: 160,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => (
        <TCurrency
          value={p.row.profit}
          variant="body2"
          fontWeight={600}
          sx={{ color: Number(p.row.profit) < 0 ? "error.main" : undefined }}
        />
      ),
    },
  ];

  return (
    <MasterDetailLayout
      title="Profit by Cost Center"
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
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5, display: "flex", flexDirection: "column" }}>
        {!valid && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            The "From" date must be on or before the "To" date.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            Could not load the report.
          </Alert>
        )}
        {unassigned && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {fmt(Math.abs(Number(unassigned.income)) + Math.abs(Number(unassigned.costs)))} of income and costs has no
            cost center. Give each branch a default cost center (Accounting Setup → Cost Centers) so new entries are
            assigned automatically.
          </Alert>
        )}
        {data && (
          <FormSection title="Totals for the Period" columns={3}>
            <Figure label="Income" value={data.income} />
            <Figure label="Costs" value={data.costs} />
            <Figure label="Profit" value={data.profit} color={Number(data.profit) < 0 ? "error.main" : undefined} />
          </FormSection>
        )}
        <Box sx={{ flex: 1, minHeight: 320, display: "flex" }}>
          <TDataGrid<ProfitLine>
            rows={data?.lines ?? []}
            columns={columns}
            loading={isFetching}
            getRowId={(r) => r.cost_center_id ?? "none"}
            pageSizeOptions={[25, 50, 100]}
            pageSize={50}
            emptyMessage="No income or costs in this period."
            autoHeight={false}
            height="100%"
          />
        </Box>
      </Box>
    </MasterDetailLayout>
  );
}
