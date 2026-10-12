from decimal import Decimal

import pytest

from app.modules.hr import schemas
from app.modules.hr.service import PayrollService
from app.modules.employees.models import EmployeePayroll


def test_employee_reader_does_not_need_user_admin_access(client, make_user):
    _, token = make_user(permissions=[("employees", "view")])
    response = client.get("/api/v1/employees/", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_user_reader_cannot_read_employee_records(client, make_user):
    _, token = make_user(permissions=[("users", "view")])
    response = client.get("/api/v1/employees/", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_manual_payroll_calculates_totals_on_create_and_update(db, make_employee):
    employee = make_employee()
    service = PayrollService(db)
    payload = schemas.EmployeePayrollCreate(
        employee_id=employee.employee_id, basic_salary=Decimal("100000"),
        add_bonus=Decimal("5000"), less_epf_employee=Decimal("8000"),
        less_apit=Decimal("1000"), epf_employer=Decimal("12000"),
        etf_employer=Decimal("3000"), payroll_month=6, payroll_year=2026,
    )
    payroll = service.create_payroll(payload)
    assert payroll.gross_salary == Decimal("105000")
    assert payroll.total_deductions == Decimal("9000")
    assert payroll.net_salary == Decimal("96000")
    assert payroll.total_employer_cost == Decimal("120000")
    payload.basic_salary = Decimal("110000")
    updated = service.update_payroll(payroll.id, payload)
    assert updated.net_salary == Decimal("106000")


@pytest.mark.parametrize("record_status,batch_no", [
    ("approved", None), ("salary_paid", None), ("completed", None),
    ("draft", "QA-BATCH"),
])
@pytest.mark.parametrize("action", ["update", "delete"])
def test_processed_or_batch_payroll_cannot_be_mutated(
    db, make_employee, record_status, batch_no, action,
):
    from fastapi import HTTPException

    employee = make_employee()
    record = EmployeePayroll(
        employee_id=employee.employee_id, basic_salary=Decimal("100000"),
        status=record_status, payroll_batch_no=batch_no,
    )
    db.add(record)
    db.flush()
    service = PayrollService(db)
    with pytest.raises(HTTPException) as error:
        if action == "delete":
            service.delete_payroll(record.id)
        else:
            service.update_payroll(record.id, schemas.EmployeePayrollCreate(
                employee_id=employee.employee_id, basic_salary=Decimal("1"),
            ))
    assert error.value.status_code == 400


@pytest.mark.parametrize("path,resource", [
    ("payroll", "payroll"), ("payroll/batches", "payroll_processing"),
    ("salary-profiles", "salary_profiles"), ("deductions", "deductions"),
    ("promotions", "promotions"), ("employee-assets", "hr_assets"),
    ("reimbursements", "reimbursements"),
])
def test_hr_read_permissions_are_resource_specific(client, make_user, path, resource):
    _, reader_token = make_user(permissions=[(resource, "view")])
    _, dashboard_token = make_user(permissions=[("hr_dashboard", "view")])
    assert client.get(f"/api/v1/hr/{path}", headers={
        "Authorization": f"Bearer {reader_token}",
    }).status_code == 200
    assert client.get(f"/api/v1/hr/{path}", headers={
        "Authorization": f"Bearer {dashboard_token}",
    }).status_code == 403