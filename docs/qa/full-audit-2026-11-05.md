# Full ERP QA audit — all modules (2026-11-05)

**Targets:** dev UI http://localhost:3000 → dev API :8020 (read-only checks); scratch UI http://localhost:3001 → scratch API :8030 (4 uvicorn workers, DB `erp_qa` = fresh `pg_dump` copy of `erp_db`) for everything that writes: form submits, fuzzing, races, load.
**Tools:** Playwright MCP (UI), `backend/loadtest/qa_api_audit.py` (OpenAPI-driven sweep of all 796 operations), `qa_probe.py` (races, money checks), `qa_load.py` (load).

**Phases run:** smoke (all ~140 routes), field validation (UI: every Add form + Customer/Coupon field by field; API: per-field fuzz of 272 write operations), security (authN, RBAC, branch scope/IDOR, query injection, mass assignment, XSS rendering, CSV formula export, headers/CORS), duplicates & races, load (5 → 25 → 50 VUs).
**Optional checks:** #1 workflow run (approve/cancel/settle on SO, supplier invoice pay); #2 accounting run (day-end, posting failures); #3 stock skipped (no stock flows exercised); #4 calculation skipped (done 2026-10-12/11-02); #5 approvals partly (parallel approve only); #6 exports run (CSV formula); #7 pagination skipped; #8 lifecycle skipped; #9 time/locale skipped; #10 a11y skipped; #11 session skipped; #12 resilience skipped; #13 regression pinning skipped (report-only run); #14 visual skipped.

## Findings

| # | Area | Endpoint / page | Input / steps | Expected | Actual | Severity |
|---|---|---|---|---|---|---|
| 1 | Accounting | `finance/posting-failures`, Day-End Reconciliation | Open Day-End for 2026-11-05 | Balanced | "Books NOT Balanced": GL itself balances, but **2 sales-revenue postings were rejected as unbalanced**: INV-QA-BR-A-26000042 (6 identical lines = 1,800, credit split 900) and INV-QA-BR-A-26000043 (1 line, paid 100, bank split 50). Credit is exactly 2× debit in both → invoice lines/total and payment split diverged (likely a race on create/edit from the 2026-11-03 run). Third failure: ITN-QAA1103A-26000008 transfer-out posting, `value too long for varchar(355)` on `item_receive_note`. | High |
| 2 | Branch scope | Purchasing: `/purchasing/credit-settlements`, `/purchasing/payments/report`, `/purchasing/outstanding-documents`, `/purchasing/eligible-advance-pos`, `/purchasing/supplier-advances` | User with all Admin permissions, limited to QA-BR-A | Only QA-BR-A rows | 10–36 rows of other branches each (supplier money) | High |
| 3 | Branch scope | `/hr/sales-commissions/summaries` and `/{summary_id}` | Same user | Own branch only | 63 foreign rows; by-id of branch 123 → 200 | High |
| 4 | Validation 500 | `POST/PUT /employees/`, `/employees/{id}/emergency-contacts`, `/dependents` | `nic`, `mobile_phone`, `home_phone`, `phone`, `alt_phone` = non-string (object); `personal_email` = "   " | 422 | **500**. `_phone` / `_nic` in `hr_core/schemas.py:54-66` call `re.match` on non-strings (TypeError, not ValueError); whitespace email hits "Unable to apply constraint 'max_length' to None" | Medium |
| 5 | Validation 500 | `GET /purchasing/grn`, `/purchasing/invoices`, `/purchasing/supplier-advances`, `/purchasing/supplier-payments`, `/warehouse/transfer-notes`, `/inventory/sales-stock/paginated` | `date_from`/`date_to` = `%`, `_`, `abc`, `' OR 1=1 --` | 422 | **500** (`fromisoformat`/`strptime` on raw `str` query params; sales-stock passes the string to SQL: `date >= character varying`). Params are typed `Optional[str]` in purchasing/api.py:1218/1477/1898/2133, invoice_api.py:91, warehouse/api.py:122, inventory/api.py:290 | Medium |
| 6 | Bug | `GET /sales/returns/list?search=…` | any search text | results | **500** `SaleReturn has no attribute 'invoice_no'` (sales/service.py:250). Latent: no page calls `saleReturnsApi.getPaginated` today | Medium |
| 7 | Race / uniqueness | `POST /customers/coupons/` | 5 parallel creates: `X`, `x`, ` X `, `X  `… | 1 × 201 | **2 × 201** — service check is `upper()`, DB constraint is plain case-sensitive `UNIQUE(cupon_code)`; POS lookup is exact match, so each case-variant has its own usage limit | Medium |
| 8 | UI double submit | Sales › Coupons › Add, Save | double-click Save | 1 POST | 2 POSTs: 201 then 409 → user sees "created" **and** "A duplicate record was detected". Saved only by the unique code; same missing in-flight guard on a form without a unique key would duplicate. (Customer Save is guarded: 1 POST.) | Medium |
| 9 | Branch scope | `/finance/accounting/posting-failures`, `/recurring-journals`, `/cost-centers`, `/bank-accounts`, `/common/locations` (+`/{id}`) | Branch-limited user | Own branch | Other branches' rows visible (cost centers/bank accounts may be company-wide by design — confirm) | Medium |
| 10 | FK not validated | `POST /finance/bank-deposits`, `/finance/cheque-payments`, `/finance/accounting/cost-centers`, `/bank-accounts` | `branch_code` = random / "ZZQA" | 400 unknown branch | 201 — money documents saved against a branch that doesn't exist | Medium |
| 11 | RBAC | `/finance/accounting/cost-centers`, `/common/locations`, `/common/reference-data` | User whose role has **no** permissions | 403 / empty | 200 with all rows (cost centers, every branch's locations, all branches) | Low |
| 12 | Errors | All unhandled exceptions | any 500 | JSON 500 | JSON 500 is sent, then Starlette re-raises ("Exception in ASGI application") and uvicorn drops the keep-alive connection → the *next* request on that connection fails with a network error (seen as ReadError in sweeps) | Low |
| 13 | Stability | `GET /auth/passcode/status`, `POST /auth/login` | Sweep / 5-VU load | < 1 s | Two stalls of **exactly 60 s** (passcode status during RBAC sweep; one login at 5 VUs); not reproducible alone (0.04–0.2 s, 8 in parallel). Watch `pg_stat_activity` lock waits during a load run | Low |
| 14 | Validation | Many text fields (bank deposit remarks/payment_for, cheque payment_for, payment-card / CoA / cash-flow / email-template descriptions) | 10,000 chars | 422 at a sane limit | Accepted (unbounded text) | Low |
| 15 | Validation | ~35 update endpoints (employees, company settings, branches, bank accounts, fixed assets…) | whitespace-only strings | 422 or trimmed→null | Stored as "   " | Low |
| 16 | UI validation | Add Customer | Name "    ", Email "abc@" | Field flagged in form | Not checked client-side; API 422 message shown as toast, field not highlighted | Low |
| 17 | Feature gap | Finance › Payment Vouchers | open page | working screen | Banner: "not yet implemented… placeholder" but listed in menu | Low |
| 18 | Perf (UI) | Sales Returns, Sales Orders | open page | list in < 2 s | List waits for reference data (branches + all products) → 4–6 s; Sales Orders loads all invoices (`limit=1000`) client-side | Low |
| 19 | Headers | API | — | prod hardening | `/docs` always enabled (`main.py:56`), no CSP/HSTS (fine if the reverse proxy adds them), `server: uvicorn` | Low |
| 20 | UI | Warehouse › Sales Track | open page | — | React warning `<div>` inside `<p>` | Low |

## What passed

- **Smoke:** ~140 routes in Sales, Purchasing, Finance (45), Warehouse, Manufacturing, Support, HR (19), Reporting, admin pages — 0 console errors, 0 failed API calls, no blank pages (after waiting for slow loads). Old `/reporting/<module>` routes redirect to the Report Center.
- **AuthN:** all 796 operations return 401/403 without a token and with a forged token (only passcode-login and logout are public, by design).
- **RBAC:** a role with no permissions gets 403 on every GET except own profile/preferences/notifications and finding #11.
- **Branch scope by id:** sales invoices, POs, GRNs, transfer notes, receive notes, payments of another branch are not readable (only the paths in #2/#3/#9 leak).
- **Mass assignment:** extra `id`, `created_by`, `is_superuser`, `status`, `approved`, `paid_amount`, `customer_no` on 108 create endpoints are ignored (only `branch_code` echoed, see #10).
- **Injection:** SQL-ish strings in every search/filter parameter never reached SQL as code (only the date crashes in #5). XSS payloads already stored in currencies, locations, bank accounts, CoA render as text on 9 pages; no dialog fired, no live `onerror`/`script` nodes.
- **CSV formulas:** server export (`/customers/export-csv`) and grid Export both prefix `'` (`'=HYPERLINK(…)`).
- **CORS / headers:** foreign origin refused; `nosniff`, `X-Frame-Options: DENY`; 404 bodies leak nothing.
- **Races (API, scratch):** approve same SO ×10 → 1×200, 9×400, one revenue + one COGS journal; cancel ×6 → 1×200; settle full balance ×6 → 1×200 (paid = total); supplier invoice pay ×6 → 1×201, balance 0; same coupon code ×10 → 1×201.
- **Form validation (UI):** every Add form (Quotation, Sale Return, Customer, Coupon, Voucher, PO, GRN, Purchase Invoice) blocks an empty Save with no request sent and highlights the required fields. Customer: phone too short/long rejected, name capped at 255. Coupon: 0 %, −5 %, 150 %, per-customer > total, past date, negative minimum all rejected with clear messages; usage 0 auto-corrected to 1.
- **CRUD (UI, scratch):** coupon create → edit → found in list with edited values; customer create.

## Load test (scratch DB, 4 workers, pool 10+10/worker, client on same laptop, think time 0.2–0.8 s)

Mix: 20 read endpoints across all modules (~95 %), customer creates (~4 %), logins (~1 %). Raw output: `backend/loadtest/qa_load_results_2026-11-05.txt`.

| Step | Requests | Throughput | 5xx / timeouts | p50 range | p95 range | Slowest |
|---|---|---|---|---|---|---|
| 5 VUs, 2 min | 796 | 6.6 req/s | 1 (0.13 %: one 60 s login) | 43–835 ms | 70–903 ms | PO list p50 605 ms; outstanding supplier invoices p99 30.7 s (one spike) |
| 25 VUs, 2 min | 4,044 | **33.7 req/s** | **0** | 83–990 ms | 237–1,801 ms | PO list p50 953 ms / p95 1.6 s, login 1.0 s (bcrypt) |
| 50 VUs, 2 min | 3,795 | 31.6 req/s (saturated) | 5 (0.13 %, dropped connections) | 593–2,173 ms | 2.1–4.2 s | login 2.2 s, PO list 1.8 s / p95 3.3 s, outstanding invoices 1.2 s |

**Reading:** the server tops out at ~32 req/s on this laptop between 25 and 50 VUs; every endpoint has p95 > 1 s at 50 VUs. The purchase-order list is the heaviest read (0.54 s and 45 KB for 50 rows on an idle server — check for per-row queries). No application errors during the load run.

## QA data

- **Dev DB `erp_db`:** 1 customer created through the dev UI by the field test "name 300 chars" — name `QA-xxx…` (255 chars), contact +94 77 123 4567. Nothing else was written to dev.
- **Scratch DB `erp_qa`:** everything else (fuzz rows, QA coupons/customers incl. ~366 `QA-Load …` customers, users `qa-noperm-*`, `qa-scope-*`, `qa-pc-*` and roles `QA-NoPerm-*`, `QA-Scope-*`, approvals/cancels/payments from the race tests). Disposable — drop with `DROP DATABASE erp_qa` in container `erp_postgres2`.

## Not covered

- Field-by-field UI entry was done on Customer and Coupon only; the other ~25 create forms got the empty-submit check in the UI and per-field fuzzing at the API only.
- UI double-click Save tested on Coupon and Customer only.
- Multi-step document flows in the UI (quotation → SO → delivery → return, PO → GRN → invoice → payment, ITN send/receive, payroll) were not walked end to end; stock integrity (#3) not checked.
- Session/idle timeout, mobile layout (390 px), accessibility.
