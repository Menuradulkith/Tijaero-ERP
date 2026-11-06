# Manufacturing for Sri Lankan factories — build + check (2026-11-06)

Scope agreed with the user (IFS used only for ideas, kept simple): A bug fixes, B yield & scrap, C batch & expiry,
D quality hold, E outside work, F by-products, G same UI as the rest of the ERP. Decimal quantities were deliberately
left out (stock is whole units across sales / POS / purchasing; stock small items in g / ml instead).

## What changed

| Area | Change |
|---|---|
| Fixes | Expired lots are never issued and don't count as free stock or MRP supply. Good + scrap share one cap (was two separate caps, up to 2x planned). A product that gets its first active BOM and has no stock moves from serial to batch tracking (no more one stock row per bun). Dashboard work-center load is limited to the user's branches. "Complete" can skip booking planned time. Output receipts are linked to their stock rows (`sales_stock.production_output_id`) instead of matching by timestamp. "Update product cost" asks first and shows old -> new cost. |
| B Yield & scrap | BOM `overproduction_pct` (copied to the order): good + scrap may reach planned x (1 + %). Scrap needs a reason (burnt, damaged, failed quality, expired, machine fault, other). Orders show yield % and scrap value. |
| C Batch & expiry | Product `shelf_life_days` sets the finished batch's expiry. Each material issue stores the lots it took; **Manufacturing -> Batch Trace** shows, for a finished batch, the component lots used, and for a raw-material lot, every order and finished batch that used it (older orders fall back to the stock rows they consumed). |
| D Quality hold | Product `requires_qc`: output stock is frozen (not sellable) until a quality decision. Passed -> available (or reserved for the order's quotation line); failed -> damaged and written off (Dr 5030 / Cr 1210). Approvers decide. |
| E Outside work | Work center "Outside work (another company)" + supplier; BOM operation price per unit. Receiving outside work posts Dr 1230 WIP / Cr 5040 and raises a **pending expense** (category outside_work, account 5040) for the subcontractor's bill, so bill and absorbed cost meet on 5040. Time can't be logged on outside steps. WIP and variance reports have an "Outside work" column. |
| F By-products | BOM by-products (e.g. bread crumbs, poonac, regrind) are received with the output at their standard cost into stock; the main product's rolled-up cost is reduced by their value. |
| G UI | Production orders, BOMs, work centers, job cards, MRP, reorder rules: standard search/filter header, side panels instead of pop-ups, double-click guards. New Batch Trace page. Products: "Manufacturing" section (shelf life, quality hold). |

Migration `s130_mfg_sri_lanka`. Memory note updated (`manufacturing-module`).

## Checks

- **Backend tests:** new `tests/test_mfg_sri_lanka_2026_11_06.py` (16 tests: expired lots, shared cap + tolerance, scrap reason, batch tracking switch, planned-time option, dashboard scope, shelf life, trace both ways, QC pass/fail + GL, outside work GL + expense + time-log refusal, close with outside cost, by-products stock/GL/rollup, API permissions). Manufacturing, planning and report suites: all pass (old tests updated for the scrap reason and the shared-cap message). Related suites (lots, GL regenerators, posting rules): 219 of 220 pass; the failure is `test_qa_audit_fixes_2026_11_03_finance::test_fin14_deposit_maker_checker` ("deposit exceeds cash on hand") — not touched here, likely from other uncommitted finance changes.
- **Frontend:** `tsc` 0 errors; eslint 0 errors (7 old warnings in ProductsPage).
- **Browser (5173 -> backend 8021 with the new code):** all 8 manufacturing pages load with no console errors or failed API calls, no horizontal overflow at 1440. Record Output panel: scrap reason becomes required when scrap > 0, the shared-cap message shows, submit stays disabled. Batch Trace on KIT-001 shows the order, finished batches and component lots. Work center outside switch + supplier, BOM tabs / tolerance / outside and by-product costs, product shelf-life and QC fields present.
- **Not checked in the browser:** submitting QC decisions, outside-work receipts and by-product output end to end (covered by backend tests only); 390 px layout.

## Notes
- Ports 8020 / 3001 / 8030 are held by processes started outside this session (old code / another backend). A `frontend-5173` launch config (-> 8021) was added to `.claude/launch.json` for testing.
- Nothing committed.
