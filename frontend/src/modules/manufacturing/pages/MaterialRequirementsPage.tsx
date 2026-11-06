/**
 * MaterialRequirementsPage - demand-driven MRP.
 *
 * Per product and branch (an order can only draw stock of its own branch):
 *   demand  = open quotation lines + components of open production orders
 *             + components of planned production (BOM explosion)
 *   supply  = free stock + open purchase orders + open production orders
 *   suggested quantity = what brings the projected stock back to zero, or up to the
 *             reordering rule's max (min when no max) when it falls below the rule's min
 * Selected suggestions are firmed into purchase orders (one per supplier) or draft
 * production orders. Expanding a row lists where the demand comes from.
 */

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import RuleIcon from "@mui/icons-material/Rule";
import SearchIcon from "@mui/icons-material/Search";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  fmtLKR,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TChip,
  TDataGrid,
  type TDataGridColumn,
  TSidePanel,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { useReferenceData } from "@/hooks";
import { planningApi, errorAlreadyToasted } from "@/modules/manufacturing/api";
import { ProduceFirmDialog, PurchaseFirmDialog } from "@/modules/manufacturing/components/MrpFirmDialogs";
import type { MrpDemandSource, MrpLine } from "@/modules/manufacturing/types";
import { useCurrencyStore } from "@/state/currencyStore";
import { formatDate } from "@/utils/formatters";

type MrpRow = MrpLine & { id: string };

const lineKey = (line: MrpLine) => `${line.product_id}:${line.branch_code}`;
const todayIso = () => formatDate(new Date());
const isLateOrder = (line: MrpLine) =>
  line.suggested_quantity > 0 && !!line.order_by_date && line.order_by_date < todayIso();

const SOURCE_LABELS: Record<MrpDemandSource["source_type"], string> = {
  quotation: "Quotation",
  production_order: "Production order",
  planned: "Planned production",
  reorder: "Reordering rule",
};

const groupByBranch = <T extends { line: MrpLine }>(rows: T[]) =>
  rows.reduce<Record<string, T[]>>((acc, r) => {
    (acc[r.line.branch_code] ||= []).push(r);
    return acc;
  }, {});

export default function MaterialRequirementsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canFirm = usePermission("mrp", "update");
  const canCreatePO = usePermission("purchase_orders", "create");
  const canCreateMO = usePermission("production_orders", "create");

  const [searchQuery, setSearchQuery] = useState("");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [shortagesOnly, setShortagesOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourcesFor, setSourcesFor] = useState<MrpRow | null>(null);
  const [dialog, setDialog] = useState<"purchase" | "produce" | null>(null);
  const [saving, setSaving] = useState(false);
  // In-flight guard: firming runs several requests, so a double click must never start a second run
  const firmBusyRef = useRef(false);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["mrp", filterBranch, shortagesOnly],
    queryFn: () => planningApi.getMrp({ branch_code: filterBranch || undefined, shortages_only: shortagesOnly }),
    enabled: branchResolved,
  });

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lines.filter(
      (l) => !q || l.product_name.toLowerCase().includes(q) || l.product_code.toLowerCase().includes(q)
    );
  }, [lines, searchQuery]);

  const gridRows: MrpRow[] = useMemo(() => rows.map((r) => ({ ...r, id: lineKey(r) })), [rows]);

  // Selection only ever holds rows that still have a suggestion
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => rows.some((r) => lineKey(r) === k && r.suggested_quantity > 0)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  // Memoised so the firm dialogs only reset their edits when the selection really changes
  const toBuy = useMemo(
    () => rows.filter((r) => selected.has(lineKey(r)) && r.suggested_action === "purchase"),
    [rows, selected]
  );
  const toMake = useMemo(
    () => rows.filter((r) => selected.has(lineKey(r)) && r.suggested_action === "produce"),
    [rows, selected]
  );

  const totals = useMemo(
    () => ({
      planned: rows.filter((r) => r.suggested_quantity > 0).length,
      value: rows.reduce((sum, r) => sum + Number(r.suggested_value), 0),
      toBuy: rows.filter((r) => r.suggested_action === "purchase").length,
      toMake: rows.filter((r) => r.suggested_action === "produce").length,
      late: rows.filter(isLateOrder).length,
    }),
    [rows]
  );

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const selectable = rows.filter((r) => r.suggested_quantity > 0);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(lineKey(r)));

  const refreshAfterFirm = () => {
    for (const key of [["mrp"], ["purchaseOrders"], ["production-orders"], ["manufacturing-dashboard"]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const afterFirm = (kind: string, numbers: string[]) => {
    showSuccessToast(`${numbers.length} ${kind} created: ${numbers.join(", ")}`);
    setDialog(null);
    setSelected(new Set());
    refreshAfterFirm();
  };

  // Firming runs one request per branch. When a later branch fails, the earlier ones are already
  // created: close the dialog and drop those lines, so a retry (on the refreshed MRP) cannot repeat them.
  const afterPartialFirm = (kind: string, numbers: string[], doneBranches: string[], error: unknown) => {
    const reason = handleApiError(error, `Failed to create ${kind}`);
    if (!numbers.length) {
      if (!errorAlreadyToasted(error)) showErrorToast(reason);
      return;
    }
    showErrorToast(`${numbers.length} ${kind} created (${numbers.join(", ")}), then: ${reason}`);
    setDialog(null);
    setSelected((prev) => new Set([...prev].filter((k) => !doneBranches.some((b) => k.endsWith(`:${b}`)))));
    refreshAfterFirm();
  };

  const handlePurchase: React.ComponentProps<typeof PurchaseFirmDialog>["onSubmit"] = async (data) => {
    if (firmBusyRef.current) return;
    firmBusyRef.current = true;
    setSaving(true);
    const numbers: string[] = [];
    const doneBranches: string[] = [];
    try {
      for (const [branch, rowsOfBranch] of Object.entries(groupByBranch(data.rows))) {
        const res = await planningApi.createPurchaseOrders({
          branch_code: branch,
          expected_date: data.expected_date,
          lines: rowsOfBranch.map((r) => ({
            product_id: r.line.product_id,
            quantity: r.quantity,
            supplier_id: r.supplier_id,
            unit_price: r.unit_price,
          })),
        });
        numbers.push(...res.documents.map((d) => d.number));
        doneBranches.push(branch);
      }
      afterFirm("purchase order(s)", numbers);
    } catch (error) {
      afterPartialFirm("purchase order(s)", numbers, doneBranches, error);
    } finally {
      firmBusyRef.current = false;
      setSaving(false);
    }
  };

  const handleProduce: React.ComponentProps<typeof ProduceFirmDialog>["onSubmit"] = async (data) => {
    if (firmBusyRef.current) return;
    firmBusyRef.current = true;
    setSaving(true);
    const numbers: string[] = [];
    const doneBranches: string[] = [];
    try {
      for (const [branch, rowsOfBranch] of Object.entries(groupByBranch(data.rows))) {
        const res = await planningApi.createProductionOrders({
          branch_code: branch,
          priority: data.priority,
          lines: rowsOfBranch.map((r) => ({
            product_id: r.line.product_id,
            quantity: r.quantity,
            bom_id: r.line.bom_id,
            planned_start_date: r.planned_start_date,
            planned_end_date: r.planned_end_date,
          })),
        });
        numbers.push(...res.documents.map((d) => d.number));
        doneBranches.push(branch);
      }
      afterFirm("production order(s)", numbers);
    } catch (error) {
      afterPartialFirm("production order(s)", numbers, doneBranches, error);
    } finally {
      firmBusyRef.current = false;
      setSaving(false);
    }
  };

  const actionChip = (line: MrpLine) =>
    line.suggested_action === "produce" ? (
      <TChip label="Produce" size="small" color="secondary" />
    ) : line.suggested_action === "purchase" ? (
      <TChip label="Purchase" size="small" color="warning" />
    ) : (
      <TChip label="Covered" size="small" color="success" variant="outlined" />
    );

  const sourceLink = (src: MrpDemandSource) => {
    if (src.source_type === "production_order" && src.document_id) return `/manufacturing/orders?order=${src.document_id}`;
    if (src.source_type === "quotation") return "/sales/quotations";
    if (src.source_type === "reorder") return "/manufacturing/reorder-rules";
    return null;
  };

  const columns: TDataGridColumn<MrpRow>[] = [
    ...(canFirm
      ? [{
          field: "select",
          header: "",
          width: 52,
          sortable: false,
          align: "center",
          headerAlign: "center",
          renderCell: (params: GridRenderCellParams<MrpRow>) =>
            params.row.suggested_quantity > 0 ? (
              <Checkbox
                size="small"
                checked={selected.has(params.row.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(selected, setSelected, params.row.id)}
                inputProps={{ "aria-label": `Select ${params.row.product_name}` }}
              />
            ) : null,
        } as TDataGridColumn<MrpRow>]
      : []),
    {
      field: "product_name",
      header: "Item",
      flex: 1,
      minWidth: 200,
      renderCell: (params: GridRenderCellParams<MrpRow>) => (
        <Box sx={{ lineHeight: 1.2, py: 0.5, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{params.row.product_name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {params.row.product_code}{params.row.unit_of_measure ? ` · ${params.row.unit_of_measure}` : ""}
            {params.row.low_level_code > 0 ? ` · level ${params.row.low_level_code}` : ""}
          </Typography>
        </Box>
      ),
    },
    { field: "branch_code", header: "Branch", width: 100 },
    {
      field: "total_demand",
      header: "Demand",
      width: 90,
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<MrpRow>) => (
        <Tooltip title={`Quotations ${params.row.quote_demand} · Production orders ${params.row.production_demand} · Planned ${params.row.planned_demand}`}>
          <span>{params.row.total_demand}</span>
        </Tooltip>
      ),
    },
    { field: "on_hand_quantity", header: "On Hand", width: 90, type: "number" },
    { field: "on_order_quantity", header: "On Order", width: 90, type: "number" },
    {
      field: "in_production_quantity",
      header: "In Production",
      width: 110,
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<MrpRow>) => (params.row.is_manufactured ? params.row.in_production_quantity : "-"),
    },
    {
      field: "min_quantity",
      header: "Min / Max",
      width: 100,
      align: "right",
      headerAlign: "right",
      sortable: false,
      renderCell: (params: GridRenderCellParams<MrpRow>) =>
        params.row.min_quantity != null ? `${params.row.min_quantity} / ${params.row.max_quantity ?? "-"}` : "-",
    },
    {
      field: "projected_quantity",
      header: "Projected",
      width: 95,
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<MrpRow>) => (
        <Typography variant="body2" color={params.row.projected_quantity < 0 ? "error.main" : undefined}>
          {params.row.projected_quantity}
        </Typography>
      ),
    },
    {
      field: "suggested_quantity",
      header: "Suggested",
      width: 95,
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<MrpRow>) => (
        <Typography variant="body2" fontWeight={700} color={params.row.suggested_quantity > 0 ? "error.main" : "success.main"}>
          {params.row.suggested_quantity}
        </Typography>
      ),
    },
    {
      field: "suggested_action",
      header: "Action",
      width: 110,
      renderCell: (params: GridRenderCellParams<MrpRow>) => actionChip(params.row),
    },
    {
      field: "order_by_date",
      header: "Order By",
      width: 110,
      renderCell: (params: GridRenderCellParams<MrpRow>) => (
        <Typography variant="body2" color={isLateOrder(params.row) ? "error.main" : undefined}>
          {params.row.order_by_date ? formatDate(params.row.order_by_date) : "-"}
        </Typography>
      ),
    },
    {
      field: "need_by_date",
      header: "Need By",
      width: 110,
      renderCell: (params: GridRenderCellParams<MrpRow>) => (params.row.need_by_date ? formatDate(params.row.need_by_date) : "-"),
    },
    {
      field: "preferred_supplier_name",
      header: "Supplier",
      width: 160,
      renderCell: (params: GridRenderCellParams<MrpRow>) =>
        params.row.suggested_action === "purchase" ? params.row.preferred_supplier_name || "-" : "-",
    },
    {
      field: "suggested_value",
      header: `Value (${currencySymbol})`,
      width: 120,
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<MrpRow>) => fmtLKR(Number(params.row.suggested_value)),
    },
    {
      field: "view",
      header: "",
      width: 56,
      sortable: false,
      align: "center",
      headerAlign: "center",
      renderCell: (params: GridRenderCellParams<MrpRow>) => (
        <Tooltip title="Demand sources">
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setSourcesFor(params.row); }}>
            <OpenInNewIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  const filtersSet = !!searchQuery || !!filterBranch || !shortagesOnly;

  return (
    <>
      <MasterDetailLayout
        title="Material Requirements"
        icon={<PlaylistAddCheckIcon />}
        titleSlot={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            <FormControlLabel
              control={<Checkbox size="small" checked={shortagesOnly} onChange={(e) => setShortagesOnly(e.target.checked)} />}
              label={<Typography variant="body2">Suggestions only</Typography>}
            />
            {filtersSet && (
              <Button size="small" sx={{ textTransform: "none" }}
                onClick={() => { setSearchQuery(""); setFilterBranch(null); setShortagesOnly(true); }}>
                Clear
              </Button>
            )}
          </Box>
        }
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["mrp"] })}
        isLoading={isLoading}
        headerActions={
          <Stack direction="row" spacing={1} sx={{ mr: 1 }}>
            <Button variant="outlined" size="small" startIcon={<RuleIcon />} sx={{ textTransform: "none" }}
              onClick={() => navigate("/manufacturing/reorder-rules")}>
              Reordering Rules
            </Button>
            {canFirm && canCreatePO && (
              <Button variant="contained" size="small" startIcon={<ShoppingCartIcon />}
                disabled={toBuy.length === 0 || saving} onClick={() => setDialog("purchase")}>
                Create POs{toBuy.length ? ` (${toBuy.length})` : ""}
              </Button>
            )}
            {canFirm && canCreateMO && (
              <Button variant="contained" size="small" startIcon={<PrecisionManufacturingIcon />}
                disabled={toMake.length === 0 || saving} onClick={() => setDialog("produce")}>
                Create Production Orders{toMake.length ? ` (${toMake.length})` : ""}
              </Button>
            )}
          </Stack>
        }
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 1.5, gap: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }} useFlexGap>
            {canFirm && (
              <FormControlLabel
                sx={{ mr: 1 }}
                disabled={selectable.length === 0}
                control={
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={!allSelected && selectable.some((r) => selected.has(lineKey(r)))}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map(lineKey)))}
                  />
                }
                label={<Typography variant="body2">Select all suggestions</Typography>}
              />
            )}
            <TChip label={`${totals.planned} planned order(s)`} color={totals.planned ? "error" : "success"} size="small" />
            <TChip label={`${totals.toBuy} to purchase`} color="warning" size="small" variant="outlined" />
            <TChip label={`${totals.toMake} to produce`} color="secondary" size="small" variant="outlined" />
            {totals.late > 0 && <TChip label={`${totals.late} past order-by date`} color="error" size="small" variant="outlined" />}
            <TChip label={`Planned value ${currencySymbol} ${fmtLKR(totals.value)}`} size="small" variant="outlined" />
          </Stack>
          <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
            <TDataGrid<MrpRow>
              rows={gridRows}
              columns={columns}
              loading={isLoading}
              onRowClick={(row) => setSourcesFor(row)}
              pageSizeOptions={[10, 25, 50, 100]}
              pageSize={25}
              emptyMessage={
                shortagesOnly
                  ? "Nothing to plan — demand from quotations, production orders and reordering rules is covered"
                  : "No demand from quotations, production orders or reordering rules"
              }
              exportFileName="material-requirements"
              autoHeight={false}
              height="100%"
            />
          </Box>
        </Box>
      </MasterDetailLayout>

      {/* Demand sources (read only) */}
      <TSidePanel open={!!sourcesFor} onClose={() => setSourcesFor(null)} title="Demand Sources" cancelText="Close">
        {sourcesFor && (
          <>
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>{sourcesFor.product_name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {sourcesFor.product_code} · {sourcesFor.branch_code}
              </Typography>
            </Box>
            <FormSection title="Demand" columns={1} isLast>
              {sourcesFor.demand_sources.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No demand — shown for its reordering rule</Typography>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {sourcesFor.demand_sources.map((src, i) => {
                    const link = sourceLink(src);
                    return (
                      <TChip
                        key={`${src.source_type}-${src.reference}-${i}`}
                        size="small"
                        variant="outlined"
                        icon={link ? <OpenInNewIcon fontSize="small" /> : undefined}
                        label={`${SOURCE_LABELS[src.source_type]} ${src.reference} · ${src.quantity}${src.need_date ? ` · ${formatDate(src.need_date)}` : ""}`}
                        onClick={link ? () => navigate(link) : undefined}
                      />
                    );
                  })}
                </Stack>
              )}
            </FormSection>
          </>
        )}
      </TSidePanel>

      <PurchaseFirmDialog open={dialog === "purchase"} lines={toBuy} saving={saving} onClose={() => setDialog(null)} onSubmit={handlePurchase} />
      <ProduceFirmDialog open={dialog === "produce"} lines={toMake} saving={saving} onClose={() => setDialog(null)} onSubmit={handleProduce} />
    </>
  );
}
