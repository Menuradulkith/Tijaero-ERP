# QA audit: Warehouse + Manufacturing (2026-11-03)

Counts: 0 Critical, 6 High, 13 Medium, 12 Low. Full request log: scratchpad/qa/warehouse/run.log.
Warehouse has no bins/stock-count/adjustment endpoints; locations tested under /common/locations.

## High
- **WH-01** warehouse/service.py:832-866, api.py:196-201 — PATCH /transfer-note-items/{id}/receive marks received with no state check and no stock move/GL; serial unit stays in_transit forever while ITN shows received (API only, UI doesn't call it).
- **WH-02** schemas.py:63, service.py:769-771,:820-821 — client can set item_recieved on line create/update; stock reserved/dispatched but never received.
- **WH-03** api.py:16-32 (_ensure_itn_access) — receiving branch user can add/delete lines, approve and dispatch the sender's ITN.
- **WH-04** schemas.py:176 vs varchar(355) — received_note > 355 chars on first receipt → 500.
- **MFG-01** manufacturing/api.py:74-94, service.py:201-226 — work centers ignore branch scope (other branch edit/read/create/delete).
- **FE-01** useCrudMutation.ts:52-58 + api/client.ts:158-163 — manufacturing actions silent on 403.

## Medium
- WH-05 service.py:311,328,613 — approved/dispatched ITN cannot be cancelled; stock stays transfer_pending.
- WH-06 service.py:53-54, :1214-1219 — serial line without barcode accepted, never receivable; ITN stuck partially_received.
- WH-07 api.py:287-296, :347-358 — receive notes can be forged/edited via POST/PUT (status reset, receiver spoofed, duplicates).
- WH-08 service.py:324-335 — delete pending ITN with lines → 400 "A required value is missing"; after manual cleanup central approval stays pending.
- WH-09 common/api.py:317-350, common/service.py:76-84 — locations not branch-scoped; moving a location with stock to another branch strands stock rows.
- MFG-02 service.py:917-927 — over-issue allowed (12 vs 8 required; duplicate line in one request).
- MFG-03 service.py:980-990 — scrap_quantity unbounded, drives backflush.
- MFG-04 service.py:481-499 — BOM update-product-cost overwrites cost/price tiers with no inventory revaluation.
- MFG-05 planning.py:424-475, MaterialRequirementsPage.tsx:165-213 — MRP firming per branch not idempotent on retry.
- FE-02 ItemTransferNotesPage.tsx:820,836-837; ItemTransferNoteApprovalsPage.tsx:390-420 — no permission gating.
- FE-03 ItemTransferNotesPage.tsx:580-605 — ITN save not atomic (header then lines).
- FE-04 stale data after receive/approve/production/BOM actions (missing invalidations).
- FE-05 ItemTransferNotesPage.tsx:837 — delete ITN not wired.

## Low
- WH-10 delete location in use → unclear "A required value is missing".
- WH-11 api.py:362-384 — validate-barcode / validate-lot no branch scope (leaks cost, qty).
- WH-12 service.py:438-474 — concurrent dispatch not locked (3×200).
- WH-13 receipts accepted at approved (before dispatch); dispatch never called from UI.
- WH-14 duplicate approval records allowed.
- MFG-06 serial numbers silently dropped on non-serial output.
- MFG-07 time-log completed_quantity unbounded.
- MFG-08 misleading MRP PO-firming errors.
- FE-06 Cancel shown when backend will refuse.
- FE-07 Enter in copy-BOM dialog bypasses pending guard.
- FE-08 missing maxLength / duplicate serial checks.
- FE-09 duplicate error toasts; load errors shown as empty list.

## Verified OK
qa-none 403 on all 41 mutations; branch 403 on production orders, reorder rules, MRP, ITN create; field validation 422s; BOM self/duplicate/loop rules; production-order state machine and concurrent release/output; manufacturing and ITN GL consistent; frontend payloads, confirms, draft-only edit buttons, double-submit guards.

## Leftovers
Branches QAA1103A/B/C, locations 80481/80482 (80482 moved to QAA1103C with B stock), products 74831-74836, users qaaudit1103_a/_b, ITNs 3497-3504 (stranded in_transit / transfer_pending stock), receive notes 768/769, approvals 2/3 and central 31945, MOs 767-773, BOMs 1156-1161, work center 1122, GL JE-MFG-202611-0001..0009.
