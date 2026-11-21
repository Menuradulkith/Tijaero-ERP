# One central warehouse stock — proposal (2026-11-20)

Goal: one place that holds **all** stock (bought Item Catalog items and the goods we sell), purchasing buys **Item Catalog items only**, and the Warehouse module is simpler to use than today's Dashboard + Stocks pair.

## 1. What we have today (research summary)

| Topic | Today |
|---|---|
| Stock table | `sales_stock` — one row per serial unit, or one row per lot with `quantity` (batch / none tracking). Statuses: available, reserved, sold, in_transit, damaged, frozen, consumed, returned… Locations, transfers (ITN), reservations for quotes, FEFO lot picking all already work on it. |
| Keyed to | `product_id` only (NOT NULL). Item Catalog items cannot be stocked at all. |
| Cost | No cost on the row. Cost is re-derived every time from the PO line price, falling back to `products.cost_price`; manufactured stock always falls back to cost_price; landed cost is ignored in valuation. |
| History | **No stock ledger.** Movement reports are rebuilt from documents (GRN, sales, returns, ITN). There is no stock count / adjustment document. |
| Purchasing | PO lines, purchase returns, supplier links and supplier invoices all point at `products`. GRN creates `sales_stock` rows from PO lines. |
| Manufacturing | BOMs, production orders and issues all point at `products`; consumes `sales_stock` lots. |
| Known bugs | PO "available stock" and the procurement queue **count rows** instead of summing quantity (under-counts lots). No composite index on (item, branch, status) though almost every allocation query filters on it. |
| Warehouse UI | "Dashboard" = KPI cards + unit/lot grid; "Stocks" = per-product summary. Two pages on the same data with overlapping filters. |

## 2. Recommended model: Item = inventory part, Product = sales part

This is the standard ERP split (IFS: *Inventory Part* + *Sales Part*; SAP: material + sales view; Odoo: product + product template):

```
Item Catalog item (materials)   ← what is stocked, bought, received, transferred, produced, issued
   ▲ 1                                one central stock, keyed by item
   │
   │ 0..n
Product (sales part)            ← what is sold: product type, family, HS code, market, selling price,
                                   website… Each stocked product points at the item it sells.
```

- **Stock is keyed by item only.** Selling a product takes stock of its linked item. Buying, receiving, transfers, production all move items.
- A trading good (bought and resold) = one item (bought from suppliers) + one product (sold to customers) linked to it.
- A manufactured good = a finished item (with a BOM of component items) + a product linked to it.
- A service / non-stock product simply has no linked item.
- Products and items stay separate catalogs with separate categories (as today); the link is just `products.item_id`.

Why not "stock rows can be a product OR an item": it doubles every allocation, report, transfer and costing path (two keys everywhere), and the same physical box could exist twice. One key is simpler and is what every mainstream ERP does.

## 3. Central stock design

| Piece | Change |
|---|---|
| `warehouse_stock` (today's `sales_stock`, renamed in the app as **Warehouse Stock**) | add `material_id` (the item) as the stock key; keep the row shape (serial unit / lot + qty, batch, expiry, branch, location, status). `product_id` stays only for old rows during migration, then is dropped. |
| `unit_cost` on each stock row | captured at receipt (PO price + landed cost share) or production (standard cost). Valuation, COGS and stock GL read it directly — no more re-deriving. Enables the item's **Inventory Valuation Method** (FIFO / Weighted Average) and **Stock Issuing Method** (FIFO / FEFO) that the Item Catalog already stores. |
| `stock_transactions` (new, append-only ledger) | one row per movement: receipt, issue to production, production output, sale, sale return, purchase return, transfer out / in, damage, adjustment, count. Columns: item, qty (+/−), unit cost, branch, location, lot/serial, stock row id, source document (type + id), user, time. Gives real movement history, audit, stock-card report and future stock counts. |
| Indexes | composite (material_id, branch_code, status) and (material_id, location_id); index on good_received_note_id. |
| Bug fixes on the way | PO available-stock and procurement queue sum quantity instead of counting rows. |

## 4. Warehouse pages (simpler, one central place)

| Page | Purpose |
|---|---|
| **Dashboard** | KPIs + alerts only (stock value, items below reorder level, expiring in 30 days, in transit, damaged, frozen/QC hold) — every tile links into Stock with the filter applied. No grids. |
| **Stock** (the central page, replaces today's Dashboard grid + Stocks page) | One grid of **items on hand by branch / location** (on hand, reserved, available, in transit, damaged, value, ageing). Expand a row → its lots / serials (batch, expiry, barcode, status, cost). Click an item → item stock card with its movement history. Filters: branch, location, category, brand, status, search; export. |
| **Stock Movements** (new) | The ledger: every receipt / issue / sale / transfer / adjustment, filterable by item, branch, document, date. |
| Transfer Notes, Approvals, Receive Notes, Company Assets | unchanged (they move warehouse stock). |

## 5. Purchasing on Item Catalog

PO lines, GRN lines, purchase returns, supplier invoices, landed cost, supplier price lists and the procurement queue all switch to **items** (`material_id`). Supplier cost on the item's Suppliers tab is the mandatory price source. Old POs / GRNs keep their product reference for history; new documents use items only. A quotation line that needs buying asks for the product's linked item.

## 6. Phases (each ends tested and working)

1. **Stock foundation** — `material_id` + `unit_cost` on stock rows, `stock_transactions` ledger written by every existing stock movement, indexes, count→sum bug fix. Warehouse **Dashboard (KPIs) + Stock + Stock Movements** pages. Products keep working unchanged.
2. **Product → item link** — `products.item_id`; data migration creates an item for every stocked product (same name/code/category mapped) and points its stock rows at it; sales, quotations, reservations and returns allocate stock via the product's item.
3. **Purchasing on items** — PO, GRN, returns, supplier invoices, landed cost, supplier links, procurement queue, MRP purchase suggestions.
4. **Manufacturing on items** — BOM components, issues, outputs and by-products as items; finished goods = items linked to products.
5. **Costing & counts** — FIFO / weighted-average issue costing from `unit_cost` per item setting; stock count / adjustment document posting to the ledger and GL.

Effort: large (phases 1–3 touch purchasing, sales, warehouse, finance GL and reports). Each phase ships with tests and is usable on its own; nothing is removed before its replacement works.

## 7. Decisions needed
1. Accept the **item = stocked part, product = sales part linked to an item** model?
2. Accept the Warehouse page set: **Dashboard (KPIs only) + Stock + Stock Movements**?
3. Start with **Phase 1**?
