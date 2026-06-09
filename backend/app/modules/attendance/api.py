"""FastAPI routes for Attendance and Leaves."""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db

from . import schemas, service

router = APIRouter(
    prefix="/hr",
    tags=["hr-attendance-leaves"],
)


# ─── Attendance ────────────────────────────────────────────────────────────────
@router.get(
    "/attendance",
    response_model=List[schemas.Attendance],
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_VIEW))],
)
def list_attendance(
    employee_id: Optional[str] = None,
    branch_code: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    """List attendance records with optional filters."""
    svc = service.AttendanceService(db)
    return svc.list(
        schemas.AttendanceFilter(
            employee_id=employee_id,
            branch_code=branch_code,
            date_from=date_from,
            date_to=date_to,
            skip=skip,
            limit=limit,
        )
    )


@router.get(
    "/attendance/summary",
    response_model=schemas.AttendanceSummary,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_VIEW))],
)
def attendance_summary(
    date_from: date,
    date_to: date,
    employee_id: Optional[str] = None,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
):
    svc = service.AttendanceService(db)
    return svc.summary(date_from, date_to, employee_id, branch_code)


@router.get(
    "/attendance/{attendance_id}",
    response_model=schemas.Attendance,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_VIEW))],
)
def get_attendance(attendance_id: int, db: Session = Depends(get_db)):
    return service.AttendanceService(db).get(attendance_id)


@router.post(
    "/attendance",
    response_model=schemas.Attendance,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_CREATE))],
)
def create_attendance(data: schemas.AttendanceCreate, db: Session = Depends(get_db)):
    return service.AttendanceService(db).create(data)


@router.post(
    "/attendance/check-in",
    response_model=schemas.Attendance,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_CREATE))],
)
def attendance_check_in(
    data: schemas.AttendanceCheckIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.AttendanceService(db).check_in(data, current_user.id)


@router.post(
    "/attendance/check-out",
    response_model=schemas.Attendance,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_CREATE))],
)
def attendance_check_out(
    data: schemas.AttendanceCheckOut,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.AttendanceService(db).check_out(data, current_user.id)


@router.put(
    "/attendance/{attendance_id}",
    response_model=schemas.Attendance,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_UPDATE))],
)
def update_attendance(
    attendance_id: int,
    data: schemas.AttendanceUpdate,
    db: Session = Depends(get_db),
):
    return service.AttendanceService(db).update(attendance_id, data)


@router.delete(
    "/attendance/{attendance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.ATTENDANCE_DELETE))],
)
def delete_attendance(attendance_id: int, db: Session = Depends(get_db)):
    service.AttendanceService(db).delete(attendance_id)


# ─── Leaves ────────────────────────────────────────────────────────────────────
@router.get(
    "/leaves",
    response_model=List[schemas.Leave],
    dependencies=[Depends(require_permission(*Permissions.LEAVE_VIEW))],
)
def list_leaves(
    employee_id: Optional[str] = None,
    leave_type: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    svc = service.LeaveService(db)
    return svc.list(
        schemas.LeaveFilter(
            employee_id=employee_id,
            leave_type=leave_type,
            status=status_filter,
            date_from=date_from,
            date_to=date_to,
            skip=skip,
            limit=limit,
        )
    )


@router.get(
    "/leaves/balance/{employee_id}",
    response_model=schemas.LeaveBalance,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_VIEW))],
)
def leave_balance(
    employee_id: str,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    return service.LeaveService(db).balance(employee_id, year)


@router.get(
    "/leaves/{leave_id}",
    response_model=schemas.Leave,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_VIEW))],
)
def get_leave(leave_id: int, db: Session = Depends(get_db)):
    return service.LeaveService(db).get(leave_id)


@router.post(
    "/leaves",
    response_model=schemas.Leave,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_CREATE))],
)
def create_leave(
    data: schemas.LeaveCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.LeaveService(db).create(data, current_user.id)


@router.put(
    "/leaves/{leave_id}",
    response_model=schemas.Leave,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_UPDATE))],
)
def update_leave(
    leave_id: int,
    data: schemas.LeaveUpdate,
    db: Session = Depends(get_db),
):
    return service.LeaveService(db).update(leave_id, data)


@router.post(
    "/leaves/{leave_id}/approve",
    response_model=schemas.Leave,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_APPROVAL_APPROVE))],
)
def approve_leave(
    leave_id: int,
    data: schemas.LeaveApprove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.LeaveService(db).approve(leave_id, data, current_user.id)


@router.post(
    "/leaves/{leave_id}/reject",
    response_model=schemas.Leave,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_APPROVAL_APPROVE))],
)
def reject_leave(
    leave_id: int,
    data: schemas.LeaveReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return service.LeaveService(db).reject(leave_id, data, current_user.id)


@router.delete(
    "/leaves/{leave_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.LEAVE_DELETE))],
)
def delete_leave(leave_id: int, db: Session = Depends(get_db)):
    service.LeaveService(db).delete(leave_id)
