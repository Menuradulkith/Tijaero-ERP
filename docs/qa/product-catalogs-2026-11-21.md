# QA — Product page (Products list, General, Pricing, Design Brief, Design Detail) — 2026-11-21

Scope: `/product-catalogs` (list + detail tabs, create flow), quick load check of Categories and Brands.
Backend: user's dev server on :8020 (current code, migrations up to `s148_design_optional_fields`).
Frontend: Vite dev server on :3000. Viewports 1440x900 and 390x844.

## Findings

| Page | Status | Finding | Severity | Repro |
|---|---|---|---|---|
| (dev env) Vite | Issue | Vite served an **old** `ProductDesignBrief.tsx` (still had the Reference field and `urlError`) although the file on disk was newer; its watcher missed the last writes. In the browser Save crashed with `TypeError: Cannot read properties of undefined (reading 'trim')`. Not a code bug — re-saving the files made Vite pick them up. Users with the page open must hard-refresh (Ctrl+F5); if it recurs, restart `npm run dev`. | Info (env) | `curl :3000/src/modules/inventory/components/ProductDesignBrief.tsx` contained `reference_url` while the disk file did not |
| Design Detail (and Design Brief) | **Fixed** | Double-clicking **Save** sent 2 PUTs: 1×200 + 1×409. No duplicate data (the version check blocked the second), but the user saw a misleading toast "The design detail was changed by someone else…" next to "Design detail saved". **Fix:** an in-flight ref guard (`runOnce`, released in `onSettled`) on save / confirm / reject in both hooks. **Re-test:** dblclick Save and dblclick Confirm on brief and detail → exactly 1 request each, only the success toast. | Low | Edit → fill → `dblclick` Save → network: `200 PUT /design-detail`, `409 PUT /design-detail` |
| Design Brief / Design Detail | **Fixed** | Console error `MUI: You are providing a disabled button child to the Tooltip component` — the **Reject** button's `Tooltip` wrapped the button directly; it is disabled while a save/confirm is pending. **Fix:** wrapped in a `<span>` like Confirm. **Re-test:** Confirm → no console error. | Low | Click Confirm → console |
| Design Brief | OK (note) | Toasts stack: after an empty-save attempt, "Fill in the highlighted fields first." stays visible next to the later "Design brief saved". Same behaviour as the rest of the app. | Info | Edit → Save (empty) → fill → Save |
| Products list | OK | 45 rows, server paging (page 2 = 26–45, no overlap with page 1), sort by Name, search = API counts (`QAAUDIT` 12, `QAAUDIT-1103 fg` 3), search on page 2 resets to page 1, empty state "No products found", Clear resets. No 4xx/5xx, no console errors. | — | — |
| Categories / Brands | OK | Load, 6 / 4 rows, no errors. | — | — |
| Product detail tabs | OK | General, Pricing, Design Brief, Design Detail load without errors; Design Detail shows "Waiting for the Design Brief" until the brief is confirmed. | — | — |
| Add Product | OK | Empty Save → 7 required-field messages + toast; Pricing/Design tabs disabled until General is complete / product saved. Valid create with **dblclick Save → exactly 1 POST (201)**. After create, Next walks General → Pricing → Design Brief → Design Detail. | — | — |
| Design Brief flow (UI) | OK | Fields: Category\*, Item\*, Brief (optional, no Reference). Empty Save → "Select a category"/"Select an item". Add Item defaults to the previous line's category; Remove works. Cancel with changes → "Discard Changes" dialog, values restored. Reject: button disabled until a reason is typed; status → Rejected, reason shown; edit+save → Draft; Confirm dialog → Confirmed, all buttons gone (locked). | — | — |
| Design Detail flow (UI) | OK | Edit pre-fills the confirmed brief's items (category/item fixed, brief read-only). Only Quantity (M) required: empty → "Required", 0 → "Must be more than 0"; bad URL → "Must start with http:// or https://". Added item gets its own Brief box. Saved view shows the same fields read-only, empty optional fields as "-", Design URL with Open link. | — | — |
| Design endpoints — authN | OK | No token → 401 on all 7 design endpoints. | — | — |
| Design endpoints — validation | OK | 422 for quantity 0 / -1 / 1e12 / 4 decimals / "abc" / "NaN", colour 121 chars, size 10k, brief 2001, notes 10k, `javascript:` and space-containing URLs, material_id 0; 400 for unknown item and duplicate item; product 99999999 → 404, 0 / 2^31 / "abc" → 422. Emoji/Sinhala/Arabic text accepted. No traceback/SQL in any error body. | — | — |
| Design endpoints — lock & state | OK | Confirmed brief: PUT → 409, reject → 409. After detail confirm, 3 parallel rejects → 3×409. | — | — |
| Design endpoints — mass assignment | OK | PUT with `status: confirmed`, `product_id`, `confirmed_by`, `id`, line `item_code`/`sort_order` → ignored (stays draft, own product, real item code). | — | — |
| Design endpoints — races | OK | 8 parallel PUTs with the same version → 1×200 + 7×409; 8 parallel Confirms → 1×200 + 7×409; final state consistent. | — | — |
| XSS | OK | Brief `QA- woven hang tag <img src=x onerror=alert(1)>` shown as text in edit and view mode; no injected `<img>`, no dialog fired. | — | — |
| Layout 390x844 | OK | Design Brief / Detail (view and edit): no horizontal overflow, fields stack full width. | — | — |

## QA data
- Created: product **ITM000023 "QA- Design Brief Test 2026-11-21"** (+ auto item **MAT000064**) — products cannot be deleted; **deactivated**.
- Design brief/detail rows written on QA products ITM000019 (id 74819) — **deleted** after the run (also after the fix re-test). Nothing was written on 74823 (all attempts were rejected).
- Not touched: existing design data on ITM000021 (id 93900).

## Coverage
Phases run: smoke ✔, field validation ✔ (UI + API), security ✔ partial (authN, XSS, mass assignment, error leakage; **not run live:** low-permission user and branch scope — products are not branch-scoped; the view-only/update permission split is covered by `tests/test_product_design_*`), duplicates & races ✔ (design endpoints, product create dblclick), load ✘ (not requested).

Optional checks: #1 workflow & status transitions — run (draft → rejected → draft → confirmed, lock); #7 pagination/sort/filter — run (paging, sort, search; filter panels not exercised); #2, #3, #4, #6 (exports), #9, #11 — skipped (trigger not met); #5 approval matrix — skipped (no maker≠checker rule on design docs); #8 data lifecycle — skipped (no delete paths); #10 accessibility — skipped (not requested); #12 resilience — skipped (not requested); #13 regression pinning — run as a Playwright re-test of the two fixes (no frontend unit-test runner in this repo); #14 visual regression — skipped (screenshots unreliable in this browser session).
