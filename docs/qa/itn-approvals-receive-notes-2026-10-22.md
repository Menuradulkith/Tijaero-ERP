# Item Transfer Notes, ITN Approvals, Receive Notes — QA audit — 2026-10-22

Tool: Playwright MCP (real Chrome) as `qa_admin` (superuser), 1440×900. Data: branch `QA-PR2` (product `QA2-Router`, units `QA2-SN-001…006`, `101…104`) transferring to location "QA Main Warehouse" (branch `QA-PR1`). Every claim below was observed on screen or in the network log and then confirmed through the API / stock rows.

## Findings (most severe first)

| # | Page | Finding | Severity |
|---|---|---|---|
| 1 | ITN approvals (stock) | **Rejecting a pending note releases units that another approved note is holding.** Duplicate notes 1447 / 1448 held `QA2-SN-004/005`; 1448 was approved (units `transfer_pending`); rejecting 1447 set both units back to `available` while 1448 stayed approved. The units can then be sold or moved by someone else, and the approved note no longer owns them. Cause: `reject_transfer_note` resets every `transfer_pending/in_transit` unit on the note, but a *pending* note never holds units (they are only taken on approval). | High |
| 2 | ITN page (edit) | **Save in edit mode creates new transfer notes instead of updating.** Opening a pending note → Edit → change the remark → Save sent `POST /warehouse/transfer-notes` (twice) plus 12 item POSTs; the remark of the original stayed unchanged, and two new notes with copies of its 6 items appeared. `handleSave` always calls `createMutation` (no update call exists). | High |
| 3 | ITN page (create) | **Double-click on Save creates two notes with the same items.** `ITN-QA-PR2-26000001` and `…002`, both holding `QA2-SN-004/005`; both toasts "created with 2 items". No in-flight guard (the 4 item POSTs hit two notes). | High |
| 4 | ITN items API | `POST /warehouse/transfer-note-items` validates nothing: the same barcode twice on one note, a unit from another branch, an unknown barcode (`NOPE-1`), a returned-to-supplier unit, a barcode with the wrong product, and **items added to approved, received and rejected notes** were all accepted (201). The page validates scans, the API does not. | High |
| 5 | ITN header API | `POST /warehouse/transfer-notes` accepts: from = to location, a from-location that belongs to another branch, a transfer date in 2020 and in 2030, a 100,000-character remark, and a note with no items (all 201). | Medium |
| 6 | Receive Notes (damage) | **Damaged quantity and notes are dropped.** The wizard accepts damaged 3 for received 1 and the review shows "Received 1 / Damaged 3", but the request is `{barcodes:[…], item_ids:[], received_note:""}`: nothing about damage or per-line notes reaches the server. | High |
| 7 | ITN + ITN Approvals lists | With the default "All Branches" filter the list is empty ("No transfer notes found" / `0–0 of 0`) although 10 notes exist; they only appear after a branch is picked (`if (!filterBranch) return []`). Receive Notes, by contrast, lists everything without a branch. A superuser sees an empty, misleading screen. | Medium |
| 8 | Approvals dialog | A wrong approver password gives **no message**: the dialog just stays open (no toast, no field error). | Medium |
| 9 | Approvals dialog | Double-click on Approve / Reject sends the request twice; the second returns "Cannot approve/reject. Current status: …" and an extra error toast "Failed to approve/reject transfer note" appears next to the success toast. The Reject login dialog also reads "confirm this approval" and its button says "Approve". | Low |
| 10 | Receive Notes | Receiving works on units that are merely `available` (a consequence of #1); the page does not insist the unit is `transfer_pending`. The wizard for a partially received note lists the already received line with received = 1 pre-filled. | Medium |
| 11 | Receive Notes | No success toast after "Receive Items" (both times); double-click sends the POST twice (second is harmless). Receive-note rows show `Transfer: ITN-1448` (the numeric id) instead of the ITN number; a note received in part is labelled "Pending" (status 2) and "Approved" once complete. | Low |
| 12 | ITN create wizard | Entering step 2 immediately fires the error toast "At least one item is required to save…"; "Next" on step 1 says "…before saving". From-Location lists all 27 locations of all branches (not the selected branch); a returned unit scans as "Barcode not found in inventory". | Low |
| 13 | ITN page | No UI path calls `dispatch`: approved notes go straight to receive, so `in_transit` is only reachable via the API; an approved note's lines still show "Pending". CSV export has a stray "view" column. | Low |

## Verified OK
- Create wizard: step 1 has no Save (Cancel / Next only), Save appears on step 2; branch / locations / date required; the "To" list excludes the chosen "From"; scans reject unknown barcode, a unit in another location, a duplicate scan.
- Approval: step-up login required; approving a note whose unit is already held by another note → clean 400 ("no longer available… committed to another transfer") and the note stays pending; a note with an invalid unit (returned to supplier) → clean 400 and nothing changes; reject needs a reason (button disabled until typed); Pending filter hides approved/rejected notes.
- Receive: over-receipt is clamped to the expected quantity, negative clamps to 0, "at least one item" is enforced, a partial receive moves only that unit (location and branch change to the destination) and sets the note to `partially_received`, the rest completes it to `received`; no duplicate receive note is created by the double click; stock rows and the warehouse dashboard agree with the notes.
- No console errors on the three pages (one error appeared while the edit-mode duplicate was being created).

## Not covered
Destination-branch users and the permission matrix for these pages, print / PDF content, races beyond double clicks, mobile layout, accessibility, the Delete action (the page passes `canDelete` but renders no delete control), receive-note approval (`received_approval_status`) screens.

## Data left behind (all `QA-`)
ITN `ITN-QA-PR2-26000001…011` (ids 1447–1457: 1447 rejected, 1448 received, the rest pending/duplicates), receive note IRN-286, units `QA2-SN-004/005` now in branch `QA-PR1`. Nothing deleted.

## Suggested fix order
1 (do not touch stock when rejecting a pending note), 2 (real update path for edit), 3 + 9 (in-flight guards), 4 + 5 (server validation of items and header), 6 (send or drop damage fields), then 7, 8 and the rest.

## Fix log (2026-10-22)
Findings 1, 2, 3, 4 and 6 fixed; 5 and 7–13 are open. Tests: `backend/tests/test_warehouse_itn_2026_10_22.py` (24).

- **#1** `reject_transfer_note` no longer touches stock: only a pending note can be rejected, and a pending note holds no units (they are taken on approval). A legacy duplicate that lists the same barcode as an approved note can be rejected without freeing that note's units.
- **#2** `ItemTransferNotesPage`: Save in edit mode now updates the note (`PUT`), deletes removed lines and adds new ones. Live: edit + double-click Save = one `PUT /transfer-notes/{id}`, remark changed, no new note.
- **#3** Save is guarded by a ref (like the Receive page): a double click sends one create. Live: one `POST` for the note, two for the items, one toast. The same guard sits on "Receive Items".
- **#4** `ItemTransferNoteItemService` validates every line for every caller: the note must exist and be **pending** (also for update / delete), the line's branch must be the note's, and a barcode must exist, belong to the line's product, be `available`/active, sit at the note's branch and source location, and not already be on another open (pending / approved / dispatched / in transit / part received) note or twice on one note. Rejected / cancelled / received notes release their units. Live: duplicate, unknown, returned-to-supplier, wrong-product and approved/received-note cases all return 400 with a clear message.
- **#6** `ReceiveItemsRequest.lines[]` (`barcode` or `item_id`, `damaged_quantity`, `note`): damaged serial units arrive at the destination as `damaged` (not sellable), damaged part of a lot is split off as `damaged`, line notes are stored on the transfer line, the receive note gets "[Damaged on arrival: N unit(s)]"; damage above the received quantity, or for a line that is not being received, is a 400 and nothing is received. The page clamps damaged ≤ received (and 0 when nothing is received) and sends the lines. Live: damaged 3 on one received unit → clamped to 1 → unit `damaged` at `QA-PR1`, the other unit `available`, `IRN` note shows the damage, the dashboard In Stock excludes it; line notes saved.
- Run: new tests 24/24; `-k "warehouse or transfer or itn or receive or lot or inventory or concurrency"` 146 passed, 3 failed (the known dev-DB ledger tests in `test_money_audit_cross_module`); `tsc --noEmit` clean.

## Fix log — medium findings (2026-10-22)
Findings 5, 7, 8 and 10 fixed; 9 and 11–13 (low) are open. Tests: `test_warehouse_itn_2026_10_22.py` now 35; one existing test (`test_inventory_process`) now gives its note an item before approving.

- **#5** `ItemTransferNoteService._validate_header` (create and update): source ≠ destination, both locations must exist, the source must belong to the note's branch; the create schema now rejects a transfer date more than a year from today, a remark over 2,000 characters and out-of-range location ids (422). A note with no items can no longer be approved (400). Live: same location, other-branch source, 2020 / 2030 dates, 5,000-char remark and id 2^40 are all refused.
- **#7** ITN and ITN Approvals lists load every note the user may see by default (limit 5,000); a branch filter narrows it. Live: the default view shows 18 notes instead of "No transfer notes found".
- **#8** Approve / reject errors show the server's reason instead of "Failed to approve…". Live: wrong password → "Invalid approver credentials" (dialog stays open).
- **#10** Only units that are `transfer_pending` or `in_transit` can be received (batch lines too): anything else is reported per unit ("not in transit") and not marked received. The receive wizard locks lines received earlier (inputs disabled, "Received earlier"), "Receive All" skips them, and only the open lines are sent. Live: partial note → one locked line, one open; payload carried only the open barcode; note → received.
- Run: `-k "warehouse or transfer or itn or receive or lot or inventory or concurrency or quote"` 224 passed, 3 failed (the known dev-DB ledger tests); `tsc --noEmit` clean.
