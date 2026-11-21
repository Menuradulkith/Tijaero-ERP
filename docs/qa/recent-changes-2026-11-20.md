# QA – recent changes (2026-11-20)

Scope: only what changed in this working session, across modules. Tool: Playwright MCP (UI) plus direct API calls through the browser context, and a Python `httpx` script for the no-permission user (`qa-none`, token minted locally). Dev server http://localhost:3000, backend :8020, dev Postgres (erp_postgres2). Viewport 1440x900, plus 390x844 for the Item Catalog form.

**Phases run:** smoke (all changed / removed routes), field validation (UI + API), security (no token, low-permission user, XSS, CSV formula injection, mass assignment), duplicates & races (Materials categories and items). **Not run:** load (needs a separate DB; only on request).

**Optional checks:** #1 workflow – skipped (no status flows changed); #2 accounting – skipped (no posting changed); #3 stock – skipped (Stocks page is read-only); #4 calculation – skipped (coupon/voucher maths removed, nothing new computed); #5 approval matrix – skipped (trigger not met); #6 reports & exports – run (materials and customers CSV got new columns); #7 pagination – skipped (new lists have < 1 page of data); #8 data lifecycle – skipped (no delete/deactivate changes); #9 time & locale – skipped; #10 accessibility – skipped (not requested; noted the duplicated heading in shared `TFormDialog`); #11 session – skipped; #12 resilience – skipped; #13 regression pinning – skipped (no confirmed bug fixed in this run); #14 visual – partial (one mobile screenshot: `docs/qa/screens/2026-11-20/item-catalog-mobile.jpeg`).

## Findings

| # | Page / Endpoint | Status | Finding | Severity | Repro |
|---|---|---|---|---|---|
| 1 | Materials > Item Catalog (create) | **Fixed** (re-checked: first empty Save marks all 7 mandatory fields) | First empty **Save** highlights only Item Name, Unit of Measure, Tracking Type and Category. Product Family, Inventory Valuation Method and Stock Issuing Method only turn red on the *second* Save (after the first four are filled). The Pricing tab also unlocks before these three are filled. Cause: `isProductGeneralIncomplete` and `onInvalidSave` in `ItemCatalogPage.tsx` don't include the three material fields. | Low (UX) | Add Item → Save → only 4 red; fill them → Save → 3 more red |
| 2 | `POST /materials/categories/` (and `/inventory/categories/`) | **Fixed** (names now collapse runs of whitespace to one space for categories, brands, products and materials; re-check: 8 parallel variants incl. double spaces and tabs → 1×201 + 7×409; pytest `TestNameSpacesCollapsed`) | Duplicate check ignores case and outer spaces but **not doubled inner spaces**: `QA-Race Var X` and `QA-Race  Var  X` both created (MCAT0005, MCAT0006). Product categories behave the same (pre-existing; materials copied the rule `lower(btrim(name))`). | Low | 8 parallel name variants → 2×201 |
| 3 | Sales returns / coupons / gift vouchers (backend) | Open (by decision) | Screens are removed, but the API is still live: `GET /sales/returns/list`, `/customers/coupons/`, `/customers/vouchers/` → 200, and the sales order create still accepts `cupon_id` / `gift_voucher_*` / `voucher_redemptions`. The backend removal was left pending in this session. | Medium | Call the endpoints with an admin token |
| 4 | `POST /materials/items/` | Info | `design_required: "yes"` is accepted as `true` (Pydantic lenient booleans; products behave the same). | Info | Post with a string toggle → 201 |

## Checked and OK

| Area | Result |
|---|---|
| Removed sales routes | `/sales/returns`, `/sales/coupons`, `/sales/vouchers`, `/sales/approvals/return-approvals`, `/sales/return-approvals` redirect to `/sales`; no menu entries; Approvals hub loads; no console errors / failing API calls. |
| Sales orders | Create form and order view have no Coupon / Gift Voucher text and no "Return Invoice" button. |
| Warehouse | Dashboard: no tabs, KPI cards + "Unit List". Stocks page: summary grid (18 rows), no KPI cards; clicking a row opens the dashboard filtered to that product. |
| Suppliers – API | Missing tax_area / default_currency / incoterm / shipment_method → 422; bad incoterm / shipment / accounting group → 422; other currency = default → 422 (create and PATCH); unknown currency → 400; incoterm_place 121 / 10k chars → 422; nulls on mandatory fields → 422; mass assignment (`supplier_no`, `created_by`, `is_superuser`) ignored; no token → 401. |
| Suppliers – UI | Create marks Tax Area, Default Currency, Incoterm, Shipment Method required; General shows Accounting Group, Other Currency, Foreign, Shipping Info. PO History: only Completed (6 for QA Supplier 238AAC), no status filter, no Edit button, row opens the PO. |
| Customers – API | Missing category / tax area / accounting group / VAT → 422; VAT blank or 51 chars → 422; bad category, SWIFT, IBAN (short, 35 chars) → 422; location 10k → 422; nulls on mandatory fields → 422. SWIFT/IBAN are normalised (spaces removed, upper-cased). CSV export has the new columns and neutralises `=HYPERLINK(...)` (prefixed `'`). |
| Customers – UI | Required marks on Category, VAT Registration No, Tax Area, Accounting Group; "Customer Type" label; Category options Customer / Prospect Customer / End Customer; Payment tab shows Bank Account Info + Correspondent Bank Info; bad IBAN shows the hint and Save sends no request; XSS name renders as text, no script runs. |
| Materials – AuthZ | All endpoints (items list/paged/create/get/export, categories list/create, activity log): no token → 401, `qa-none` → 403. |
| Materials – validation | Item type other than stock_item/expense → 422; UOM missing/blank → 422; product category id → 400; unknown brand → 400; brand omitted → 201; HS code letters → 422; `javascript:` design URL → 422; 10k product family / 121-char dimensions → 422; negative / 1e12 / NaN cost → 422; selling below cost → 400; mass assignment (`item_code`, `created_by`, `image_url`, `is_superuser`) ignored. XSS name renders as text; CSV neutralises `=cmd|...`. Material categories never appear in product categories. Activity log works for `material` and `material_category`. |
| Materials – UI | Item Type options Stock Item / Expenses; Brand not required; toggles present; no Manufacturing section; tabs General / Pricing / Suppliers; double-click Save → 1 POST, "Item created successfully", MAT000005; Add Category popup double-click Create → 1 POST, new material category selected in the form; no horizontal overflow at 390 px. |
| Materials – races | 10 identical category creates → 1×201 + 9×409; 10 identical items → 1×201 + 9×409; 10 distinct items in parallel → unique codes MAT000007–MAT000016. |
| Product Catalog | Categories and Brands indented under Products in the sidebar (48 px vs 32 px; same under Materials > Item Catalog); product tabs General / Pricing only; no Manufacturing section; Add Category / Add Brand only in create/edit mode; popup Create disabled when empty; double-click Create → 1 POST and selects it; duplicate name shows "Category with name ... already exists" inside the popup. |

## QA records left in the dev DB
- Suppliers: 3 × `QA-Sup …` (one has an XSS incoterm place).
- Customers: 1 × `QA-Cust <img src=x onerror=alert(1)>`.
- Materials: 15 items MAT000002–MAT000016 (`QA-Mat …`, `QA-Race …`); MAT000001 "QA Steel Sheet 2mm" is from earlier manual testing.
- Material categories: 6 × `QA-…` (plus "Raw Materials", MCAT0001, from earlier).
- Product categories: `QA-ProdCat popup …`, 2 × `QA-Space … Cat …`.

None were deleted. They can be deactivated, or removed with a guarded script on request.
