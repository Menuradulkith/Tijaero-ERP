/**
 * Display helpers for purchasing lines. Purchasing buys Item Catalog items
 * (material_id + item code/name/UOM); documents created before that only carry
 * a product, so every helper falls back to the product name.
 * The linked name component is components/LineItemLink.tsx.
 */

export interface LineItemLike {
  material_id?: number | null;
  material_item_code?: string | null;
  material_name?: string | null;
  unit_of_measure?: string | null;
  product_id?: number | null;
  product_name?: string | null;
}

/** Item Catalog page opened on one item. */
export const itemCatalogUrl = (materialId: number) => `/materials/item-catalog?focus=${materialId}`;

export const lineItemCode = (l: LineItemLike): string => l.material_item_code || "";

export const lineItemName = (l: LineItemLike): string =>
  l.material_name || l.product_name || (l.material_id ? `Item #${l.material_id}` : l.product_id ? `Product #${l.product_id}` : "-");

/** "CODE - Name", or just the name when there is no code (old product lines). */
export const lineItemLabel = (l: LineItemLike): string => {
  const code = lineItemCode(l);
  const name = lineItemName(l);
  return code ? `${code} - ${name}` : name;
};

export const lineItemUom = (l: LineItemLike): string => l.unit_of_measure || "-";
