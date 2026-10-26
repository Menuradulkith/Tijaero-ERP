# Deep QA: product → supplier → PO → approval → GRN → warehouse dashboard → ITN → approval → receive note — 2026-10-22

Tool: built-in browser as `qa_admin` (Playwright MCP failed to connect this time), 1440×900. Forms, wizards, approvals and the receive flow were driven in the UI; setup, validation sweeps and the access checks used the API. Fresh data: branches `QA-D1` (source) and `QA-D2` (destination), product `QA-Deep Phone` (ITM000003), supplier `QA-Deep Supplier`, `PO-QA-D1-26000001`, `GRN-QA-D1-26000001`, ITNs `ITN-QA-D1-26000001…3`, receive note IRN-337, two limited users (`qa_wh1` on D1, `qa_wh2` on D2, role `QA-Deep-WH`). The dashboard was compared with raw stock rows after every step.

## Flow and result

| Step | Result |
|---|---|
| Branch + location | Created through the API; **a branch is created with no location** (the page makes a second call, `location_name` in the branch body is ignored; one location per branch is enforced). |
| Product (UI) | Auto code ITM000003; negative cost and selling < cost refused; one record on a double click. API sweep: duplicate name (case/space), 256-char name, cost 1e12, negative, bad category, bad tracking → clean 400/422; `item_code` / `id` / `created_by` sent in the body are ignored. |
| Supplier (API) | Bad email / phone → 422; duplicate name (case/space) and duplicate email → 400; product mapping created. |
| PO (UI wizard) | 8 × 200 = 1,600.00; one PO and one toast on a double click; approval OK. |
| GRN (UI) | Existing serial → "Barcode already exists", repeated serial → "Duplicate barcode"; 8 units received once on a double click; PO → completed. Dashboard `QA-D1`: In Stock 8, value 1,600.00 (8 × 200). |
| ITN create (UI) | Step 1 has no Save; empty Next refused; scans refuse unknown barcode, a unit of another branch, a duplicate; one note and 4 lines on a double click. Edit: one `PUT`, remark changed, no new note. API: a unit already on an open note is refused (400), pending notes hold no stock (In Stock stays 8). |
| ITN approval (UI) | Step-up login; approving moves the 2 units to `transfer_pending` (In Stock 6, In Transit 2, value 1,200.00); rejecting the other note (reason required) leaves the approved note's units untouched. |
| Receive note (UI) | Damaged field is locked until a quantity is received; partial receive (1 unit, damaged 1, note "screen cracked") → ITN `partially_received`, IRN "[Damaged on arrival: 1 unit(s)]", unit arrives at `QA-D2` as `damaged`, the other still `transfer_pending`; second receipt locks the first line and completes the ITN (`received`, IRN status 1). Final: `QA-D1` In Stock 6 / value 1,200; `QA-D2` In Stock 1 / value 200 (the damaged unit is excluded). |
| Access (users on one branch) | Approve without permission 403; create a note from another branch 403; other branch's stock summary / notes list 403; a destination user can open a note addressed to their branch (by design). |

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | Receive Notes (access) | **The receiving branch cannot list incoming transfers.** `GET /warehouse/transfer-notes?to_location_branch=QA-D2` returned `[]` for `qa_wh2` (branch D2 only) while an approved note addressed to D2 was waiting; the list filters notes by the *sender* branch against the user's branches. The Receive Notes page ("No approved transfer notes available for receiving") is therefore empty for exactly the users who must receive. By id they can open the note. | High |
| 2 | Receive (authorisation) | **The sending branch can confirm receipt.** `qa_wh1` (branch D1 only) received a unit of a D1 → D2 transfer into D2 (`receive-items` → 200 "received 1"). Receiving should be limited to the destination branch (or approvers), otherwise the check "the receiver confirms what arrived" is void. | High |
| 3 | Dashboard | **Damaged units are invisible.** After the damaged unit arrived, `QA-D2` showed In Stock 1 / total 1 and no damaged figure (cards and Stock Summary); it only exists in the unit list. Same class of gap as In Transit before it was added. | Medium |
| 4 | Receive note record | The receipt note is **overwritten** by each receipt (the damage text "[Damaged on arrival: 1 unit(s)]" disappeared when the rest was received with an empty note), and `recieved_user` stays `null` — nobody is recorded as the receiver. | Medium |
| 5 | Receive wizard | Lines show only "QA-Deep Phone / 1 / received / damaged / notes": **no barcode column**, so the receiver cannot tell which unit a row is (the damaged flag went to whichever row was first). | Medium |
| 6 | Approvals dialog | A double click on Approve sends two requests; the success toast is followed by "Cannot approve. Current status: approved". The Reject login dialog still says "confirm this approval" with an "Approve" button. | Low |
| 7 | ITN page | The From / To location pickers list every branch's locations (29 / 28 options) instead of the selected branch's; the branch-create call and the location call are separate and non-atomic. | Low |
| 8 | Receive page | No success toast after "Receive Items"; scans typed while the previous scan is being validated are dropped silently (two quick scans → one row). | Low |

## Verified OK (no finding)
Duplicate-click guards on PO, GRN, ITN create/edit and receive; GRN barcode checks; PO/GRN totals; dashboard figures after GRN, approval, reject, partial and full receive (both branches); reject no longer frees an approved note's units; edit updates in place; unit already on an open note refused; locked "received earlier" lines; header/line API validation from the earlier fixes (same location, other-branch source, dates, item rules); product / supplier uniqueness and field validation; mass-assignment fields ignored; step-up approvals and reasons; limited users get 403 for approval and for other branches.

## Not covered
GL / payables postings of the GRN and the transfer, print / PDF output, quotation and purchase-return paths (audited earlier), load and race bursts beyond double clicks, mobile layout, accessibility. Playwright MCP was unavailable, so keyboard-level checks ran through the built-in browser.

## Data left behind (all `QA-`)
Branches `QA-D1`, `QA-D2` (+ locations), product `QA-Deep Phone` and probes (ITM000004/5), supplier `QA-Deep Supplier`, PO/GRN above (8 units `QA3-SN-001…008`: 1 damaged at D2, 2 received at D2 by the access test), ITNs 1–3 (1 rejected), IRN-337, role `QA-Deep-WH`, users `qa_wh1`, `qa_wh2` (password in the test script only). Nothing deleted.

## Suggested fix order
1 and 2 (receiving-branch scope: list incoming by destination, receive only by destination), then 4 (append receipt notes, record the receiver), 3 (damaged figure), 5 (barcode column), then the low items.
