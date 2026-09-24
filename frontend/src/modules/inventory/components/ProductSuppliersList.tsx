/**
 * ProductSuppliersList - "Vendor Pricelist" for a product: which suppliers
 * can supply it, and on what terms (cost, MOQ, preferred).
 *
 * This is the product-first entry point into the same supplier_product
 * mapping managed from the Supplier's own detail page (Suppliers ->
 * Products section) — both sides read/write the exact same rows via
 * suppliersApi.*Product, just scoped from opposite directions. The UI
 * mirrors SuppliersPage's Payment Methods pattern (TDataGrid + TSidePanel)
 * so both "vendor list" editors look and behave the same way.
 */
import { useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, IconButton, Switch, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fmtLKR,
  handleApiError,
  TAutocomplete,
  TButton,
  TConfirmDialog,
  TDataGrid,
  TFormSection,
  TSidePanel,
  showErrorToast,
  showSuccessToast,
  useConfirmDialog,
  type TDataGridColumn,
} from "@/components/tijaero";
import { productsApi } from "../api";
import { suppliersApi } from "@/modules/purchasing/api";
import type { Supplier, SupplierProduct, SupplierProductCreate } from "@/modules/purchasing/types";

/**
 * A supplier mapping staged locally while a product is still being created
 * — there's no product id yet to attach it to on the backend, so it's held
 * here and pushed to the API once the product is saved (see ProductsPage's
 * createProductMutation).
 */
export interface PendingSupplierMapping {
  id: number;
  supplier_id: number;
  supplier_company_name: string;
  supplier_sku?: string;
  cost_price: number;
  minimum_order_qty?: number;
  is_preferred: boolean;
  active: boolean;
}

type MappingRow = SupplierProduct | PendingSupplierMapping;

interface ProductSuppliersListProps {
  /** Omit while creating a new product (no id yet) — pair with pendingMappings/onPendingMappingsChange. */
  productId?: number;
  canEdit?: boolean;
  pendingMappings?: PendingSupplierMapping[];
  onPendingMappingsChange?: (mappings: PendingSupplierMapping[]) => void;
}

interface MappingFormState {
  supplier_id: number;
  supplier_sku: string;
  cost_price: string;
  minimum_order_qty: string;
  is_preferred: boolean;
  active: boolean;
}

const emptyForm: MappingFormState = {
  supplier_id: 0,
  supplier_sku: "",
  cost_price: "",
  minimum_order_qty: "",
  is_preferred: false,
  active: true,
};

export default function ProductSuppliersList({
  productId,
  canEdit = false,
  pendingMappings,
  onPendingMappingsChange,
}: ProductSuppliersListProps) {
  const isPending = productId === undefined;
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // A single panel serves Add / Edit / (read-only) View, matching the
  // Payment Methods / Contact Persons pattern on the Suppliers page.
  const [panelMode, setPanelMode] = useState<"create" | "edit" | "view" | null>(null);
  const [activeMapping, setActiveMapping] = useState<MappingRow | null>(null);
  const [form, setForm] = useState<MappingFormState>(emptyForm);
  const [error, setError] = useState("");

  const qKey = ["product-suppliers", productId];

  const { data: liveMappings = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => productsApi.getSuppliers(productId as number),
    enabled: !isPending,
  });

  const mappings: MappingRow[] = isPending ? pendingMappings ?? [] : liveMappings;

  // Only fetched once the panel is actually open — the picker needs the
  // full supplier list, but there's no reason to load it just to view the grid.
  const { data: allSuppliers = [] } = useQuery({
    queryKey: ["suppliers-for-product-mapping"],
    queryFn: () => suppliersApi.getAll(),
    enabled: panelMode !== null,
  });

  const alreadyMappedSupplierIds = new Set(mappings.map((m) => m.supplier_id));
  const availableSuppliers = allSuppliers.filter(
    (s) => s.active && (!alreadyMappedSupplierIds.has(s.id) || s.id === activeMapping?.supplier_id)
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qKey });
    queryClient.invalidateQueries({ queryKey: ["product-suppliers-compare", productId] });
  };

  const buildPayload = (): SupplierProductCreate => ({
    product_id: productId as number,
    supplier_sku: form.supplier_sku || undefined,
    cost_price: parseFloat(form.cost_price),
    minimum_order_qty: form.minimum_order_qty ? parseInt(form.minimum_order_qty, 10) : undefined,
    is_preferred: form.is_preferred,
    active: form.active,
  });

  const createMut = useMutation({
    mutationFn: () => suppliersApi.createProduct(form.supplier_id, buildPayload()),
    onSuccess: () => { invalidate(); showSuccessToast("Supplier added"); closePanel(); },
    onError: (e: unknown) => setError(handleApiError(e, "Failed to save.")),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      suppliersApi.updateProduct((activeMapping as SupplierProduct).supplier_id, (activeMapping as SupplierProduct).id, buildPayload()),
    onSuccess: () => { invalidate(); showSuccessToast("Supplier mapping updated"); closePanel(); },
    onError: (e: unknown) => setError(handleApiError(e, "Failed to save.")),
  });

  const deleteMut = useMutation({
    mutationFn: (mapping: SupplierProduct) => suppliersApi.deleteProduct(mapping.supplier_id, mapping.id),
    onSuccess: () => { invalidate(); showSuccessToast("Supplier removed"); closePanel(); },
    onError: () => showErrorToast("Cannot delete this supplier mapping."),
  });

  const formFromMapping = (mapping: MappingRow): MappingFormState => ({
    supplier_id: mapping.supplier_id,
    supplier_sku: mapping.supplier_sku || "",
    cost_price: String(mapping.cost_price),
    minimum_order_qty: mapping.minimum_order_qty != null ? String(mapping.minimum_order_qty) : "",
    is_preferred: mapping.is_preferred,
    active: mapping.active,
  });

  const openAdd = () => {
    setActiveMapping(null);
    setForm(emptyForm);
    setError("");
    setPanelMode("create");
  };

  const openEdit = (mapping: MappingRow) => {
    setActiveMapping(mapping);
    setForm(formFromMapping(mapping));
    setError("");
    setPanelMode("edit");
  };

  // A saved (non-pending) row opens read-only, with an Edit button in the
  // panel footer; a still-draft row (created while the product itself was
  // being created) opens straight into edit, since there's nothing to
  // "view" yet that the user didn't just type themselves.
  const handleRowClick = (mapping: MappingRow) => {
    setActiveMapping(mapping);
    setForm(formFromMapping(mapping));
    setError("");
    setPanelMode(isPending ? "edit" : "view");
  };

  const closePanel = () => {
    setPanelMode(null);
    setActiveMapping(null);
    setForm(emptyForm);
    setError("");
  };

  const handleDeleteClick = async (mapping: MappingRow) => {
    const confirmed = await confirmDialog.confirm({
      title: "Remove Supplier",
      message: `This will remove "${mapping.supplier_company_name || "this supplier"}" from this product's approved-vendor list.`,
      confirmText: "Remove",
      confirmColor: "error",
    });
    if (!confirmed) return;

    if (isPending) {
      onPendingMappingsChange?.((pendingMappings ?? []).filter((m) => m.id !== mapping.id));
      if (panelMode) closePanel();
      return;
    }
    deleteMut.mutate(mapping as SupplierProduct);
  };

  const handleSave = () => {
    setError("");
    if (!form.supplier_id) {
      setError("Please select a supplier.");
      return;
    }
    if (isNaN(parseFloat(form.cost_price)) || parseFloat(form.cost_price) < 0) {
      setError("Please enter a valid cost price.");
      return;
    }

    if (isPending) {
      const supplier = allSuppliers.find((s) => s.id === form.supplier_id);
      const savedRow: PendingSupplierMapping = {
        id: activeMapping?.id ?? Date.now(),
        supplier_id: form.supplier_id,
        supplier_company_name:
          supplier?.company_name ?? activeMapping?.supplier_company_name ?? "",
        supplier_sku: form.supplier_sku || undefined,
        cost_price: parseFloat(form.cost_price),
        minimum_order_qty: form.minimum_order_qty ? parseInt(form.minimum_order_qty, 10) : undefined,
        is_preferred: form.is_preferred,
        active: form.active,
      };
      const current = pendingMappings ?? [];
      const next = activeMapping
        ? current.map((m) => (m.id === savedRow.id ? savedRow : m))
        : [...current, savedRow];
      // Only one preferred supplier per product, mirroring the backend rule.
      const deduped = savedRow.is_preferred
        ? next.map((m) => (m.id === savedRow.id ? m : { ...m, is_preferred: false }))
        : next;
      onPendingMappingsChange?.(deduped);
      closePanel();
      return;
    }

    if (activeMapping) {
      updateMut.mutate();
    } else {
      createMut.mutate();
    }
  };

  const isBusy = createMut.isPending || updateMut.isPending;

  const columns: TDataGridColumn<MappingRow>[] = useMemo(
    () => [
      {
        field: "supplier_company_name",
        header: "Supplier",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<MappingRow>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <Typography variant="body2" fontWeight={600}>
              {params.row.supplier_company_name || `#${params.row.supplier_id}`}
            </Typography>
            {params.row.is_preferred && (
              <Chip label="Preferred" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: "0.65rem" }} />
            )}
            {!params.row.active && <Chip label="Inactive" size="small" sx={{ height: 20, fontSize: "0.65rem" }} />}
          </Box>
        ),
      },
      {
        field: "supplier_sku",
        header: "Supplier SKU",
        flex: 1,
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<MappingRow>) => params.row.supplier_sku || "-",
      },
      {
        field: "cost_price",
        header: "Cost Price",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<MappingRow>) => fmtLKR(params.row.cost_price),
      },
      {
        field: "minimum_order_qty",
        header: "MOQ",
        width: 90,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<MappingRow>) => params.row.minimum_order_qty ?? "-",
      },
      ...(canEdit
        ? [
            {
              field: "actions",
              header: "Actions",
              width: 100,
              sortable: false,
              align: "center" as const,
              headerAlign: "center" as const,
              renderCell: (params: GridRenderCellParams<MappingRow>) => (
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(params.row);
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClick(params.row);
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, activeMapping]
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Suppliers
        </Typography>
        {canEdit && (
          <Button size="small" startIcon={<AddIcon />} variant="outlined" onClick={openAdd}>
            Add Supplier
          </Button>
        )}
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : mappings.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No suppliers mapped to this product yet.
        </Typography>
      ) : (
        <TDataGrid
          rows={mappings}
          columns={columns}
          onRowClick={handleRowClick}
          autoHeight
          density="standard"
          pageSizeOptions={[10, 25, 50]}
          pageSize={10}
        />
      )}

      <TSidePanel
        open={panelMode !== null}
        onClose={closePanel}
        title={
          panelMode === "view"
            ? "Supplier Mapping Details"
            : panelMode === "edit"
              ? "Edit Supplier Mapping"
              : "Add Supplier"
        }
        onSubmit={panelMode === "view" ? undefined : handleSave}
        isSubmitting={isBusy}
        submitDisabled={!form.supplier_id || isNaN(parseFloat(form.cost_price)) || parseFloat(form.cost_price) < 0}
        submitText={panelMode === "edit" ? "Save Changes" : "Add Supplier"}
        extraActions={
          panelMode === "view" && canEdit ? (
            <TButton variant="secondary" onClick={() => activeMapping && openEdit(activeMapping)}>
              Edit
            </TButton>
          ) : undefined
        }
      >
        <TFormSection title="Supplier" variant="plain" columns={1}>
          <TAutocomplete<Supplier>
            label="Supplier"
            required
            options={availableSuppliers}
            value={allSuppliers.find((s) => s.id === form.supplier_id) || null}
            onChange={(value) => setForm({ ...form, supplier_id: (value as Supplier | null)?.id || 0 })}
            getOptionLabel={(s) => s.company_name}
            disabled={panelMode !== "create"}
            viewMode={panelMode === "view"}
          />
        </TFormSection>
        <TFormSection title="Terms" variant="plain" columns={2}>
          <TextField
            label="Supplier's SKU"
            value={form.supplier_sku}
            onChange={(e) => setForm({ ...form, supplier_sku: e.target.value })}
            helperText={panelMode === "view" ? undefined : "Supplier's own part number"}
            disabled={panelMode === "view"}
            fullWidth
          />
          <TextField
            label="Cost Price *"
            type="number"
            value={form.cost_price}
            onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
            inputProps={{ min: 0, step: "0.01" }}
            disabled={panelMode === "view"}
            fullWidth
          />
          <TextField
            label="Minimum Order Qty"
            type="number"
            value={form.minimum_order_qty}
            onChange={(e) => setForm({ ...form, minimum_order_qty: e.target.value })}
            inputProps={{ min: 1 }}
            disabled={panelMode === "view"}
            fullWidth
          />
          <Box sx={{ display: "flex", gap: 3, gridColumn: "1 / -1" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_preferred}
                  disabled={panelMode === "view"}
                  onChange={(e) => setForm({ ...form, is_preferred: e.target.checked })}
                />
              }
              label="Preferred supplier"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.active}
                  disabled={panelMode === "view"}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
              }
              label="Active"
            />
          </Box>
        </TFormSection>
        {error && (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
      </TSidePanel>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );
}
