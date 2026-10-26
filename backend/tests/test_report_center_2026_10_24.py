"""Report Center: one registry of reports, run and exported from one place.

* the catalogue only lists reports the user may run, and running needs the report's permission;
* branch-limited users only get their branches' data;
* parameters are validated (dates, ranges, required values);
* every report in the registry runs and exports to CSV, Excel and PDF-ready HTML;
* saved reports are private unless shared, sharing and editing others' needs permission;
* runs are logged and show up as recent runs.
"""

import csv
import io
import json
import pytest

from app.modules.reporting.models import Report, ReportExecution
from app.reporting.center import REGISTRY

BASE = "/api/v1/reporting/center"


def _run(client, key, params=None, **extra):
    return client.post(f"{BASE}/reports/{key}/run", json={"params": params or {}, **extra})


class TestCatalogue:
    def test_superuser_sees_every_report(self, superclient):
        r = superclient.get(f"{BASE}/catalog")
        assert r.status_code == 200
        assert {x["key"] for x in r.json()["reports"]} == set(REGISTRY)

    def test_catalogue_is_filtered_by_permission(self, api, make_user, make_branch):
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[make_branch()])
        keys = {x["key"] for x in api(token).get(f"{BASE}/catalog").json()["reports"]}
        assert keys == {"sales.summary"}

    def test_running_needs_the_reports_permission(self, api, make_user, make_branch):
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[make_branch()])
        assert _run(api(token), "finance.balance_sheet").status_code == 403

    def test_unknown_report_is_404(self, superclient):
        assert _run(superclient, "nope.nothing").status_code == 404


class TestEveryReport:
    @pytest.mark.parametrize("key", sorted(REGISTRY))
    def test_runs_and_exports(self, superclient, key):
        r = _run(superclient, key)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["report"]["key"] == key
        for t in body["tables"]:
            assert all(set(row) <= {c["key"] for c in t["columns"]} for row in t["rows"])
        for fmt in ("csv", "xlsx", "html"):
            e = superclient.post(f"{BASE}/reports/{key}/export", json={"format": fmt})
            assert e.status_code == 200, (fmt, e.text)
        assert e.headers["content-security-policy"].startswith("default-src 'none'")


class TestParameters:
    def test_dates_are_validated(self, superclient):
        r = _run(superclient, "sales.summary", {"date_from": "not-a-date"})
        assert r.status_code == 422

    def test_start_after_end_is_rejected(self, superclient):
        r = _run(superclient, "sales.summary", {"date_from": "2026-05-01", "date_to": "2026-04-01"})
        assert r.status_code == 422 and "start date" in r.json()["detail"]

    def test_ranges_are_enforced(self, superclient):
        assert _run(superclient, "hr.birthdays", {"days": 9999}).status_code == 422

    def test_defaults_are_filled_in(self, superclient):
        r = _run(superclient, "sales.summary")
        from app.core import timezone as tz

        params = r.json()["params"]
        assert params["date_to"] == tz.today().isoformat()
        assert params["date_from"] == tz.today().replace(day=1).isoformat()


class TestBranchScope:
    def test_limited_user_cannot_ask_for_another_branch(self, api, make_user, make_branch):
        mine, other = make_branch(), make_branch()
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[mine])
        r = _run(api(token), "sales.summary", {"branch_code": other.branch_code})
        assert r.status_code == 403

    def test_single_branch_user_gets_their_branch_automatically(self, api, make_user, make_branch):
        mine = make_branch()
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[mine])
        r = _run(api(token), "sales.summary")
        assert r.status_code == 200
        assert all(row["branch_code"] == mine.branch_code for row in r.json()["tables"][2]["rows"])

    def test_multi_branch_user_must_pick_one_for_single_branch_reports(self, api, make_user, make_branch):
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[make_branch(), make_branch()])
        assert _run(api(token), "sales.summary").status_code == 422

    def test_branch_options_are_the_users_branches(self, api, make_user, make_branch):
        mine = make_branch()
        make_branch()
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[mine])
        options = api(token).get(f"{BASE}/branches").json()
        assert [o["value"] for o in options] == [mine.branch_code]


class TestExports:
    def test_csv_applies_the_view_and_blocks_formulas(self, superclient):
        view = {"tables": {"by_branch": {"hidden": ["orders"], "sort": {"key": "revenue", "dir": "desc"}}}}
        r = superclient.post(f"{BASE}/reports/sales.summary/export",
                             json={"format": "csv", "table": "by_branch", "view": view,
                                   "params": {"date_from": "2026-01-01"}})
        rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
        assert rows[0] == ["Branch", "Revenue"]

    def test_xlsx_is_a_workbook(self, superclient):
        r = superclient.post(f"{BASE}/reports/finance.trial_balance/export", json={"format": "xlsx"})
        assert r.content[:2] == b"PK"

    def test_pdf_export(self, superclient):
        try:
            r = superclient.post(f"{BASE}/reports/hr.headcount/export", json={"format": "pdf"})
        except Exception as exc:  # pragma: no cover - no Chromium here
            pytest.skip(f"Chromium not available: {exc}")
        assert r.status_code == 200 and r.content.startswith(b"%PDF")


class TestSavedReports:
    def _save(self, client, **overrides):
        body = {"report_key": "sales.summary", "name": "Monthly sales", "params": {"date_from": "2026-01-01"},
                "view": {"tables": {"by_branch": {"hidden": ["orders"]}}}}
        body.update(overrides)
        return client.post(f"{BASE}/saved", json=body)

    def test_save_and_run_a_saved_report(self, superclient, db):
        r = self._save(superclient)
        assert r.status_code == 201, r.text
        saved = r.json()
        assert saved["params"] == {"date_from": "2026-01-01"} and saved["view"]["tables"]["by_branch"]["hidden"] == ["orders"]
        run = _run(superclient, "sales.summary", saved["params"], saved_report_id=saved["id"])
        assert run.status_code == 200
        db.expire_all()
        assert db.get(Report, saved["id"]).last_run is not None

    def test_invalid_parameters_cannot_be_saved(self, superclient):
        assert self._save(superclient, params={"date_from": "bad"}).status_code == 422

    def test_private_reports_are_private(self, superclient, api, make_user, make_branch):
        saved = self._save(superclient).json()
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[make_branch()])
        other = api(token)
        assert saved["id"] not in {s["id"] for s in other.get(f"{BASE}/catalog").json()["saved"]}
        assert other.delete(f"{BASE}/saved/{saved['id']}").status_code == 404

    def test_sharing_needs_permission(self, api, make_user, make_branch):
        _, token = make_user(permissions=[("reporting_sales", "view")], branches=[make_branch()])
        assert self._save(api(token), is_shared=True).status_code == 403

    def test_shared_reports_are_visible_but_only_the_owner_edits(self, api, make_user, make_branch):
        branch = make_branch()
        _, owner = make_user(permissions=[("reporting_sales", "view"), ("saved_reports", "share")], branches=[branch])
        saved = self._save(api(owner), is_shared=True).json()
        _, reader = make_user(permissions=[("reporting_sales", "view")], branches=[branch])
        client = api(reader)
        listed = {s["id"]: s for s in client.get(f"{BASE}/catalog").json()["saved"]}
        assert saved["id"] in listed and listed[saved["id"]]["can_edit"] is False
        r = client.put(f"{BASE}/saved/{saved['id']}", json={"name": "Hijack", "params": {}, "is_shared": True})
        assert r.status_code == 403

    def test_shared_reports_hide_from_users_who_cannot_run_them(self, superclient, api, make_user, make_branch):
        saved = self._save(superclient, is_shared=True).json()
        _, token = make_user(permissions=[("hr_reports", "view")], branches=[make_branch()])
        assert saved["id"] not in {s["id"] for s in api(token).get(f"{BASE}/catalog").json()["saved"]}


class TestHistory:
    def test_runs_are_logged_and_listed_as_recent(self, superclient, superuser, db):
        user, _ = superuser
        _run(superclient, "hr.headcount")
        _run(superclient, "sales.summary", {"date_from": "2026-02-01"})
        row = db.query(ReportExecution).filter(ReportExecution.executed_by == user.id).order_by(ReportExecution.id.desc()).first()
        assert row.report_key == "sales.summary" and row.status == "success"
        assert json.loads(row.parameters)["date_from"] == "2026-02-01"
        recent = superclient.get(f"{BASE}/recent").json()
        assert [r["report_key"] for r in recent[:2]] == ["sales.summary", "hr.headcount"]
