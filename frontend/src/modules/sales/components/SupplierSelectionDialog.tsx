/**
 * SupplierSelectionDialog - step 1 of the Sales Quotation -> Purchase Orders
 * workflow. Lets the user pick which quotation items need procurement and,
 * for each, compare and choose a supplier (unit cost, lead time, minimum
 * order quantity, preferred-supplier flag). No PO is created here — the
 * user's picks are handed off to the Create Purchase Orders review page.
 */
import StarIcon from "@mui/icons-material/Star";
import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { fmtLKR, modernTableStyles, TButton } from "@/components/tijaero";
import { productsApi } from "@/modules/inventory/api";
import { suppliersApi } from "@/modules/purchasing/api";
import type { Supplier, SupplierProduct } from "@/modules/purchasing/types";

export interface ProcurementCandidate {
  quote_item_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  warrenty_month: string;
}

export interface SupplierSelection {
  quote_item_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  warrenty_month: string;
  supplier_id: number;
}

export interface SupplierSelectionDialogProps {
  open: boolean;
  candidates: ProcurementCandidate[];
  onClose: () => void;
  onContinue: (selections: SupplierSelection[]) => void;
}

interface RowState {
  included: boolean;
  supplier_id: number;
  quantity: number;
  unit_price: number;
}

export default function SupplierSelectionDialog({
  open,
  candidates,
  onClose,
  onContinue,
}: SupplierSelectionDialogProps) {
  const [rows, setRows] = useState<Record<number, RowState>>({});

  // Reset row state whenever the dialog opens for a (possibly new) set of candidates.
  useEffect(() => {
    if (!open) return;
    setRows(
      Object.fromEntries(
        candidates.map((c) => [
          c.quote_item_id,
          { included: true, supplier_id: 0, quantity: c.quantity, unit_price: c.unit_price },
        ]),
      ),
    );
  }, [open, candidates]);

  const { data: suppliers } = useQueries({
    queries: [{ queryKey: ["suppliers"], queryFn: () => suppliersApi.getAll(), enabled: open }],
    combine: (results) => ({ data: results[0].data as Supplier[] | undefined }),
  });

  const productIds = useMemo(() => Array.from(new Set(candidates.map((c) => c.product_id))), [candidates]);

  const supplierOptionQueries = useQueries({
    queries: productIds.map((productId) => ({
      queryKey: ["product-suppliers-compare", productId],
      queryFn: () => productsApi.getSuppliers(productId),
      staleTime: 60_000,
      enabled: open,
    })),
  });

  const supplierOptionsByProduct = useMemo(() => {
    const map = new Map<number, SupplierProduct[]>();
    productIds.forEach((productId, idx) => {
      map.set(productId, supplierOptionQueries[idx]?.data || []);
    });
    return map;
  }, [productIds, supplierOptionQueries]);

  const getSupplierLeadTimeLabel = (supplierId: number) => {
    const supplier = suppliers?.find((s) => s.id === supplierId);
    if (supplier?.average_lead_time_days != null) return `${Math.round(supplier.average_lead_time_days)} days`;
    if (supplier?.lead_time_days != null) return `${supplier.lead_time_days} days (est.)`;
    return "-";
  };

  const updateRow = (quoteItemId: number, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [quoteItemId]: { ...prev[quoteItemId], ...patch } }));

  const isValid = candidates.some((c) => rows[c.quote_item_id]?.included) &&
    candidates
      .filter((c) => rows[c.quote_item_id]?.included)
      .every((c) => rows[c.quote_item_id]?.supplier_id > 0 && rows[c.quote_item_id]?.quantity > 0);

  const handleContinue = () => {
    const selections: SupplierSelection[] = candidates
      .filter((c) => rows[c.quote_item_id]?.included)
      .map((c) => ({
        quote_item_id: c.quote_item_id,
        product_id: c.product_id,
        product_name: c.product_name,
        quantity: rows[c.quote_item_id].quantity,
        unit_price: rows[c.quote_item_id].unit_price,
        warrenty_month: c.warrenty_month,
        supplier_id: rows[c.quote_item_id].supplier_id,
      }));
    onContinue(selections);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Select Products & Suppliers for Procurement</DialogTitle>
      <DialogContent>
        {candidates.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No items on this quotation currently need procurement.
          </Typography>
        ) : (
          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2, mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell sx={{ width: 40 }} />
                  <TableCell sx={{ minWidth: 160 }}>Product</TableCell>
                  <TableCell align="right" sx={{ width: 90 }}>Quantity</TableCell>
                  <TableCell sx={{ minWidth: 260 }}>Supplier</TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>Unit Price</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((c) => {
                  const row = rows[c.quote_item_id];
                  if (!row) return null;
                  const supplierOptions = supplierOptionsByProduct.get(c.product_id) || [];
                  const selectedSupplier = supplierOptions.find((o) => o.supplier_id === row.supplier_id) || null;
                  return (
                    <TableRow key={c.quote_item_id} sx={modernTableStyles.bodyRow}>
                      <TableCell>
                        <Checkbox
                          size="small"
                          checked={row.included}
                          onChange={(e) => updateRow(c.quote_item_id, { included: e.target.checked })}
                        />
                      </TableCell>
                      <TableCell>{c.product_name}</TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          disabled={!row.included}
                          value={row.quantity}
                          onChange={(e) => updateRow(c.quote_item_id, { quantity: parseInt(e.target.value) || 0 })}
                          inputProps={{ min: 1, max: c.quantity }}
                          sx={{ width: 80 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Autocomplete
                          size="small"
                          options={supplierOptions}
                          disabled={!row.included}
                          getOptionLabel={(option) => option.supplier_company_name || `#${option.supplier_id}`}
                          value={selectedSupplier}
                          onChange={(_, newValue) =>
                            updateRow(c.quote_item_id, {
                              supplier_id: newValue?.supplier_id || 0,
                              unit_price: newValue?.cost_price ?? row.unit_price,
                            })
                          }
                          renderOption={(props, option) => (
                            <li {...props} key={option.id}>
                              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, width: "100%" }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                  <Typography variant="body2" sx={{ flex: 1 }}>
                                    {option.supplier_company_name || `#${option.supplier_id}`}
                                  </Typography>
                                  {option.is_preferred && (
                                    <Chip size="small" color="primary" icon={<StarIcon />} label="Preferred" />
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
                          renderInput={(params) => <TextField {...params} placeholder="Select supplier" size="small" />}
                          noOptionsText="No suppliers mapped to this product yet"
                          sx={{ minWidth: 240 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          disabled={!row.included}
                          value={row.unit_price}
                          onChange={(e) => updateRow(c.quote_item_id, { unit_price: parseFloat(e.target.value) || 0 })}
                          inputProps={{ min: 0, step: "0.01" }}
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <TButton variant="secondary" onClick={onClose}>Cancel</TButton>
        <TButton onClick={handleContinue} disabled={!isValid}>Continue</TButton>
      </DialogActions>
    </Dialog>
  );
}
