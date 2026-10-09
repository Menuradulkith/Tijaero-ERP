# Quotation → Purchase Order flow QA — 2026-10-09

Scope: the three ways a quotation turns into a PO — (1) Quotation page → supplier dialog → **Procurement Queue** (`POST/GET/DELETE /purchasing/procurement-queue`) → **batch PO** (`POST /purchasing/orders/batch`, UI "Review & Create PO"); (2) the **legacy** `POST /sales/quotes/{id}/create-po` (exposed in the API and `quotation-api.ts`, not used by any page); (3) PO approval/cancel effects on the quotation.
Method: API audit script (two runs; admin plus a branch-limited Purchasing Manager, 7 quotes in 4 states, 3 suppliers, parallel bursts) + Procurement Queue page in the built-in browser (a queued item → "Review & Create PO" created a PO). Everything created was removed with a guarded DB script (4 QA branches, 14 quotes, 17 POs, 6 suppliers, 2 customers, 2 users).

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | **Legacy create-po: approval bypass** | `POST /sales/quotes/{id}/create-po` works on **pending-approval and rejected quotes (200)**, with an **inactive supplier (200)** and a bogus `payment_method` ("bitcoin", 200). It creates POs with status `pending` and **no approval row**, so they never reach PO Approvals; numbers come from a separate `PO-2026-0000x` sequence. | **Critical** |
| 2 | Legacy create-po: duplicates | Calling it twice, and 5 times in parallel, on one quote gave **9 POs for the same quote** (items are marked `procurement`, which the "already procured" check does not skip). PO lines are priced at the quote's **selling price**, not a cost price. | High |
| 3 | Queue: quote state | Items of **pending-approval, rejected and cancelled quotations can be queued** (201); only the batch PO step refuses them (400). | High |
| 4 | Queue: branch scope | A branch-limited user can queue items of **another branch's quotation (201)**, the POST response returns the **whole unscoped queue** (other branches' rows leak), and `DELETE /procurement-queue/{id}` removes **another branch's queue entry (204)**. (The branch check exists only on the batch PO and legacy routes: both 403.) | High |
| 5 | Queue: 500s | `supplier_id` = 2^40, `quote_item_id` = 2^40, `DELETE …/{2^40}`, and `unit_price` = `NaN` all return **500**. | High |
| 6 | Queue: validation | `unit_price` 0 and 1e30 accepted; a list of 1000 items accepted; the same item twice in one request accepted; price unrelated to cost or selling price accepted. | Medium |
| 7 | Batch PO: partial quantities | After a PO for **2 of 5** units the item is flagged `po_created` (converted 2), so the **remaining 3 units can never be ordered** (400 "already has a purchase order"); the quote stays `partially_processed`. | High |
| 8 | Batch PO: cancel does not release | After the PO is **cancelled**, the quote item stays `po_created` / converted 2, so it cannot be procured again (re-order → 400) and the quote stays stuck. | High |
| 9 | Batch PO: branch | A group whose `branch_code` differs from the quotation's branch is accepted (**PO created in branch B for a branch-A quote**). | Medium |
| 10 | Batch PO: price | A PO unit price far above the quote's selling price (5000 vs 300) is accepted (buying at a loss, no warning). | Low |
| 11 | UX | The Procurement Queue button reads "Review & Create PO" but creates the PO immediately (no review step; date and terms are pre-filled). | Low |

## Verified OK
- Batch PO refuses pending / rejected / cancelled quotes (400), over-quantity (400), inactive supplier (400), an item from another quote (400), the same item twice in a group (400), two groups over-ordering one item (400), cross-branch users (403); the product-not-on-quote case returns 409.
- Batch PO: 6 parallel POs for the same quantity → exactly one PO, 5 refused; queue entry removed after PO creation; quote moves to `partially_processed`; PO is created `pending_approval` with an approval row and approving it works.
- Queue: 8 parallel adds for one item → one row; qty 0 / negative / float → 422; supplier 0 / missing → 404; inactive supplier → 400; over the remaining quantity → 400.
- Procurement Queue page loads and shows required / available / ordered / to-purchase per quote and supplier; the UI create-PO path works for an approved quote.

Not covered: PO → GRN → stock reservation back to the quotation, release of reservations, ITN creation, UI supplier-selection dialog on the Quotations page, emails.

## Suggested fix order
1. Remove or lock down the legacy `create-po` (it is unused by the UI): if kept, require an approved quote, reuse the batch PO service (approval row, numbering, supplier/payment validation, branch check, no double use).
2. Queue: require an approved, non-terminal quote, scope POST/DELETE/response by branch, bound ids / price / list length, reject NaN.
3. Partial quantities: keep the item open until `converted_qty` reaches `quantity`; on PO cancel/reject return the quantity to the quote item and recompute the quote status.
4. Batch PO: group branch must equal the quote's branch; optionally warn when the cost exceeds the selling price.

## Fix log (2026-10-09)
Verified by `backend/tests/test_quote_to_po.py` (26 tests), the full suite (1031 passed; the 2 failing tests are the known supplier-advance cashbook ones) and a re-run of the audit script (all findings gone; QA data removed again).

- **#1/#2 legacy create-po:** removed (endpoint, service method, schemas and the unused frontend client). POs now come only from the batch endpoint with its approval row, numbering, supplier/payment validation and branch checks.
- **#3 queue state:** only quotations that are approved and not rejected / cancelled / revised / expired / completed can be queued (400).
- **#4 queue branch scope:** POST and DELETE refuse other branches' quotations / entries (403); the POST response is limited to the caller's branches.
- **#5/#6 queue validation:** ids int4 (422 instead of 500), quantity 1–1,000,000, unit price > 0 and bounded, NaN rejected, at most 200 items, duplicate items in one request rejected, unit price above the quotation selling price rejected (400). The 422 error body no longer echoes the submitted `input`, which also removed the 500 that a `NaN` caused in the error handler for every endpoint (and stops echoing submitted passwords).
- **#7 partial quantities:** a partial PO leaves the item "procurement" (open); it becomes "po_created" only when the full quantity is ordered. The same quotation line repeated in one PO is checked as a sum.
- **#8 cancel / reject:** cancelling or rejecting a PO returns its quantities to the quotation items and recomputes the status (back to "approved" when nothing is in progress).
- **#9 batch branch:** a PO group's branch must equal the quotation's branch (400).
- **#10 price:** a PO line above the quotation's selling price is refused (400); this is a business rule you may want to relax for known loss-making purchases.
- **#11 UX:** the button now says "Create PO" (it creates immediately).
