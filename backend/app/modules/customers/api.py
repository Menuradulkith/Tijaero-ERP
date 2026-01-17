from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from app.modules.customers import schemas, service

router = APIRouter()

@router.get(
    "/",
    response_model=List[schemas.Customer],
    summary="List All Customers",
    description="Get list of all customers with pagination",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def list_customers(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of records to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    return service.customer_service.get_all_customers(db, skip, limit)

@router.get(
    "/search",
    response_model=List[schemas.Customer],
    summary="Search Customers",
    description="Search customers by name, email, or phone",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def search_customers(
    q: str = Query(..., min_length=1, description="Search query"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    return service.customer_service.search_customers(db, q, skip, limit)

@router.get(
    "/{customer_id}",
    response_model=schemas.Customer,
    summary="Get Customer by ID",
    description="Retrieve customer details by ID",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    return service.customer_service.get_customer(db, customer_id)

@router.post(
    "/",
    response_model=schemas.Customer,
    status_code=status.HTTP_201_CREATED,
    summary="Create Customer",
    description="Create a new customer record",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_CREATE))]
)
def create_customer(
    customer: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_CREATE))
):
    return service.customer_service.create_customer(db, customer, current_user.id)

@router.put(
    "/{customer_id}",
    response_model=schemas.Customer,
    summary="Update Customer",
    description="Update an existing customer",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))]
)
def update_customer(
    customer_id: int,
    customer: schemas.CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE))
):
    return service.customer_service.update_customer(db, customer_id, customer, current_user.id)

@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Customer",
    description="Delete a customer",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_DELETE))]
)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_DELETE))
):

    return service.customer_service.delete_customer(db, customer_id)


from app.modules.customers.credit_service import customer_credit_service
from datetime import date

@router.get(
    "/{customer_id}/credit-summary",
    summary="Get Customer Credit Summary",
    description="Get complete credit status including limits, outstanding, and aging",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_customer_credit_summary(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    return customer_credit_service.get_customer_credit_summary(db, customer_id)


@router.post(
    "/{customer_id}/credit-check",
    summary="Check Credit Availability",
    description="Validate if a credit sale can be made",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def check_customer_credit(
    customer_id: int,
    sale_amount: float = Query(..., description="Amount of the proposed credit sale"),
    allow_over_limit: bool = Query(False, description="Allow sale if over limit (warning only)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    from decimal import Decimal
    return customer_credit_service.check_credit_availability(
        db, customer_id, Decimal(str(sale_amount)), allow_over_limit
    )


@router.get(
    "/{customer_id}/aging-report",
    summary="Get Customer Aging Report",
    description="Get aging report for customer receivables",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_customer_aging_report(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    return customer_credit_service.get_aging_report(db, customer_id)


@router.get(
    "/reports/aging",
    summary="Get All Customers Aging Report",
    description="Get aging report for all customer receivables",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_all_customers_aging_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    return customer_credit_service.get_aging_report(db)


@router.get(
    "/{customer_id}/statement",
    summary="Get Customer Statement",
    description="Get detailed statement of all credit transactions",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_customer_statement(
    customer_id: int,
    from_date: Optional[date] = Query(None, description="Start date for statement"),
    to_date: Optional[date] = Query(None, description="End date for statement"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    return customer_credit_service.get_customer_statement(db, customer_id, from_date, to_date)


@router.post(
    "/{customer_id}/credit-settlements",
    response_model=schemas.CustomerCreditsSettle,
    status_code=status.HTTP_201_CREATED,
    summary="Create Credit Settlement",
    description="Record payment received against credit invoices",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))]
)
def create_customer_credit_settlement(
    customer_id: int,
    settlement: schemas.CustomerCreditsSettleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE))
):

    if settlement.customers_id != customer_id:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Settlement customer_id doesn't match URL customer_id"
        )
    return customer_credit_service.create_credit_settlement(db, settlement)


@router.get(
    "/{customer_id}/credit-settlements",
    response_model=List[schemas.CustomerCreditsSettle],
    summary="List Customer Credit Settlements",
    description="Get all credit settlements for a customer",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def list_customer_credit_settlements(
    customer_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    return customer_credit_service.get_customer_settlements(db, customer_id, skip, limit)


@router.get(
    "/{customer_id}/credit-settlements/{settlement_id}",
    response_model=schemas.CustomerCreditsSettleWithTransactions,
    summary="Get Credit Settlement Details",
    description="Get settlement with all transaction details",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_customer_credit_settlement(
    customer_id: int,
    settlement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):

    return customer_credit_service.get_settlement_with_transactions(db, settlement_id)
