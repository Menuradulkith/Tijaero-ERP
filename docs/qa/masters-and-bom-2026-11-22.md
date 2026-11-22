# QA audit: Suppliers, Customers, Item Catalog, Product Catalog, BOM — 2026-11-22

Scope: Purchasing › Suppliers, Sales › Customers, Materials › Item Catalog / Categories / Brands, Product Catalogs › Products / Categories / Brands, Product Catalogs › BOM (incl. product Design Brief / Design Detail / BOM Structure APIs).
Environment: local dev, frontend :3000, backend :8020 (single dev worker), dev Postgres. Admin + existing QA accounts (`qa-none`, `qa_sm_a1` Sales Manager, `qa_pm_a1` Purchasing Manager, `qa-mgr-b1` on another branch); their access tokens were minted server-side (no password changes, no login-rate-limit hits).
Scripts (session workspace, not committed): `audit1.py` (AuthZ, validation, mass assignment, CSV, headers, errors), `audit2.py` (races), `audit3.py` (uploads), `perf.py`, `enums.py`.

**Phases run:** smoke (UI), field validation, security, duplicates & races. **Not run:** load (needs a staging DB), UI-level permission hiding for limited users (no UI login for them; the API enforcement was tested instead).
**Optional checks:** #1 workflow & status run (Design Brief / Detail / BOM draft→confirm/reject under races); #2 accounting skipped (trigger not met); #3 stock skipped (trigger not met); #4 calculation skipped here (BOM routing maths verified in its own test on 2026-11-22); #5 approval matrix skipped (no maker/checker on these masters); #6 reports & exports run (CSV formula injection); #7 pagination/sort/filter run (API caps, literal wildcards, search); #8 data lifecycle skipped (no deletes on these masters); #9 time & locale skipped; #10 accessibility skipped; #11 session skipped; #12 resilience skipped; #13 regression pinning skipped (no confirmed bugs fixed yet); #14 visual regression skipped.

## Findings

| # | Page | Field / Endpoint | Input | Expected | Actual | Severity |
|---|---|---|---|---|---|---|
| 1 | Customers | `POST/PUT /customers` `title` | `Mr`, `<b>King</b>` | Only `mr / mrs / miss / dr` (the UI's choices), case-normalised | Any text is stored. The detail page's Title select can't show it (MUI "out-of-range value" warning) and the field appears blank; saving the form can silently drop it | Medium |
| 2 | Customers | `bank_swift_code` | `!!` | 8 or 11 letters/digits (BIC) | Accepted (IBAN is validated, SWIFT isn't) | Low |
| 3 | Suppliers, Customers, Item Catalog, Products, Product Categories (list pages) | Search box | type a search | Keep showing current rows while the new page loads | Table blanks to ~20–38 skeleton rows for 1–2 s on every search (same pattern fixed on the BOM page) | Low (UX) |
| 4 | Item Catalog / Products / Categories / Brands | duplicate name on create / rename | same name | One consistent status for "already exists" | Mixed 400 and 409 (material create burst: 6×409 + 3×400; product create 409 but rename 400). Messages are clear; only the code differs | Low |

No Critical or High findings.

## What passed

**Authorization (42 endpoints × 4 users + no token)**
- No token → 401 on every endpoint.
- `qa-none` → 403 everywhere.
- Sales Manager: allowed on customers and on product / category / brand **view**. Refused 403 on every write to products, categories, brands, BOM, design brief / detail, all supplier endpoints and all Item Catalog endpoints.
- Purchasing Manager: allowed on suppliers. Refused 403 on customers and on every write outside suppliers.
- The supplier statement needs `supplier_payments:view` (a finance permission) — by design.
- Customers and suppliers are company-wide master data (no `branch_code`), so a user of another branch can see them by design; their branch-level documents (statements, aging) are scoped.

**Field validation** (58 bad inputs across 7 create endpoints → all 400/422, never 500)
- Blank / whitespace names, 256 and 10,000 characters.
- Negative, 1e13 and 2^40 amounts; `NaN`.
- Tax 150 %, tolerance 101 %, negative credit days and shelf life.
- Bad e-mail, phone letters / too short, invalid enums.
- Non-existent category, brand, product type, material and country ids; `javascript:` website and design URLs.
- Future and invalid (`2026-02-30`) birthdates, commission 150 %, selling price below cost.
- Unicode / emoji / Sinhala names are accepted.

**Mass assignment**
- `id`, `created_by`, `is_superuser`, `branch_code`, `item_code`, `supplier_no` / `customer_no`, `category_code` / `brand_code`, `status` and `created_at` sent on create were ignored on all 7 endpoints.

**Injection / XSS**
- Records named `<img src=x onerror=…> "><script>…` render as plain text in every list and detail header (9 pages). No dialog fired and no `<img>` was injected.
- `' OR 1=1 --` and `%_\` in search are literal.
- An SQL-looking `sort_by` is ignored.

**CSV exports** (customers, items, products)
- Cells starting with `=`, `+`, `-`, `@` are prefixed with `'`, e.g. `'=HYPERLINK(…)` and `'+9477…`.

**Headers**
- Authenticated JSON has `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and `X-Frame-Options: DENY`.
- A CORS pre-flight from `https://evil.example` is rejected with no `Access-Control-Allow-Origin`.

**Errors**
- Malformed JSON, out-of-range ids (2^31, -1, `abc`), `size=100000`, `page=1e9` and a 5,000-character search → clean 422/404.
- No stack trace, SQL or file path in any response.

**Uploads** (product image, item image, supplier logo)
- Rejected:
  - text, HTML and PHP renamed `.png`
  - SVG with a script
  - `.exe` and empty files
  - files over 5 MB
- A `../../../evil.png` filename is stored under a random name.
- Files are served as `image/png` with `nosniff`, and replacing an image deletes the old file.
- `/uploads/..` and encoded traversals → 404.
- Uploads can be read without logging in (needed for `<img>`); names are random.

**Races and duplicates** (parallel requests on the live server)
- 10 identical creates → exactly 1 created on all 7 endpoints.
- 8 case/space variants of the unique name (customers: e-mail) → exactly 1 created on all 7.
- 10 parallel creates with different names → display numbers (supplier no., customer no., `MAT…`, `MCAT…`, `CAT…`, brand code, `ITM…`) all unique.
- 5 records renamed to the same name at once → exactly 1 succeeded on all 7.
- 5 updates of one customer / supplier with the same version → 1×200 + 4×409. Two parallel edits of different fields without a version → both saved, nothing lost.
- Item–supplier link: same link 5× → 1; two "preferred" links at once → only 1 preferred.
- Design Brief / Design Detail / BOM:
  - first save 5× → 1×200 + 4×409
  - confirm 5× → 1×200 + 4×409
  - BOM save 5× with the same version → 1×200 + 4×409
  - confirm and reject at the same moment → exactly one wins
- List scans of this run's names: no case/space duplicates.

**UI smoke** (1440 px and 390 px)
- All 9 pages load with no console errors and no failed API calls.
- Search returns the right row with one request; footers match.
- Opening a row works.
- No sideways scroll on mobile on any list or detail page.
- Double/triple-click Save on Product Categories, Product Brands, Item Categories and Item Brands → 1 POST each. An empty Save shows the field errors plus "Please fill in the highlighted mandatory fields".

**Speed**
- List APIs answer in 25–75 ms (median of 8). The slowness felt when searching is the typing delay plus finding #3, not the server.

**Observations (not bugs)**
- Materials › Brands and Product Catalogs › Brands use the same brand list (`/inventory/brands`): a brand added on one page appears on the other, while item and product categories are separate. Confirm this is intended.

## Test data left in the dev DB

None. All QA records were removed with a guarded DB script after the fixes were verified:
- **Records:** 16 suppliers, 20 customers, 30 items, 16 item categories, 16 product categories, 17 brands and 15 products.
- **Their children:** 15 auto-created price tiers and 3 item–supplier links.
- **Uploaded test images:** 3.

The script deleted only rows named `QA-AUD22…` or `QAXSS…`, after a dry run showed no other table referencing them.

## Resolution (same day)

| # | Fix | Verified |
|---|---|---|
| 1 | `title` must be Mr / Mrs / Miss / Dr. It is stored lowercase (`Dr.` → `dr`); anything else is a 422. Migration `s151_customer_title_swift` lowercased the 25 stored `Mr` titles. The form loads an unknown title blank, so the required Title asks for a valid one instead of resending the bad value. | `<b>King</b>` → 422; old `Mr` customer opens showing **Mr** with no console warning; 4 new tests |
| 2 | `bank_swift_code` uses the same 8/11 letters/digits check as the correspondent SWIFT and is upper-cased (API, migration and form with an inline error that blocks Save) | `!!` → 422; the form shows "8 or 11 letters/digits"; 3 new tests. One existing customer, **Prasad MP**, has `u9393`: the form will ask for a valid code the next time it is edited |
| 3 | The Suppliers, Customers, Item Catalog (items, categories, brands) and Products (products, categories, brands) grids show placeholders only on the first load. A search keeps the current rows until the new page arrives, and the header spinner still shows that a refresh is running. | 0 placeholders during search on all 5 lists |
| 4 | "Already exists / already used" is 409 for suppliers (incl. contact persons), customers, items, products, categories and brands (pre-checks used 400) | Duplicate create returns 409 on all 7 endpoints; the UI toast still shows the message; 11 assertions in 3 test files updated |

Tests: `test_customer_validation.py`, `test_materials_2026_11_18.py`, `test_catalog_supplier_integrity.py` → 187 passed.

Pre-existing failures, not caused by these fixes:
- In `tests/integration/test_workflows/test_frontend_api.py`, the product tests omit the newer required fields (product type, HS code) and the PO tests send `product_id` instead of `material_id`.
- Three unused imports in `CustomersPage.tsx` (lint).

## Activity history check (2026-11-22, afternoon)

**Method:**
- Created one record per entity and changed every editable field in one save (supplier 32 fields, customer 52, item 29, product 21, categories 4, brand 3).
- Compared the history entry with the before and after records.
- Re-saved the unchanged record as the UI does (full form) to look for phantom entries.
- Ran each side action once.

All test records (`QA-HIST-…`) and their files were deleted afterwards.

**Passed:**
- Every create is logged.
- Every changed field is logged, with no missing and no extra fields, on all 7 entities.
- Old and new values are correct, apart from finding H2.
- Unchanged saves add nothing for suppliers, customers, categories and brands.
- Image and logo uploads are logged.

| # | Where | Finding | Severity |
|---|---|---|---|
| H1 | Products, Items | Saving an unchanged form adds an "Updated" entry such as "Cost Price 99.99 → 99.99" or "Selling Price 120.45 → 120.45". Prices are stored as exact decimals and compared with the float sent by the form (Decimal ≠ float for most cents values), so every Save clutters the history. | Medium |
| H2 | Customers | Payment / delivery address are rebuilt from the billing / shipping lines on save, but the history logs the submitted value. It can show a value that was never stored ("Pay addr" while "B1, B2, Kandy…" was saved). | Low |
| H3 | All pages | Linked fields show raw ids: "Category Id 2295 → 75795", "Items Brand Id", "Country Id". The image shows its file path ("Image Url (empty) → products/….png"). | Low (usability) |
| H4 | Suppliers, Customers, Items, Products | Changes made outside the main Save are not in the history: supplier contact persons, payment methods and item links (on both the supplier and the item); customer contact persons; product / item minimum price added from its own section; product price tiers (add / edit / toggle / delete). | Medium |
| H5 | BOM, product Design Brief / Design Detail / BOM Structure | No activity history at all: save, confirm and reject are not logged, and there is no history panel. The documents only show "created / last updated / confirmed / rejected by". | Medium |

### Activity history: resolution (same day)

| # | Fix |
|---|---|
| H1 | Values are compared by meaning (`99.99` = `Decimal('99.99')`, empty = none) before logging. Re-run: unchanged saves add 0 entries on all 7 entities. |
| H2 | The customer history logs the stored payment / delivery address. |
| H3 | The history shows names: Category, Brand, Country, Item, Supplier, Work Center, HS Code, Product Type. Images read "Image added / New image / Image removed". This applies to older entries too. |
| H4 | Logged on the parent record (and on both sides for links): supplier contact persons, payment methods, item and product links; customer contact persons; item / product minimum price; product price tiers (add / edit / remove). The panel shows a one-line summary ("Price tier: Wholesale") plus the field changes. |
| H5 | Design Brief, Design Detail and BOM Structure log Created / Updated (header fields plus line-level added / removed / changed) / Confirmed / Rejected (with reason). A "History" button next to "Created by … · Last updated by …" opens the panel on the product tabs and the BOM page. |

Verified: `tests/test_activity_history_2026_11_22.py` (5 tests); the related suites pass (585). The field audit and side-action scripts were re-run live, and the panels were checked in the browser (product, supplier, design brief). The QA-HIST rows, their audit entries and the 3 uploaded test images were removed.