# Sales › Customers QA — 2026-10-09

Scope: `/sales/customers` (list, create/edit form, contact persons) and `/customers/*` (customers, contact persons, export; credit endpoints only read-checked).
Method: API audit with an async client (bursts, validation matrix, export check) + built-in browser smoke. Playwright MCP unavailable. QA rows (60 customers + their contacts) were removed afterwards by a guarded DB script; the 2 real customers remain.

## Findings

| # | Area | Finding | Severity |
|---|---|---|---|
| 1 | **Duplicates / races** | **Nothing prevents duplicates.** 8 identical creates → 8×201; 8 case/space variants of the same email → 8×201; same name, email or phone created sequentially → 201. 17 case-insensitive duplicate names ended up in the table. No unique rule or index for email / phone / ID card / registration numbers | High |
| 2 | **Credit control** | `left_credit_amount` / `initial_credit_amount` are client-writable on create and update (`left_credit_amount: 999999` stored, `5000` accepted on PUT) — a user with the customer-update permission can raise the available credit that the credit check and credit sales rely on | High |
| 3 | Validation | **500s**: `credit_days: 2^40`, `max_credit_limit: 2^40`, `country_id: 2^40` (create and update); `GET/PUT /customers/{2^31}` and contact-person id `2^40` → 500 (ids unbounded) | High |
| 4 | Validation | Blank / whitespace names accepted (create and PUT); names not trimmed; `credit_days` and `max_credit_limit` accept negatives (`-5`, `-100`, `-1`); `left_credit_amount: -5` accepted | High |
| 5 | Validation | Email is a plain string: `"nope"`, `""` and `x@tijaero.local` stored (PUT too); `birthdate` 2999-01-01 / 1800-01-01 accepted (create and PUT); `no_of_kids` free text ("lots", "-3"); `gender` and `civil_status` free text; `default_currency` not checked against configured currencies; `country_id` / `billing_country_id` to a non-existent row (400 or stored — see report script); `payment_address` / `delivery_address` / `bank_details` unbounded text (1 MB accepted) | Medium |
| 6 | Update rules | PUT can clear required data: mobile number blank (individual → stored as NULL), switch to `business` with no company name (200), clear contact phone; null on `customer_name`/`active` → 409 instead of 422 | Medium |
| 7 | Export | `GET /customers/export-csv` writes cells as-is: a customer named `=HYPERLINK("http://evil","x")` is a live formula in Excel; gender column prints "Female" for anything that is not "m" (and the header says gender but data holds m/f/other) | High |
| 8 | List | **Silent 1 000-row cap + client-side everything**: the page requests `limit=1000&active_only=false` and filters/pages in the browser; `GET /customers/` has no `ORDER BY` (ids came back unsorted); search `%` / `_` wildcards are unescaped (`%` matched both real customers) | High |
| 9 | Contact persons | Blank full name accepted; XSS/formula names accepted; **several primary contacts** (5 parallel creates with `is_primary: true` → 4 primaries); phone required on create but clearable on update; same phone/ID no uniqueness not enforced | Medium |
| 10 | Concurrency | No `version` token on customers: 6 parallel same-"version" edits → 6×200 (last write wins, edits silently lost); customer create/update commit audit + row with no unique guard | Medium |
| 11 | Validation | NIC / passport / registration numbers are free text (`<b>`), customer `title`, `civil_status` not from a list | Low |
| 12 | UI | Create/edit form has no `maxLength`, credit limit input uses `parseFloat` but the API rounds to int (decimals silently dropped), no in-flight guard on Save (check before relying on the disabled button) | Low |

## Verified OK
- 401 without a token on every route (including POST and export).
- Individual/business required-field rules, bank details required on create, distinct phones, phone format (E.164), name ≤255, email length ≤75, title ≤30, id card ≤20, commission 0–100, customer_type enum.
- Customer numbers (`customer_no`) are unique under 10 parallel creates (no duplicates in 62 rows).
- Credit endpoints (summary, aging, statement, settlements) return 200; `credit-check` rejects negative and huge amounts (422).
- Contact-person validation that exists works: name/designation length, bad email/phone, title/phone required on create, 404 for a customer that does not exist, delete is idempotent (second delete 404).
- Page loads at the sales route (62 rows, footer "1–25 of 62"), filters (status, type, category) present, XSS-named customer renders as text.

## Phases run / not run
Smoke (partial) · 1b validation & security (API) · 2 duplicates & races (API). Not run: UI form end-to-end, double-click Save in the UI, low-privilege RBAC matrix, load. Optional checks: 8 (data lifecycle) skipped, 6 (export) run (finding 7), 7 (paging) run (finding 8).

## Suggested fix order
1. #2 make credit amounts server-controlled (ignore `left_/initial_credit_amount` input; derive from `max_credit_limit`), #3/#4 bounds and non-negative rules, #7 `csv_safe` + real gender.
2. #1 uniqueness (case/space-insensitive email, phone; DB unique indexes `lower(btrim())` + 400 mapping) — decide which fields must be unique (name? email? mobile? ID card?).
3. #8 server paging (`/customers/paged`, ordered, literal search, export-all), #5/#6/#9/#10/#11 validation, contact primary rule, optimistic version, #12 form limits.

## Fix log (2026-10-09)
Verified by 66 new backend tests (`backend/tests/test_customer_validation.py`), a re-run of the audit scripts, and live in the browser (31 customers: paging, search, export, edit + double-click Save).

- **#1 duplicates:** migration `s88_customer_unique_ci` adds case/space-insensitive unique indexes on **email, ID card number, passport number, company registration number and tax registration number** (blank values are not compared) and the service pre-checks them (clear 400 naming the field; the index message is mapped for races). **Names and mobile numbers are deliberately not unique** (two customers can share a name; families/offices share lines) — tell me if you want mobile unique too. The upgrade lists clashing values instead of failing opaquely.
- **#2 credit control:** `left_credit_amount` / `initial_credit_amount` are no longer accepted from the client. On create both equal `max_credit_limit`; when the limit changes the initial amount follows and the left amount is recomputed from the customer's documents by the credit service.
- **#3/#4 bounds and signs:** every text field has the column's length (note: city/state were 200 in the schema but 120 in the table, ID card 20 vs 12), `credit_days` 0–3650, `max_credit_limit` 0–2 147 483 647 (whole number), ids int4 in the body, path and query (customer, contact, coupon, voucher routes), names trimmed and non-blank.
- **#5 validation:** email format (accepts `.local`), birthdate 1900–today, gender `m|f|u|other|male|female`, civil status from the list, `no_of_kids` 0–99, ID card / passport characters, commission 0–100 and finite, country and billing/shipping country must exist, default currency must be a configured active currency, address and bank text bounded. Blank form values become null.
- **#6 update rules:** nulls on required fields → 422 (was 409); the individual/business rules are re-applied to the merged record whenever the type, company name, mobile or a person-only field changes (clearing the mobile number or switching to business without a company name is refused; legacy rows can still be edited for unrelated fields).
- **#7 export:** cells go through `csv_safe`; Gender prints Male / Female / Other (blank if unset).
- **#8 list:** `GET /customers/` and `/search` are ordered and search escapes `%` `_`; new `GET /customers/paged` (search incl. customer no., status, type, agent flag, whitelisted sort); the Sales › Customers page now loads only the visible page and Export writes every matching row. Verified: "1–25 of 31", page 2 "26–31 of 31", search "1–10 of 10", `%` → 0, CSV 32 lines.
- **#9 contact persons:** title, name (non-blank), phone required and not clearable on update; email/designation bounded; **one primary contact per customer** (customer row lock + unique partial index; the primary cannot be unset without naming another; 5 parallel primary creates → still one primary).
- **#10 concurrency:** customers now carry a `version` token; the page sends it as `expected_version` and a stale save is a 409. The update takes a row lock.
- **#11/#12 form:** `maxLength` on 17 inputs, credit limit input is a whole number, Save has an in-flight guard (verified: a double-click sends one `PUT`).

Notes
- The project also contains an older, unused copy of the page at `frontend/src/modules/customers/pages/CustomersPage.tsx`; the route uses `modules/sales/pages/CustomersPage.tsx`. Only the latter was changed.
- 60 + 29 QA customers from the audit and the verification run were removed by a guarded DB script; the 2 real customers remain.
