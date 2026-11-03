"""Branch scope on per-employee HR records (QA 2026-11-03): a user limited to one branch must not read or
change another branch's payroll records, salary profiles and history, deductions, promotions, asset
assignments or loans, nor file claims / attendance for another branch's employee by tagging their own branch."""
from datetime import date

import pytest

HR = "/api/v1/hr"
TODAY = date.today()
PERMS = [(r, a) for r in ("hr_dashboard", "deductions", "payroll", "salary_profiles", "promotions", "hr_assets", "reimbursements",
                          "attendance") for a in ("view", "create", "update", "delete")]


@pytest.fixture
def two(db, make_branch, make_employee):
    mine, other = make_branch(), make_branch()
    a, b = make_employee(), make_employee()
    a.branch_code, b.branch_code = mine.branch_code, other.branch_code
    db.flush()
    return mine, other, a, b


@pytest.fixture
def limited(make_user, api, superuser, two):
    """Switch the shared test client to a user limited to the first branch (call after seeding)."""
    _, tok = make_user(permissions=PERMS, branches=[two[0]])
    yield lambda: api(tok)
    api(superuser[1])


def _seed(c, e):
    """One record of each kind for employee `e` (as superuser); returns their ids."""
    ids = {}
    r = c.post(f"{HR}/salary-profiles", json={"employee_id": e.employee_id, "basic_salary": 80000, "allowances": []})
    assert r.status_code == 201, r.text
    ids["profile"] = r.json()["id"]
    r = c.post(f"{HR}/deductions", json={"employee_id": e.id, "reason": "scope test", "amount": 10})
    assert r.status_code == 201, r.text
    ids["deduction"] = r.json()["id"]
    r = c.post(f"{HR}/promotions", json={"employee_id": e.employee_id, "designation": "Lead", "appointed_date": TODAY.isoformat()})
    assert r.status_code == 201, r.text
    ids["promotion"] = r.json()["id"]
    r = c.post(f"{HR}/loans", json={"employee_pk": e.id, "amount": 3000, "installments": 3, "issue_date": TODAY.isoformat(),
                                    "start_period": TODAY.strftime("%Y-%m")})
    assert r.status_code == 201, r.text
    ids["loan"] = r.json()["id"]
    return ids


class TestPerEmployeeRecords:
    def test_lists_only_show_own_branch(self, superclient, two, limited):
        mine, other, a, b = two
        own, foreign = _seed(superclient, a), _seed(superclient, b)
        c = limited()
        for path, key, field in [("/salary-profiles", "profile", "id"), ("/deductions?limit=5000", "deduction", "id"),
                                 ("/promotions?limit=5000", "promotion", "id"), ("/loans", "loan", "id")]:
            got = {r[field] for r in c.get(HR + path).json()}
            assert own[key] in got, path
            assert foreign[key] not in got, path

    def test_other_branch_records_are_refused(self, superclient, two, limited):
        mine, other, a, b = two
        f = _seed(superclient, b)
        c = limited()
        for path in [f"/salary-profiles/{f['profile']}", f"/deductions/{f['deduction']}", f"/promotions/{f['promotion']}",
                     f"/loans/{f['loan']}", f"/employees/{b.employee_id}/salary-profile", f"/employees/{b.employee_id}/salary-revisions"]:
            assert c.get(HR + path).status_code == 403, path
        assert c.put(f"{HR}/deductions/{f['deduction']}", json={"employee_id": b.id, "reason": "x", "amount": 1}).status_code == 403
        assert c.delete(f"{HR}/promotions/{f['promotion']}").status_code == 403
        assert c.post(f"{HR}/loans/{f['loan']}/repay", json={"amount": 1}).status_code == 403

    def test_cannot_create_for_another_branch_employee(self, superclient, two, limited):
        mine, other, a, b = two
        c = limited()
        assert c.post(f"{HR}/deductions", json={"employee_id": b.id, "reason": "x", "amount": 1}).status_code == 403
        assert c.post(f"{HR}/promotions", json={"employee_id": b.employee_id, "designation": "x",
                                                "appointed_date": TODAY.isoformat()}).status_code == 403
        assert c.post(f"{HR}/salary-profiles", json={"employee_id": b.employee_id, "basic_salary": 1}).status_code == 403
        # moving an own-branch record onto another branch's employee is refused too
        own = superclient.post(f"{HR}/deductions", json={"employee_id": a.id, "reason": "x", "amount": 1}).json()
        assert c.put(f"{HR}/deductions/{own['id']}", json={"employee_id": b.id, "reason": "x", "amount": 1}).status_code == 403
        assert c.post(f"{HR}/deductions", json={"employee_id": a.id, "reason": "x", "amount": 1}).status_code == 201

    def test_statistics_count_own_branch_only(self, superclient, two, limited):
        mine, other, a, b = two
        _seed(superclient, a)
        _seed(superclient, b)
        all_stats = superclient.get(f"{HR}/statistics").json()
        mine_stats = limited().get(f"{HR}/statistics").json()
        assert mine_stats["total_deductions"] < all_stats["total_deductions"]
        assert mine_stats["total_employees"] < all_stats["total_employees"]


class TestTaggingOwnBranchIsNotEnough:
    def test_claim_for_other_branch_employee(self, two, limited):
        mine, other, a, b = two
        body = {"employee_id": b.employee_id, "branch_code": mine.branch_code, "claim_date": TODAY.isoformat(),
                "items": [{"expense_type": "transport", "amount": 10}]}
        c = limited()
        assert c.post(f"{HR}/reimbursements", json=body).status_code == 403
        assert c.post(f"{HR}/reimbursements", json={**body, "employee_id": a.employee_id}).status_code == 201

    def test_check_in_for_other_branch_employee(self, two, limited):
        mine, other, a, b = two
        c = limited()
        assert c.post(f"{HR}/attendance/check-in", json={"employee_id": b.employee_id, "branch_code": mine.branch_code}).status_code == 403
        assert c.post(f"{HR}/attendance/check-in", json={"employee_id": a.employee_id, "branch_code": mine.branch_code}).status_code == 200


def test_list_names_come_from_one_lookup(superclient, two, db):
    """Profile / attendance / leave lists still carry the employee name after the bulk lookup."""
    mine, other, a, b = two
    superclient.post(f"{HR}/salary-profiles", json={"employee_id": a.employee_id, "basic_salary": 1000})
    row = next(p for p in superclient.get(f"{HR}/salary-profiles").json() if p["employee_id"] == a.employee_id)
    assert row["employee_name"] == "Test User"
    superclient.post(f"{HR}/attendance/check-in", json={"employee_id": a.employee_id, "branch_code": mine.branch_code})
    att = superclient.get(f"{HR}/attendance", params={"employee_id": a.employee_id}).json()
    assert att and att[0]["employee_name"] == "Test User"
    s = superclient.get(f"{HR}/attendance/summary", params={"date_from": TODAY.isoformat(), "date_to": TODAY.isoformat(),
                                                             "employee_id": a.employee_id}).json()
    assert s["total_records"] == 1 and s["total_present"] == 1
