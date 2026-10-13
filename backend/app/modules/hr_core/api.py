"""Core HR endpoints.

/hr/...         masters (departments, designations, employment types, shifts, holidays,
                leave types), leave allocations / balances, HR reports
/employees/...  employee master with sub-records
"""
from datetime import date
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Path, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user, get_user_branch_filter
from app.auth.models import User
from app.auth.rbac import Permissions, require_any_permission, require_permission, user_has_permission
from app.db.session import get_db
from app.modules.hr_core import reports
from app.modules.hr_core import schemas as s
from app.modules.hr_core.service import EmployeeService, LeavePolicyService, OrgService, TimeService
from app.core import timezone as tz

RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]

router = APIRouter(prefix="/hr", tags=["hr-core"])
employee_router = APIRouter(tags=["employees"])

# Reference data (departments, shifts, leave types ...) is read by every HR screen, so anyone who
# works with employees or leave may read it; changing it needs the hr_setup permissions.
VIEW = Depends(require_any_permission(Permissions.HR_SETUP_VIEW, Permissions.EMPLOYEE_VIEW, Permissions.LEAVE_VIEW))
CREATE = Depends(require_permission(*Permissions.HR_SETUP_CREATE))
UPDATE = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))


# ═══════════════════════════ organisation ═══════════════════════════
@router.get("/departments", response_model=List[s.DepartmentOut], dependencies=[VIEW])
def list_departments(q: Optional[str] = Query(None, max_length=100), active: Optional[bool] = None, db: Session = Depends(get_db)):
    return OrgService(db).list_departments(q, active)


@router.post("/departments", response_model=s.DepartmentOut, status_code=201)
def create_department(data: s.DepartmentIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return OrgService(db).create_department(data, user.id)


@router.put("/departments/{dept_id}", response_model=s.DepartmentOut)
def update_department(dept_id: RowId, data: s.DepartmentUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return OrgService(db).update_department(dept_id, data, user.id)


@router.get("/designations", response_model=List[s.DesignationOut], dependencies=[VIEW])
def list_designations(q: Optional[str] = Query(None, max_length=100), active: Optional[bool] = None,
                      department_id: Optional[int] = Query(None, ge=1, le=2_147_483_647), db: Session = Depends(get_db)):
    return OrgService(db).list_designations(q, active, department_id)


@router.post("/designations", response_model=s.DesignationOut, status_code=201)
def create_designation(data: s.DesignationIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return OrgService(db).create_designation(data, user.id)


@router.put("/designations/{row_id}", response_model=s.DesignationOut)
def update_designation(row_id: RowId, data: s.DesignationUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return OrgService(db).update_designation(row_id, data, user.id)


@router.get("/employment-types", response_model=List[s.EmploymentTypeOut], dependencies=[VIEW])
def list_employment_types(active: Optional[bool] = None, db: Session = Depends(get_db)):
    return OrgService(db).list_employment_types(active)


@router.post("/employment-types", response_model=s.EmploymentTypeOut, status_code=201)
def create_employment_type(data: s.EmploymentTypeIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return OrgService(db).create_employment_type(data, user.id)


@router.put("/employment-types/{row_id}", response_model=s.EmploymentTypeOut)
def update_employment_type(row_id: RowId, data: s.EmploymentTypeUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return OrgService(db).update_employment_type(row_id, data, user.id)


# ═══════════════════════════ time ═══════════════════════════
@router.get("/shifts", response_model=List[s.ShiftOut], dependencies=[VIEW])
def list_shifts(active: Optional[bool] = None, db: Session = Depends(get_db)):
    return TimeService(db).list_shifts(active)


@router.post("/shifts", response_model=s.ShiftOut, status_code=201)
def create_shift(data: s.ShiftIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return TimeService(db).create_shift(data, user.id)


@router.put("/shifts/{row_id}", response_model=s.ShiftOut)
def update_shift(row_id: RowId, data: s.ShiftUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return TimeService(db).update_shift(row_id, data, user.id)


@router.get("/holiday-lists", response_model=List[s.HolidayListOut], dependencies=[VIEW])
def list_holiday_lists(year: Optional[int] = Query(None, ge=2000, le=2100), db: Session = Depends(get_db)):
    return TimeService(db).list_holiday_lists(year)


@router.post("/holiday-lists", response_model=s.HolidayListOut, status_code=201)
def create_holiday_list(data: s.HolidayListIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return TimeService(db).create_holiday_list(data, user.id)


@router.put("/holiday-lists/{row_id}", response_model=s.HolidayListOut)
def update_holiday_list(row_id: RowId, data: s.HolidayListUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return TimeService(db).update_holiday_list(row_id, data, user.id)


@router.get("/holiday-lists/{list_id}/holidays", response_model=List[s.HolidayOut], dependencies=[VIEW])
def list_holidays(list_id: RowId, db: Session = Depends(get_db)):
    return TimeService(db).list_holidays(list_id)


@router.post("/holiday-lists/{list_id}/holidays", response_model=s.HolidayOut, status_code=201)
def add_holiday(list_id: RowId, data: s.HolidayIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return TimeService(db).add_holiday(list_id, data, user.id)


@router.put("/holiday-lists/{list_id}/holidays/{holiday_id}", response_model=s.HolidayOut)
def update_holiday(list_id: RowId, holiday_id: RowId, data: s.HolidayIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return TimeService(db).update_holiday(list_id, holiday_id, data, user.id)


@router.delete("/holiday-lists/{list_id}/holidays/{holiday_id}", status_code=204)
def delete_holiday(list_id: RowId, holiday_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    TimeService(db).delete_holiday(list_id, holiday_id, user.id)


# ═══════════════════════════ leave ═══════════════════════════
@router.get("/leave-types", response_model=List[s.LeaveTypeOut], dependencies=[VIEW])
def list_leave_types(active: Optional[bool] = None, db: Session = Depends(get_db)):
    return LeavePolicyService(db).list_types(active)


@router.post("/leave-types", response_model=s.LeaveTypeOut, status_code=201)
def create_leave_type(data: s.LeaveTypeIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_CREATE))):
    return LeavePolicyService(db).create_type(data, user.id)


@router.put("/leave-types/{row_id}", response_model=s.LeaveTypeOut)
def update_leave_type(row_id: RowId, data: s.LeaveTypeUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.HR_SETUP_UPDATE))):
    return LeavePolicyService(db).update_type(row_id, data, user.id)


@router.get("/leave-allocations", response_model=s.Page[s.LeaveAllocationOut], dependencies=[Depends(require_permission(*Permissions.LEAVE_ALLOCATION_VIEW))])
def list_leave_allocations(
    year: int = Query(default_factory=lambda: tz.today().year, ge=2000, le=2100),
    employee_pk: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    leave_type_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    page: int = Query(1, ge=1, le=1_000_000), size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    return LeavePolicyService(db).list_allocations(year, employee_pk, leave_type_id, branches, page, size)


@router.post("/leave-allocations", response_model=s.LeaveAllocationOut, status_code=201)
def create_leave_allocation(data: s.LeaveAllocationIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.LEAVE_ALLOCATION_CREATE))):
    return LeavePolicyService(db).upsert_allocation(data, user.id)


@router.put("/leave-allocations/{row_id}", response_model=s.LeaveAllocationOut)
def update_leave_allocation(row_id: RowId, data: s.LeaveAllocationUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.LEAVE_ALLOCATION_UPDATE))):
    return LeavePolicyService(db).update_allocation(row_id, data, user.id)


@router.post("/leave-allocations/generate")
def generate_leave_allocations(data: s.GenerateAllocationsIn, db: Session = Depends(get_db),
                               user: User = Depends(require_permission(*Permissions.LEAVE_ALLOCATION_CREATE)),
                               branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return LeavePolicyService(db).generate(data, user.id, branches)


@router.get("/leave-days")
def leave_days(
    employee_id: str = Query(..., min_length=1, max_length=100), leave_type: str = Query(..., min_length=1, max_length=30),
    from_date: date = Query(...), to_date: date = Query(...), leave_time: str = Query("FULL DAY", max_length=20),
    db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.LEAVE_VIEW)),
):
    """How many leave days a date range costs this employee (weekly offs and holidays excluded)."""
    from fastapi import HTTPException
    from app.modules.employees.models import Employee
    from app.modules.hr_core.service import is_half_day

    emp = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="To date must be on or after the from date")
    if (to_date - from_date).days > 366:
        raise HTTPException(status_code=400, detail="The range is too long")
    svc = LeavePolicyService(db)
    lt = svc.get_type_by_code(leave_type)
    if not lt:
        raise HTTPException(status_code=400, detail=f"Unknown leave type '{leave_type}'")
    half = is_half_day(leave_time)
    return {"days": svc.count_days(emp, lt, from_date, to_date, half and from_date == to_date)}


@router.get("/employees/{employee_pk}/leave-balances", response_model=List[s.LeaveBalanceRow])
def employee_leave_balances(employee_pk: RowId, year: int = Query(default_factory=lambda: tz.today().year, ge=2000, le=2100),
                            db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_VIEW))):
    emp = EmployeeService(db)._get_employee(employee_pk, user)
    return LeavePolicyService(db).balances(emp, year)


# ═══════════════════════════ reports ═══════════════════════════
REPORT = Depends(require_permission(*Permissions.HR_REPORTS_VIEW))


@router.get("/reports/headcount", dependencies=[REPORT])
def report_headcount(db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return reports.headcount(db, branches)


@router.get("/reports/birthdays", dependencies=[REPORT])
def report_birthdays(days: int = Query(30, ge=0, le=365), db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return reports.birthdays(db, branches, days)


@router.get("/reports/anniversaries", dependencies=[REPORT])
def report_anniversaries(days: int = Query(30, ge=0, le=365), db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return reports.anniversaries(db, branches, days)


@router.get("/reports/expiring", dependencies=[REPORT])
def report_expiring(days: int = Query(60, ge=0, le=730), db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return reports.expiring(db, branches, days)


@router.get("/reports/leave-summary", dependencies=[REPORT])
def report_leave_summary(year: int = Query(default_factory=lambda: tz.today().year, ge=2000, le=2100), db: Session = Depends(get_db),
                         branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return reports.leave_summary(db, branches, year)


@router.get("/reports/attrition", dependencies=[REPORT])
def report_attrition(year: int = Query(default_factory=lambda: tz.today().year, ge=2000, le=2100), db: Session = Depends(get_db),
                     branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return reports.attrition(db, branches, year)


# ═══════════════════════════ employees ═══════════════════════════
EMP_VIEW = Depends(require_permission(*Permissions.EMPLOYEE_VIEW))


def _sens_view(user: User) -> bool:
    return user_has_permission(user, *Permissions.EMPLOYEE_SENSITIVE_VIEW)


def _sens_edit(user: User) -> bool:
    return user_has_permission(user, *Permissions.EMPLOYEE_SENSITIVE_UPDATE)


@employee_router.get("/paged", response_model=s.Page[s.EmployeeListItem], dependencies=[EMP_VIEW])
def list_employees_paged(
    q: Optional[str] = Query(None, max_length=100),
    department_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    designation_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    employment_type_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    branch_code: Optional[str] = Query(None, max_length=20),
    status_filter: Optional[Literal["live", "active", "probation", "notice_period", "resigned", "terminated", "retired", "inactive"]] = Query(None, alias="status"),
    sort_by: Optional[Literal["employee_id", "name", "status", "date_of_joining", "department"]] = None,
    order: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1, le=1_000_000), size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    return EmployeeService(db).list_paged(branches, page, size, sort_by, order, q=q, department_id=department_id, designation_id=designation_id,
                                          branch_code=branch_code, status_=status_filter, employment_type_id=employment_type_id)


@employee_router.get("/", response_model=List[s.EmployeeListItem], dependencies=[EMP_VIEW])
def list_employees(skip: int = Query(0, ge=0, le=10_000_000), limit: int = Query(100, ge=1, le=5000),
                   db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return EmployeeService(db).list_all(branches, skip, limit)


@employee_router.get("/{emp_id}", response_model=s.EmployeeDetail)
def get_employee(emp_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_VIEW))):
    return EmployeeService(db).detail(emp_id, user, _sens_view(user))


@employee_router.post("/", response_model=s.EmployeeDetail, status_code=201)
def create_employee(data: s.EmployeeCreate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_CREATE))):
    return EmployeeService(db).create(data, user, _sens_edit(user))


@employee_router.put("/{emp_id}", response_model=s.EmployeeDetail)
def update_employee(emp_id: RowId, data: s.EmployeeUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    return EmployeeService(db).update(emp_id, data, user, _sens_edit(user))


@employee_router.post("/{emp_id}/confirm", response_model=s.EmployeeDetail)
def confirm_employee(emp_id: RowId, confirmation_date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                     db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    from datetime import date as _d
    return EmployeeService(db).confirm(emp_id, user, _d.fromisoformat(confirmation_date) if confirmation_date else None, _sens_view(user))


@employee_router.post("/{emp_id}/separate", response_model=s.EmployeeDetail)
def separate_employee(emp_id: RowId, data: s.EmployeeSeparation, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    return EmployeeService(db).separate(emp_id, data, user, _sens_view(user))


@employee_router.post("/{emp_id}/reinstate", response_model=s.EmployeeDetail)
def reinstate_employee(emp_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    return EmployeeService(db).reinstate(emp_id, user, _sens_view(user))


@employee_router.post("/{emp_id}/checklist/{category}")
def apply_checklist(emp_id: RowId, category: Literal["onboarding", "offboarding"], db: Session = Depends(get_db),
                    user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    return {"created": EmployeeService(db).apply_template(emp_id, category, user)}


_OUT = {"emergency-contacts": s.EmergencyContactOut, "dependents": s.DependentOut, "education": s.EducationOut,
        "experience": s.ExperienceOut, "documents": s.DocumentOut, "tasks": s.TaskOut}
_IN = {"emergency-contacts": s.EmergencyContactIn, "dependents": s.DependentIn, "education": s.EducationIn,
       "experience": s.ExperienceIn, "documents": s.DocumentIn, "tasks": s.TaskIn}


def _sub_guard(kind: str, user: User, write: bool) -> None:
    """Documents hold IDs, contracts and medical papers: they follow the sensitive-data permission."""
    from fastapi import HTTPException
    if kind == "documents":
        ok = _sens_edit(user) if write else _sens_view(user)
        if not ok:
            raise HTTPException(status_code=403, detail="You are not allowed to access employee documents")
    elif kind == "dependents" and not write and not user_has_permission(user, *Permissions.EMPLOYEE_VIEW):
        raise HTTPException(status_code=403, detail="Permission denied")


def _register_sub(kind: str, In, Out):
    def list_rows(emp_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_VIEW))):
        _sub_guard(kind, user, write=False)
        return [Out.model_validate(r, from_attributes=True) for r in EmployeeService(db).sub_list(emp_id, kind, user)]

    def create_row(emp_id: RowId, payload: In, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
        _sub_guard(kind, user, write=True)
        return Out.model_validate(EmployeeService(db).sub_create(emp_id, kind, payload, user), from_attributes=True)

    def update_row(emp_id: RowId, row_id: RowId, payload: In, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
        _sub_guard(kind, user, write=True)
        return Out.model_validate(EmployeeService(db).sub_update(emp_id, kind, row_id, payload, user), from_attributes=True)

    def delete_row(emp_id: RowId, row_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
        _sub_guard(kind, user, write=True)
        EmployeeService(db).sub_delete(emp_id, kind, row_id, user)

    employee_router.add_api_route(f"/{{emp_id}}/{kind}", list_rows, methods=["GET"], response_model=List[Out], name=f"list_{kind}")
    employee_router.add_api_route(f"/{{emp_id}}/{kind}", create_row, methods=["POST"], response_model=Out, status_code=201, name=f"create_{kind}")
    employee_router.add_api_route(f"/{{emp_id}}/{kind}/{{row_id}}", update_row, methods=["PUT"], response_model=Out, name=f"update_{kind}")
    employee_router.add_api_route(f"/{{emp_id}}/{kind}/{{row_id}}", delete_row, methods=["DELETE"], status_code=204, name=f"delete_{kind}")


for _kind in _IN:
    _register_sub(_kind, _IN[_kind], _OUT[_kind])


@employee_router.patch("/{emp_id}/tasks/{task_id}/status", response_model=s.TaskOut)
def set_task_status(emp_id: RowId, task_id: RowId, data: s.TaskStatusIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    return EmployeeService(db).task_status(emp_id, task_id, data.status, user)


@employee_router.post("/{emp_id}/documents/{doc_id}/file", response_model=s.DocumentOut)
def upload_document_file(emp_id: RowId, doc_id: RowId, file: UploadFile = File(...), db: Session = Depends(get_db),
                         user: User = Depends(require_permission(*Permissions.EMPLOYEE_UPDATE))):
    _sub_guard("documents", user, write=True)
    return EmployeeService(db).attach_file(emp_id, doc_id, file, user)


@employee_router.get("/{emp_id}/documents/{doc_id}/file")
def download_document_file(emp_id: RowId, doc_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.EMPLOYEE_VIEW))):
    _sub_guard("documents", user, write=False)
    path, name = EmployeeService(db).document_file(emp_id, doc_id, user)
    return FileResponse(path, filename=name, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})
