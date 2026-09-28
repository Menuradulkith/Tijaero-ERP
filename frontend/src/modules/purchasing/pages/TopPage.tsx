/**
 * TopPage — the central cross-quotation procurement queue ("TOP" page).
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
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
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
import { useMemo, useState } from "react";

import {
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
  grnDate: string;
  paymentMethod: string;
}

const groupKey = (supplierId: number, quoteId: number) => `${supplierId}:${quoteId}`;
const todayIso = () => new Date().toISOString().split("T")[0];

export default function TopPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const creditWarningDialog = useTConfirmDialog();

  const { data: queue = [], isLoading, refetch } = useQuery({
    queryKey: ["procurementQueue"],
    queryFn: procurementQueueApi.list,
  });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => suppliersApi.getAll() });

  const getSupplier = (supplierId: number) => (suppliers as Supplier[] | undefined)?.find((s) => s.id === supplierId);

  const [supplierSettings, setSupplierSettings] = useState<Record<number, SupplierSettings>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, { quantity: number; unit_price: number }>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [creatingKey, setCreatingKey] = useState<string | "selected" | "all" | null>(null);

  const supplierGroups = useMemo((): SupplierGroup[] => {
    const bySupplier = new Map<number, Map<number, QuoteSubGroup>>();
    for (const item of queue) {
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
      const override = overrides[item.quote_item_id];
      subGroup.lines.push({
        queueId: item.id,
        quote_item_id: item.quote_item_id,
        product_id: item.product_id,
        product_name: item.product_name || `Product #${item.product_id}`,
        quantity: override?.quantity ?? item.quantity,
        unit_price: override?.unit_price ?? item.unit_price,
      });
    }
    return Array.from(bySupplier.entries()).map(([supplierId, quoteMap]) => ({
      supplierId,
      quoteGroups: Array.from(quoteMap.values()),
    }));
  }, [queue, overrides]);

  const computeDefaultGrnDate = (supplier: Supplier | undefined, orderDate: string) => {
    if (supplier?.average_lead_time_days == null) return orderDate;
    const base = new Date(`${orderDate}T00:00:00`);
    base.setDate(base.getDate() + Math.round(supplier.average_lead_time_days));
    return base.toISOString().split("T")[0];
  };

  // Order Date / GRN Date / Payment Method are set per supplier — like the PO
  // creation page — since they end up directly on the PurchaseOrder record,
  // and one supplier can have several queued quotations that all share them.
  // Falls back to sensible defaults until the user actually edits a field, so
  // switching suppliers doesn't require re-entering everything each time.
  const getSupplierSettings = (supplierId: number): SupplierSettings => {
    const supplier = getSupplier(supplierId);
    const existing = supplierSettings[supplierId];
    const orderDate = existing?.orderDate ?? todayIso();
    return {
      orderDate,
      grnDate: existing?.grnDate ?? computeDefaultGrnDate(supplier, orderDate),
      paymentMethod: existing?.paymentMethod ?? "Non-credit",
    };
  };

  const updateSupplierSettings = (supplierId: number, patch: Partial<SupplierSettings>) =>
    setSupplierSettings((prev) => ({
      ...prev,
      [supplierId]: { ...getSupplierSettings(supplierId), ...patch },
    }));

  const groupTotal = (lines: QueueLine[]) => lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);

  const updateLine = (quoteItemId: number, patch: Partial<{ quantity: number; unit_price: number }>) =>
    setOverrides((prev) => {
      const existing = queue.find((q) => q.quote_item_id === quoteItemId);
      const base = prev[quoteItemId] ?? { quantity: existing?.quantity ?? 0, unit_price: existing?.unit_price ?? 0 };
      return { ...prev, [quoteItemId]: { ...base, ...patch } };
    });

  const handleRemoveLine = async (queueId: number) => {
    try {
      await procurementQueueApi.remove(queueId);
      queryClient.invalidateQueries({ queryKey: ["procurementQueue"] });
      showSuccessToast("Removed from the procurement queue.");
    } catch (err: any) {
      showErrorToast(err?.response?.data?.detail || "Failed to remove item from the queue");
    }
  };

  const buildOrderPayload = (supplierId: number, group: QuoteSubGroup): PurchasingOrderCreate => {
    const supplier = getSupplier(supplierId);
    const settings = getSupplierSettings(supplierId);
    return {
      purchasing_order_no: "",
      branch_code: group.branchCode,
      payment_method: settings.paymentMethod,
      purchasing_order_date: settings.orderDate,
      good_received_note_date: settings.grnDate,
      remarks: `PO for Quotation ${group.quoteNo}`,
      credit_date: supplier?.credit_days ?? 0,
      first_suppliers_id: supplierId,
      second_suppliers_id: 0,
      sales_quote_id: group.quoteId,
      items: group.lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
        warrenty_month: "0",
        remark: `From Quotation ${group.quoteNo}`,
        quote_item_id: l.quote_item_id,
      })),
    };
  };

  const runCreditChecks = async (targets: { supplierId: number; group: QuoteSubGroup }[]): Promise<boolean> => {
    for (const { supplierId, group } of targets) {
      if (getSupplierSettings(supplierId).paymentMethod.toLowerCase() !== "credit") continue;
      const supplier = getSupplier(supplierId);
      try {
        const creditCheck = await purchaseOrdersApi.checkCredit(supplierId, groupTotal(group.lines));
        if (creditCheck.requires_approval) {
          const confirmed = await creditWarningDialog.confirm({
            title: "⚠️ Credit Limit Warning",
            message: `Supplier: ${supplier?.company_name || "Unknown"}\nQuotation: ${group.quoteNo}\nCredit Limit: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.max_credit_limit)}\nCurrent Outstanding: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.current_outstanding)}\nAvailable Credit: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.available_credit)}\nThis Order: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.po_value)}\nExceeds by: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.excess_amount)}\n\n${creditCheck.message}`,
            confirmText: "Continue Anyway",
            cancelText: "Cancel",
            confirmColor: "warning",
          });
          if (!confirmed) return false;
        }
      } catch {
        showErrorToast("Failed to check credit limit. Please try again.");
        return false;
      }
    }
    return true;
  };

  const afterCreate = (createdOrders: { purchasing_order_no: string }[], keysCreated: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keysCreated.forEach((k) => next.delete(k));
      return next;
    });
    setOverrides({});
    queryClient.invalidateQueries({ queryKey: ["procurementQueue"] });
    queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
    showSuccessToast(
      `${createdOrders.length} purchase order(s) created: ${createdOrders.map((o) => o.purchasing_order_no).join(", ")}.`,
    );
  };

  const missingGrnDateSuppliers = (targets: { supplierId: number }[]): number[] =>
    Array.from(new Set(targets.filter((t) => !getSupplierSettings(t.supplierId).grnDate).map((t) => t.supplierId)));

  const handleCreateGroup = async (supplierId: number, group: QuoteSubGroup) => {
    if (missingGrnDateSuppliers([{ supplierId }]).length > 0) {
      showErrorToast(`Set a GRN date for ${getSupplier(supplierId)?.company_name || "this supplier"} before creating its PO.`);
      return;
    }
    const key = groupKey(supplierId, group.quoteId);
    setCreatingKey(key);
    try {
      if (!(await runCreditChecks([{ supplierId, group }]))) return;
      const result = await purchaseOrdersApi.createBatch({ groups: [buildOrderPayload(supplierId, group)] });
      afterCreate(result.orders, [key]);
    } catch (err: any) {
      showErrorToast(err?.response?.data?.detail || "Failed to create purchase order");
    } finally {
      setCreatingKey(null);
    }
  };

  const handleCreateMany = async (targets: { supplierId: number; group: QuoteSubGroup }[], mode: "selected" | "all") => {
    if (targets.length === 0) return;
    const missing = missingGrnDateSuppliers(targets);
    if (missing.length > 0) {
      const names = missing.map((id) => getSupplier(id)?.company_name || `Supplier #${id}`).join(", ");
      showErrorToast(`Set a GRN date for: ${names}`);
      return;
    }
    setCreatingKey(mode);
    try {
      if (!(await runCreditChecks(targets))) return;
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
      setCreatingKey(null);
    }
  };

  const toggleSelected = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
        title="TOP — Purchase Order Queue"
        icon={<ShoppingCartIcon color="primary" />}
        onRefresh={() => refetch()}
        isLoading={isLoading}
        headerActions={
          allTargets.length > 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CheckIcon />}
                onClick={() => handleCreateMany(selectedTargets, "selected")}
                disabled={selectedTargets.length === 0 || creatingKey !== null}
              >
                {creatingKey === "selected" ? "Creating..." : `Create Selected (${selectedTargets.length})`}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<ShoppingCartIcon />}
                onClick={() => handleCreateMany(allTargets, "all")}
                disabled={creatingKey !== null}
              >
                {creatingKey === "all" ? "Creating..." : `Create All (${allTargets.length})`}
              </Button>
            </Box>
          ) : undefined
        }
      >
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {supplierGroups.length === 0 ? (
            <EmptyState message="The procurement queue is empty — nothing waiting to be ordered." />
          ) : (
            <>
              {supplierGroups.map((sg) => {
                const supplier = getSupplier(sg.supplierId);
                const settings = getSupplierSettings(sg.supplierId);
                return (
                  <FormSection
                    key={sg.supplierId}
                    title={supplier?.company_name || `Supplier #${sg.supplierId}`}
                    columns={1}
                  >
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 1.5 }}>
                      <TextField
                        label="Order Date"
                        size="small"
                        type="date"
                        value={settings.orderDate}
                        onChange={(e) => updateSupplierSettings(sg.supplierId, { orderDate: e.target.value })}
                        InputLabelProps={{ shrink: true }}
                        required
                      />
                      <TextField
                        label="GRN Date"
                        size="small"
                        type="date"
                        value={settings.grnDate}
                        onChange={(e) => updateSupplierSettings(sg.supplierId, { grnDate: e.target.value })}
                        InputLabelProps={{ shrink: true }}
                        required
                        error={!settings.grnDate}
                        helperText={!settings.grnDate ? "GRN date is required" : undefined}
                      />
                      <Autocomplete
                        size="small"
                        options={["Non-credit", "Credit"]}
                        value={settings.paymentMethod}
                        onChange={(_, newValue) =>
                          updateSupplierSettings(sg.supplierId, { paymentMethod: newValue || "Non-credit" })
                        }
                        disableClearable
                        renderInput={(params) => <TextField {...params} label="Payment Method" />}
                      />
                    </Box>

                    {sg.quoteGroups.map((group) => {
                      const key = groupKey(sg.supplierId, group.quoteId);
                      const isEditing = editingKey === key;
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
                              <Checkbox size="small" checked={isSelected} onChange={() => toggleSelected(key)} />
                              <Chip size="small" label={`Quotation ${group.quoteNo}`} />
                              <Typography variant="body2" color="text.secondary">
                                Branch: {group.branchCode}
                              </Typography>
                            </Box>
                            <Box sx={{ display: "flex", gap: 1 }}>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<EditIcon />}
                                onClick={() => setEditingKey(isEditing ? null : key)}
                              >
                                {isEditing ? "Done" : "View/Edit"}
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<ShoppingCartIcon />}
                                disabled={group.lines.length === 0 || creatingKey !== null || !settings.grnDate}
                                onClick={() => handleCreateGroup(sg.supplierId, group)}
                              >
                                {creatingKey === key ? "Creating..." : "Create PO"}
                              </Button>
                            </Box>
                          </Box>
                          <Table size="small">
                            <TableHead>
                              <TableRow sx={modernTableStyles.headerRow}>
                                <TableCell>Product</TableCell>
                                <TableCell align="right">Qty</TableCell>
                                <TableCell align="right">{`Unit Price (${currencySymbol})`}</TableCell>
                                <TableCell align="right">{`Line Total (${currencySymbol})`}</TableCell>
                                <TableCell sx={{ width: 40 }} />
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {group.lines.map((line, index) => (
                                <TableRow
                                  key={line.quote_item_id}
                                  sx={{
                                    ...modernTableStyles.bodyRow,
                                    ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                                  }}
                                >
                                  <TableCell>{line.product_name}</TableCell>
                                  <TableCell align="right">
                                    {isEditing ? (
                                      <TextField
                                        size="small"
                                        type="number"
                                        value={line.quantity}
                                        onChange={(e) =>
                                          updateLine(line.quote_item_id, { quantity: parseInt(e.target.value) || 0 })
                                        }
                                        inputProps={{ min: 1 }}
                                        sx={{ width: 80 }}
                                      />
                                    ) : (
                                      line.quantity
                                    )}
                                  </TableCell>
                                  <TableCell align="right">
                                    {isEditing ? (
                                      <TextField
                                        size="small"
                                        type="number"
                                        value={line.unit_price}
                                        onChange={(e) =>
                                          updateLine(line.quote_item_id, { unit_price: parseFloat(e.target.value) || 0 })
                                        }
                                        inputProps={{ min: 0, step: "0.01" }}
                                        sx={{ width: 100 }}
                                      />
                                    ) : (
                                      fmtLKR(line.unit_price)
                                    )}
                                  </TableCell>
                                  <TableCell align="right">{fmtLKR(line.quantity * line.unit_price)}</TableCell>
                                  <TableCell>
                                    <Tooltip title="Remove from queue">
                                      <IconButton size="small" color="error" onClick={() => handleRemoveLine(line.queueId)}>
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  </TableCell>
                                </TableRow>
                              ))}
                              <TableRow sx={modernTableStyles.footerRow}>
                                <TableCell colSpan={3} align="right">
                                  <strong>PO Total:</strong>
                                </TableCell>
                                <TableCell align="right" colSpan={2}>
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
