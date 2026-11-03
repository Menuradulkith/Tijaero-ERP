# HR module — security, races and load (2026-11-03)

Scope: every HR endpoint (110 paths: `/hr/*`, `/employees/*`, `/reporting/hr`), API-level, plus the new loan UI guard (code review).
Accounts: `admin` (superuser), `qa-none` (no permissions), `qa-hr-d1` (new QA role **QA-HR-Scope** with all 60 HR permissions, branch **QA-D1** only).
Targets: other-branch records belong to `QA-qa-viewer` (QA-B1).

**Phases run:** security (authZ, branch scope / IDOR, mass assignment, injection, uploads), duplicates & races (API bursts), load (scratch DB copy).
**Not run:** smoke and field validation (done 2026-11-02, see `hr-2026-11-02.md`); UI double-click checks (the browser pane could not draw — Loans guard checked by code review only).

**Optional checks:** #1 workflow run (leave apply→approve→cancel, claim approve/reject, separate→reinstate); #5 approval matrix partly (approve vs reject race);
#2 accounting skipped (no payments posted — forbidden on dev, and the load DB is throwaway); #3 stock skipped (trigger not met); #4 calculation skipped (done 2026-11-02);
#6 reports/exports partly (statutory CSV timing under load); #7 pagination run (unbounded lists found by load test); #8 lifecycle run (separate/reinstate race);
#9–#12, #14 skipped (trigger not met); #13 regression pinning skipped (no fixes made yet — add tests with the fixes).

## Findings

| # | Area / endpoint | Status | Finding | Severity | Repro |
|---|---|---|---|---|---|
| 1 | Payroll records, salary profiles, salary revisions, deductions, promotions, asset assignments, loans, HR statistics | Issue | **No branch scope.** A user limited to QA-D1 can list and open other branches' payroll records (salaries), payslips' source data, loans, salary history; and **create** deductions and promotions for another branch's employee (`POST /hr/deductions` employee 4192 → 201, `POST /hr/promotions` QA-qa-viewer → 201). Lists return every branch (`/hr/payroll` 2/2, `/hr/loans` 5/5 foreign rows). Services `SalaryDeductionService`, `PayrollService` (records), `SalaryProfileService`, `PromotionService`, `EmployeeAssetService`, `LoanService`, `HRStatisticsService` never receive `allowed_branches`. Payroll **batches** are company-wide by design; the per-employee records are not. | High | qa-hr-d1: `GET /hr/payroll/778`, `GET /hr/loans/17`, `GET /hr/employees/QA-qa-viewer/salary-revisions` → 200 |
| 2 | Reimbursements — create | Issue | Branch check is on the claim's `branch_code` only, not on the employee: qa-hr-d1 filed a claim for QA-B1's employee by tagging it QA-D1 (201). Tagging QA-B1 is correctly refused (403). | Medium | `POST /hr/reimbursements {employee_id: QA-qa-viewer, branch_code: QA-D1}` |
| 3 | Attendance — check-in | Issue | Same pattern: qa-hr-d1 checked in QA-B1's employee by sending `branch_code: QA-D1` (200). Leave apply for that employee is correctly refused (403 "Access denied to branch: QA-B1"). | Medium | `POST /hr/attendance/check-in {employee_id: QA-qa-viewer, branch_code: QA-D1}` |
| 4 | `GET /hr/salary-profiles` | Issue | Unpaginated and N+1: loads every profile, then 2 queries per row for the employee name (`_resolve_employee_name`). 2,000 profiles = 630 KB, **6–12 s for one user, p50 12 s / p95 18 s at 5 users** — the slowest HR call by far. | High (perf) | Load test, scratch DB with 2,000 profiles |
| 5 | `POST /hr/payroll/run` (2,000 employees) | Issue | **45 s** for one run on an idle server (gunicorn timeout in prod is 120 s, so ~5,000 employees would time out). Response is the whole batch (2.4 MB). | Medium (perf) | Scratch DB, Nov-2026 run |
| 6 | `GET /hr/payroll/batches/{id}` and statutory CSVs | Issue | Batch detail with 2,000 records: 8.9–10.4 s, 2.4 MB, no paging. EPF CSV 3.8 s, bank CSV 4.4–6.1 s. | Medium (perf) | Same batch |
| 7 | `GET /hr/attendance`, `/hr/attendance/summary`, `/hr/leaves` | Issue | Slow already at 5 users with 40k attendance / 2k leaves: attendance list p50 1.3 s (p99 5.6 s), summary p50 1.3 s, leaves p50 0.7 s. | Low (perf) | Load test |
| 8 | Statutory CSV injection (from 2026-11-02, finding #2) | Open | Still not neutralised (no code change since). | Medium | see `hr-2026-11-02.md` |

### What worked (OK)
- **AuthN/authZ:** every method on all 110 HR paths returns **401** without a token and **403/404** for `qa-none` — no anomalies, no 5xx.
- **Branch scope that does work:** employees list (qa-hr-d1 sees 1 of 46), employee detail and every employee sub-record (contacts, dependents, documents, tasks, education), final settlement, leave balances, leave apply, reimbursements list/by-id, claims tagged with a foreign branch, document download through another employee's path (403).
- **Mass assignment:** leave created with `status: approved` stays `pending`; claim created with `status: paid, approved_amount: 999, approved_by: 1` stays `pending` with nulls.
- **Injection:** 200-char code and 10k-char name rejected with 4xx; XSS payloads stored as text (rendering was checked on 2026-11-02).
- **Uploads:** exe, html, svg rejected (type allow-list); `cv.pdf.exe` and an HTML body named `.pdf` rejected (content sniffing); 25 MB rejected (5 MB cap); a `../../../../etc/passwd.pdf` name is stored under a random UUID; replacing a file deletes the old one; download sends `attachment` + `nosniff`.
- **Races (all clean, no 5xx):** 6× same leave application → 1×201 + 5×400; 6× approve same leave → 1×200 + 5×400; 6× cancel approved leave → 1×200 + 5×400; 4× approve + 4× reject same claim → 1×200 + 7×400 (final status approved); 6× check-in → 1×200 + 5×400 ("Already checked in"); 6× check-out → 6×200 on one row (last write wins, harmless); 6× create salary profile for one employee → 1×201 + 5×400 (advisory lock); 8 department code variants and 8 name variants (case/space) → 1×201 + 7×400 each; 5× generate leave allocations → 1×200 + 4×409, no duplicate rows; 5× separate → 1×200 + 4×409; 5× reinstate → 1×200 + 4×400.
- Earlier races still hold (2026-11-02): loan repay/cancel bursts, lieu grants.
- **Loans UI double-click (finding #1 of 2026-11-02):** issue/repay/plan/cancel now each use `isPending` + a ref set synchronously before the request (LoansPage.tsx:150-178). Not clicked in a browser.

## Load test

Target: a **scratch copy** of the dev DB (`erp_load` in the same Docker Postgres), seeded to 2,046 employees (users, branches QA-D1/B1/D2), 2,001 salary profiles, 40k attendance rows (Oct-2026 weekdays), 2k leaves. Backend on :8030 with **4 uvicorn workers** (production uses 4), DB pool 10+10 per worker, login rate limit raised for the test.
Client: async httpx on the **same machine** (Windows laptop), think time 0.2–0.8 s; mix ≈ 90 % reads over 14 HR list/detail endpoints, 6 % leave applications, 3 % check-ins, 1 % logins; 2/3 of virtual users are branch-limited, 1/3 superuser.
Ramp 5 → 25 → 50 VUs, 2 min each; stop on > 5 % 5xx/timeouts.

| Step | Requests | Throughput | 5xx / timeouts | Notes |
|---|---|---|---|---|
| 5 VUs | 319 | 2.6 req/s | 0 % | salary profiles p50 12 s already |
| 25 VUs | 761 | 5.5 req/s | 0.66 % | throughput barely grows: workers busy with salary-profile calls |
| 50 VUs | 1,039 | 5.8 req/s | **34 %** — stopped | 52 client timeouts (60 s) on salary profiles, the rest **503 "server busy"** from the admission control (`app/core/admission.py`, 32 in-flight per worker) for every endpoint |
| 50 VUs **without** salary-profile calls | 2,153 | **17.3 req/s** | **0 %** | proves the profile list is what saturates the server |

Latency at 50 VUs, full mix (ms):

| Endpoint | p50 | p95 | p99 | 5xx/timeouts |
|---|---|---|---|---|
| salary profiles | 37,797 | 60,027 | 60,062 | 52 timeouts + 17×503 |
| attendance list | 4,782 | 16,240 | 20,796 | 20×503 |
| leaves list | 2,251 | 13,671 | 19,361 | 41×503 |
| attendance summary | 2,036 | 8,077 | 21,814 | 18×503 |
| login (bcrypt) | 1,062 | 3,002 | 3,413 | 2×503 |
| apply leave | 434 | 3,531 | 9,214 | 17×503 |
| employees paged / search | 366 | 3,208–6,904 | ~15,000 | 86×503 |
| other HR lists and reports | 240–430 | 1,800–10,300 | 10,500–15,600 | 5–22×503 each |

Latency at 50 VUs **without** salary profiles (ms): attendance list p50 9,660 / p95 14,557; leaves list 5,126 / 8,549; attendance summary 2,968 / 7,496; everything else p50 400–750, p95 1,700–3,300; no errors.

**Why:** the same N+1 helper `_resolve_employee_name` (2 queries per row: employee + user) runs for every row of the salary-profile list (all rows, unpaginated), the attendance list (200 rows → 400 extra queries) and the leaves list (100 rows → 200). Indexes on `employee_id`/`date`/`status` exist, so a join or one bulk name lookup per page fixes it. After that, paging the salary-profile list and the batch detail, and making the payroll run batch its queries, are the next steps.

Caveats: client and server on one laptop; pool 10+10 per worker (prod default 20+20); dataset is cloned rows, so string-heavy columns are uniform. The 503s are the intended overload behaviour — clean and retryable, no 500s anywhere.

Heavy single operations (idle server):

| Operation | Time | Size |
|---|---|---|
| Payroll run Nov-2026, 2,000 employees | 44.8 s | 2.4 MB |
| Batch detail, 2,000 records | 8.9 s | 2.4 MB |
| EPF Form C CSV | 3.8 s | 92 KB |
| Bank transfer CSV | 4.4 s | 59 KB |
| Batch cancel | 0.2 s | — |
| Salary profiles (all) | 8.6 s | 631 KB |
| Employees paged, size 100 | 53 ms | 50 KB |
| Report Center HR payroll summary | 55 ms | — |

## Fixes (same day)

| Finding | Fix | Verified |
|---|---|---|
| 1 Branch scope | New `app/modules/hr/scope.py` (`branches_of`, `scope`, `need_employee`, `need_row`). Lists of payroll records, salary profiles, deductions, promotions, asset assignments and loans filter by the employee's home branch; every by-id read/update/delete/repay/cancel and every create checks the employee's branch (update also checks the new employee). HR statistics are counted per branch (batches stay company-wide). Employees with no branch stay visible to all, as in the employee list. | Live on :8021 as qa-hr-d1: `/hr/payroll` 0 of 2, `/hr/loans` 0 of 5, payroll record / loan / salary profile / salary history of QA-B1 → 403; creating deduction, promotion, salary profile, loan for QA-B1 → 403; authZ sweep still 0 anomalies |
| 2 Claim for another branch's employee | `create_reimbursement` also checks the claimant's branch. | 403 live; own-branch claim 201 (test) |
| 3 Check-in for another branch's employee | `check_in` and manual attendance also check the employee's branch. | 403 live; own-branch check-in 200 |
| 4 Salary profile list N+1 | Names come from one bulk query (`employee_names`); list is branch-scoped. Still returns every profile in scope (no paging, the page filters client-side). | 2,000 profiles: 6–12 s → **0.48 s** |
| 7 Attendance / leaves lists, attendance summary | Same bulk name lookup for the attendance and leave lists; the summary is one SQL aggregate instead of loading up to 100,000 rows (also removes that silent cap). | attendance list 1.3 s → **46 ms**, summary 1.6 s → **64 ms**, leaves 0.44 s → **45 ms** |

Regression tests: `tests/test_hr_branch_scope_2026_11_03.py` (7 tests). With the scope checks disabled 4 of them fail (the claim / check-in tests guard the service-level fixes). HR suite 231 passed; report reconciliation, security fixes, unique indexes and cross-module money audit 53 passed.

**Load test after the fixes** (fresh scratch copy, same seed and mix):

| Step | Requests | Throughput | 5xx / timeouts |
|---|---|---|---|
| 25 VUs | 4,296 | **35.6 req/s** (was 5.5) | 0 (1 client read error) |
| 50 VUs | 7,352 | **60.6 req/s** (was 5.8) | 0 (2 client read errors; was 34 %) |

At 50 VUs every HR endpoint has p50 115–200 ms and p95 620–1,360 ms (salary profiles p50 440 ms / p95 1.4 s; login 0.9 s / 2.7 s, bcrypt). No 503s.

### Payroll run, batch detail and statutory returns (findings 5, 6, 8)

- **Run:** everything looked up per employee is loaded up front: salary revisions in force (`sl_payroll.salaries_for_period`), approved no-pay leave (`_nopay_days` now takes all employees), loan instalments due with balances (`loans.dues_for_period`: one query for loans, one for amounts recovered), employment types. Records are inserted in one batch at the end and loan recoveries written after it, with the loan status set by the same rule as `refresh_status`. Calculations are unchanged.
- **Batch detail / run response:** employee names from one bulk lookup.
- **Returns:** the employee's user is loaded with the row (`joinedload`), instead of one query per name.
- **CSV formulas:** text cells go through the shared `csv_safe` (prefix `'`).

SQL statements per run in tests: ~10 per employee before; now 24 for a run whatever the size (3 → 23 employees, each with a loan); batch detail 5; bank return flat.

Scratch DB, 2,000 employees, 300 with a loan, 200 with no-pay leave, overtime from 46k attendance rows:

| Operation | Before | After |
|---|---|---|
| Payroll run | 44.8 s | **2.8–3.6 s** |
| Batch detail | 8.9–10.4 s | **0.28–0.36 s** |
| EPF / ETF / APIT / bank CSV | 3.8 / – / – / 4.4–6.1 s | **0.13–0.42 s** each |
| Batch cancel | 0.2 s | 0.6–1.6 s (gives 300 loan instalments back) |

Two runs in a row (run → cancel → run) give the same net total (Rs 216,061,525.10): 300 instalments recovered, balances restored by the cancel.
Tests: `tests/test_hr_payroll_run_queries_2026_11_03.py` (query counts flat as employees grow; formula cell neutralised — fails with `csv_safe` disabled). HR + payroll + cross-module money suites: 232 passed.

**Still open:** the dev backend on :8020 is a process started outside this session (system Python) and still runs the old code until it is restarted.

## QA data
- **Dev DB:** everything created by this run was removed (36 rows: claims and their items, leaves and approval rows, departments, promotion, deduction, salary profile and revision, leave allocations 2027, attendance, document and its file, offboarding tasks from the separation race). Left in place: role **QA-HR-Scope** and user **qa-hr-d1** (for re-testing the branch-scope fixes) — remove with a guarded script when done.
- **Scratch DB `erp_load`:** dropped after the test (see below).
