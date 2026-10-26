# Warehouse dashboard accuracy audit (quotation → PO → GRN → sale → return / transfer) — 2026-10-22

Scope: `/warehouse` (SalesStockDashboard): KPI cards (In Stock / Reserved / Sold Today / Returned Items), Unit List and the new Stock Summary tab. Checked after every step of one end-to-end chain on branch `QA-PR1` (product `QA-Laptop PO Chain`, supplier `QA-Supplier Alpha`), comparing the dashboard API (`/inventory/sales-stock/paginated` summary and `/stock-summary`) with the raw unit rows (`/inventory/sales-stock`), and the UI cards with the API.
Method: built-in browser as `qa_admin` (Playwright MCP profile was locked by another session); setup and state changes through the API, GRN through the UI.

## Flow checked (dashboard vs raw units)

| Step | Dashboard result | OK? |
|---|---|---|
| GRN of 6 serial units, 1 purchase return pending | In Stock 5, Returned 1; summary total 5 / value 400 | OK |
| Quotation (10) created, then approved | no change (nothing reserved by a quotation) | OK (by design) |
| PO for the 5-unit shortfall created and approved | no change (no "incoming/on order" figure anywhere) | OK / see #7 |
| GRN of those 5 units (PO linked to quotation) | 5 units auto-reserved for the quote line; In Stock 5, Reserved 5; summary total 10, allocated 5, available 5, value 800 | OK |
| UI cards and Stock Summary tab for the branch | identical to API (5 / 5 / 0 / 1, 11 units, summary row 10/5/5) | OK |
| Purchase return approved | unit pending → returned_to_supplier; Returned stays 1; excluded from summary | OK |
| Item transfer: pending / approved / dispatched / received | pending: no change; approved: units leave source In Stock (transfer_pending); dispatched: in_transit; received: destination branch In Stock +2, value 160, source 8 | OK (see #6) |
| Freeze / unfreeze a unit | In Stock −1/+1, summary "Freezed" 1/0 | OK (no Frozen card) |
| Quotation → partial SO | see #1, #2, #3 | **Issue** |
| SO approved, then full return processed | units back to available, Issued 0 | OK (see #4) |

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | Sold / Reserved accuracy | Sales orders created **from a quotation** (`POST /sales/quotes/{id}/partial-so`, and `convert`) mark the units **`sold` immediately while the order is still `pending_approval`** (`quotation_service.py:1143`, `:1503`). The normal order path reserves them until approval/completion (`sales/service.py:1419-1425`). Result: Sold Today and Issued jump before anything is approved, the Reserved card never shows quotation-sourced orders, and the unit-level status disagrees with the order. | High |
| 2 | Sold Today KPI | "Sold Today" counts every invoice created today that has stock lines, **including cancelled and returned ones** (`inventory/service.py get_summary`, no status filter). After cancelling the 5-unit SO and fully returning a 2-unit SO, the card still read 7 with 0 units actually sold. | High |
| 3 | SO cancel → quotation | Cancelling the SO leaves the quotation `completed` (line `so_created`, converted 10): a new SO is refused ("quotation is in terminal status: completed"). The 5 units also keep a stale `reserved_for_quote_item_id` while `available`. The PO cancel/reject path was fixed on 2026-10-09; the SO cancel path was not. | High |
| 4 | Returned Items card | Card says "Restocked from returns" but counts only `returned_to_supplier` + `return_pending` (purchase returns). A customer return that restocks units does not move it (stayed 1 after a processed sale return). | Medium |
| 5 | Stale dashboard | The dashboard uses a 5-minute query cache (`main.tsx`) and only the GRN, ITN, Receive Notes and Company Assets pages invalidate `["salesStock"]`. Sales orders, approvals, cancels, returns, purchase returns and the PO flow do not, and nothing invalidates `["salesStockSummary"]` (the Stock Summary tab) because the key differs. Reproduced: froze a unit, navigated GRN → Dashboard in the app: card still 4,481, API 4,480. | High |
| 6 | Visibility of stock in transit | Units in `transfer_pending` / `in_transit` / `return_pending` vanish from every card and from Stock Summary "Total Qty" (8 instead of 10 while 2 are moving); the destination branch shows nothing until receipt. No "In Transit" figure. | Medium |
| 7 | No incoming figure | A PO / quotation shortfall has no representation on the dashboard (no on-order or incoming quantity). | Low |
| 8 | Valuation | Stock Summary "Value" = current `product.cost_price` × on-hand. Changing the product cost 80 → 90 changed the value of existing stock 640 → 720 though it was received at 80 (reverted after the test). | Medium |
| 9 | Numbering | Orders created through partial-SO are numbered `INV-QA-PR1-2026-00001`, a different format from normal orders (`INV-<branch>-<yy>NNNNNN`). | Low |
| 10 | Sale return reason | `return-full` with `reason: "QA return audit"` ended up with `return_reason: customer_changed_mind` (field ignored). | Low |

## Notes
- `qa_admin` could approve its own quotation, PO and purchase return (superuser, no maker≠checker) — already reported earlier.
- Stale-backend note from the previous run does not affect these results (dashboard code was current).

## Phases / optional checks
- Phases run: smoke of the dashboard (cards, Unit List, Stock Summary, branch filter) and the data-flow audit above. Not run: field validation, security/AuthZ (the stock-summary `branch` scoping and `cost_price` masking were not tested), duplicates & races, load.
- Optional: #1 workflow & status transitions **run** (quotation → PO → GRN → SO → cancel/return); #3 stock integrity **run** (every step compared with raw units); #8 data lifecycle **partly** (SO cancel / quotation); #7 pagination/filter **skipped**; #4 calculations **partly** (value, ageing); the others **skipped**.

## Data left behind (all `QA-`)
Quotations `QT-QA-PR1-26000001/2`, POs `PO-QA-PR1-26000001..3`, GRNs `GRN-QA-PR1-26000001..2` (11 units `QA-SN-001..006`, `101..105`), ITN `ITN-QA-PR1-26000001` (2 units now in branch `QA-B2`), cancelled SO `INV-QA-PR1-2026-00001`, returned SO `INV-QA-PR1-2026-00002` with return `SRN-QA-PR1-26000001`, purchase returns 228–235 (228 approved, 229–235 junk without items from the earlier run). Product cost restored to 80; unit `QA-SN-004` restored to available. Nothing deleted.

## Suggested fix order
1. Make quotation-sourced orders follow the normal rule (reserve while pending, sold on approval/completion).
2. Count Sold Today from completed, non-cancelled invoices (net of returns), and fix the Returned label or its definition.
3. On SO cancel/reject release the quotation line (as already done for PO cancel) and clear `reserved_for_quote_item_id`.
4. Invalidate `["salesStock"]` and `["salesStockSummary"]` from sales, approval, return and PO mutations, or lower the dashboard `staleTime`.
5. Add an In Transit figure and value stock at the received cost.

## Fix log (2026-10-22)
Findings 1, 2, 3 and 5 fixed; tests in `backend/tests/test_warehouse_dashboard_2026_10_22.py` (7 tests). Findings 4, 6–10 are open.

- **#1** `quotation_service.create_partial_so`: units are `reserved` (not `sold`) while the order is pending approval, and the quote-item link is cleared so a held unit cannot be picked up by another order of the same quotation; approving the order turns them into sold (existing approve path).
- **#2** `SalesStockService.get_summary`: Sold Today counts only units on today's invoices that are still `sold` and whose invoice is not cancelled, so pending orders, cancelled orders and processed returns drop out.
- **#3** `SalesService._release_source_quote_items` (called from cancel, reject and delete of an order): gives the order's quantities back to the quotation lines (`so_created` → `pending`, or `procurement` when part of the line is on a PO), clears the converted-invoice link, and `recompute_quote_status` now also reopens a `completed` quotation (→ approved / partially processed). Released units lose any stale `reserved_for_quote_item_id`.
- **#5** `frontend/src/lib/queryClient.ts` (QueryClient moved out of `main.tsx`) + a success interceptor in `api/client.ts`: any non-GET call to `/sales`, `/purchasing/{returns,grn,orders}`, `/warehouse`, `/inventory` or `/common/approvals` invalidates every `salesStock*` and `stock-tracking` query (this also covers the Stock Summary tab, whose key was never invalidated). Checked live: card 4,481 (stale) → 4,480 after invalidation → 4,481 after restoring the unit.

Verification: new tests 7/7; `tsc --noEmit` clean; full backend suite 1656 passed, 21 failed. The 21 failures are not in code touched here: 17 in `test_money_audit_cross_module` (global ledger comparisons; account 1110 already carries 335,667 and the GL cash net shows 2E+30 in the shared dev DB), 2 in `test_accounting_gl_reliability`, 1 each in `test_reporting_accuracy` and `test_supplier_validation::test_search_is_literal` (finds leftover QA suppliers). They depend on leftover dev-DB rows, not on the code; I did not run a clean-DB baseline. The backend on :8020 needs a restart to pick up the fixes.

## Fix log — medium findings (2026-10-22)
Findings 4, 6 and 8 fixed; tests added to `backend/tests/test_warehouse_dashboard_2026_10_22.py` (now 11, all pass). Open: 7, 9, 10.

- **#4** The card is now "Returned to Supplier" ("Sent back or awaiting return"): it always counted purchase returns, so the label was wrong, not the number. (Customer returns that restock simply become available stock again, so there is nothing separate to count.)
- **#6** New `in_transit` KPI (transfer_pending + in_transit units) with an "In Transit" card, and an "In Transit" column in the Stock Summary. These units still stay out of On Hand quantity and value; a product that only has units in transit is now listed. Cards use equal-width columns so five fit.
- **#8** Stock Summary value is now the sum of each on-hand unit's purchase-order cost (product cost only when a unit has no PO line); "Unit Cost" is the average of those. Live check: product cost 80 → 90 left the value at 640.00 (it used to become 720).
- Live check of transit on branch `QA-PR1`: approve → In Transit 2 / In Stock 6; dispatch → still 2; receive → 0 (units back in `QA-B2`); product cost restored to 80.
- `tsc --noEmit` clean; the 3 failures in a `-k stock/inventory/summary/transfer` run are the same dev-DB ledger tests as before.
