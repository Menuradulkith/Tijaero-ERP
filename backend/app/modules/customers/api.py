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
    """
    Get list of all customers with pagination.
    
    **Required Permission**: customers:view
    """
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
    """
    Search customers by name, email, or phone number.
    
    **Required Permission**: customers:view
    """
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
    """
    Get customer information by customer ID.
    
    **Required Permission**: customers:view
    """
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
    """
    Create a new customer with the following information:
    
    - **name**: Customer name (required)
    - **email**: Customer email address (required)
    - **phone**: Contact phone number
    - **customer_type**: Type of customer (individual/business)
    - **address**: Physical address
    - **tax_id**: Tax identification number
    
    **Required Permission**: customers:create
    """
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
    """
    Update customer information.
    
    **Required Permission**: customers:update
    """
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
    """
    Delete a customer by ID.
    
    **Required Permission**: customers:delete
    """
    return service.customer_service.delete_customer(db, customer_id)
