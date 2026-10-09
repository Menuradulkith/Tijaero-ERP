/**
 * Minimum order quantity (MOQ) check for purchase orders.
 *
 * A supplier's MOQ for a product lives on the Supplier -> Products mapping
 * (SupplierProduct.minimum_order_qty). Ordering below it is allowed, but the
 * user is warned so they can confirm or fix the quantity first.
 */
import { suppliersApi } from "@/modules/purchasing/api";
import type { SupplierProduct } from "@/modules/purchasing/types";

export interface MoqShortfall {
  productId: number;
  productName: string;
  quantity: number;
  moq: number;
}

/** Lines ordered below the supplier's MOQ. Products with no mapping or no MOQ are ignored. */
export async function findMoqShortfalls(
  supplierId: number,
  items: { product_id: number; quantity: number }[],
  loadSupplierProducts: (supplierId: number) => Promise<SupplierProduct[]> = suppliersApi.getProducts,
): Promise<MoqShortfall[]> {
  if (!supplierId || items.length === 0) return [];
  const mappings = await loadSupplierProducts(supplierId);
  const byProduct = new Map(mappings.map((m) => [m.product_id, m]));

  // The same product can appear on several lines; the MOQ applies to the total.
  const totals = new Map<number, number>();
  for (const item of items) {
    totals.set(item.product_id, (totals.get(item.product_id) ?? 0) + Number(item.quantity || 0));
  }

  const shortfalls: MoqShortfall[] = [];
  for (const [productId, quantity] of totals) {
    const mapping = byProduct.get(productId);
    const moq = mapping?.minimum_order_qty;
    if (mapping && moq != null && moq > 0 && quantity < moq) {
      shortfalls.push({
        productId,
        productName: mapping.product_name || mapping.product_item_code || `Product #${productId}`,
        quantity,
        moq,
      });
    }
  }
  return shortfalls;
}

/** Dialog text for one supplier's shortfalls. */
export function formatMoqMessage(supplierName: string, shortfalls: MoqShortfall[]): string {
  const lines = shortfalls.map((s) => `• ${s.productName}: ordering ${s.quantity}, MOQ is ${s.moq}`);
  return `Supplier: ${supplierName}\n\nThese items are below the supplier's minimum order quantity (MOQ):\n${lines.join("\n")}`;
}
