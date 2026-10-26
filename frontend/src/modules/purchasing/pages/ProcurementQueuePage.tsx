/**
 * ProcurementQueuePage — the central cross-quotation procurement queue.
 *
 * Every time a supplier is chosen on a Sales Quotation's "Select Products &
 * Suppliers for Procurement" dialog, the pick lands in the procurement queue
 * (see ProcurementQueueService on the backend) instead of a one-quotation
 * review screen. This page aggregates that queue across *every* quotation,
 * grouped by supplier and then by quotation (a Purchase Order can only ever
 * reference one quotation), so a buyer can batch-create POs across many
 * quotations at once. Creating a PO removes its lines from the queue
 * automatically (server-side), so this page is always "what's left to order".
 *
 * Styled to match the other Purchasing/Sales master-detail pages
 * (PurchaseOrdersPage, POApprovalsPage, QuotationsPage): MasterDetailLayout
 * shell, FormSection blocks, modernTableStyles tables, and plain MUI Button
 * actions rather than one-off styling.
 */
import CheckIcon from "@mui/icons-material/Check";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Divider,
  IconButton,
  Paper,
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
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  TChip,
  EmptyState,
  fmtLKR,
  FormSection,
  MasterDetailLayout,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  useTConfirmDialog,
} from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { procurementQueueApi, purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import type { PurchasingOrderCreate, Supplier } from "@/modules/purchasing/types";

interface QueueLine {
  queueId: number;
  quote_item_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  requiredQuantity: number;
  availableQuantity: number;
  orderedQuantity: number;
  toPurchaseQuantity: number;
}

interface QuoteSubGroup {
  quoteId: number;
  quoteNo: string;
  branchCode: string;
  lines: QueueLine[];
}

interface SupplierGroup {
  supplierId: number;
  quoteGroups: QuoteSubGroup[];
}

interface SupplierSettings {
  orderDate: string;
}

const groupKey = (supplierId: number, quoteId: number) => `${supplierId}:${quoteId}`;
const todayIso = () => new Date().toISOString().split("T")[0];
import { findMoqShortfalls, formatMoqMessage } from "@/modules/purchasing/utils/moq";
import { addWorkingDays } from "@/modules/purchasing/utils/workingDays";

export default function ProcurementQueuePage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const creditWarningDialog = useTConfirmDialog();

  const { data: queue = [], isLoading, refetch } = useQuery({
    queryKey: ["procurementQueue"],
    queryFn: procurementQueueApi.list,
  });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => suppliersApi.getAll() });

  const getSupplier = (supplierId: number) => (suppliers as Supplier[] | undefined)?.find((s) => s.id === supplierId);

  const [supplierSettings, setSupplierSettings] = useState<Record<number, SupplierSettings>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [creatingKey, setCreatingKey] = useState<string | "selected" | null>(null);
  // Per-product opt-out within a PO — lets a buyer postpone one line (e.g.
  // "Mouse") while still creating the PO for the rest of the quotation.
  // Checked (included) by default; unchecking removes it from that PO only,
  // it stays queued for a later PO.
  const [excludedLineIds, setExcludedLineIds] = useState<Set<number>>(new Set());
  const toggleLineIncluded = (queueId: number) =>
    setExcludedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(queueId)) next.delete(queueId);
      else next.add(queueId);
      return next;
    });

  // Filters: free-text search (quotation, product, supplier), supplier and branch.
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<number | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);

  const supplierFilterOptions = useMemo(
    () => Array.from(new Set(queue.map((q) => q.supplier_id))),
    [queue],
  );
  const branchFilterOptions = useMemo(
    () => Array.from(new Set(queue.map((q) => q.branch_code))).sort(),
    [queue],
  );
  const filtersActive = !!search.trim() || supplierFilter !== null || branchFilter !== null;

  const filteredQueue = useMemo(() => {
    const term = search.trim().toLowerCase();
    return queue.filter((item) => {
      if (supplierFilter !== null && item.supplier_id !== supplierFilter) return false;
      if (branchFilter !== null && item.branch_code !== branchFilter) return false;
      if (!term) return true;
      const supplierName = (suppliers as Supplier[] | undefined)?.find((s) => s.id === item.supplier_id)?.company_name || "";
      return [item.quote_no, item.product_name, supplierName].some((v) => (v || "").toLowerCase().includes(term));
    });
  }, [queue, search, supplierFilter, branchFilter, suppliers]);

  const supplierGroups = useMemo((): SupplierGroup[] => {
    const bySupplier = new Map<number, Map<number, QuoteSubGroup>>();
    for (const item of filteredQueue) {
      let quoteMap = bySupplier.get(item.supplier_id);
      if (!quoteMap) {
        quoteMap = new Map();
        bySupplier.set(item.supplier_id, quoteMap);
      }
      let subGroup = quoteMap.get(item.quote_id);
      if (!subGroup) {
        subGroup = { quoteId: item.quote_id, quoteNo: item.quote_no, branchCode: item.branch_code, lines: [] };
        quoteMap.set(item.quote_id, subGroup);
      }
      subGroup.lines.push({
        queueId: item.id,
        quote_item_id: item.quote_item_id,
        product_id: item.product_id,
        product_name: item.product_name || `Product #${item.product_id}`,
        quantity: item.quantity,
        unit_price: item.unit_price,
        requiredQuantity: item.required_quantity,
        availableQuantity: item.available_quantity,
        orderedQuantity: item.ordered_quantity,
        toPurchaseQuantity: item.to_purchase_quantity,
      });
    }
    return Array.from(bySupplier.entries()).map(([supplierId, quoteMap]) => ({
      supplierId,
      quoteGroups: Array.from(quoteMap.values()),
    }));
  }, [filteredQueue]);

  // Expected delivery = order date + the supplier's lead time in working days
  // (same estimate as the PO wizard); falls back to the computed average, then
  // to the order date.
  const computeDefaultDeliveryDate = (supplier: Supplier | undefined, orderDate: string) => {
    if (supplier?.lead_time_days && supplier.lead_time_days > 0) {
      return addWorkingDays(orderDate, supplier.lead_time_days);
    }
    if (supplier?.average_lead_time_days == null) return orderDate;
    const base = new Date(`${orderDate}T00:00:00`);
    base.setDate(base.getDate() + Math.round(supplier.average_lead_time_days));
    return base.toISOString().split("T")[0];
  };

  // The Order Date is set per supplier, since one supplier can have several queued
  // quotations that all share it. The expected delivery date is estimated from the
  // supplier's lead time and the payment terms default to Non-credit; both can be
  // changed on the Purchase Order itself (it is created pending approval). The
  // actual GRN date is entered later on the GRN page.
  const getSupplierSettings = (supplierId: number): SupplierSettings => ({
    orderDate: supplierSettings[supplierId]?.orderDate ?? todayIso(),
  });

  const updateSupplierSettings = (supplierId: number, patch: Partial<SupplierSettings>) =>
    setSupplierSettings((prev) => ({
      ...prev,
      [supplierId]: { ...getSupplierSettings(supplierId), ...patch },
    }));

  const groupTotal = (lines: QueueLine[]) => lines.reduce((sum, l) => sum + effectiveQty(l) * l.unit_price, 0);

  // Don't allow accidental over-purchasing: cap what's actually ordered at
  // the freshly computed shortfall (required - available - already
  // ordered), not the quantity that was queued a while ago — stock or other
  // POs may have moved since then. 0 means this line no longer needs buying,
  // or the user unchecked it to postpone it out of this particular PO.
  const effectiveQty = (line: QueueLine) =>
    excludedLineIds.has(line.queueId) ? 0 : Math.max(Math.min(line.quantity, line.toPurchaseQuantity), 0);

  const buildOrderPayload = (supplierId: number, group: QuoteSubGroup): PurchasingOrderCreate => {
    const supplier = getSupplier(supplierId);
    const settings = getSupplierSettings(supplierId);
    return {
      purchasing_order_no: "",
      branch_code: group.branchCode,
      payment_method: "Non-credit",
      purchasing_order_date: settings.orderDate,
      good_received_note_date: computeDefaultDeliveryDate(supplier, settings.orderDate),
      remarks: `PO for Quotation ${group.quoteNo}`,
      credit_date: supplier?.credit_days ?? 0,
      first_suppliers_id: supplierId,
      second_suppliers_id: 0,
      sales_quote_id: group.quoteId,
      items: group.lines
        .filter((l) => effectiveQty(l) > 0)
        .map((l) => ({
          product_id: l.product_id,
          quantity: effectiveQty(l),
          unit_price: l.unit_price,
          warrenty_month: "0",
          remark: `From Quotation ${group.quoteNo}`,
          quote_item_id: l.quote_item_id,
        })),
    };
  };

  // Ordering below a supplier's MOQ is allowed, but the user is told first.
  const runMoqChecks = async (targets: { supplierId: number; group: QuoteSubGroup }[]): Promise<boolean> => {
    try {
      const messages: string[] = [];
      for (const { supplierId, group } of targets) {
        const items = group.lines
          .filter((l) => effectiveQty(l) > 0)
          .map((l) => ({ product_id: l.product_id, quantity: effectiveQty(l) }));
        const shortfalls = await findMoqShortfalls(supplierId, items, (id) =>
          queryClient.fetchQuery({ queryKey: ["supplier-products", id], queryFn: () => suppliersApi.getProducts(id) }),
        );
        if (shortfalls.length > 0) {
          messages.push(`Quotation ${group.quoteNo}\n${formatMoqMessage(getSupplier(supplierId)?.company_name || "Unknown", shortfalls)}`);
        }
      }
      if (messages.length === 0) return true;
      return await creditWarningDialog.confirm({
        title: "Below Minimum Order Quantity",
        message: messages.join("\n\n"),
        confirmText: "Continue Anyway",
        cancelText: "Go Back",
        confirmColor: "warning",
      });
    } catch {
      // MOQ is advisory; never block the order because the lookup failed.
      return true;
    }
  };

  // One create burst at a time: a double-click must not create the PO twice.
  const createInFlightRef = useRef(false);

  const afterCreate = (createdOrders: { purchasing_order_no: string }[], keysCreated: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keysCreated.forEach((k) => next.delete(k));
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ["procurementQueue"] });
    queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
    showSuccessToast(
      `${createdOrders.length} purchase order(s) created: ${createdOrders.map((o) => o.purchasing_order_no).join(", ")}.`,
    );
  };

  // The Order Date is required per supplier before any PO for that supplier can be created.
  const missingRequiredFieldSuppliers = (targets: { supplierId: number }[]): number[] =>
    Array.from(
      new Set(targets.filter((t) => !getSupplierSettings(t.supplierId).orderDate).map((t) => t.supplierId)),
    );

  const handleCreateGroup = async (supplierId: number, group: QuoteSubGroup) => {
    if (missingRequiredFieldSuppliers([{ supplierId }]).length > 0) {
      showErrorToast(`Set the Order Date for ${getSupplier(supplierId)?.company_name || "this supplier"} before creating its PO.`);
      return;
    }
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    const key = groupKey(supplierId, group.quoteId);
    setCreatingKey(key);
    try {
      if (!(await runMoqChecks([{ supplierId, group }]))) return;
      const result = await purchaseOrdersApi.createBatch({ groups: [buildOrderPayload(supplierId, group)] });
      afterCreate(result.orders, [key]);
    } catch (err: any) {
      showErrorToast(err?.response?.data?.detail || "Failed to create purchase order");
    } finally {
      createInFlightRef.current = false;
      setCreatingKey(null);
    }
  };

  const handleCreateMany = async (targets: { supplierId: number; group: QuoteSubGroup }[], mode: "selected") => {
    if (targets.length === 0) return;
    const missing = missingRequiredFieldSuppliers(targets);
    if (missing.length > 0) {
      const names = missing.map((id) => getSupplier(id)?.company_name || `Supplier #${id}`).join(", ");
      showErrorToast(`Set the Order Date for: ${names}`);
      return;
    }
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreatingKey(mode);
    try {
      if (!(await runMoqChecks(targets))) return;
      const result = await purchaseOrdersApi.createBatch({
        groups: targets.map((t) => buildOrderPayload(t.supplierId, t.group)),
      });
      afterCreate(
        result.orders,
        targets.map((t) => groupKey(t.supplierId, t.group.quoteId)),
      );
    } catch (err: any) {
      showErrorToast(err?.response?.data?.detail || "Failed to create purchase orders");
    } finally {
      createInFlightRef.current = false;
      setCreatingKey(null);
    }
  };

  const toggleSelected = (key: string, group: QuoteSubGroup) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Selecting the quotation selects all of its products; deselecting it
    // postpones all of them — individual product checkboxes still allow
    // overriding within a selected quotation afterwards.
    const nowSelected = !selectedKeys.has(key);
    setExcludedLineIds((prev) => {
      const next = new Set(prev);
      for (const line of group.lines) {
        if (nowSelected) next.delete(line.queueId);
        else next.add(line.queueId);
      }
      return next;
    });
  };

  const allTargets = useMemo(
    () => supplierGroups.flatMap((g) => g.quoteGroups.map((qg) => ({ supplierId: g.supplierId, group: qg }))),
    [supplierGroups],
  );
  const selectedTargets = useMemo(
    () => allTargets.filter((t) => selectedKeys.has(groupKey(t.supplierId, t.group.quoteId))),
    [allTargets, selectedKeys],
  );

  return (
    <>
      <MasterDetailLayout
        title="Procurement Queue"
        icon={<ShoppingCartIcon color="primary" />}
        onRefresh={() => refetch()}
        isLoading={isLoading}
        headerActions={
          allTargets.length > 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Tooltip title="Creates draft Purchase Orders (pending approval) for the checked quotations — review and approve them on the Purchase Orders page.">
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CheckIcon />}
                    onClick={() => handleCreateMany(selectedTargets, "selected")}
                    disabled={selectedTargets.length === 0 || creatingKey !== null}
                  >
                    {creatingKey === "selected" ? "Creating..." : `Create Selected POs (${selectedTargets.length})`}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          ) : undefined
        }
      >
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {queue.length > 0 && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5, alignItems: "center" }}>
              <TextField
                size="small"
                label="Search"
                placeholder="Quotation, product or supplier"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ minWidth: 260 }}
              />
              <Autocomplete
                size="small"
                options={supplierFilterOptions}
                value={supplierFilter}
                onChange={(_, v) => setSupplierFilter(v)}
                getOptionLabel={(id) => getSupplier(id)?.company_name || `#${id}`}
                renderInput={(params) => <TextField {...params} label="Supplier" />}
                sx={{ minWidth: 220 }}
              />
              <Autocomplete
                size="small"
                options={branchFilterOptions}
                value={branchFilter}
                onChange={(_, v) => setBranchFilter(v)}
                renderInput={(params) => <TextField {...params} label="Branch" />}
                sx={{ minWidth: 160 }}
              />
              {filtersActive && (
                <Button
                  size="small"
                  onClick={() => {
                    setSearch("");
                    setSupplierFilter(null);
                    setBranchFilter(null);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </Box>
          )}
          {supplierGroups.length === 0 ? (
            <EmptyState
              message={
                queue.length > 0 && filtersActive
                  ? "No queued items match the filters."
                  : "The procurement queue is empty — nothing waiting to be ordered."
              }
            />
          ) : (
            <>
              {supplierGroups.map((sg) => {
                const supplier = getSupplier(sg.supplierId);
                const settings = getSupplierSettings(sg.supplierId);
                return (
                  <FormSection
                    key={sg.supplierId}
                    title={`Supplier: ${supplier?.company_name || `#${sg.supplierId}`}`}
                    columns={1}
                  >
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 260px)" }, gap: 1.5 }}>
                      <TextField
                        label="Order Date"
                        size="small"
                        type="date"
                        value={settings.orderDate}
                        onChange={(e) => updateSupplierSettings(sg.supplierId, { orderDate: e.target.value })}
                        InputLabelProps={{ shrink: true }}
                        required
                        error={!settings.orderDate}
                        helperText={!settings.orderDate ? "Order date is required" : undefined}
                      />
                    </Box>

                    {/* One PO per quotation under this supplier — the divider
                        makes the "one supplier = one PO per quotation" rule
                        visually obvious when scanning many supplier groups. */}
                    <Divider sx={{ my: 1.5 }} />

                    {sg.quoteGroups.map((group) => {
                      const key = groupKey(sg.supplierId, group.quoteId);
                      const isSelected = selectedKeys.has(key);
                      return (
                        <Paper
                          key={key}
                          variant="outlined"
                          sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              p: 1.5,
                              pb: 1,
                            }}
                          >
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                              <Checkbox size="small" checked={isSelected} onChange={() => toggleSelected(key, group)} />
                              <Box>
                                <Typography variant="body2">
                                  <strong>Quotation:</strong>{" "}
                                  <Box
                                    component="span"
                                    onClick={() => navigate("/sales/quotations", { state: { selectedQuoteId: group.quoteId } })}
                                    sx={{
                                      color: "primary.main",
                                      cursor: "pointer",
                                      textDecoration: "underline",
                                      "&:hover": { color: "primary.dark" },
                                    }}
                                  >
                                    {group.quoteNo}
                                  </Box>
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  <strong>Branch:</strong> {group.branchCode}
                                </Typography>
                              </Box>
                              <TChip size="small" color="info" variant="outlined" label="Status: Ready to Create" />
                            </Box>
                            <Box sx={{ display: "flex", gap: 1 }}>
                              <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<ShoppingCartIcon />}
                                disabled={
                                  group.lines.every((l) => effectiveQty(l) === 0) ||
                                  creatingKey !== null ||
                                  !settings.orderDate
                                }
                                onClick={() => handleCreateGroup(sg.supplierId, group)}
                              >
                                {creatingKey === key ? "Creating..." : "Create PO"}
                              </Button>
                            </Box>
                          </Box>
                          <Table size="small">
                            <TableHead>
                              <TableRow sx={modernTableStyles.headerRow}>
                                <TableCell sx={{ width: 40 }} />
                                <TableCell>Product</TableCell>
                                <TableCell align="right">Required</TableCell>
                                <TableCell align="right">Available</TableCell>
                                <TableCell align="right">Ordered</TableCell>
                                <TableCell align="right">To Purchase</TableCell>
                                <TableCell align="right">{`Unit Price (${currencySymbol})`}</TableCell>
                                <TableCell align="right">{`Line Total (${currencySymbol})`}</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {group.lines.map((line, index) => {
                                const qty = effectiveQty(line);
                                const reduced = qty < line.quantity && !excludedLineIds.has(line.queueId);
                                const included = !excludedLineIds.has(line.queueId);
                                return (
                                <TableRow
                                  key={line.quote_item_id}
                                  sx={{
                                    ...modernTableStyles.bodyRow,
                                    ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                                    ...(!included && { opacity: 0.5 }),
                                  }}
                                >
                                  <TableCell>
                                    <Tooltip title={included ? "Postpone this product out of this PO" : "Include this product in this PO"}>
                                      <Checkbox size="small" checked={included} onChange={() => toggleLineIncluded(line.queueId)} />
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>{line.product_name}</TableCell>
                                  <TableCell align="right">{line.requiredQuantity}</TableCell>
                                  <TableCell align="right">{line.availableQuantity}</TableCell>
                                  <TableCell align="right">{line.orderedQuantity}</TableCell>
                                  <TableCell align="right">
                                    <Tooltip title={reduced ? `Queued as ${line.quantity} — reduced to avoid over-purchasing (stock/orders changed since queuing)` : ""}>
                                      <Box component="span" sx={{ fontWeight: 700, color: qty === 0 ? "text.disabled" : reduced ? "warning.main" : "inherit" }}>
                                        {!included ? "Postponed" : qty === 0 ? "Not needed" : qty}
                                      </Box>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell align="right">{fmtLKR(line.unit_price)}</TableCell>
                                  <TableCell align="right">{fmtLKR(qty * line.unit_price)}</TableCell>
                                </TableRow>
                                );
                              })}
                              <TableRow sx={modernTableStyles.footerRow}>
                                <TableCell colSpan={7} align="right">
                                  <strong>PO Total:</strong>
                                </TableCell>
                                <TableCell align="right">
                                  <strong>{fmtLKR(groupTotal(group.lines))}</strong>
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </Paper>
                      );
                    })}
                  </FormSection>
                );
              })}
            </>
          )}
        </Box>
      </MasterDetailLayout>

      <TConfirmDialog {...creditWarningDialog.dialogProps} confirmColor="warning" />
    </>
  );
}
