# Branch → product → supplier → PO → quotation → GRN → warehouse → purchase return (re-audit) — 2026-10-22

Second pass over the whole chain on fresh data (branch `QA-PR2`, product `QA2-Router` ITM000002, supplier `QA-Supplier Beta`), after the dashboard fixes. Built-in browser as `qa_admin` (Playwright MCP profile was locked by another session); forms and validation in the UI, setup and assertions through the API; dashboard cards compared with the API and with raw stock rows after every step.

## Chain and result

| Step | Result |
|---|---|
| Branch (UI) | Created once (double-click Save = 1 POST). Duplicate code refused, also case-insensitive (400); invalid email / empty name / 300-char code → 422. |
| Product (UI) | Auto item code ITM000002; a selling price below the cost is now refused ("Selling price cannot be less than cost price"); created once on a double click. |
| Supplier (API) | Created; duplicate name refused in 4 variants and 3 parallel calls (400). Product↔supplier mapping: negative cost 422, MOQ 0 422, duplicate 400. |
| PO (UI wizard) | **Double-click on "Confirm & Create" created two POs** (000001 and 000002) — see #1. PO approval / rejection OK. |
| GRN (UI) | 6 of 10 serial units; one GRN on a double click; PO → partially completed; duplicate serial blocked; dashboard: In Stock 6, value 300.00 (6 × 50). |
| Quotation (API) | Validation matrix OK (qty 0, negative price, price below minimum, past valid-until, qty 1e7, unknown branch, tax 150 → all refused). Over-ordering the line (11 > 10) and a PO price above the quote price (900) refused; PO for 4 units created and approved. |
| GRN for the quotation PO (UI) | 4 units auto-reserved for the quote line; dashboard In Stock 6 / Reserved 4 / total 10 / value 500.00. |
| Order from the quotation | Pending order holds units as reserved (Reserved 4, Sold Today 0); cancel returns them to available and reopens the quotation line (item procurement/4, quote partially processed). The earlier fixes hold. |
| Purchase return (UI) | Reason list, "Other" needs a comment, items by barcode, duplicate barcode blocked; one return on a double click; reason and comment stored. Print blocked while pending (400), allowed once approved (200). Dashboard: pending → Returned to Supplier 2, In Stock 8; approved → same, value 400.00. |
| Warehouse dashboard UI, branch `QA-PR2` | Five cards (8 / 0 / 0 / 2 / 0) and the Stock Summary row match the API. |

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | PO wizard (still open) | Double-clicking "Confirm & Create" creates two purchase orders (000001 and 000002; each a separate batch). First reported on the earlier pass; unchanged. | High |
| 2 | Purchase return list (new) | `GET /purchasing/returns` returns other branches' returns to a branch-limited buyer (3 `QA-PR2` returns visible to `qa_buyer1`, who only has `QA-PR1`) although by-id, print, GRN, orders, quotations and stock endpoints are branch-scoped (403/filtered). Return numbers, suppliers and amounts leak. | High |
| 3 | Purchase return API (still open) | A return with **no items** is accepted (201) and sits in the approval queue. The UI blocks it. | High |
| 4 | Purchase return price (still open) | A return price of 500 against a purchase price of 50 is accepted (201); the approved credit would exceed what was paid. | Medium |
| 5 | Warranty 0 (still open) | Units received with warranty "0" are flagged `warranty_expired: true` at once (expiry = received date), so every such return asks "WARRANTY EXPIRED?" through `window.confirm`; that dialog is blocked in embedded browsers, and after it focus leaves the scan box so the next scan is lost. | Medium |
| 6 | Return numbering (still open) | Return numbers are random (`PR-29E5DA08`), unlike every other document. | Low |

Fixed / verified since the first pass: return reason validated server-side (BOGUS → 422, "Other" without comment → 422) and stored; product selling price ≥ cost; dashboard cards, in-transit and valuation figures; pending quotation orders reserve instead of sell; cancelled order releases the quotation.

## Not covered
Phases not run: load; races beyond double-click and the parallel supplier-name test; uploads; exports/print PDF contents. Optional checks: workflow & stock integrity **run**; accounting integrity (GL / payables effect of the approved return), calculations beyond line totals, reports/exports, time & locale **skipped**. The backend restarted once during the run (tokens invalidated), nothing was lost.

## Data left behind (all `QA-`)
Branch `QA-PR2` (+ location), product `QA2-Router`, supplier `QA-Supplier Beta` (+ mapping), POs `PO-QA-PR2-26000001..3` (2 rejected duplicate), GRNs `GRN-QA-PR2-26000001..2` (10 units), quotation `QT-QA-PR2-26000001` (partially processed), cancelled order `INV-QA-PR2-2026-00001`, returns: approved `PR-29E5DA08` (2 units returned to supplier) and 2 rejected test returns. Nothing deleted.

## Fix log (2026-10-22)
Findings 1–5 fixed; finding 6 (random return numbers) left open. Tests: `backend/tests/test_purchase_return_rules_2026_10_22.py` (13 new) plus the adjusted `test_purchase_return_reason.py`.

- **#1** `PurchaseOrderCreateWizard`: the confirm handler is guarded by a ref, because the `isSubmitting` state only changes on the next render. Live: a double click on "Confirm & Create" now creates one PO and one toast (it made two before). The test PO was rejected afterwards.
- **#2** `GET /purchasing/returns` is scoped to the caller's branches (`get_user_branch_filter`, same as the GRN list) and accepts a `branch_code` filter (403 for a foreign branch). Live: `qa_buyer1` sees 0 `QA-PR2` returns (3 before); the list shrank from 16 to 8 rows; superusers still see everything.
- **#3** `PurchasingReturnCreate.items` requires at least one item (422).
- **#4** The service refuses a return price above the unit's purchase-order price (400) and stores that real price instead of the client-sent `purchasing_price`, so a forged purchasing price cannot raise the limit. Live: 500 vs 50 → 400.
- **#5** Warranty of 0 months is no longer "expired" (backend); the expired-warranty prompt is an in-app `TConfirmDialog` instead of `window.confirm`, and focus returns to the scan box after every scan or prompt. Live: unit with warranty 0 → `warranty_expired: false`.
- Run: new + related tests 20/20; `-k "return or purchas or grn or lot or warehouse_dashboard"` 296 passed, 8 failed (the same dev-DB ledger tests as before: `test_money_audit_cross_module` ×6, `test_accounting_gl_reliability` ×2); `tsc --noEmit` clean.
