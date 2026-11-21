/**
 * Manufacturing works on Item Catalog items (materials): a BOM makes an item from
 * component items, production orders make an item, reorder rules and MRP are per
 * item. Rows saved before that only carry a product, so every helper falls back to
 * the product's code / name. The linked name and picker components are in
 * components/ItemFields.tsx.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { materialsApi, type Material } from "@/modules/materials/api";

export interface MfgItemLike {
  material_id?: number | null;
  material_item_code?: string | null;
  material_name?: string | null;
  unit_of_measure?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  product_code?: string | null;
}

/** Item Catalog page opened on one item. */
export const itemCatalogUrl = (materialId: number) => `/materials/item-catalog?focus=${materialId}`;

export const mfgItemCode = (r: MfgItemLike): string => r.material_item_code || r.product_code || "";

export const mfgItemName = (r: MfgItemLike): string =>
  r.material_name ||
  r.product_name ||
  (r.material_id ? `Item #${r.material_id}` : r.product_id ? `Product #${r.product_id}` : "-");

/** "CODE — Name", or just the name when there is no code. */
export const mfgItemLabel = (r: MfgItemLike): string => {
  const code = mfgItemCode(r);
  const name = mfgItemName(r);
  return code ? `${code} — ${name}` : name;
};

export const mfgItemUom = (r: MfgItemLike): string => r.unit_of_measure || "-";

/** Picker label for a catalog item: "MAT000012 — Steel Sheet". */
export const itemOptionLabel = (m?: Pick<Material, "item_code" | "name"> | null): string =>
  m ? (m.item_code ? `${m.item_code} — ${m.name}` : m.name) : "";

/** An MRP row's key: item (or, for an old product-only row, product) + branch. */
export const mrpLineKey = (l: MfgItemLike & { branch_code: string }): string =>
  `${l.material_id ? `m${l.material_id}` : `p${l.product_id ?? 0}`}:${l.branch_code}`;

/** What an MRP firm line sends: the item, or the product only for an old product-only row. */
export const mrpLineRef = (l: MfgItemLike): { material_id?: number; product_id?: number } =>
  l.material_id ? { material_id: l.material_id } : l.product_id ? { product_id: l.product_id } : {};

/** Same key / fetch as the purchasing item pickers, so the list is shared in the cache. */
export const ACTIVE_ITEMS_QUERY_KEY = ["materials", "active-all"] as const;

/**
 * Active Item Catalog items that can be made or used in production (expense items
 * are left out), plus a lookup by id.
 */
export function useMfgItems(enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ACTIVE_ITEMS_QUERY_KEY,
    queryFn: () => materialsApi.getAll(0, 100000, true),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  const items: Material[] = useMemo(() => (data || []).filter((m) => m.item_type !== "expense"), [data]);
  const itemById = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  return { items, itemById, isLoading };
}
