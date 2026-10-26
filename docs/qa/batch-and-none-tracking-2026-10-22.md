# Batch and none (quantity-only) tracking — product → PO → GRN → dashboard → ITN → approval → receive note → return — 2026-10-22

The earlier audits walked **serial** (barcode) stock only. This pass covers the other two tracking methods: **batch / lot** (batch no + expiry) and **none** (quantity only). Tool: built-in browser as `qa_admin` (Playwright MCP unavailable); UI for the product form, GRN, ITN wizard, approvals and receive wizard; API for the validation sweeps, races and returns. Data: branches `QA-D1` → `QA-D2`, products `QA-Lot Batch Item` (ITM000006, batch) and `QA-Lot None Item` (ITM000007, none), supplier `QA-Deep Supplier`, `PO-QA-D1-26000002` (10 × 50 + 20 × 30 = 1,100.00 ✔), GRN-02/03/04, `ITN-QA-D1-26000004`, IRN-339.

## Flow and result

| Step | Result |
|---|---|
| Product (UI) | Tracking select offers Serial / Batch / None; batch product created once on a double click; tolerance > 100 % refused. |
| GRN (UI + API) | Batch line needs a batch number (message + field error); none line needs nothing. Server: over-receipt (11 of 10, 1 of 0 left), negative, zero-only, 101-char batch, same line twice, serial barcodes on a batch item, foreign PO line, rejected > ordered, rejection without a reason → all refused. Partial receipts keep the remaining quantity right (10 → 9 → 3 open) and the PO stays `partially_completed`. Lots stored as one row per batch (`B-001 × 6`, expiry 2027-06-30; none lot `× 20`). |
| Dashboard | Quantities, value and ageing count lots correctly: none 20 → 600.00; batch 7 → 350.00; the unit list shows "Batch B-001 × 3", "Lot × 4". |
| ITN (UI) | Lot lines are added by product + quantity ("Only 7 unit(s) available at the source location" when over); one note on a double click; the pending note holds no stock. |
| ITN approval (UI) | Lots are allocated and split at approval, first-expiring first: 4 batch units = `B-EXP × 1` + `B-001 × 3` (line expanded into two), 8 none units split from the 20; stock `transfer_pending`, In Transit 12. Over-allocation (500 of 12) → clean 400 and the note stays pending; two notes of 8 competing for 12 approved in parallel → exactly one succeeds. |
| Receive note (UI) | Lines are received whole; the none line received 8 with damaged 2 → split into `6 available` + `2 damaged` at `QA-D2`; the batch line `B-001 × 3` marked damaged → whole lot `damaged`; partial → `partially_received` ("[Damaged on arrival: 5 unit(s)]"), the remaining line completed it (`received`); received lines are locked. |
| Purchase return of lots (API) | Quantity above what the lot holds, price above cost, a lot of another GRN, a damaged lot are refused; a valid 2-unit return splits the lot (`B-001`: 2 `return_pending`, 1 left). |

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | Purchase return (lots) | **A lot can be returned under another branch's return.** The none lot that sat at `QA-D2` was returned in a return whose `branch_code` is `QA-D1` (201) and again in one for `QA-D2` (201). The serial path checks the unit's branch; the lot path does not. | High |
| 2 | GRN / stock (expiry) | **An already expired batch is accepted** (`expiry_date` 2020-01-01 → 201), counted as sellable In Stock, picked **first** by FEFO for a transfer, and arrived at `QA-D2` as `available`. Nothing in the dashboard shows expiry (the unit list shows only the batch number). | Medium |
| 3 | ITN approvals page | The approver sees no quantity for lot lines: columns are Product / Barcode / Remark / Received, the lines show "-" and the footer says "Total Items: 2" for a transfer of 12 units. | Medium |
| 4 | Receive wizard | Lot lines carry no batch no / expiry / line identity: after the split the table shows two identical "QA-Lot Batch Item" rows (3 and 1) and the receiver cannot tell which is which (same gap as the missing barcode column for serial lines). | Medium |
| 5 | Dashboard (damaged lots) | Damaged units stay invisible: the destination batch product shows `damaged × 3` only in the unit list; the cards and Stock Summary omit it (same finding as for serial, confirmed for lots). | Medium |
| 6 | Receive note record | The receipt note is again overwritten by the next receipt ("[Damaged on arrival: 5 unit(s)]" → ""), and `recieved_user` is `null`. | Medium |
| 7 | ITN item API | A lot line of 500 units is accepted when 12 exist (201); it only fails at approval. | Low |
| 8 | ITN wizard | Adding 5 more of a lot already on the note says "Only 7 unit(s) available" although 3 are left (it ignores the note's own lines in the message). | Low |
| 9 | GRN wizard | The Received Qty box accepts -3; the batch line is then silently dropped and the rest is saved. The none line is pre-filled with the full open quantity (a full receipt is one click away). | Low |
| 10 | Receive page | Receipts list "ITN-1720" (numeric id) instead of the ITN number; the picker shows the raw status text "partially_received". | Low |

## Verified OK (no finding)
Product tracking selection; batch-number rule; every GRN quantity / duplicate / foreign-line / rejection rule above; PO progress across partial receipts; PO and GRN totals; lot value and quantity in the dashboard; ITN lot add / over-quantity message; single note on a double click; atomic, race-safe approval for lots and clean failures; lot split on approval and on damage; locked received lines; lot return quantity / price / GRN / status rules; branch scope of returns for serial remains correct.

## Not covered
GL / payables postings, print output, quotation-reserved lots (`reserved_for_quote_item_id`) and sale of lots, lot **transfer by specific lot id** from the UI, load and race bursts beyond the approval race, mobile layout, accessibility.

## Data left behind (all `QA-`)
Products ITM000006/7, PO-02, GRN-02/03/04, ITNs 1720–1724 (1720 received, 1722 approved, others pending), IRN-339, returns `PR-B1C52AEB`, `PR-7CF9DE88`, `PR-7FE97661` (pending, they hold 4 units), expired lot `B-EXP`. Nothing deleted.

## Suggested fix order
1 (branch check for lot returns), 3 + 4 (show quantity / batch / expiry for lot lines), 2 (refuse or flag expired receipts, show expiry), then 5–6 (damaged figure, receipt note + receiver), then the low items.

## Fix log (2026-10-22, "fix all": findings 1–10)

| # | Fix |
|---|---|
| 1 | `validate_lot_for_return(..., branch_code)`: a lot must sit at the return's branch ("This stock lot is at branch X, not Y"); the create path and the validate-lot endpoint pass the branch; the return page sends it. |
| 2 | GRN receive refuses an expired batch with accepted quantity > 0 (record it as rejected instead); the GRN wizard sets `min` on the expiry box, flags "Already expired" and keeps the line not-ready. The dashboard unit list has an **Expiry** column (expired dates in red). FEFO still orders by expiry; nothing expired can enter stock any more. |
| 3 | ITN Approvals lines show **Barcode / Lot**, **Qty**; footer is "Total Units" (sum of quantities). |
| 4 | `ItemTransferNoteItem` carries `batch_no` / `expiry_date` of the allocated lot; the receive wizard and the receipt detail show a **Barcode / Lot** column ("Batch B-001 (exp …)"), so split lines are distinguishable. |
| 5 | Dashboard summary has `damaged` and a **Damaged** card; Stock Summary rows have `damaged_quantity` and a **Damaged** column (outside on-hand and value). |
| 6 | Receiving appends to the receipt note (`first | second`) instead of overwriting; the receiver is the signed-in user (set server-side, not a client claim). |
| 7 | `_check_lot_quantity`: a lot line cannot exceed what the source location holds, counting the note's other lines of the product ("Only N unit(s) left at the source location for this product."). |
| 8 | ITN wizard message: "Only N more unit(s) available (M already on this note)." |
| 9 | GRN lot Received Qty is clamped to 0…open quantity. (Pre-filling the full open quantity is kept: a full receipt is the common case.) |
| 10 | Receipts show the transfer note's number (`item_transfer_note_no`) instead of "ITN-<id>"; the status chip map knows dispatched / in transit / partially received / received. |

Tests: `backend/tests/test_lot_tracking_2026_10_22.py` (11). `tsc --noEmit` clean.
