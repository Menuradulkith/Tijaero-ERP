"""Payroll run must not issue queries per employee (2,000 employees took 45 s, QA 2026-11-03): the number of
SQL statements for a run and for the batch detail stays flat as the company grows."""
from datetime import date

import pytest
from sqlalchemy import event

HR = "/api/v1/hr"
TODAY = date.today()
PERIOD = {"payroll_month": TODAY.month, "payroll_year": TODAY.year}


@pytest.fixture
def count_sql(_connection):
    seen = []

    def _on(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(_connection, "before_cursor_execute", _on)
    yield seen
    event.remove(_connection, "before_cursor_execute", _on)


def _staff(c, make_employee, db, n, with_loan=False):
    for _ in range(n):
        e = make_employee()
        db.flush()
        r = c.post(f"{HR}/salary-profiles", json={"employee_id": e.employee_id, "basic_salary": 90000,
                                                  "allowances": [{"name": "BRA", "amount": 3500, "epf_liable": True, "taxable": True}]})
        assert r.status_code == 201, r.text
        if with_loan:
            r = c.post(f"{HR}/loans", json={"employee_pk": e.id, "amount": 3000, "installments": 3, "issue_date": TODAY.isoformat(),
                                            "start_period": TODAY.strftime("%Y-%m")})
            assert r.status_code == 201, r.text


def _run(c, seen):
    seen.clear()
    r = c.post(f"{HR}/payroll/run", json=PERIOD)
    assert r.status_code == 201, r.text
    run_q = len(seen)
    seen.clear()
    detail = c.get(f"{HR}/payroll/batches/{r.json()['id']}")
    assert detail.status_code == 200
    detail_q = len(seen)
    seen.clear()
    assert c.get(f"{HR}/payroll/batches/{r.json()['id']}/returns/bank/csv").status_code == 200
    return r.json(), run_q, (detail_q, len(seen))


def test_queries_do_not_grow_with_employees(superclient, make_employee, db, count_sql):
    _staff(superclient, make_employee, db, 3, with_loan=True)
    small, run_small, detail_small = _run(superclient, count_sql)
    assert superclient.post(f"{HR}/payroll/batches/{small['id']}/cancel").status_code == 200

    _staff(superclient, make_employee, db, 20, with_loan=True)
    big, run_big, detail_big = _run(superclient, count_sql)
    assert big["total_employees"] == small["total_employees"] + 20
    # 20 more employees, each with a loan: the same statements (inserts go out in batches). Was ~10 per employee.
    assert run_big - run_small <= 3, (run_small, run_big)
    assert detail_big[0] - detail_small[0] <= 1, (detail_small, detail_big)     # batch detail
    assert detail_big[1] - detail_small[1] <= 1, (detail_small, detail_big)     # bank-transfer return
    names = {r["employee_id"]: r["employee_name"] for r in big["payroll_records"]}
    assert all(names.values())


def test_statutory_csv_neutralises_formulas(superclient, make_employee, db):
    e = make_employee()
    e.name_with_initials, e.bank_account_no = '=HYPERLINK("http://x","pay")', "123"
    db.flush()
    _staff_one = superclient.post(f"{HR}/salary-profiles", json={"employee_id": e.employee_id, "basic_salary": 50000})
    assert _staff_one.status_code == 201, _staff_one.text
    batch = superclient.post(f"{HR}/payroll/run", json=PERIOD)
    assert batch.status_code == 201, batch.text
    text = superclient.get(f"{HR}/payroll/batches/{batch.json()['id']}/returns/bank/csv").text
    line = next(ln for ln in text.splitlines() if e.employee_id in ln)
    assert "'=HYPERLINK" in line and ',=HYPERLINK' not in line and ',"=HYPERLINK' not in line
