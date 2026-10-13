"""Core HR: masters, leave policy, employee master, sub-records, reports."""
from datetime import date, timedelta
from io import BytesIO

import pytest

HR = "/api/v1/hr"
EMP = "/api/v1/employees"
LV = "/api/v1/hr/leaves"


def _uid():
    import uuid
    return uuid.uuid4().hex[:8]


def _weekday(offset: int) -> date:
    """The first Mon-Fri on or after today + offset days."""
    d = date.today() + timedelta(days=offset)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


@pytest.fixture
def org(superclient):
    dept = superclient.post(f"{HR}/departments", json={"code": f"D{_uid()}", "name": f"Dept {_uid()}"}).json()
    des = superclient.post(f"{HR}/designations", json={"name": f"Role {_uid()}", "department_id": dept["id"]}).json()
    et = superclient.post(f"{HR}/employment-types", json={"name": f"Type {_uid()}"}).json()
    return {"dept": dept, "des": des, "et": et}


def _new_employee(superclient, make_user, **extra):
    user, _ = make_user()
    r = superclient.post(f"{EMP}/", json={"user_id": user.id, "employee_id": f"E{_uid()}", **extra})
    assert r.status_code == 201, r.text
    return user, r.json()


# ───────────────────────────── masters ─────────────────────────────
class TestMasters:
    def test_department_crud_and_uniqueness(self, superclient):
        code, name = f"D{_uid()}", f"Dept {_uid()}"
        r = superclient.post(f"{HR}/departments", json={"code": code, "name": name})
        assert r.status_code == 201, r.text
        d = r.json()
        assert superclient.post(f"{HR}/departments", json={"code": code.lower(), "name": "Other"}).status_code == 400
        assert superclient.post(f"{HR}/departments", json={"code": "ZZ" + _uid(), "name": f" {name.upper()} "}).status_code == 400
        u = superclient.put(f"{HR}/departments/{d['id']}", json={"code": code, "name": name + " 2", "expected_version": d["version"]})
        assert u.status_code == 200 and u.json()["name"].endswith(" 2")
        assert superclient.put(f"{HR}/departments/{d['id']}", json={"code": code, "name": "x", "expected_version": d["version"]}).status_code == 409

    @pytest.mark.parametrize("body", [{"code": "bad code!", "name": "x"}, {"code": "", "name": "x"}, {"code": "A1", "name": "  "}, {"code": "A1", "name": "n" * 151},
                                      {"code": "A1", "name": "x", "parent_id": 2 ** 40}, {"code": "A" * 31, "name": "x"}])
    def test_department_validation(self, superclient, body):
        assert superclient.post(f"{HR}/departments", json=body).status_code == 422

    def test_department_parent_loop_and_deactivation_guards(self, superclient, make_user, org):
        a = org["dept"]
        b = superclient.post(f"{HR}/departments", json={"code": f"D{_uid()}", "name": f"Sub {_uid()}", "parent_id": a["id"]}).json()
        loop = superclient.put(f"{HR}/departments/{a['id']}", json={"code": a["code"], "name": a["name"], "parent_id": b["id"]})
        assert loop.status_code == 400
        assert superclient.put(f"{HR}/departments/{a['id']}", json={"code": a["code"], "name": a["name"], "parent_id": a["id"]}).status_code == 400
        assert superclient.put(f"{HR}/departments/{a['id']}", json={"code": a["code"], "name": a["name"], "active": False}).status_code == 400  # active sub-department
        _new_employee(superclient, make_user, department_id=b["id"])
        assert superclient.put(f"{HR}/departments/{b['id']}", json={"code": b["code"], "name": b["name"], "parent_id": a["id"], "active": False}).status_code == 400  # has employees

    def test_designation_and_employment_type(self, superclient, org):
        assert superclient.post(f"{HR}/designations", json={"name": org["des"]["name"].upper()}).status_code == 400
        assert superclient.post(f"{HR}/designations", json={"name": "x", "department_id": 2 ** 31 - 1}).status_code == 404
        assert superclient.post(f"{HR}/employment-types", json={"name": org["et"]["name"]}).status_code == 400
        assert superclient.post(f"{HR}/employment-types", json={"name": "y", "default_probation_months": 99}).status_code == 422

    def test_shift_rules_and_single_default(self, superclient):
        body = {"name": f"S{_uid()}", "start_time": "08:00", "end_time": "16:00", "work_minutes": 450, "half_day_minutes": 225}
        assert superclient.post(f"{HR}/shifts", json={**body, "end_time": "07:00"}).status_code == 422
        assert superclient.post(f"{HR}/shifts", json={**body, "work_minutes": 900}).status_code == 422
        assert superclient.post(f"{HR}/shifts", json={**body, "weekly_off_days": "9"}).status_code == 422
        assert superclient.post(f"{HR}/shifts", json={**body, "weekly_off_days": "6,6"}).status_code == 422
        new = superclient.post(f"{HR}/shifts", json={**body, "is_default": True})
        assert new.status_code == 201, new.text
        shifts = superclient.get(f"{HR}/shifts").json()
        assert [x["name"] for x in shifts if x["is_default"]] == [body["name"]]
        old_default = next(x for x in shifts if not x["is_default"] and x["name"] != body["name"])
        assert superclient.put(f"{HR}/shifts/{new.json()['id']}", json={**body, "is_default": False, "expected_version": new.json()["version"]}).status_code == 400
        assert superclient.put(f"{HR}/shifts/{old_default['id']}", json={**{k: old_default[k] for k in ("name", "start_time", "end_time", "work_minutes", "half_day_minutes")}, "is_default": True}).status_code == 200

    def test_holiday_list_year_rules(self, superclient):
        year = 2031
        hl = superclient.post(f"{HR}/holiday-lists", json={"name": f"HL{_uid()}", "year": year}).json()
        assert superclient.post(f"{HR}/holiday-lists/{hl['id']}/holidays", json={"holiday_date": f"{year}-05-01", "name": "May Day"}).status_code == 201
        assert superclient.post(f"{HR}/holiday-lists/{hl['id']}/holidays", json={"holiday_date": f"{year}-05-01", "name": "dup"}).status_code == 400
        assert superclient.post(f"{HR}/holiday-lists/{hl['id']}/holidays", json={"holiday_date": f"{year + 1}-05-01", "name": "wrong year"}).status_code == 400
        assert superclient.post(f"{HR}/holiday-lists/{hl['id']}/holidays", json={"holiday_date": "2031-02-30", "name": "bad"}).status_code == 422
        assert superclient.post(f"{HR}/holiday-lists/{hl['id']}/holidays", json={"holiday_date": f"{year}-06-01", "name": "x", "holiday_type": "nope"}).status_code == 422
        assert superclient.put(f"{HR}/holiday-lists/{hl['id']}", json={"name": hl["name"], "year": year + 1}).status_code == 400
        holidays = superclient.get(f"{HR}/holiday-lists/{hl['id']}/holidays").json()
        assert superclient.delete(f"{HR}/holiday-lists/{hl['id']}/holidays/{holidays[0]['id']}").status_code == 204

    def test_only_one_default_holiday_list_per_year(self, superclient):
        a = superclient.post(f"{HR}/holiday-lists", json={"name": f"A{_uid()}", "year": 2032, "is_default": True}).json()
        b = superclient.post(f"{HR}/holiday-lists", json={"name": f"B{_uid()}", "year": 2032, "is_default": True}).json()
        lists = {x["id"]: x for x in superclient.get(f"{HR}/holiday-lists", params={"year": 2032}).json()}
        assert lists[b["id"]]["is_default"] and not lists[a["id"]]["is_default"]

    def test_id_bounds_and_permissions(self, superclient, api, make_user):
        assert superclient.put(f"{HR}/departments/{2 ** 40}", json={"code": "A", "name": "x"}).status_code == 422
        assert superclient.put(f"{HR}/departments/0", json={"code": "A", "name": "x"}).status_code == 422
        _, token = make_user(permissions=[("hr_setup", "view")])
        c = api(token)
        assert c.get(f"{HR}/departments").status_code == 200
        assert c.post(f"{HR}/departments", json={"code": "X1", "name": "x"}).status_code == 403
        _, reader = make_user(permissions=[("employees", "view")])
        assert api(reader).get(f"{HR}/departments").status_code == 200          # reference data for the employee screens
        assert api(reader).post(f"{HR}/departments", json={"code": "X2", "name": "x"}).status_code == 403
        _, nope = make_user(permissions=[("payroll", "view")])
        assert api(nope).get(f"{HR}/departments").status_code == 403


# ───────────────────────────── leave ─────────────────────────────
class TestLeavePolicy:
    def test_defaults_are_seeded(self, superclient):
        codes = {t["code"] for t in superclient.get(f"{HR}/leave-types").json()}
        assert {"annual", "casual", "medical", "maternity", "unpaid"} <= codes

    @pytest.mark.parametrize("patch", [{"code": "bad code"}, {"annual_entitlement": -1}, {"annual_entitlement": 400}, {"accrual": "weekly"},
                                       {"applicable_gender": "x"}, {"max_consecutive_days": 0}, {"carry_forward_max": 50, "annual_entitlement": 10}])
    def test_leave_type_validation(self, superclient, patch):
        r = superclient.post(f"{HR}/leave-types", json={"code": f"t{_uid()}", "name": f"T {_uid()}", "annual_entitlement": 10, **patch})
        assert r.status_code == 422, (patch, r.text[:200])

    def test_code_is_unique_case_insensitively(self, superclient):
        code = f"zz{_uid()}"
        assert superclient.post(f"{HR}/leave-types", json={"code": code, "name": f"N {_uid()}"}).status_code == 201
        assert superclient.post(f"{HR}/leave-types", json={"code": code.upper(), "name": f"M {_uid()}"}).status_code == 400

    def test_application_checks(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user)
        eid = emp["employee_id"]
        start = _weekday(30)
        base = {"employee_id": eid, "leave_type": "annual", "from_date": start.isoformat(), "to_date": start.isoformat(), "leave_reason": "r", "leave_duration": 1}
        assert superclient.post(LV, json={**base, "leave_type": "nope"}).status_code == 400
        assert superclient.post(LV, json={**base, "leave_duration": 3}).status_code == 400                       # days do not match the dates
        assert superclient.post(LV, json={**base, "leave_time": "MORNING", "leave_duration": 0.5, "to_date": (start + timedelta(days=1)).isoformat()}).status_code == 400
        assert superclient.post(LV, json={**base, "leave_type": "maternity"}).status_code in (400, 422)           # gender rule (not female)
        sunday = start + timedelta(days=(6 - start.weekday()))
        assert superclient.post(LV, json={**base, "from_date": sunday.isoformat(), "to_date": sunday.isoformat()}).status_code == 400  # weekly off
        ok = superclient.post(LV, json=base)
        assert ok.status_code in (200, 201), ok.text
        assert superclient.post(LV, json=base).status_code == 400                                                  # overlap
        # a different year in one application
        y = date.today().year + 1
        assert superclient.post(LV, json={**base, "from_date": f"{y}-12-29", "to_date": f"{y + 1}-01-02", "leave_duration": 3}).status_code in (400, 422)

    def test_balance_blocks_overdraw_and_unpaid_is_free(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user)
        eid = emp["employee_id"]
        a, b = _weekday(60), _weekday(75)
        # casual: 7 days a year, max 3 consecutive
        four = [a + timedelta(days=i) for i in range(6)]
        mondays = [d for d in four if d.weekday() < 5]
        too_long = {"employee_id": eid, "leave_type": "casual", "from_date": mondays[0].isoformat(), "to_date": mondays[-1].isoformat(),
                    "leave_reason": "r", "leave_duration": float(len(mondays))}
        assert superclient.post(LV, json=too_long).status_code == 400  # > 3 consecutive (or balance)
        unpaid = {"employee_id": eid, "leave_type": "unpaid", "from_date": b.isoformat(), "to_date": b.isoformat(), "leave_reason": "r", "leave_duration": 1}
        assert superclient.post(LV, json=unpaid).status_code in (200, 201)

    def test_balance_endpoint_and_allocation_override(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user)
        year = date.today().year
        rows = superclient.get(f"{HR}/employees/{emp['id']}/leave-balances", params={"year": year}).json()
        annual = next(r for r in rows if r["code"] == "annual")
        assert annual["balance"] > 0 and annual["used"] == 0
        types = {t["code"]: t for t in superclient.get(f"{HR}/leave-types").json()}
        r = superclient.post(f"{HR}/leave-allocations", json={"employee_pk": emp["id"], "leave_type_id": types["annual"]["id"], "year": year, "allocated": 3})
        assert r.status_code == 201, r.text
        assert superclient.post(f"{HR}/leave-allocations", json={"employee_pk": emp["id"], "leave_type_id": types["annual"]["id"], "year": year, "allocated": 3}).status_code == 400
        rows = superclient.get(f"{HR}/employees/{emp['id']}/leave-balances", params={"year": year}).json()
        assert next(x for x in rows if x["code"] == "annual")["total"] == 3
        upd = superclient.put(f"{HR}/leave-allocations/{r.json()['id']}", json={"allocated": 5, "expected_version": r.json()["version"]})
        assert upd.status_code == 200 and upd.json()["total"] == 5
        assert superclient.put(f"{HR}/leave-allocations/{r.json()['id']}", json={"allocated": 5, "expected_version": r.json()["version"]}).status_code == 409

    def test_generate_allocations_and_carry_forward(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user, date_of_joining="2024-01-01")
        year = 2028
        types = {t["code"]: t for t in superclient.get(f"{HR}/leave-types").json()}
        superclient.post(f"{HR}/leave-allocations", json={"employee_pk": emp["id"], "leave_type_id": types["annual"]["id"], "year": year - 1, "allocated": 14})
        g = superclient.post(f"{HR}/leave-allocations/generate", json={"year": year, "employee_pk": emp["id"]})
        assert g.status_code == 200 and g.json()["created"] >= 3
        alloc = next(a for a in superclient.get(f"{HR}/leave-allocations", params={"year": year, "employee_pk": emp["id"]}).json()["items"] if a["leave_type_code"] == "annual")
        assert alloc["allocated"] == 14 and alloc["carried_forward"] == 7        # unused 14, capped at the type's carry-forward limit
        again = superclient.post(f"{HR}/leave-allocations/generate", json={"year": year, "employee_pk": emp["id"]}).json()
        assert again["created"] == 0 and again["skipped"] >= 3
        assert all(a["leave_type_code"] != "maternity" for a in superclient.get(f"{HR}/leave-allocations", params={"year": year, "employee_pk": emp["id"]}).json()["items"])

    def test_approving_own_leave_is_refused_for_non_superusers(self, superclient, api, make_user, db):
        from app.modules.employees.models import Employee
        user, token = make_user(permissions=[("leaves", "view"), ("leaves", "create"), ("leave_approvals", "approve"), ("leaves", "update")])
        emp = Employee(user_id=user.id, employee_id=f"E{_uid()}")
        db.add(emp)
        db.flush()
        d = _weekday(90)
        c = api(token)
        r = c.post(LV, json={"employee_id": emp.employee_id, "leave_type": "casual", "from_date": d.isoformat(), "to_date": d.isoformat(), "leave_reason": "r", "leave_duration": 1})
        assert r.status_code in (200, 201), r.text
        ap = c.post(f"{LV}/{r.json()['id']}/approve", json={})
        assert ap.status_code == 400 and "own" in ap.text


# ───────────────────────────── employee master ─────────────────────────────
class TestEmployeeMaster:
    def test_create_full_profile_and_read_back(self, superclient, make_user, org):
        body = {"name_with_initials": "A. B. Silva", "nic": "199012345678", "marital_status": "single", "blood_group": "O+", "gender": "male",
                "date_of_birth": "1990-05-04", "personal_email": "a@example.com", "mobile_phone": "+94771234567", "city": "Colombo",
                "department_id": org["dept"]["id"], "designation_id": org["des"]["id"], "employment_type_id": org["et"]["id"],
                "date_of_joining": "2024-02-01", "epf_no": f"EPF{_uid()}", "bank_name": "BOC", "bank_account_no": "12345678"}
        user, emp = _new_employee(superclient, make_user, **body)
        got = superclient.get(f"{EMP}/{emp['id']}").json()
        for k in ("nic", "gender", "date_of_birth", "city", "bank_name", "epf_no", "department_id", "designation_id"):
            assert got[k] == body[k], k
        assert got["status"] in ("active", "probation") and got["shift_id"] and got["retirement_date"] == "2050-05-04"
        assert got["counts"]["tasks_open"] == 8                       # onboarding checklist seeded
        assert got["version"] and got["service_years"] >= 2

    @pytest.mark.parametrize("patch", [
        {"nic": "123"}, {"nic": "12345678901234"}, {"date_of_birth": "2999-01-01"}, {"date_of_birth": "2020-01-01"}, {"gender": "x"},
        {"marital_status": "complicated"}, {"blood_group": "Z+"}, {"personal_email": "nope"}, {"mobile_phone": "abc"}, {"department_id": 2 ** 40},
        {"bank_account_no": "12"}, {"date_of_joining": "1900-01-01"}, {"notice_period_days": -1}, {"city": "c" * 101},
        {"date_of_joining": "2024-01-01", "probation_end_date": "2023-01-01"}, {"employee_id": "bad id!"}, {"employee_id": ""},
    ])
    def test_validation(self, superclient, make_user, patch):
        user, _ = make_user()
        body = {"user_id": user.id, "employee_id": f"E{_uid()}", **patch}
        assert superclient.post(f"{EMP}/", json=body).status_code == 422, patch

    def test_duplicates_and_references(self, superclient, make_user, org):
        nic = "199112345678"
        _new_employee(superclient, make_user, nic=nic)
        u2, _ = make_user()
        assert superclient.post(f"{EMP}/", json={"user_id": u2.id, "employee_id": f"E{_uid()}", "nic": nic.lower()}).status_code == 400
        user, emp = _new_employee(superclient, make_user)
        assert superclient.post(f"{EMP}/", json={"user_id": user.id, "employee_id": f"E{_uid()}"}).status_code == 400            # user already has a record
        u3, _ = make_user()
        assert superclient.post(f"{EMP}/", json={"user_id": u3.id, "employee_id": emp["employee_id"].lower()}).status_code == 400  # id clash, case-insensitive
        assert superclient.post(f"{EMP}/", json={"user_id": 2 ** 31 - 1, "employee_id": f"E{_uid()}"}).status_code == 404
        assert superclient.post(f"{EMP}/", json={"user_id": u3.id, "employee_id": f"E{_uid()}", "branch_code": "NOPE"}).status_code == 404
        assert superclient.post(f"{EMP}/", json={"user_id": u3.id, "employee_id": f"E{_uid()}", "reports_to_id": 2 ** 31 - 1}).status_code == 404

    def test_contract_type_needs_end_date(self, superclient, make_user):
        contract = next(t for t in superclient.get(f"{HR}/employment-types").json() if t["has_end_date"])
        user, _ = make_user()
        assert superclient.post(f"{EMP}/", json={"user_id": user.id, "employee_id": f"E{_uid()}", "employment_type_id": contract["id"]}).status_code == 400
        ok = superclient.post(f"{EMP}/", json={"user_id": user.id, "employee_id": f"E{_uid()}", "employment_type_id": contract["id"],
                                               "date_of_joining": date.today().isoformat(), "contract_end_date": (date.today() + timedelta(days=200)).isoformat()})
        assert ok.status_code == 201, ok.text

    def test_update_with_version_and_user_writethrough(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user)
        body = {"city": "Galle", "gender": "female", "date_of_birth": "1992-03-04", "expected_version": emp["version"]}
        r = superclient.put(f"{EMP}/{emp['id']}", json=body)
        assert r.status_code == 200 and r.json()["city"] == "Galle" and r.json()["gender"] == "female"
        assert superclient.put(f"{EMP}/{emp['id']}", json=body).status_code == 409          # stale version
        assert superclient.put(f"{EMP}/{2 ** 40}", json={"city": "x"}).status_code == 422

    def test_reporting_line_cannot_loop(self, superclient, make_user):
        _, boss = _new_employee(superclient, make_user)
        _, worker = _new_employee(superclient, make_user, reports_to_id=boss["id"])
        r = superclient.put(f"{EMP}/{boss['id']}", json={"reports_to_id": worker["id"]})
        assert r.status_code == 400
        assert superclient.put(f"{EMP}/{boss['id']}", json={"reports_to_id": boss["id"]}).status_code == 400

    def test_sensitive_fields_need_their_own_permission(self, superclient, api, make_user):
        user, emp = _new_employee(superclient, make_user, nic="199212345678", bank_account_no="99998888", epf_no=f"E{_uid()}")
        _, tok = make_user(permissions=[("employees", "view"), ("employees", "update")])
        c = api(tok)
        got = c.get(f"{EMP}/{emp['id']}").json()
        assert got["sensitive_hidden"] and got.get("bank_account_no") is None and got.get("nic") is None
        assert c.put(f"{EMP}/{emp['id']}", json={"city": "Kandy"}).status_code == 200
        assert c.put(f"{EMP}/{emp['id']}", json={"city": "Kandy", "bank_account_no": "11112222"}).status_code == 403
        _, tok2 = make_user(permissions=[("employees", "view"), ("employee_sensitive", "view")])
        assert api(tok2).get(f"{EMP}/{emp['id']}").json()["bank_account_no"] == "99998888"

    def test_branch_scope(self, superclient, api, make_user, make_branch):
        mine, other = make_branch(), make_branch()
        _, a = _new_employee(superclient, make_user, branch_code=mine.branch_code)
        _, b = _new_employee(superclient, make_user, branch_code=other.branch_code)
        _, tok = make_user(permissions=[("employees", "view"), ("employees", "update"), ("employees", "create")], branches=[mine])
        c = api(tok)
        assert c.get(f"{EMP}/{a['id']}").status_code == 200
        assert c.get(f"{EMP}/{b['id']}").status_code == 403
        assert c.put(f"{EMP}/{b['id']}", json={"city": "x"}).status_code == 403
        ids = {e["id"] for e in c.get(f"{EMP}/paged", params={"size": 200}).json()["items"]}
        assert a["id"] in ids and b["id"] not in ids
        u, _ = make_user()
        assert c.post(f"{EMP}/", json={"user_id": u.id, "employee_id": f"E{_uid()}", "branch_code": other.branch_code}).status_code == 403

    def test_paged_list_filters_sort_and_search(self, superclient, make_user, org):
        for i in range(3):
            _new_employee(superclient, make_user, department_id=org["dept"]["id"])
        r = superclient.get(f"{EMP}/paged", params={"department_id": org["dept"]["id"], "size": 2, "page": 1, "sort_by": "employee_id", "order": "desc"}).json()
        assert r["total"] == 3 and len(r["items"]) == 2 and r["pages"] == 2
        ids = [e["employee_id"].lower() for e in r["items"]]
        assert ids == sorted(ids, reverse=True)
        assert superclient.get(f"{EMP}/paged", params={"q": "%"}).json()["total"] == 0               # literal search
        assert superclient.get(f"{EMP}/paged", params={"status": "bogus"}).status_code == 422
        assert superclient.get(f"{EMP}/paged", params={"size": 100000}).status_code == 422
        assert superclient.get(f"{EMP}/paged", params={"sort_by": "password"}).status_code == 422

    def test_separation_reinstate_and_confirm(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user, employment_type_id=None, date_of_joining=(date.today() - timedelta(days=400)).isoformat())
        last = date.today().isoformat()
        assert superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "resignation", "last_working_date": "1999-01-01"}).status_code == 422
        assert superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "resignation", "last_working_date": (date.today() - timedelta(days=500)).isoformat()}).status_code == 400  # before joining
        assert superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "bogus", "last_working_date": last}).status_code == 422
        r = superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "resignation", "last_working_date": last, "exit_reason": "better offer"})
        assert r.status_code == 200 and r.json()["status"] == "resigned" and r.json()["exit_reason"] == "better offer"
        assert superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "resignation", "last_working_date": last}).status_code == 400
        assert superclient.put(f"{EMP}/{emp['id']}", json={"city": "x"}).status_code == 400     # left: read only
        assert len([t for t in superclient.get(f"{EMP}/{emp['id']}/tasks").json() if t["category"] == "offboarding"]) == 8
        back = superclient.post(f"{EMP}/{emp['id']}/reinstate")
        assert back.status_code == 200 and back.json()["status"] == "active" and back.json()["last_working_date"] is None
        assert superclient.post(f"{EMP}/{emp['id']}/reinstate").status_code == 400
        assert superclient.post(f"{EMP}/{emp['id']}/confirm").status_code == 400                # only probation can be confirmed

    def test_future_last_day_is_notice_period_and_leave_blocked_after_exit(self, superclient, make_user):
        user, emp = _new_employee(superclient, make_user)
        r = superclient.post(f"{EMP}/{emp['id']}/separate", json={"exit_type": "resignation", "last_working_date": (date.today() + timedelta(days=20)).isoformat()})
        assert r.json()["status"] == "notice_period"
        left_user, left = _new_employee(superclient, make_user)
        superclient.post(f"{EMP}/{left['id']}/separate", json={"exit_type": "termination", "last_working_date": date.today().isoformat()})
        d = _weekday(5)
        assert superclient.post(LV, json={"employee_id": left["employee_id"], "leave_type": "casual", "from_date": d.isoformat(), "to_date": d.isoformat(), "leave_reason": "r", "leave_duration": 1}).status_code == 400

    def test_probation_and_confirmation(self, superclient, make_user):
        probation = next(t for t in superclient.get(f"{HR}/employment-types").json() if t["name"] == "Probation")
        user, emp = _new_employee(superclient, make_user, employment_type_id=probation["id"], date_of_joining=date.today().isoformat())
        assert emp["status"] == "probation" and emp["probation_end_date"]
        c = superclient.post(f"{EMP}/{emp['id']}/confirm")
        assert c.status_code == 200 and c.json()["status"] == "active" and c.json()["confirmation_date"] == date.today().isoformat()


# ───────────────────────────── sub-records ─────────────────────────────
class TestSubRecords:
    def test_emergency_contacts_primary_is_single(self, superclient, make_user):
        _, emp = _new_employee(superclient, make_user)
        base = f"{EMP}/{emp['id']}/emergency-contacts"
        a = superclient.post(base, json={"name": "A", "relationship_type": "Spouse", "phone": "+94771234567", "is_primary": True}).json()
        b = superclient.post(base, json={"name": "B", "relationship_type": "Parent", "phone": "0771234568", "is_primary": True}).json()
        rows = {r["id"]: r for r in superclient.get(base).json()}
        assert rows[b["id"]]["is_primary"] and not rows[a["id"]]["is_primary"]
        assert superclient.post(base, json={"name": "C", "relationship_type": "x", "phone": "abc"}).status_code == 422
        assert superclient.post(base, json={"name": "C", "relationship_type": "x"}).status_code == 422
        assert superclient.put(f"{base}/{a['id']}", json={"name": "A2", "relationship_type": "Spouse", "phone": "+94771234567"}).json()["name"] == "A2"
        assert superclient.delete(f"{base}/{a['id']}").status_code == 204
        assert superclient.delete(f"{base}/{a['id']}").status_code == 404

    @pytest.mark.parametrize("kind,body", [
        ("dependents", {"name": "x", "relationship_type": "Child", "date_of_birth": "2999-01-01"}),
        ("dependents", {"name": "x", "relationship_type": "Child", "nic": "12"}),
        ("education", {"level": "phd", "qualification": "q", "institution": "i"}),
        ("education", {"level": "bachelor", "qualification": "q", "institution": "i", "start_year": 2020, "end_year": 2018}),
        ("experience", {"company": "c", "designation": "d", "from_date": "2020-01-01", "to_date": "2019-01-01"}),
        ("experience", {"company": "c", "designation": "d", "from_date": "2999-01-01"}),
        ("documents", {"doc_type": "nic", "title": "t", "issue_date": "2024-01-01", "expiry_date": "2023-01-01"}),
        ("documents", {"doc_type": "visa", "title": "t"}),
        ("tasks", {"category": "other", "title": "t"}),
    ])
    def test_validation(self, superclient, make_user, kind, body):
        _, emp = _new_employee(superclient, make_user)
        assert superclient.post(f"{EMP}/{emp['id']}/{kind}", json=body).status_code == 422, (kind, body)

    def test_education_experience_dependents_roundtrip(self, superclient, make_user):
        _, emp = _new_employee(superclient, make_user)
        e = f"{EMP}/{emp['id']}"
        assert superclient.post(f"{e}/education", json={"level": "bachelor", "qualification": "BSc", "institution": "UoC", "start_year": 2012, "end_year": 2016}).status_code == 201
        assert superclient.post(f"{e}/experience", json={"company": "ACME", "designation": "Clerk", "from_date": "2017-01-01", "to_date": "2020-01-01", "last_salary": 50000}).status_code == 201
        assert superclient.post(f"{e}/dependents", json={"name": "Kid", "relationship_type": "Child", "date_of_birth": "2018-01-01", "gender": "male"}).status_code == 201
        counts = superclient.get(e).json()["counts"]
        assert counts["education"] == counts["experience"] == counts["dependents"] == 1

    def test_other_employees_records_are_not_reachable_by_id(self, superclient, make_user):
        _, a = _new_employee(superclient, make_user)
        _, b = _new_employee(superclient, make_user)
        row = superclient.post(f"{EMP}/{a['id']}/education", json={"level": "school", "qualification": "OL", "institution": "x"}).json()
        assert superclient.put(f"{EMP}/{b['id']}/education/{row['id']}", json={"level": "school", "qualification": "hack", "institution": "x"}).status_code == 404
        assert superclient.delete(f"{EMP}/{b['id']}/education/{row['id']}").status_code == 404

    def test_tasks_workflow(self, superclient, make_user):
        _, emp = _new_employee(superclient, make_user)
        tasks = superclient.get(f"{EMP}/{emp['id']}/tasks").json()
        assert len(tasks) == 8
        t = superclient.patch(f"{EMP}/{emp['id']}/tasks/{tasks[0]['id']}/status", json={"status": "done"}).json()
        assert t["status"] == "done" and t["completed_date"] == date.today().isoformat()
        t = superclient.patch(f"{EMP}/{emp['id']}/tasks/{tasks[0]['id']}/status", json={"status": "pending"}).json()
        assert t["completed_date"] is None
        assert superclient.patch(f"{EMP}/{emp['id']}/tasks/{tasks[0]['id']}/status", json={"status": "bogus"}).status_code == 422
        assert superclient.post(f"{EMP}/{emp['id']}/checklist/onboarding").status_code == 400    # already seeded

    def test_documents_files_are_private_and_validated(self, superclient, api, make_user):
        _, emp = _new_employee(superclient, make_user)
        base = f"{EMP}/{emp['id']}/documents"
        doc = superclient.post(base, json={"doc_type": "contract", "title": "Contract", "expiry_date": (date.today() + timedelta(days=10)).isoformat()}).json()
        assert doc["expires_in_days"] == 10 and not doc["expired"]
        assert superclient.post(f"{base}/{doc['id']}/file", files={"file": ("x.exe", BytesIO(b"MZ"), "application/octet-stream")}).status_code == 400
        assert superclient.post(f"{base}/{doc['id']}/file", files={"file": ("x.pdf", BytesIO(b"<html>"), "application/pdf")}).status_code == 400
        assert superclient.post(f"{base}/{doc['id']}/file", files={"file": ("../../etc/passwd.pdf", BytesIO(b"%PDF-1.4 test"), "application/pdf")}).status_code == 200
        got = superclient.get(f"{base}/{doc['id']}/file")
        assert got.status_code == 200 and got.content.startswith(b"%PDF") and got.headers["x-content-type-options"] == "nosniff"
        assert "/" not in superclient.get(base).json()[0]["file_name"]
        _, no = make_user(permissions=[("employees", "view")])
        assert api(no).get(base).status_code == 403
        assert api(no).get(f"{base}/{doc['id']}/file").status_code == 403
        _, yes = make_user(permissions=[("employees", "view"), ("employee_sensitive", "view")])
        assert api(yes).get(f"{base}/{doc['id']}/file").status_code == 200


# ───────────────────────────── reports ─────────────────────────────
class TestReports:
    def test_headcount_and_lists(self, superclient, make_user, org):
        _new_employee(superclient, make_user, department_id=org["dept"]["id"], date_of_birth=date.today().replace(year=1990).isoformat(), gender="male")
        h = superclient.get(f"{HR}/reports/headcount").json()
        assert h["total"] >= 1 and any(r["key"] == org["dept"]["id"] for r in h["by_department"])
        b = superclient.get(f"{HR}/reports/birthdays", params={"days": 0}).json()
        assert any(r["days_to_go"] == 0 for r in b)
        assert superclient.get(f"{HR}/reports/birthdays", params={"days": 9999}).status_code == 422
        e = superclient.get(f"{HR}/reports/expiring", params={"days": 30}).json()
        assert set(e) == {"contracts", "probation", "retirements", "documents"}
        assert superclient.get(f"{HR}/reports/leave-summary").status_code == 200
        a = superclient.get(f"{HR}/reports/attrition").json()
        assert {"joiners", "leavers", "attrition_rate_percent"} <= set(a)

    def test_leave_days_quote(self, superclient, make_user):
        _, emp = _new_employee(superclient, make_user)
        start = _weekday(40)
        sat = start + timedelta(days=(5 - start.weekday()) % 7)
        mon = sat + timedelta(days=2)
        q = lambda a, b, lt="annual", t="FULL DAY": superclient.get(f"{HR}/leave-days", params={"employee_id": emp["employee_id"], "leave_type": lt, "from_date": a.isoformat(), "to_date": b.isoformat(), "leave_time": t})
        assert q(start, start).json()["days"] == 1
        assert q(sat, mon).json()["days"] == 2                      # Saturday + Monday; Sunday is the weekly off
        assert q(start, start, t="first_half").json()["days"] == 0.5
        assert q(start, start, t="full_day").json()["days"] == 1   # the leave page sends full_day
        assert q(mon, sat).status_code == 400
        assert q(start, start, lt="nope").status_code == 400

    def test_reports_need_permission(self, api, make_user):
        _, tok = make_user(permissions=[("employees", "view")])
        assert api(tok).get(f"{HR}/reports/headcount").status_code == 403
