/**
 * Item display / picking for manufacturing screens.
 * - ItemLink: the item's name (or a given label) linked to the Item Catalog when the
 *   row has an item; old product-only rows show plain text.
 * - ItemAutocomplete: picks an Item Catalog item ("MAT000012 — Steel Sheet"), UOM shown.
 */
import { Autocomplete, Box, Link, TextField, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { Material } from "@/modules/materials/api";
import { itemCatalogUrl, itemOptionLabel, mfgItemName, type MfgItemLike } from "@/modules/manufacturing/itemDisplay";

export function ItemLink({ row, label }: { row: MfgItemLike; label?: ReactNode }) {
  const text = label ?? mfgItemName(row);
  if (!row.material_id) return <>{text}</>;
  return (
    <Link component={RouterLink} to={itemCatalogUrl(row.material_id)} underline="hover" onClick={(e) => e.stopPropagation()}>
      {text}
    </Link>
  );
}

interface ItemAutocompleteProps {
  items: Material[];
  /** Selected item id (0 / null = none). */
  value: number | null | undefined;
  onChange: (item: Material | null) => void;
  label?: string;
  placeholder?: string;
  error?: boolean;
  helperText?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  loading?: boolean;
  onBlur?: () => void;
  minWidth?: number;
  /** Table cells: no "UOM: ..." hint under the field. */
  hideUomHint?: boolean;
}

export function ItemAutocomplete({
  items,
  value,
  onChange,
  label,
  placeholder,
  error,
  helperText,
  required,
  disabled,
  size = "small",
  loading,
  onBlur,
  minWidth,
  hideUomHint,
}: ItemAutocompleteProps) {
  const selected = (value && items.find((m) => m.id === value)) || null;
  return (
    <Autocomplete
      size={size}
      options={items}
      value={selected}
      loading={loading}
      disabled={disabled}
      getOptionLabel={itemOptionLabel}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, m) => onChange(m)}
      onBlur={onBlur}
      sx={minWidth ? { minWidth } : undefined}
      renderOption={(props, m) => (
        <Box component="li" {...props} key={m.id}>
          <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 1 }}>
            <Typography variant="body2" noWrap>{itemOptionLabel(m)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{m.unit_of_measure}</Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText ?? (!hideUomHint && selected?.unit_of_measure ? `UOM: ${selected.unit_of_measure}` : undefined)}
        />
      )}
    />
  );
}
