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

import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  EmptyState,
  fmtLKR,
  handleApiError,
  MasterDetailLayout,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  TBranchFilter,
  TChip,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { useReferenceData } from "@/hooks";
import { planningApi } from "@/modules/manufacturing/api";
import { ProduceFirmDialog, PurchaseFirmDialog } from "@/modules/manufacturing/components/MrpFirmDialogs";
import type { MrpDemandSource, MrpLine } from "@/modules/manufacturing/types";
import { useCurrencyStore } from "@/state/currencyStore";
import { formatDate } from "@/utils/formatters";

const lineKey = (line: MrpLine) => `${line.product_id}:${line.branch_code}`;
const todayIso = () => format(new Date(), "yyyy-MM-dd");

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"purchase" | "produce" | null>(null);
  const [saving, setSaving] = useState(false);

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
      late: rows.filter((r) => r.suggested_quantity > 0 && !!r.order_by_date && r.order_by_date < todayIso()).length,
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

  const afterFirm = (kind: string, numbers: string[]) => {
    showSuccessToast(`${numbers.length} ${kind} created: ${numbers.join(", ")}`);
    setDialog(null);
    setSelected(new Set());
    for (const key of [["mrp"], ["purchaseOrders"], ["production-orders"], ["manufacturing-dashboard"]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const handlePurchase: React.ComponentProps<typeof PurchaseFirmDialog>["onSubmit"] = async (data) => {
    setSaving(true);
    const numbers: string[] = [];
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
      }
      afterFirm("purchase order(s)", numbers);
    } catch (error) {
      showErrorToast(handleApiError(error, "Failed to create purchase orders"));
      if (numbers.length) queryClient.invalidateQueries({ queryKey: ["mrp"] });
    } finally {
      setSaving(false);
    }
  };

  const handleProduce: React.ComponentProps<typeof ProduceFirmDialog>["onSubmit"] = async (data) => {
    setSaving(true);
    const numbers: string[] = [];
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
      }
      afterFirm("production order(s)", numbers);
    } catch (error) {
      showErrorToast(handleApiError(error, "Failed to create production orders"));
      if (numbers.length) queryClient.invalidateQueries({ queryKey: ["mrp"] });
    } finally {
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

  return (
    <>
      <MasterDetailLayout
        title="Material Requirements"
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
              sx={{ width: 190, flexShrink: 0 }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            <FormControlLabel
              control={<Checkbox size="small" checked={shortagesOnly} onChange={(e) => setShortagesOnly(e.target.checked)} />}
              label={<Typography variant="body2">Suggestions only</Typography>}
            />
          </Box>
        }
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["mrp"] })}
        isLoading={isLoading}
        headerActions={
          <Stack direction="row" spacing={1} sx={{ mr: 1 }}>
            <Button variant="outlined" size="small" startIcon={<RuleIcon />} onClick={() => navigate("/manufacturing/reorder-rules")}>
              Reordering Rules
            </Button>
            {canFirm && canCreatePO && (
              <Button variant="contained" size="small" color="warning" startIcon={<ShoppingCartIcon />}
                disabled={toBuy.length === 0} onClick={() => setDialog("purchase")}>
                Create POs{toBuy.length ? ` (${toBuy.length})` : ""}
              </Button>
            )}
            {canFirm && canCreateMO && (
              <Button variant="contained" size="small" color="secondary" startIcon={<PrecisionManufacturingIcon />}
                disabled={toMake.length === 0} onClick={() => setDialog("produce")}>
                Create Production Orders{toMake.length ? ` (${toMake.length})` : ""}
              </Button>
            )}
          </Stack>
        }
      >
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap" }} useFlexGap>
            <TChip label={`${totals.planned} planned order(s)`} color={totals.planned ? "error" : "success"} size="small" />
            <TChip label={`${totals.toBuy} to purchase`} color="warning" size="small" variant="outlined" />
            <TChip label={`${totals.toMake} to produce`} color="secondary" size="small" variant="outlined" />
            {totals.late > 0 && <TChip label={`${totals.late} past order-by date`} color="error" size="small" variant="outlined" />}
            <TChip label={`Planned value ${currencySymbol} ${fmtLKR(totals.value)}`} size="small" variant="outlined" />
          </Stack>

          {!isLoading && rows.length === 0 ? (
            <EmptyState
              message={
                shortagesOnly
                  ? "Nothing to plan — demand from quotations, production orders and reordering rules is covered"
                  : "No demand from quotations, production orders or reordering rules"
              }
            />
          ) : (
            <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell padding="checkbox">
                      {canFirm && (
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={!allSelected && selectable.some((r) => selected.has(lineKey(r)))}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map(lineKey)))}
                        />
                      )}
                    </TableCell>
                    <TableCell padding="checkbox" />
                    <TableCell>Item</TableCell>
                    <TableCell>Branch</TableCell>
                    <TableCell align="right">Demand</TableCell>
                    <TableCell align="right">On Hand</TableCell>
                    <TableCell align="right">On Order</TableCell>
                    <TableCell align="right">In Production</TableCell>
                    <TableCell align="right">Min / Max</TableCell>
                    <TableCell align="right">Projected</TableCell>
                    <TableCell align="right">Suggested</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Order By</TableCell>
                    <TableCell>Need By</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell align="right">{`Value (${currencySymbol})`}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((line, index) => {
                    const key = lineKey(line);
                    const open = expanded.has(key);
                    const lateOrder = line.suggested_quantity > 0 && !!line.order_by_date && line.order_by_date < todayIso();
                    return (
                      <Fragment key={key}>
                        <TableRow
                          hover
                          sx={{ ...modernTableStyles.bodyRow, ...(index % 2 === 1 && { bgcolor: "grey.25" }) }}
                        >
                          <TableCell padding="checkbox">
                            {canFirm && line.suggested_quantity > 0 && (
                              <Checkbox size="small" checked={selected.has(key)} onChange={() => toggle(selected, setSelected, key)} />
                            )}
                          </TableCell>
                          <TableCell padding="checkbox">
                            <IconButton size="small" onClick={() => toggle(expanded, setExpanded, key)}>
                              {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>{line.product_name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {line.product_code}{line.unit_of_measure ? ` · ${line.unit_of_measure}` : ""}
                              {line.low_level_code > 0 ? ` · level ${line.low_level_code}` : ""}
                            </Typography>
                          </TableCell>
                          <TableCell>{line.branch_code}</TableCell>
                          <TableCell align="right">
                            <Tooltip title={`Quotations ${line.quote_demand} · Production orders ${line.production_demand} · Planned ${line.planned_demand}`}>
                              <span>{line.total_demand}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell align="right">{line.on_hand_quantity}</TableCell>
                          <TableCell align="right">{line.on_order_quantity}</TableCell>
                          <TableCell align="right">{line.is_manufactured ? line.in_production_quantity : "-"}</TableCell>
                          <TableCell align="right">
                            {line.min_quantity != null ? `${line.min_quantity} / ${line.max_quantity ?? "-"}` : "-"}
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" color={line.projected_quantity < 0 ? "error.main" : undefined}>
                              {line.projected_quantity}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight={700} color={line.suggested_quantity > 0 ? "error.main" : "success.main"}>
                              {line.suggested_quantity}
                            </Typography>
                          </TableCell>
                          <TableCell>{actionChip(line)}</TableCell>
                          <TableCell>
                            <Typography variant="body2" color={lateOrder ? "error.main" : undefined}>
                              {line.order_by_date ? formatDate(line.order_by_date) : "-"}
                            </Typography>
                          </TableCell>
                          <TableCell>{line.need_by_date ? formatDate(line.need_by_date) : "-"}</TableCell>
                          <TableCell>{line.suggested_action === "purchase" ? line.preferred_supplier_name || "-" : "-"}</TableCell>
                          <TableCell align="right">{fmtLKR(Number(line.suggested_value))}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow>
                            <TableCell colSpan={16} sx={{ bgcolor: "action.hover", py: 1 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                                Demand sources:
                              </Typography>
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {line.demand_sources.length === 0 && (
                                  <Typography variant="caption">No demand — shown for its reordering rule</Typography>
                                )}
                                {line.demand_sources.map((src, i) => {
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
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
          )}
        </Box>
      </MasterDetailLayout>

      <PurchaseFirmDialog open={dialog === "purchase"} lines={toBuy} saving={saving} onClose={() => setDialog(null)} onSubmit={handlePurchase} />
      <ProduceFirmDialog open={dialog === "produce"} lines={toMake} saving={saving} onClose={() => setDialog(null)} onSubmit={handleProduce} />
    </>
  );
}
