from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from app.modules.employees import schemas, service

router = APIRouter()

@router.get(
    "/",
    response_model=List[schemas.Employee],
    summary="List All Employees",
    dependencies=[Depends(require_permission(*Permissions.USER_VIEW))]
)
def list_employees(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_VIEW))
):
    return service.employee_service.get_all_employees(db, skip, limit)

@router.get(
    "/{employee_id}",
    response_model=schemas.Employee,
    summary="Get Employee by ID",
    dependencies=[Depends(require_permission(*Permissions.USER_VIEW))]
)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_VIEW))
):
    return service.employee_service.get_employee(db, employee_id)

@router.post(
    "/",
    response_model=schemas.Employee,
    status_code=status.HTTP_201_CREATED,
    summary="Create Employee",
    dependencies=[Depends(require_permission(*Permissions.USER_CREATE))]
)
def create_employee(
    employee: schemas.EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_CREATE))
):
    return service.employee_service.create_employee(db, employee)

@router.put(
    "/{employee_id}",
    response_model=schemas.Employee,
    summary="Update Employee",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))]
)
def update_employee(
    employee_id: int,
    employee: schemas.EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE))
):
    return service.employee_service.update_employee(db, employee_id, employee)

@router.delete(
    "/{employee_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Employee",
    dependencies=[Depends(require_permission(*Permissions.USER_DELETE))]
)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_DELETE))
):
    return service.employee_service.delete_employee(db, employee_id)
