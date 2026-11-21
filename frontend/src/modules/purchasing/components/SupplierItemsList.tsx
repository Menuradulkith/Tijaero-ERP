/**
 * Supplier > Items tab: the supplier's item price list - the Item Catalog items
 * this supplier sells, with the supplier's own cost (mandatory; it is the unit
 * price on a purchase order), SKU, MOQ and preferred flag. Same links as the
 * Item Catalog's Suppliers tab, read and saved from the supplier's side
 * (GET/POST/PUT /purchasing/suppliers/{id}/items).
 */
import { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, FormControlLabel, IconButton, Link, Switch, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fmtLKR,
  handleApiError,
  TAutocomplete,
  TButton,
  TDataGrid,
  TFormSection,
  TSidePanel,
  TStatusChip,
  showSuccessToast,
  type TDataGridColumn,
} from "@/components/tijaero";
import { materialsApi, type Material } from "@/modules/materials/api";
import { supplierItemsApi } from "@/modules/purchasing/api";
import type { SupplierItem, SupplierItemCreate } from "@/modules/purchasing/types";
import { itemCatalogUrl } from "@/modules/purchasing/utils/itemDisplay";
import { useCurrencyStore } from "@/state/currencyStore";

interface SupplierItemsListProps {
  supplierId: number;
  canEdit?: boolean;
}

interface LinkFormState {
  material_id: number;
  supplier_sku: string;
  cost_price: string;
  minimum_order_qty: string;
  is_preferred: boolean;
  active: boolean;
}

const emptyForm: LinkFormState = {
  material_id: 0,
  supplier_sku: "",
  cost_price: "",
  minimum_order_qty: "",
  is_preferred: false,
  active: true,
};

const itemLabel = (code?: string | null, name?: string | null, id?: number) =>
  `${code ? `${code} - ` : ""}${name || (id ? `Item #${id}` : "")}`;

export default function SupplierItemsList({ supplierId, canEdit = false }: SupplierItemsListProps) {
  const queryClient = useQueryClient();
  const currencySymbol = useCurrencyStore((s) => s.symbol);

  // One panel serves Add / Edit / (read-only) View, like the Item Catalog's Suppliers tab.
  const [panelMode, setPanelMode] = useState<"create" | "edit" | "view" | null>(null);
  const [activeLink, setActiveLink] = useState<SupplierItem | null>(null);
  const [form, setForm] = useState<LinkFormState>(emptyForm);
  const [error, setError] = useState("");

  const qKey = ["supplier-items", supplierId];
  const { data: links = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => supplierItemsApi.list(supplierId),
  });

  // Active items are only loaded once the panel opens (the picker needs them).
  const { data: allItems = [] } = useQuery({
    queryKey: ["materials", "active-all"],
    queryFn: () => materialsApi.getAll(0, 100000, true),
    enabled: panelMode !== null,
    staleTime: 60_000,
  });

  const linkedItemIds = new Set(links.map((l) => l.material_id));
  const availableItems = allItems.filter((m) => !linkedItemIds.has(m.id) || m.id === activeLink?.material_id);

  const invalidate = (materialId?: number) => {
    queryClient.invalidateQueries({ queryKey: qKey });
    if (materialId) queryClient.invalidateQueries({ queryKey: ["material-suppliers", materialId] });
  };

  const buildPayload = (): SupplierItemCreate => ({
    material_id: form.material_id,
    supplier_sku: form.supplier_sku.trim() || null,
    cost_price: parseFloat(form.cost_price),
    minimum_order_qty: form.minimum_order_qty ? parseInt(form.minimum_order_qty, 10) : null,
    is_preferred: form.is_preferred,
    active: form.active,
  });

  const createMut = useMutation({
    mutationFn: () => supplierItemsApi.create(supplierId, buildPayload()),
    onSuccess: (row) => {
      invalidate(row?.material_id ?? form.material_id);
      showSuccessToast("Item added to this supplier");
      closePanel();
    },
    onError: (e: unknown) => setError(handleApiError(e, "Failed to save.")),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      // material_id is fixed once linked; send only the editable terms.
      const payload = buildPayload();
      return supplierItemsApi.update(supplierId, (activeLink as SupplierItem).id, {
        supplier_sku: payload.supplier_sku,
        cost_price: payload.cost_price,
        minimum_order_qty: payload.minimum_order_qty,
        is_preferred: payload.is_preferred,
        active: payload.active,
      });
    },
    onSuccess: () => {
      invalidate(activeLink?.material_id);
      showSuccessToast("Supplier item updated");
      closePanel();
    },
    onError: (e: unknown) => setError(handleApiError(e, "Failed to save.")),
  });

  const formFromLink = (link: SupplierItem): LinkFormState => ({
    material_id: link.material_id,
    supplier_sku: link.supplier_sku || "",
    cost_price: String(link.cost_price ?? ""),
    minimum_order_qty: link.minimum_order_qty != null ? String(link.minimum_order_qty) : "",
    is_preferred: link.is_preferred,
    active: link.active,
  });

  const openAdd = () => {
    setActiveLink(null);
    setForm(emptyForm);
    setError("");
    setPanelMode("create");
  };

  const openEdit = (link: SupplierItem) => {
    setActiveLink(link);
    setForm(formFromLink(link));
    setError("");
    setPanelMode("edit");
  };

  const handleRowClick = (link: SupplierItem) => {
    setActiveLink(link);
    setForm(formFromLink(link));
    setError("");
    setPanelMode("view");
  };

  const closePanel = () => {
    setPanelMode(null);
    setActiveLink(null);
    setForm(emptyForm);
    setError("");
  };

  const costValid = !isNaN(parseFloat(form.cost_price)) && parseFloat(form.cost_price) > 0;

  const handleSave = () => {
    setError("");
    if (!form.material_id) {
      setError("Please select an item.");
      return;
    }
    if (!costValid) {
      setError("Enter this supplier's cost price (greater than 0) - purchase orders use it.");
      return;
    }
    if (activeLink) updateMut.mutate();
    else createMut.mutate();
  };

  const isBusy = createMut.isPending || updateMut.isPending;

  const columns: TDataGridColumn<SupplierItem>[] = useMemo(
    () => [
      {
        field: "material_item_code",
        header: "Item Code",
        width: 130,
        renderCell: (params: GridRenderCellParams<SupplierItem>) => params.row.material_item_code || "-",
      },
      {
        field: "material_name",
        header: "Item",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<SupplierItem>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <Link
              component={RouterLink}
              to={itemCatalogUrl(params.row.material_id)}
              underline="hover"
              variant="body2"
              fontWeight={600}
              onClick={(e) => e.stopPropagation()}
            >
              {params.row.material_name || `Item #${params.row.material_id}`}
            </Link>
            {params.row.is_preferred && (
              <TStatusChip
                status="preferred"
                size="small"
                variant="outlined"
                customMap={{ preferred: { label: "Preferred", color: "primary" } }}
                sx={{ height: 20, fontSize: "0.65rem" }}
              />
            )}
            {!params.row.active && (
              <TStatusChip status="inactive" size="small" statusMap="activeInactive" sx={{ height: 20, fontSize: "0.65rem" }} />
            )}
          </Box>
        ),
      },
      {
        field: "unit_of_measure",
        header: "UOM",
        width: 90,
        renderCell: (params: GridRenderCellParams<SupplierItem>) => params.row.unit_of_measure || "-",
      },
      {
        field: "supplier_sku",
        header: "Supplier SKU",
        width: 140,
        renderCell: (params: GridRenderCellParams<SupplierItem>) => params.row.supplier_sku || "-",
      },
      {
        field: "cost_price",
        header: `Cost Price (${currencySymbol})`,
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierItem>) => fmtLKR(Number(params.row.cost_price)),
      },
      {
        field: "minimum_order_qty",
        header: "MOQ",
        width: 90,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SupplierItem>) => params.row.minimum_order_qty ?? "-",
      },
      ...(canEdit
        ? [
            {
              field: "actions",
              header: "Actions",
              width: 90,
              sortable: false,
              align: "center" as const,
              headerAlign: "center" as const,
              renderCell: (params: GridRenderCellParams<SupplierItem>) => (
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                  <IconButton
                    size="small"
                    aria-label="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(params.row);
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, currencySymbol],
  );

  const selectedItem: Material | null =
    allItems.find((m) => m.id === form.material_id) ||
    (activeLink
      ? ({ id: activeLink.material_id, item_code: activeLink.material_item_code || "", name: activeLink.material_name || "" } as Material)
      : null);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Items this supplier sells. The supplier's cost is the unit price on purchase orders.
        </Typography>
        {canEdit && (
          <Button size="small" startIcon={<AddIcon />} variant="outlined" onClick={openAdd}>
            Add Item
          </Button>
        )}
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : links.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No items for this supplier yet.
        </Typography>
      ) : (
        <TDataGrid
          rows={links}
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
        title={panelMode === "view" ? "Supplier Item Details" : panelMode === "edit" ? "Edit Supplier Item" : "Add Item"}
        onSubmit={panelMode === "view" ? undefined : handleSave}
        isSubmitting={isBusy}
        submitDisabled={!form.material_id || !costValid}
        submitText={panelMode === "edit" ? "Save Changes" : "Add Item"}
        extraActions={
          panelMode === "view" && canEdit ? (
            <TButton variant="secondary" onClick={() => activeLink && openEdit(activeLink)}>
              Edit
            </TButton>
          ) : undefined
        }
      >
        <TFormSection title="Item" variant="plain" columns={1}>
          <TAutocomplete<Material>
            label="Item"
            required
            options={availableItems}
            value={selectedItem}
            onChange={(value) => setForm({ ...form, material_id: (value as Material | null)?.id || 0 })}
            getOptionLabel={(m) => itemLabel(m.item_code, m.name, m.id)}
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
            label={`Cost Price * (${currencySymbol})`}
            type="number"
            value={form.cost_price}
            onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
            inputProps={{ min: 0.01, step: "0.01" }}
            helperText={panelMode === "view" ? undefined : "Used as the unit price when this item is bought from this supplier"}
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
              label="Preferred supplier for this item"
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
    </Box>
  );
}
