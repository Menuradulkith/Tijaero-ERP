/**
 * ProductReadOnlyView - the Products page detail panel (General / Pricing / Suppliers tabs),
 * same layout and fields, view only. Used by the product "peek" popup so a user who may not
 * open the Products page can still see exactly what it shows.
 *
 * Keep the sections in step with ProductsPage.tsx's detail panel.
 */
import { useMemo, useState } from "react";
import { Alert, Box, FormControlLabel, InputAdornment, Switch, TextField, Typography } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import InventoryIcon from "@mui/icons-material/Inventory";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import { useCurrencyStore } from "@/state/currencyStore";
import {
  FormSection,
  PRODUCT_ITEM_TYPE,
  PRODUCT_TRACKING_TYPE,
  PRODUCT_UOM,
  TChip,
  TDataGrid,
  TTabPanel,
  TTabs,
  fmtLKR,
  type TDataGridColumn,
  type TTabConfig,
} from "@/components/tijaero";
import { productImageUrl } from "@/modules/inventory/api";
import type { Product } from "@/modules/inventory/types";
import type { SupplierProduct } from "@/modules/purchasing/types";

export interface ProductPeekData {
  product: Partial<Product> & { name: string; item_code: string; active: boolean };
  category_name?: string | null;
  brand_name?: string | null;
  show_pricing: boolean;
  /** False for sales-side viewers: the backend leaves out each supplier's cost_price. */
  show_supplier_costs?: boolean;
  suppliers: SupplierProduct[];
}

/** A disabled, read-only field styled like the page's fields. */
function Field({
  label,
  value,
  adornment,
  multiline,
  wide,
}: {
  label: string;
  value: unknown;
  adornment?: string;
  multiline?: boolean;
  wide?: boolean;
}) {
  return (
    <TextField
      label={label}
      size="small"
      value={value === null || value === undefined ? "" : String(value)}
      disabled
      multiline={multiline}
      rows={multiline ? 2 : undefined}
      InputProps={{
        readOnly: true,
        startAdornment: adornment ? <InputAdornment position="start">{adornment}</InputAdornment> : undefined,
      }}
      InputLabelProps={{ shrink: true }}
      sx={wide ? { gridColumn: { sm: "1 / -1" } } : undefined}
    />
  );
}

const optionLabel = (options: readonly { value: string; label: string }[], value?: string) =>
  options.find((o) => o.value === value)?.label ?? value ?? "";

export default function ProductReadOnlyView({ product, category_name, brand_name, show_pricing, show_supplier_costs = true, suppliers }: ProductPeekData) {
  const [tab, setTab] = useState("general");
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const image = productImageUrl(product.image_url);

  const tabs: TTabConfig[] = [
    { id: "general", label: "General", icon: <InventoryIcon fontSize="small" /> },
    ...(show_pricing ? [{ id: "pricing", label: "Pricing", icon: <AttachMoneyIcon fontSize="small" /> }] : []),
    { id: "suppliers", label: "Suppliers", icon: <LocalShippingIcon fontSize="small" /> },
  ];

  const supplierColumns: TDataGridColumn<SupplierProduct>[] = useMemo(
    () => [
      { field: "supplier_company_name", header: "Supplier", flex: 1, minWidth: 160 },
      { field: "supplier_sku", header: "Supplier SKU", width: 140 },
      ...(show_supplier_costs
        ? [
            {
              field: "cost_price",
              header: "Cost",
              width: 120,
              align: "right" as const,
              headerAlign: "right" as const,
              renderCell: (params: GridRenderCellParams<SupplierProduct>) => fmtLKR(Number(params.row.cost_price)),
            },
          ]
        : []),
      { field: "minimum_order_qty", header: "MOQ", width: 90, align: "right", headerAlign: "right" },
      {
        field: "is_preferred",
        header: "Preferred",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SupplierProduct>) =>
          params.row.is_preferred ? <TChip label="Preferred" size="small" color="primary" /> : null,
      },
      {
        field: "active",
        header: "Status",
        width: 100,
        renderCell: (params: GridRenderCellParams<SupplierProduct>) => (
          <TChip label={params.row.active ? "Active" : "Inactive"} size="small" color={params.row.active ? "success" : "default"} />
        ),
      },
    ],
    [show_supplier_costs],
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" noWrap>
            {product.item_code} - {product.name}
          </Typography>
        </Box>
        <TChip size="small" label={product.active ? "Active" : "Inactive"} color={product.active ? "success" : "default"} />
        {product.website_active && <TChip size="small" label="Website Active" color="info" />}
      </Box>
      <TTabs tabs={tabs} activeTab={tab} onChange={(id) => setTab(String(id))} showDivider={false} />

      <TTabPanel value={tab} index="general" padding={0} sx={{ pt: 2 }}>
        {!product.active && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This product is inactive and cannot be used in transactions.
          </Alert>
        )}

        <FormSection title="Basic Information">
          <Field label="Item Code" value={product.item_code} />
          <Field label="Product Name" value={product.name} />
          <Field label="Model" value={product.model} />
          <Field label="Item Type" value={optionLabel(PRODUCT_ITEM_TYPE, product.item_type)} />
          <Field label="Unit of Measure" value={optionLabel(PRODUCT_UOM, product.unit_of_measure || "pcs")} />
          <Field label="Tracking Type" value={optionLabel(PRODUCT_TRACKING_TYPE, product.tracking_type || "serial")} />
          <Field label="Over-receipt tolerance (%)" value={product.over_receipt_tolerance_pct ?? 0} />
          <Field label="Under-receipt tolerance (%)" value={product.under_receipt_tolerance_pct ?? 0} />
          <Field label="Description" value={product.description} multiline wide />
        </FormSection>

        <FormSection title="Classification">
          <Field label="Category" value={category_name} />
          <Field label="Brand" value={brand_name} />
        </FormSection>

        <FormSection title="Product Image" columns={1}>
          {image ? (
            <Box component="img" src={image} alt={product.name} sx={{ maxWidth: 220, maxHeight: 220, objectFit: "contain" }} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No image uploaded.
            </Typography>
          )}
        </FormSection>

        <FormSection title="Status">
          <Box sx={{ display: "flex", gap: 3, gridColumn: { sm: "1 / -1" } }}>
            <FormControlLabel control={<Switch checked={!!product.active} disabled />} label="Active" />
            <FormControlLabel control={<Switch checked={!!product.website_active} disabled />} label="Website Active" />
          </Box>
        </FormSection>
      </TTabPanel>

      {show_pricing && (
        <TTabPanel value={tab} index="pricing" padding={0} sx={{ pt: 2 }}>
          <FormSection title="Pricing" isLast>
            <Field label="Cost Price" value={product.cost_price} adornment={currencySymbol} />
            <Field label="Website Price" value={product.website_price} adornment={currencySymbol} />
            <Field label="Selling Price" value={product.selling_price} adornment={currencySymbol} />
            <Field label="Minimum Selling Price" value={product.minimum_selling_price} adornment={currencySymbol} />
          </FormSection>
        </TTabPanel>
      )}

      <TTabPanel value={tab} index="suppliers" padding={0} sx={{ pt: 2 }}>
        <FormSection title="Suppliers" isLast>
          <Box sx={{ gridColumn: "1 / -1" }}>
            {suppliers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No suppliers are linked to this product yet.
              </Typography>
            ) : (
              <TDataGrid
                rows={suppliers}
                columns={supplierColumns}
                autoHeight
                density="standard"
                pageSizeOptions={[10, 25, 50]}
                pageSize={10}
              />
            )}
          </Box>
        </FormSection>
      </TTabPanel>
    </Box>
  );
}
