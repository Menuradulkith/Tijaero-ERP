/**
 * PurchaseOrderCreateWizard - product-first, multi-supplier PO creation.
 *
 * Flow: add products, each with a supplier picked inline from that
 * product's own row (no supplier required for the whole PO up front) ->
 * review the lines grouped by supplier -> confirm creates one Purchase
 * Order per supplier group in a single batch, all tagged with a shared
 * purchase_batch_id so the user can see they came from one purchase.
 */
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import StarIcon from "@mui/icons-material/Star";
import {
  Autocomplete,
  Box,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  TChip,
  fmtLKR,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  TButton,
  TConfirmDialog,
  TFormSection,
  TSteps,
  useTConfirmDialog,
  type TStepConfig,
} from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { useReferenceData } from "@/hooks";
import { productsApi } from "@/modules/inventory/api";
import { purchaseOrdersApi, suppliersApi } from "@/modules/purchasing/api";
import { EntityLink, EntityPeekButton } from "@/components/tijaero/peek";
import { findMoqShortfalls, formatMoqMessage } from "@/modules/purchasing/utils/moq";
import { addWorkingDays } from "@/modules/purchasing/utils/workingDays";
import type {
  PurchasingOrderBatchResponse,
  PurchasingOrderCreate,
  PurchasingOrderItemCreate,
  Supplier,
  SupplierProduct,
} from "@/modules/purchasing/types";

const WIZARD_STEPS: TStepConfig[] = [
  { id: "products", label: "Add Products & Suppliers", description: "Pick what to buy and from whom" },
  { id: "review", label: "Review & Confirm", description: "Grouped by supplier" },
];

// A line's GRN Date can't be in the past — it's when the product is
// needed by, so today is the earliest sensible value.
const TODAY_STR = new Date().toISOString().split("T")[0];

interface DraftLine {
  _id: string;
  product_id: number;
  quantity: number;
  supplier_id: number;
  unit_price: number;
  remark: string;
}

const newLine = (): DraftLine => ({
  _id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  product_id: 0,
  quantity: 1,
  supplier_id: 0,
  unit_price: 0,
  remark: "",
});

/** State the wizard reports up so the parent page can render matching
 * Back/Next/Confirm controls in its own ActionToolbar instead of the
 * wizard drawing its own navigation bar. */
export interface PurchaseOrderWizardState {
  activeStep: number;
  stepCount: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  /** Whether the current step's Next/Confirm action is currently allowed. */
  canAdvance: boolean;
  isSubmitting: boolean;
  /** Label for the primary (right-hand) action button — "Next" or the
   * dynamic "Confirm & Create N Purchase Orders" / "Creating..." text. */
  primaryActionLabel: string;
}

/** Imperative controls the parent page's ActionToolbar drives directly. */
export interface PurchaseOrderWizardHandle {
  goBack: () => void;
  goNext: () => void | Promise<void>;
  confirm: () => void;
}

export interface PurchaseOrderCreateWizardProps {
  /** Called after the batch is created successfully, with the created orders. */
  onCreated: (result: PurchasingOrderBatchResponse) => void;
  /** Called when the user cancels out of the wizard entirely. */
  onCancel: () => void;
  /** Fired whenever the wizard's step/validity/submitting state changes, so
   * the parent page can keep its own toolbar buttons in sync. */
  onStateChange?: (state: PurchaseOrderWizardState) => void;
}

const PurchaseOrderCreateWizard = forwardRef<PurchaseOrderWizardHandle, PurchaseOrderCreateWizardProps>(function PurchaseOrderCreateWizard({
  onCreated,
  onCancel,
  onStateChange,
}, ref) {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const creditWarningDialog = useTConfirmDialog();

  const [activeStep, setActiveStep] = useState(0);
  const [branchCode, setBranchCode] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  // The PO's order date isn't a user-facing field anymore — it's always today.
  const orderDate = TODAY_STR;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
  const products = refData?.products || [];
  const branches = filteredBranches || [];

  // Default the branch to the user's own branch once reference data
  // resolves, without clobbering a choice the user already made.
  useEffect(() => {
    if (defaultBranchCode && !branchCode) setBranchCode(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: suppliers } = useQueries({
    queries: [{ queryKey: ["suppliers"], queryFn: () => suppliersApi.getAll() }],
    combine: (results) => ({ data: results[0].data as Supplier[] | undefined }),
  });

  const productIdsNeedingSuppliers = useMemo(
    () => Array.from(new Set(lines.map((l) => l.product_id).filter((id) => id > 0))),
    [lines],
  );

  // One query per distinct product on the cart, fetching the reciprocal
  // "which suppliers carry this product" list.
  const supplierOptionQueries = useQueries({
    queries: productIdsNeedingSuppliers.map((productId) => ({
      queryKey: ["product-suppliers-compare", productId],
      queryFn: () => productsApi.getSuppliers(productId),
      staleTime: 60_000,
    })),
  });

  const supplierOptionsByProduct = useMemo(() => {
    const map = new Map<number, SupplierProduct[]>();
    productIdsNeedingSuppliers.forEach((productId, idx) => {
      map.set(productId, supplierOptionQueries[idx]?.data || []);
    });
    return map;
  }, [productIdsNeedingSuppliers, supplierOptionQueries]);

  // Currently-available stock for every product on the cart, at the
  // wizard's single branch — lets the user see what's already on hand
  // before deciding how much to order.
  const { data: availableStockByProduct } = useQuery({
    queryKey: ["po-wizard-available-stock", branchCode, productIdsNeedingSuppliers],
    queryFn: () => purchaseOrdersApi.getAvailableStock(productIdsNeedingSuppliers, branchCode),
    enabled: !!branchCode && productIdsNeedingSuppliers.length > 0,
  });

  // Units already ordered on approved POs for these products and not yet
  // received — so the user doesn't re-order what is already on its way.
  const { data: inTransitByProduct } = useQuery({
    queryKey: ["po-wizard-in-transit", branchCode, productIdsNeedingSuppliers],
    queryFn: () => purchaseOrdersApi.getInTransit(productIdsNeedingSuppliers, branchCode),
    enabled: !!branchCode && productIdsNeedingSuppliers.length > 0,
  });

  const getInTransitQty = useCallback(
    (productId: number) => inTransitByProduct?.[productId] ?? 0,
    [inTransitByProduct],
  );

  const getAvailableQty = useCallback(
    (productId: number) => availableStockByProduct?.[productId] ?? 0,
    [availableStockByProduct],
  );

  const getProductName = useCallback(
    (productId: number) => products.find((p: any) => p.id === productId)?.name || `Product #${productId}`,
    [products],
  );

  const getSupplierLeadTimeLabel = useCallback(
    (supplierId: number) => {
      const supplier = suppliers?.find((s) => s.id === supplierId);
      const est = supplier?.lead_time_days != null ? `${supplier.lead_time_days}d est.` : "- est.";
      const avg =
        supplier?.average_lead_time_days != null
          ? `${Math.round(supplier.average_lead_time_days)}d avg`
          : "no avg data";
      return `${est} / ${avg}`;
    },
    [suppliers],
  );

  // ── Step 1: Add Products & Suppliers ──────────────────────────────────
  const handleAddLine = () => setLines((prev) => [...prev, newLine()]);
  const handleRemoveLine = (id: string) => setLines((prev) => prev.filter((l) => l._id !== id));
  const handleUpdateLine = (id: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));

  const handleSelectSupplier = useCallback((lineId: string, supplierProduct: SupplierProduct | null) => {
    setLines((prev) =>
      prev.map((l) =>
        l._id === lineId
          ? {
              ...l,
              supplier_id: supplierProduct?.supplier_id || 0,
              // Hard requirement: choosing a supplier always overwrites the
              // unit price with that supplier's listed cost — it's a
              // starting point the user can still edit afterward, not a
              // merge with whatever was there before.
              unit_price: supplierProduct?.cost_price ?? 0,
            }
          : l,
      ),
    );
  }, []);

  // Changing the product clears any supplier already chosen for that row
  // (the old supplier's mapping doesn't apply to the new product).
  const handleSelectProduct = useCallback((lineId: string, productId: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l._id === lineId ? { ...l, product_id: productId, supplier_id: 0, unit_price: 0 } : l,
      ),
    );
  }, []);

  const isProductsStepValid =
    !!branchCode &&
    lines.length > 0 &&
    lines.every((l) => l.product_id > 0 && l.quantity > 0 && l.supplier_id > 0);

  // ── Step 2: Review & Confirm — group by supplier ──────────────────────
  const supplierGroups = useMemo(() => {
    const groups = new Map<number, DraftLine[]>();
    for (const line of lines) {
      if (!line.supplier_id) continue;
      const bucket = groups.get(line.supplier_id) || [];
      bucket.push(line);
      groups.set(line.supplier_id, bucket);
    }
    return Array.from(groups.entries()).map(([supplierId, groupLines]) => ({
      supplier: suppliers?.find((s) => s.id === supplierId),
      supplierId,
      lines: groupLines,
      total: groupLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
    }));
  }, [lines, suppliers]);

  // Each PO's expected delivery date is not entered here: it is estimated as the order date + the
  // supplier's lead time in working days (re-based on the approval date when the PO is approved).
  const estimatedDeliveryDate = (leadTimeDays?: number | null): string | null =>
    leadTimeDays && leadTimeDays > 0 ? addWorkingDays(TODAY_STR, leadTimeDays) : null;

  const grandTotal = useMemo(() => supplierGroups.reduce((sum, g) => sum + g.total, 0), [supplierGroups]);

  const isReviewStepValid = supplierGroups.length > 0;

  // Ordering below a supplier's MOQ is allowed, but the user is told first
  // (before Review & Confirm, and again before the POs are saved). Returns
  // false if they choose to go back and fix the quantities.
  const confirmMoq = useCallback(async (): Promise<boolean> => {
    try {
      const messages: string[] = [];
      for (const group of supplierGroups) {
        const shortfalls = await findMoqShortfalls(
          group.supplierId,
          group.lines,
          (id) => queryClient.fetchQuery({ queryKey: ["supplier-products", id], queryFn: () => suppliersApi.getProducts(id) }),
        );
        if (shortfalls.length > 0) {
          messages.push(formatMoqMessage(group.supplier?.company_name || "Unknown", shortfalls));
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
  }, [supplierGroups, queryClient, creditWarningDialog]);

  const handleNext = useCallback(async () => {
    if (activeStep === 0 && !(await confirmMoq())) return;
    setActiveStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }, [activeStep, confirmMoq]);
  const handleBack = useCallback(() => setActiveStep((s) => Math.max(s - 1, 0)), []);

  const runConfirm = useCallback(async () => {
    if (isSubmitting || supplierGroups.length === 0) return;
    setIsSubmitting(true);
    try {
      if (!(await confirmMoq())) {
        setIsSubmitting(false);
        return;
      }
      // Every PO is owed to the supplier (paid later from Finance), so check the supplier's credit limit
      // for each group — when the supplier has one.
      for (const group of supplierGroups) {
        if (!((group.supplier?.max_credit_limit ?? 0) > 0)) continue;
        try {
          const creditCheck = await purchaseOrdersApi.checkCredit(group.supplierId, group.total);
          if (creditCheck.requires_approval) {
            const supplierName = group.supplier?.company_name || "Unknown";
            const confirmed = await creditWarningDialog.confirm({
              title: "⚠️ Credit Limit Warning",
              message: `Supplier: ${supplierName}\nCredit Limit: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.max_credit_limit)}\nCurrent Outstanding: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.current_outstanding)}\nAvailable Credit: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.available_credit)}\nThis Order: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.po_value)}\nExceeds by: ${currencySymbol} ${fmtLKR(creditCheck.credit_check.excess_amount)}\n\n${creditCheck.message}`,
              confirmText: "Continue Anyway",
              cancelText: "Cancel",
              confirmColor: "warning",
            });
            if (!confirmed) {
              setIsSubmitting(false);
              return;
            }
          }
        } catch {
          showErrorToast("Failed to check credit limit. Please try again.");
          setIsSubmitting(false);
          return;
        }
      }

      const groups: PurchasingOrderCreate[] = supplierGroups.map((group) => {
        const requiredDate = estimatedDeliveryDate(group.supplier?.lead_time_days);
        return {
          purchasing_order_no: "",
          branch_code: branchCode,
          purchasing_order_date: orderDate,
          // The date the supplier is expected to deliver by (lead-time estimate, else the order date).
          good_received_note_date: requiredDate || orderDate,
          required_date: requiredDate,
          // Payment term = the supplier's credit days (how it is then paid is decided in Finance).
          credit_date: group.supplier?.credit_days ?? 0,
          first_suppliers_id: group.supplierId,
          second_suppliers_id: 0,
          items: group.lines.map(
            (l): PurchasingOrderItemCreate => ({
              product_id: l.product_id,
              quantity: l.quantity,
              unit_price: l.unit_price,
              warrenty_month: "0",
              remark: l.remark.trim(),
            }),
          ),
        };
      });

      const result = await purchaseOrdersApi.createBatch({ groups });
      showSuccessToast(
        `${result.orders.length} purchase order(s) created: ${result.orders
          .map((o) => o.purchasing_order_no)
          .join(", ")}. All are pending approval.`,
      );
      queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      onCreated(result);
    } catch (err: any) {
      showErrorToast(err?.response?.data?.detail || "Failed to create purchase orders");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    supplierGroups,
    branchCode,
    orderDate,
    creditWarningDialog,
    confirmMoq,
    currencySymbol,
    queryClient,
    onCreated,
  ]);

  // `isSubmitting` is state and only updates on the next render, so a double click would run the whole
  // submit twice (two purchase orders). The ref blocks the second call for as long as the first runs.
  const submittingRef = useRef(false);
  const handleConfirm = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await runConfirm();
    } finally {
      submittingRef.current = false;
    }
  }, [runConfirm]);

  const isLastStep = activeStep === WIZARD_STEPS.length - 1;
  const canAdvance = isLastStep ? isReviewStepValid && !isSubmitting : isProductsStepValid;
  const primaryActionLabel = isLastStep
    ? isSubmitting
      ? "Creating..."
      : `Confirm & Create ${supplierGroups.length} Purchase Order${supplierGroups.length === 1 ? "" : "s"}`
    : "Next";

  // Let the parent page's ActionToolbar drive the wizard directly.
  useImperativeHandle(ref, () => ({
    goBack: handleBack,
    goNext: handleNext,
    confirm: handleConfirm,
  }), [handleBack, handleNext, handleConfirm]);

  // Report step/validity/submitting state up so the parent's toolbar
  // buttons stay in sync without re-deriving this logic itself.
  useEffect(() => {
    onStateChange?.({
      activeStep,
      stepCount: WIZARD_STEPS.length,
      isFirstStep: activeStep === 0,
      isLastStep,
      canAdvance,
      isSubmitting,
      primaryActionLabel,
    });
  }, [activeStep, isLastStep, canAdvance, isSubmitting, primaryActionLabel, onStateChange]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <TSteps steps={WIZARD_STEPS} activeStep={activeStep} alternativeLabel />

      {activeStep === 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TFormSection title="Branch" columns={3}>
            <Autocomplete
              size="small"
              options={branches}
              getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
              value={branches.find((b) => b.branch_code === branchCode) || null}
              onChange={(_, newValue) => setBranchCode(newValue?.branch_code || "")}
              renderInput={(params) => <TextField {...params} label="Branch" required />}
            />
          </TFormSection>

          <TFormSection title="Products & Suppliers" columns={1}>
            <Paper variant="outlined" sx={{ overflowX: "auto", borderRadius: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={modernTableStyles.headerRow}>
                    <TableCell sx={{ minWidth: 180 }}>Product</TableCell>
                    <TableCell sx={{ width: 90 }}>UOM</TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>
                      Available Qty
                    </TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>
                      In-Transit Qty
                    </TableCell>
                    <TableCell align="right" sx={{ width: 90 }}>
                      Quantity
                    </TableCell>
                    <TableCell sx={{ minWidth: 220 }}>Supplier</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>
                      {`Cost Price (${currencySymbol})`}
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>Remark</TableCell>
                    <TableCell sx={{ width: 50 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((line) => {
                    const supplierOptions = supplierOptionsByProduct.get(line.product_id) || [];
                    const selectedSupplier =
                      supplierOptions.find((o) => o.supplier_id === line.supplier_id) || null;
                    const selectedProduct = products.find((p: any) => p.id === line.product_id) as any;
                    return (
                      <TableRow key={line._id} sx={modernTableStyles.bodyRow}>
                        <TableCell>
                          <Autocomplete
                            size="small"
                            options={products}
                            getOptionLabel={(option: any) =>
                              option.name ? `${option.item_code ? `${option.item_code} - ` : ""}${option.name}` : ""
                            }
                            value={selectedProduct || null}
                            onChange={(_, newValue: any) =>
                              handleSelectProduct(line._id, newValue?.id || 0)
                            }
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                placeholder="Select Product"
                                size="small"
                                required
                                InputProps={{
                                  ...params.InputProps,
                                  endAdornment: (
                                    <>
                                      <EntityPeekButton entity="product" id={line.product_id} />
                                      {params.InputProps.endAdornment}
                                    </>
                                  ),
                                }}
                              />
                            )}
                            sx={{ minWidth: 170 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {selectedProduct?.unit_of_measure || "-"}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" color="text.secondary">
                            {line.product_id ? getAvailableQty(line.product_id) : "-"}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" color="text.secondary">
                            {line.product_id ? getInTransitQty(line.product_id) : "-"}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={line.quantity}
                            onChange={(e) =>
                              handleUpdateLine(line._id, { quantity: parseInt(e.target.value) || 0 })
                            }
                            inputProps={{ min: 1 }}
                            sx={{ width: 80 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Autocomplete
                            size="small"
                            options={supplierOptions}
                            disabled={!line.product_id}
                            getOptionLabel={(option) =>
                              option.supplier_company_name || `#${option.supplier_id}`
                            }
                            value={selectedSupplier}
                            onChange={(_, newValue) => handleSelectSupplier(line._id, newValue)}
                            renderOption={(props, option) => (
                              <li {...props} key={option.id}>
                                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, width: "100%" }}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Typography variant="body2" sx={{ flex: 1 }}>
                                      {option.supplier_company_name || `#${option.supplier_id}`}
                                    </Typography>
                                    {option.is_preferred && (
                                      <TChip size="small" color="primary" icon={<StarIcon />} label="Preferred" />
                                    )}
                                    <Typography variant="caption" color="text.secondary">
                                      {fmtLKR(option.cost_price)}
                                    </Typography>
                                  </Box>
                                  <Typography variant="caption" color="text.secondary">
                                    MOQ: {option.minimum_order_qty ?? "-"} · Lead time:{" "}
                                    {getSupplierLeadTimeLabel(option.supplier_id)}
                                  </Typography>
                                </Box>
                              </li>
                            )}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                placeholder={
                                  !line.product_id ? "Select a product first" : "Select supplier"
                                }
                                size="small"
                                required
                                InputProps={{
                                  ...params.InputProps,
                                  endAdornment: (
                                    <>
                                      <EntityPeekButton entity="supplier" id={line.supplier_id} />
                                      {params.InputProps.endAdornment}
                                    </>
                                  ),
                                }}
                              />
                            )}
                            noOptionsText={
                              line.product_id
                                ? "No suppliers mapped to this product yet"
                                : "Select a product first"
                            }
                            sx={{ minWidth: 200 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {line.supplier_id ? fmtLKR(line.unit_price) : "-"}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            placeholder="Note for this product"
                            value={line.remark}
                            onChange={(e) => handleUpdateLine(line._id, { remark: e.target.value })}
                            inputProps={{ maxLength: 200 }}
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemoveLine(line._id)}
                            disabled={lines.length === 1}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
            <Box sx={{ mt: 1 }}>
              <TButton variant="text" startIcon={<AddIcon />} size="small" onClick={handleAddLine}>
                Add Product
              </TButton>
            </Box>
          </TFormSection>
        </Box>
      )}

      {activeStep === 1 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {supplierGroups.map((group) => (
            <TFormSection
              key={group.supplierId}
              title={group.supplier?.company_name || `Supplier #${group.supplierId}`}
              columns={1}
            >
              <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell>UOM</TableCell>
                      <TableCell align="right">Available Qty</TableCell>
                      <TableCell align="right">In-Transit Qty</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell>Remark</TableCell>
                      <TableCell align="right">{`Unit Price (${currencySymbol})`}</TableCell>
                      <TableCell align="right">{`Subtotal (${currencySymbol})`}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {group.lines.map((l) => (
                      <TableRow key={l._id}>
                        <TableCell>{getProductName(l.product_id)}</TableCell>
                        <TableCell>
                          {(products.find((p: any) => p.id === l.product_id) as any)?.unit_of_measure || "-"}
                        </TableCell>
                        <TableCell align="right">{getAvailableQty(l.product_id)}</TableCell>
                        <TableCell align="right">{getInTransitQty(l.product_id)}</TableCell>
                        <TableCell align="right">{l.quantity}</TableCell>
                        <TableCell sx={{ maxWidth: 240, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {l.remark.trim() || "-"}
                        </TableCell>
                        <TableCell align="right">{fmtLKR(l.unit_price)}</TableCell>
                        <TableCell align="right">{fmtLKR(l.quantity * l.unit_price)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={7} align="right">
                        <Typography fontWeight="bold">Group Total:</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold">{fmtLKR(group.total)}</Typography>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </TFormSection>
          ))}

          <Paper variant="outlined" sx={{ p: 2, display: "flex", justifyContent: "space-between", borderRadius: 2 }}>
            <Typography fontWeight="bold">Grand Total</Typography>
            <Typography fontWeight="bold">{fmtLKR(grandTotal)}</Typography>
          </Paper>
        </Box>
      )}

      <TConfirmDialog {...creditWarningDialog.dialogProps} confirmColor="warning" />
    </Box>
  );
});

export default PurchaseOrderCreateWizard;
