# Manufacturing module QA — 2026-10-26

Tooling: the Playwright MCP timed out connecting, so I used the skill's fallback: direct API calls from the built-in browser (admin token, plus minted tokens for `qa-none`, `qa_sm_a1`, `qa_adm_a`) and the built-in browser for UI checks. Local dev only. Fixed nothing.

## Findings
| Area | Endpoint / page | Input | Expected | Actual | Severity |
|---|---|---|---|---|---|
| Time logs | `POST /orders/{id}/time-logs` | `start_time` 2026-10-26, `end_time` 2999-10-26 (no `minutes`) | Reject: end in the future, cap like `minutes` (<= 100000) | 200. Minutes are derived from the timestamps, so the 100000 cap is bypassed. Labour of Rs. 10,234,972,900 and WIP of Rs. 14.5 billion were posted to the GL (Dr 1230 / Cr 5040) and the dashboard | **High** |
| Time logs | same | `completed_quantity: 99999` on a 3-unit order | Reject above planned/remaining quantity | 200. Operation shows 199,998 done | **High** |
| Output / complete | `POST /orders/{id}/output`, `/complete` | Order whose BOM items are `issue_method: manual`, nothing issued | Block output (or completion) until the required materials are issued | 200 and 200. Finished stock (serials, Rs. 50 each) and Dr 1210 / Cr 1230 are posted from nothing; WIP goes negative and the order completes with `material_status: shortage`. Backflush items are checked (400 "Not enough ..."), manual ones are not | **High** (inventory and WIP overstated) |
| Output | `POST /orders/{id}/output` | `quantity: 1, scrap_quantity: 99999` on a 2-unit order | Cap scrap (or good + scrap) at the order quantity | 200. `scrapped_quantity` = 99999; skews the scrap rate | Medium |
| AuthZ / IDOR | `GET/PUT/DELETE /work-centers/{id}`, `POST /work-centers` | `qa_adm_a` (branch QA-BR-A only) vs a QA-B2 work center | 403 like orders (`_order_access`) | 200: read, renamed (restored afterwards), and created a QA-B2 work center. By-id routes and create have no `validate_branch_access`; the list is branch-scoped | Medium |
| Dates | `POST /orders` | start/end 2020-01-01 and 2999-01-01 | Reject or warn on absurd dates | 201 | Low |
| Validation | `POST /orders` | `bom_id` of an inactive/draft BOM was not tested (only a BOM of another product -> 400) | - | - | Info |
| Reports | `POST /reporting/center/reports/manufacturing.production_summary/run` | `branch_code: ZZZ` | 4xx unknown branch | 200 with empty result | Low |
| UI | Order detail | order with booked time | "Cancel Order" hidden or disabled | Button is shown; API answers 400 "Time has been booked..." | Low |
| Dashboard | `/manufacturing` | - | - | Calls `/reporting/dashboard` twice on load; pre-existing WIP of -5,024.51 (output booked ahead of materials, same cause as the third finding) | Info |
| Print | `TPrintButton` | - | - | Shared component puts `?token=` in the print URL (not manufacturing-specific) | Low |

## Passed
- All 7 pages load with data, no error toasts, no failed API calls, no stuck spinner. All endpoints 401 without a token.
- `qa-none` and `qa_sm_a1` (sales manager) get 403 on all 29 endpoints tried, reads and writes. `qa_adm_a` is blocked from other-branch orders (GET, create), as well as from MRP and reorder rules.
- Validation (clean 4xx, never 500): ~120 cases across work centers, BOMs (qty/scrap/output/version/length, self-component, duplicate component, bad FK, int overflow), orders (qty, dates, priority, bad branch/product/BOM/location, 5k/10k-char text), issue/return/output/time-log quantities (zero, negative, decimal, 1e12, 2^40, 'abc', NaN, serial count mismatch), reorder rules (min > max, multiple 0, bad supplier), MRP firming (empty lines, bad qty/price/date/branch/supplier).
- Mass assignment (`status`, `id`, `is_default`, `order_no`, `produced_quantity`, `created_by`) ignored.
- Races: 8x identical and 8 case/space variants on work centers (1x201), BOM version (1x201, rest 400/409), reorder rule (1x201). No 5xx. Case-insensitive duplicate scan of work centers: 0.
- Status machine: release/start/complete/close/delete/edit out of order all refused with a clear message; BOM loop (A uses B, B uses A) is caught at activation.
- Double-click Save on Work Center: 1 POST, 1 record, 1 toast. Empty submit highlights 8 fields.
- XSS strings in names, remarks and descriptions render as text; no dialog.
- Reports: all 5 run; WIP report reconciles to GL 1230 (both Rs. 14,499,539,767.15 while my bad data existed, back to equal after cleanup).

## Phases run / not run
- Smoke: run. Field validation and security (1b): run (API level; UI forms only for Work Center and the Add/empty-submit paths). Duplicates and races: run for work centers, BOMs and reorder rules; **not run** for issue/output/complete/close concurrency (no component stock in the QA branches to issue). Load: not run.
- Not covered: UI create flows for BOM, Production Order and Reorder Rule (autocomplete pickers), mobile layout, MRP "create POs" happy path (it creates real POs), print previews, cross-branch authZ for reorder rules and MRP (qa_adm_a lacks those permissions).

## Optional checks
1 Workflow and status transitions: run (statuses and approvals). 2 Accounting integrity: run (journal entries balanced, WIP report = GL 1230, before and after cleanup). 3 Stock integrity: run partly (phantom output stock found; no component stock to test issue/return). 4 Calculation accuracy: skipped (standard-cost maths not recomputed). 5 Approval matrix: skipped (release/complete use a permission, no maker/checker rule). 6 Reports and exports: run (5 reports). 7 Pagination/sort/filter: skipped (lists under 10 rows). 8 Data lifecycle: run partly (work center used by a BOM cannot be deleted; non-draft BOM cannot be deleted). 9 Time and locale: skipped. 10 Accessibility: skipped. 11 Session behavior: skipped. 12 Resilience: skipped. 13 Regression pinning: skipped (nothing fixed). 14 Visual regression: skipped.

## QA data
Removed: draft orders 225/226, reorder rules 14-16, BOMs 344-346/347/350/354/355 (drafts) and 345, work centers 334-338. Removed with a guarded script (dry run first, FK-dependents check, QA-B2 order numbers only): orders 227/228/229 with their 7 journal entries (Rs. 14,499,545,091.66 each side), 14 ledger rows, 3 stock rows, 4 time logs, 3 outputs. The dashboard WIP is back to the pre-existing -5,024.51.
Remaining (no delete for non-draft): BOM 353 `QA-CY1` (archived). Order numbers MO-QA-B2-26000001 to 26000005 were consumed.
