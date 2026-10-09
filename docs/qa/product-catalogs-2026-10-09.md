# Product Catalogs – QA (2026-10-09)

Pages: `/product-catalogs` (Products, 3 tabs: General / Pricing / Suppliers), `/product-catalogs/categories`, `/product-catalogs/brands`. Backend: `backend/app/modules/products/*` (`/api/v1/inventory/products|categories|brands`, price tiers, minimum prices). Frontend: `frontend/src/modules/inventory/pages/ProductsPage.tsx` (one 2.7k-line component serving all three views).

Real data (untouched): 2 products (`0002 Apple mackbook`, `001 fffef`), category `Laptop`, brand `Apple`. All QA rows (≈ 70 products, 35 categories, 25 brands, 70 price tiers, 1 QA user) were removed with guarded DB scripts (abort unless nothing real references them).

## Phases
- Smoke **run** (all 3 pages) · Field validation & security **run** (UI + API) · AuthZ **run** (read-only user) · Duplicates & races **run** · Load **not run**
- Optional: #4 calculation accuracy **partial** (rounding), #7 pagination/search **partial**, #8 data lifecycle **partial** (inactive category/brand), #6 export **run** (found broken), #10 a11y/#14 visual **skipped**, others **skipped**

## Passed
| Check | Result |
|---|---|
| Load: 3 pages | No console errors, no 4xx, no 307s; API 90–140 ms (the first Products load takes several seconds in dev: Vite compiling the large page) |
| No delete | No delete action in any page; no delete API for products/categories/brands |
| AuthZ | Read-only user: list `200`; create/update product, category, brand, price tier, minimum price, image → `403` |
| Optimistic locking | Stale or reused `expected_version` → `409`; 6 clients with the same version race → 1×200 + 5×409 |
| Price rules | negative cost/selling/min → 422; selling < cost → 400; tier min > selling or min < cost → 400; tier addressed through the wrong product → 404; **last active tier cannot be deactivated or deleted**, also under concurrency (toggle/delete both of two tiers at once → exactly one 200 + one 400) |
| Duplicates (identical) | item code / name / category / brand duplicates → 400/409; 8 identical parallel creates → 1×201 |
| Mass assignment | `created_by`, `created_date`, `id` ignored |
| Uploads | PHP/HTML as `.png` and SVG with script rejected; oversize/empty rejected; unknown product 404 |
| XSS | `<img onerror>` / `<svg onload>` names render as text in all three grids; no dialog |
| Length limits | name/code/memo > 255 → 422; brand code > 4 → 422 |
| Mobile 390 px | No horizontal overflow on all three pages |

## Findings
| # | Severity | Where | Finding |
|---|---|---|---|
| 1 | **High** — **FIXED** | `POST/PUT /products` (`ProductBase.website_price`) | **A single bad request can break the whole catalog.** `website_price` has no `ge=0`, so `-5` is accepted. The product *and its default price tier* are committed, then the response fails because `PriceTierOut` forbids negatives → **500 after commit**. The row exists but cannot be read (`GET /products/{id}` → 500), and because the list endpoint returns every product in one response, **`GET /products`, search and the Products page return 500 for everyone** until the row is removed. Reproduced; two such rows broke the dev catalog until I deleted them. |
| 2 | **High** — **FIXED** | `backend/app/modules/sales/accounting_integration.py:74` (committed at HEAD) | **Sales invoices cannot post to the general ledger.** `from app.modules.products.models import Product, ProductPriceTier` — `ProductPriceTier` lives in `price_tier_models.py`, so the import raises `ImportError`; the service logs `GL posting failed for approved credit invoice … cannot import name 'ProductPriceTier'` and carries on. This is the cause of the `ProductPriceTier` errors seen in the backend test failures. One-line fix (import from `price_tier_models`). |
| 3 | **High** — **FIXED** | Products, Categories, Brands (API + UI) | **Blank / whitespace names and codes are accepted** (`item_code "  "`, category/brand `name`/`code` blank). The UI Save also accepts them (a blank product, category and brand were created from the forms). `item_code "X "` (trailing space) is accepted as a separate code. Later blank-name updates hit misleading `409 already exists` because a blank row already exists. |
| 4 | Medium — **FIXED** | Products, Categories, Brands | **Case/space variants race through.** The sequential duplicate check is case-insensitive, but there are no DB indexes: 8 parallel variants of the code/name created **5 duplicates** each for products (code, name), categories (name, code) and brands (name); 3 of 5 concurrent product renames onto one name succeeded. Identical (exact) parallel creates are fine (1 winner). |
| 5 | Medium — **FIXED** | Create forms (Products, Categories, Brands) | **Double-click Save sends two POSTs**: one record is created, then an error toast ("…already exists") appears. |
| 6 | Medium — **FIXED** | `POST/PUT` prices | Prices at/above the `Numeric(60,2)` limit (e.g. `1e61`) → **500** for `selling_price`, `website_price`, `minimum_selling_price`, tier prices and minimum-price history; `PUT` tier `cost_price: null` → 500; tier `is_active: null` → wrong `409`. |
| 7 | Medium — **FIXED** | Prices (logic) | **Minimum selling price may exceed the selling price**: product create with `minimum_selling_price 500 / selling_price 100` → 201; `POST …/minimum-prices` with `100000` against a `150` selling price → 201 (current minimum then exceeds the selling price, so no sale is possible). The tier endpoint enforces `selling ≥ min ≥ cost`; the product-level paths do not. |
| 8 | Medium — **FIXED** | `GET /inventory/products/export-csv` | **Route shadowed** by `/products/{product_id}` (declared earlier): the call returns `422 path -> product_id: Input should be a valid integer`. The backend CSV export is unreachable (the page's Export button is the grid's own export). |
| 9 | Medium — **FIXED** | all `{id}` routes | Ids above int4 → **500** (`GET/PUT` for products, categories, brands, price tiers; `category_id: 2^40` in a product body). |
| 10 | Low–Med — **FIXED** | `POST /products` | Products can be created with an **inactive category or brand** (201); the Add form's pickers only list active ones, the API doesn't. Deactivating a category that products use is allowed. |
| 11 | Low — **FIXED** | Products | `item_type` and `unit_of_measure` accept blank and arbitrary text (`<script>x</script>`); `website_active=true` without a website price; `image_url` can be set at create (e.g. `javascript:`) although the update schema says uploads are its only writer; description/remark unbounded (300 k accepted). |
| 12 | Low — **FIXED** | Search | `q=%` and `q=_` are treated as SQL wildcards (match everything). |
| 13 | Low — **FIXED** | Updates | `null` for `name`/`code`/`active` on update → vague `400 "breaks a database constraint"` instead of a field-level 422; whitespace code accepted on update. |
| 14 | Low — **FIXED** | Forms | No `maxLength` on product/category/brand name/code/memo inputs; number inputs have no `min` and accept negative prices; Save is enabled on an empty form (the check happens on click). |
| 15 | Info/UX — **FIXED (toast, website price); tier editor intentionally not built** | Product detail | Opening a product that has no minimum price shows a red **error** toast "No minimum price set for this product"; the Pricing tab has **no price-tier UI** (the API supports multiple tiers per product, the page edits only the primary prices); a null website price shows as "Rs. 0". |

## Suggested fixes (not applied)
1. **#1:** `ge=0` on `website_price`, `selling_price`, `minimum_selling_price` (and an upper bound matching `Numeric(60,2)`) in `ProductBase/ProductUpdate`; build the response *before* commit or validate prices first; make the list endpoint resilient to one bad row. Repair any existing negative `website_price` rows.
2. **#2:** change the import in `accounting_integration.py` to `from app.modules.products.price_tier_models import ProductPriceTier`; add a test that posts an invoice to the GL.
3. **#3/#4/#13:** `strip + min_length=1` on names/codes (trim `item_code`), reject `null` on required updates, then **unique functional indexes** on `lower(btrim(...))` for `products.item_code`, `products.name`, `category.name/category_code`, `items_brand.brand_name/brand_code` (same approach as roles/users/branches; the three audited modules' pattern, tests in `test_unique_indexes.py`).
4. **#5:** in-flight Save guard in the three forms (as on Users/Roles/Branches).
5. **#6/#7/#9:** bound prices and ids, enforce `selling ≥ minimum ≥ cost` on product create/update and minimum-price history, return 422 not 500.
6. **#8:** declare `/products/export-csv` (and `/products/search`) before `/products/{product_id}` or constrain the path param with `Path(..., ge=1)` + a converter.
7. **#10/#11:** reject inactive category/brand on create/assign, validate `item_type`/`unit_of_measure` against a list, drop `image_url` from `ProductCreate`, escape `%`/`_` in search.
8. **#14/#15:** `maxLength`/`min` on inputs, soften the min-price toast (info, not error), add the tier editor to the Pricing tab if tiers are meant to be user-managed.

Not tested: the Suppliers tab (preferred supplier links), stock/inventory effects of products, price tiers inside sales quotations/invoices (belongs to the Sales pass), product import, the UI image upload control, load.

## Fix log (2026-10-09) — everything fixed except the price-tier editor
You confirmed multiple price tiers per product are not needed, so the "no price-tier UI" part of #15 is dropped (the API's tier endpoints were left as they are; they could be removed later if single-tier is the final design — each product keeps its one default tier, which sales uses).

Verified by 67 new backend tests (`backend/tests/test_catalog_validation.py`), live API checks against the running backend, and the browser. Full backend suite: **625 passed, 29 failed** — the same 22 unrelated failures as before, plus 7 tests in `test_accounting_gl_reliability.py` that *could not even be collected before* (the broken import, #2) and now run: 31 of that file's 38 pass; the 7 failures there are independent (a test fixture lacking `.items`, and the DB function `fn_insert_cashbook_entry` missing from this dev database).

- **#1 poisoned catalog:** all price fields are `0 ≤ price ≤ 999 999 999 999.99` on create/update (product, tier, minimum-price history) → 422 before anything is written. The *response* schemas (`Product`, `PriceTierOut`, …) are now lenient, so a legacy bad row can no longer make a list/search endpoint return 500. Live: negative website/selling price and `1e61` → 422, nothing saved, list stays 200.
- **#2 ledger:** `accounting_integration.py` imports `ProductPriceTier` from `price_tier_models`. Test: the module imports and exposes the model.
- **#3 blank/whitespace:** names, item codes, category/brand names and codes are trimmed and must be non-empty (create *and* update; null → 422). UI: whitespace counts as empty, payloads are trimmed. Verified in the browser: spaces-only brand is blocked with no request sent.
- **#4 races:** the existing `s66` indexes only compared `lower(col)`; the API now trims, and migration **`s85_catalog_unique_trim`** replaces them with `lower(btrim(col))` unique indexes (products name + item code, category name + code, brand name + code; the upgrade lists any clashing values instead of failing opaquely). Live: 8 parallel case/space variants of product code, product name, category name/code and brand name/code → **exactly 1×201 each (was 5)**; 5 concurrent renames onto one name → 1×200 (was 3); same-version race 1×200 + 5×409; no 5xx.
- **#5 double-click Save:** products, categories and brands saves go through one in-flight guard that spans the duplicate checks and the mutation (`withSaveGuard`). Verified in the browser: a double-click on Save sends **one** `POST /brands/` and stores one record (was two POSTs and an error toast).
- **#6 / #9 limits:** prices bounded (above); `tier cost_price: null` → 422, `is_active: null` → 422 (was 500 / wrong 409); product, category, brand, tier and price-history ids bounded to int4 in the path *and* in body ids (`category_id: 2^40` → 422).
- **#7 minimum price:** `selling ≥ minimum ≥ cost` is enforced on product create, on update (when cost, selling or minimum changes) and on `POST …/minimum-prices` (a minimum above the selling price → 400). Legacy out-of-rule products can still be edited for unrelated fields.
- **#8 export:** `/products/export-csv` is declared before `/products/{product_id}` (no longer shadowed) → 200 `text/csv`; text cells beginning `= + - @` are neutralised with a leading `'` (new shared helper `csv_safe` in `app/utils/csv_export.py`).
- **#10:** a new product (or a *changed* category/brand on update) must use an active category/brand (an existing assignment to a since-deactivated one does not block unrelated edits); `item_type` / `unit_of_measure` must be a short identifier of letters, digits, space, `_ . / -` (blank and `<script>` rejected; `inventory`, `service`, `general`, `pcs`… still work — it is deliberately *not* a fixed list because existing data/tests use values like `general`); `website_active` requires a website price; `image_url` is no longer accepted on create (only the upload endpoints write it); descriptions/remarks are capped (5 000 / 500).
- **#11 search:** `%` and `_` (and `\`) are escaped, so the search is literal (`%` returns nothing instead of everything).
- **#12/#13:** null or blank on required update fields → field-level 422.
- **#14 forms:** `maxLength` on item code, name, model, category/brand names and codes, memo, descriptions (255 / 4 / 255 / 5 000); price inputs have `min=0`, `step=0.01`.
- **#15 UX:** opening a product without a minimum price no longer pops a red error toast (the lookup is made quiet and treats 404 as "none yet"; `QuotationsPage` keeps the strict call); a null website price displays blank instead of "Rs. 0".

Also: the test `test_duplicate_blocked_by_database_when_precheck_is_bypassed` asserted the old index name; it now accepts `uq_products_name_(ci|lower)`.

All QA rows from this pass were removed by the guarded DB script (2 products / 1 category / 1 brand remain, as before).

## Server-side paging (2026-10-09, follow-up)
Question was whether the Products / Categories / Brands pages cap what they show. They did: each loaded at most 1 000 rows (silently), in no defined order, and paged/filtered in the browser. Now:

- **API:** `GET /inventory/{products,categories,brands}/paged` → `{items, total, page, size, pages}`. Params: `page` (0-based), `size` 1–200, `q` (literal, trimmed contains-search), `active`, products also `category_id`, `brand_id`, `supplier_id`; `sort_by` (whitelisted per entity, unknown → default) + `order`; always a stable `ORDER BY …, id`. Product rows carry `category_name` / `brand_name`. The old array endpoints are unchanged.
- **UI:** `TDataGrid` has opt-in `serverPagination` / `onServerSortChange`; the three grids fetch only the visible page (search debounced 300 ms, any filter/search/sort change returns to page 1, previous page stays visible while loading). The footer shows the real total ("1–10 of 25"). Header sort is done by the database across all pages.
- **Removed:** client-side filtering of a 1 000-row list, and the browser-side duplicate-name pre-checks (they only saw the loaded rows; the DB's case/space-insensitive unique indexes are the authority and return 400).
- Category/brand drop-down pickers still load the full lists (limit raised to 100 000), supplier filter is now a server join instead of loading the supplier's mappings.
- **Bug caught during live check:** the unfiltered total for categories/brands was 1 (`count(*)` lost its FROM); fixed and covered by `test_unfiltered_total_matches_full_list`.
- Tests: `backend/tests/test_catalog_paging.py` (6). Verified live with 25 products: page 1→2, 10/page, search reset to page 1 ("1–3 of 3"), descending name sort across pages. QA rows removed afterwards.
