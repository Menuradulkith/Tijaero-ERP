/**
 * Minimum order quantity (MOQ) check for purchase orders.
 *
 * A supplier's MOQ for an item lives on the supplier's item price list
 * (Supplier -> Items, the same link as the Item Catalog's Suppliers tab).
 * Ordering below it is allowed, but the user is warned so they can confirm
 * or fix the quantity first.
 */
import { supplierItemsApi } from "@/modules/purchasing/api";
import type { SupplierItem } from "@/modules/purchasing/types";

export interface MoqShortfall {
  materialId: number;
  itemName: string;
  quantity: number;
  moq: number;
}

/** Lines ordered below the supplier's MOQ. Items with no link or no MOQ (and old
 * lines without an item) are ignored. */
export async function findMoqShortfalls(
  supplierId: number,
  items: { material_id?: number | null; quantity: number }[],
  loadSupplierItems: (supplierId: number) => Promise<SupplierItem[]> = supplierItemsApi.list,
): Promise<MoqShortfall[]> {
  const withItem = items.filter((i) => !!i.material_id);
  if (!supplierId || withItem.length === 0) return [];
  const links = await loadSupplierItems(supplierId);
  const byItem = new Map(links.map((m) => [m.material_id, m]));

  // The same item can appear on several lines; the MOQ applies to the total.
  const totals = new Map<number, number>();
  for (const item of withItem) {
    const id = item.material_id as number;
    totals.set(id, (totals.get(id) ?? 0) + Number(item.quantity || 0));
  }

  const shortfalls: MoqShortfall[] = [];
  for (const [materialId, quantity] of totals) {
    const link = byItem.get(materialId);
    const moq = Number(link?.minimum_order_qty ?? 0);
    if (link && moq > 0 && quantity < moq) {
      shortfalls.push({
        materialId,
        itemName:
          [link.material_item_code, link.material_name].filter(Boolean).join(" - ") || `Item #${materialId}`,
        quantity,
        moq,
      });
    }
  }
  return shortfalls;
}

/** Dialog text for one supplier's shortfalls. */
export function formatMoqMessage(supplierName: string, shortfalls: MoqShortfall[]): string {
  const lines = shortfalls.map((s) => `• ${s.itemName}: ordering ${s.quantity}, MOQ is ${s.moq}`);
  return `Supplier: ${supplierName}\n\nThese items are below the supplier's minimum order quantity (MOQ):\n${lines.join("\n")}`;
}
