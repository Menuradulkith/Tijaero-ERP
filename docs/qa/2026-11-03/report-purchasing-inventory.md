# QA audit: Purchasing + Inventory (2026-11-03)

Counts: 6 High, 21 Medium, 26 Low (53). Scripts: scratchpad/qa/purchasing/. qa-none 403 on ~150 routes.
Side effect: QA-BR-A hit its daily limit of 5 POs for 2026-11-03 (cancelled POs count).

## High
- **PUR-01** purchasing/api.py:1255, service.py:2442 — branch-A user posts GRN against branch-B PO (only payload branch checked).
- **PUR-02** service.py:2442-2456 — GRN branch/location not tied to PO branch; stock lands in wrong branch; aging vs statement mismatch.
- **PUR-03** api.py:1524-1541, service.py:3288-3320 — legacy POST /grn-items and /inventory/sales-stock accept cancelled GRNs, skip branch checks, create stock with no GL (unused by UI).
- **PUR-04** invoice_service.py:538-596 — invoice PATCH skips create checks (total 400→1, past due date, empty supplier no, items replaced unchecked).
- **PUR-05** service.py:3838, :3854 — pending payment amount editable (50→5000); verify posts edited amount.
- **PUR-06** invoice_service.py:971 — returned goods still invoiceable.

## Medium
- PUR-07 service.py:3708 — supplier payment no upper bound (99,999,999 vs 3,500 PO).
- PUR-08 cross-branch payment create.
- PUR-09 invoice_service.py:634 — /invoices/pay skips date and method checks (2099, "Bitcoin").
- PUR-10 service.py:3982 — delete pending payment → misleading "A required value is missing".
- PUR-11 service.py:3907 — verified payment can't be reversed.
- PUR-12 schemas.py:877, service.py:2066 — client can skip purchase-return approval (require_approval=false default).
- PUR-13 return line product_id not checked against stock row.
- PUR-14 GRN can be backdated before its PO.
- PUR-15 service.py:1224-1252 — empty PATCH on approved PO resets to pending_approval and loses approver.
- PUR-16 invoice_service.py:116 — zero-qty / empty invoices accepted, status paid.
- PUR-17 service.py:1056 — update_order skips create-time line checks.
- PUR-18 inventory/service.py:546, sales/accounting_integration.py:152 — stock cost/COGS use tier cost, not GRN or landed cost; GL drifts.
- PUR-23 GRN payment-history and grn-items/by-po skip branch check.
- INV-01 products/repository.py:56-61, service.py:231 — default tier ignores min price, doesn't follow product edits.
- INV-02 price_tier_service.py:151-198 — last active tier deletable.
- INV-03 inventory/api.py:403, :465, :430 — stock read endpoints skip branch check (incl. cost).
- FE-01 api/client.ts:158-164 + useCrudMutation.ts:52-58 — 403 on save silent.
- FE-02 GoodReceivedNotesPage.tsx:160, :975-983 — location defaults to id 1 / stale branch.
- FE-03 ProductsPage.tsx:924-938 — 409 conflict silently drops edits.
- FE-04 PurchaseReturnsPage.tsx:744-767, :987-1008 — Edit/Delete buttons with no backend.
- FE-05 PurchaseOrdersPage.tsx:899, :1143, :1944 — unit_price defaults 0, no price/qty checks.

## Low
PUR-19 landed-cost date 2099; PUR-20 daily PO limit counts cancelled; PUR-21 PO double-submit; PUR-22 approved unreceived PO can't be closed; PUR-24 empty fields in responses; PUR-25 pending payments counted as paid; supplier statement cross-branch; INV-04 deactivate category/brand in use; INV-05 deactivate product with stock; INV-06 Sales Manager sees cost; FE-06..FE-20 (canEdit ignores GRN, no Cancel PO, dropped fields, min price checks, tracking default, confirms, conditional hooks, generic 422, duplicate toasts, UTC dates, dead verify call, wizard 0 price).

## Leftovers
Brand 74966, category 75795, products 74817-74820, supplier 101349 (owed 2,690), posted GRNs 76821-76827, stock 96908, GRN items 22316-22319, returns 1086-1089, invoices 320/322/323 + returned-units invoice, verified payments 173/175.
