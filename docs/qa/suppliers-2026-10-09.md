# Suppliers page QA — 2026-10-09

Scope: `/purchasing/suppliers` (list, General / Address / Contact Person / Payment tabs) and its API (`/purchasing/suppliers…`).
Method: Playwright MCP was unavailable, so API audits with an async Python client + the built-in browser. All QA rows (33 suppliers, with their contacts / payment methods / product mappings) were removed afterwards by a guarded DB script (no supplier has a delete endpoint). Pre-existing rows untouched.

## Findings

| # | Area | Finding | Severity | Repro |
|---|---|---|---|---|
| 1 | Validation | **500 instead of 4xx on over-long / huge values.** No max-length or range checks, so the DB rejects and the API returns "secure database error": company_name 256+, email 70+ chars local part, website 200+, postal 21+, city 121+, address line 256+, registration no 256+, `credit_days: 2^40`, `max_credit_limit: 1e30`, `lead_time_days: 2^40`, `country_id: 2^40`; same on PATCH (`company_name` 256) | High | `POST /purchasing/suppliers` with the value |
| 2 | Validation | **Contact persons / payment methods also 500**: full_name 256, title/gender/occupation/id_card long, account_number 300, `lc_amount: 1e30`; supplier-product `product_id: 2^40` | High | sub-resource POSTs |
| 3 | Validation | **Whitespace-only accepted**: `company_name "   "` creates a supplier with an invisible name (create *and* PATCH); same for `billing_address_line1 "  "`, contact `full_name "  "`. Names are not trimmed (`"  QA-Trim  "` stored with spaces) | High | `POST` with spaces |
| 4 | Validation | **Negative money/terms accepted**: `credit_days: -5`, `max_credit_limit: -100` on create and PATCH (grid shows "Net -1", "Net -5"); `max_credit_limit 10.555` silently rounds | High | `POST`/`PATCH` |
| 5 | Validation | Ids are not bounded: `GET /suppliers/2147483648` and `PATCH /suppliers/2^40`, `/contact-persons/2^40` → 500 (should be 422) | Medium | path ids |
| 6 | Validation | `country_id` huge on the list filter → 500; `min_credit_limit` negative/huge accepted; `default_currency` accepts `"XX"` and lower-case `"usd"` (comment says it is validated against the currencies table — it is not) | Medium | `GET ?country_id=1099511627776`, `POST default_currency:"XX"` |
| 7 | Validation | `company_website` accepts `javascript:alert(1)` (rendered as a link anywhere?) — restrict to http(s) | Medium | `POST company_website` |
| 8 | Validation | Payment-method content unchecked: bank_transfer with no bank fields, account number `abc!!`, bad SWIFT `zz`, card expiry in the past (`01/2001`) or `99/9999`, LC expiry before issue, bad LC currency | Medium | payment-method POSTs |
| 9 | Validation | Contact birthdate `1800-01-01` accepted; `supplier_product.cost_price 1e30` accepted | Low | |
| 10 | List | **Silent 100-row cap + no ORDER BY.** `suppliersApi.getAll()` sends no limit, the API defaults to `limit=100`, and the grid pages/filters client-side — supplier #101+ never appears. Rows come back unordered (0006, 0007, 0008, 0013, 0001, …). Same class of bug fixed on Product Catalogs | High | needs >100 suppliers; code: `api.ts getAll`, `list_suppliers` default `limit=100` |
| 11 | Search | `search=%` and `search=_` match every supplier (LIKE wildcards not escaped) | Low | `GET ?search=%25` |
| 12 | UI | **Double-click Save sends two `POST /suppliers`**: one 201, the second 400 → success toast **and** error toast "Company name … already used". Only the unique index saves it from a duplicate | Medium | dblclick/Save twice on New Supplier |
| 13 | UI | Credit-limit input uses `parseInt`, so decimals typed are dropped while the API stores cents; UI marks Email required but API/DB allow blank (inconsistent rule); Contact No 1 not flagged on empty submit | Low | form |
| 14 | Data | Sub-resources can be added to a deactivated supplier (201); logo upload filename `../../x.png` returns 200 (stored name is generated — verify) | Low | |
| 15 | Export | Grid "Export" is client-side CSV; formula neutralisation not verified. NOTE: after the paging change on Product Catalogs, export there covers the **current page only** (suppliers still export all loaded rows) | Medium | click Export |

## What is OK
- 401 without token; read/create/update permissions present on every supplier route.
- **Races are solid** (unique indexes exist): 8 identical creates → 1×201; 8 case/space variants of company name, email and registration no → 1×201 each; 5 renames onto one name → 1×200; same-version PATCH → 1×200 + 5×409; 10 distinct parallel creates → 10×201 with **no duplicate `supplier_no`**; payment-method default race leaves exactly one default; duplicate product mapping → 400.
- XSS strings are escaped in the grid (`<img onerror>` shows as text, no dialog); mass-assignment (`supplier_no`, `id`, `left_credit_amount`, `logo_path`, `version`) is ignored.
- Bad email/phone/tax_area/gender-less birthdate in the future/negative lead time → 422; same mobile+home number → 422; bad file as logo → 400; 8 MB logo → 400.
- Mobile width (390): no horizontal page overflow, Add Supplier reachable.
- Empty submit shows field errors (Company Name, Email).

## Phases run / not run
Smoke (partial: list, create form, mobile — Playwright unavailable, built-in browser used) · 1b field validation & security (API) · 2 duplicates & races (API + UI double-click) · Load: **not run**. Not exercised in the UI: Address / Contact Person / Payment tab forms, supplier edit, logo upload from the UI, low-privilege-user RBAC matrix (route permissions only read in code).

## Optional checks
1 Workflow: skipped (no status chain) · 2 Accounting: skipped · 3 Stock: skipped · 4 Calculation: skipped · 5 Approval matrix: skipped · 6 Reports & exports: run (export noted above, not verified) · 7 Pagination/sort/filter: run (finding 10) · 8 Data lifecycle: partial (deactivate; sub-resources on inactive supplier) · 9 Time & locale: skipped · 10 Accessibility: skipped · 11 Session: skipped · 12 Resilience: skipped · 13 Regression pinning: pending fixes · 14 Visual: skipped.

## Suggested fix order
1. #1/#2/#5/#6 — bound every string/number/id in the supplier schemas (Annotated StringConstraints, `ge/le`), 422 not 500.
2. #3/#4 — trim + non-blank names/addresses, `credit_days ≥ 0`, `max_credit_limit ≥ 0` with 2 decimals.
3. #10/#11 — server-side paged `/suppliers/paged` like Product Catalogs (stable order, escaped search), and export all matches.
4. #12 — in-flight save guard (`withSaveGuard` pattern).
5. #7/#8/#9 — website scheme, currency list, payment-method rules, minor bounds.

## Fix log (2026-10-09) — everything fixed
Verified by 53 new backend tests (`backend/tests/test_supplier_validation.py`), re-running the audit scripts (every 5xx above is now 422/400; race results unchanged), and live in the browser. QA rows (about 90 across the audit runs) were removed by the guarded DB script; the 5 original suppliers remain.

- **#1/#2/#5/#6 bounds → 422:** every supplier / contact / payment-method / product-mapping text field has a max length matching its column, numbers and ids are range-bound (`credit_days 0–3650`, `max_credit_limit 0–9 999 999 999 999.99` with 2 decimals, int4 ids in body, path and query). Response schemas stay lenient so legacy rows can still be read.
- **#3/#4:** names/addresses are trimmed, company name and contact name must be non-blank (create and PATCH), blank optional text becomes null, `credit_days` and `max_credit_limit` reject negatives and extra decimals. (A blank billing address on create is by design — it is filled in on the Address tab.)
- **#6 currency:** `default_currency` is upper-cased and must exist in the currencies table (400 otherwise).
- **#7 website:** must be http(s).
- **#8 payment methods:** bank transfer / direct debit need bank name + account number; LC needs an LC number, expiry ≥ issue and shipment ≤ expiry; credit card needs last-4 and a non-past `MM/YYYY`; wallet needs provider + id; account numbers 3–34 alphanumeric, SWIFT 8/11 chars. Updates are re-validated against the stored row.
- **#9:** birthdate ≥ 1900, mapping cost price bounded, id card ≤ 12 (column size).
- **#10 list:** new `GET /purchasing/suppliers/paged` (page/size/q/active/country, whitelisted sort incl. country name, stable order); the page now loads only the visible page with a real total. The old array endpoint is ordered and bounded too.
- **#11:** search escapes `%` / `_` and also matches the supplier number.
- **#12:** Save has an in-flight guard (verified: double-click → 1 POST, 1 toast).
- **#13:** credit limit keeps cents; Contact No 1 is highlighted when missing (`TPhoneField` now counts a bare dial code as empty); input `maxLength` on all supplier text fields. Email stays required in the form (product decision) though the API allows blank.
- **#14:** new contacts / payment methods on an inactive supplier → 400. Logo filenames are generated server side (the `../../x.png` upload only ever stores a random name).
- **#15 export:** `TDataGrid` gains `exportAllRows`; Products, Categories, Brands and Suppliers export **every row matching the current filters** (fetched in pages of 200, capped at 50 000), visible columns, formula-safe cells (plain numbers/phones are left alone). Verified: 62 suppliers → 63 CSV lines.
