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


# ==================== COUPON ENDPOINTS ====================

@router.get(
    "/coupons/",
    response_model=List[schemas.CustomerCuponCodes],
    summary="List All Coupons",
    description="Get list of all coupons with pagination",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def list_coupons(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of records to return"),
    active_only: bool = Query(False, description="Only return active coupons"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get all coupons with usage count"""
    return service.coupon_service.get_all_coupons(db, skip, limit, active_only)


@router.get(
    "/coupons/{coupon_id}",
    response_model=schemas.CustomerCuponCodes,
    summary="Get Coupon by ID",
    description="Retrieve coupon details by ID",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get a single coupon by ID"""
    return service.coupon_service.get_coupon(db, coupon_id)


@router.get(
    "/coupons/code/{coupon_code}",
    response_model=schemas.CustomerCuponCodes,
    summary="Get Coupon by Code",
    description="Retrieve coupon details by barcode/code",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_coupon_by_code(
    coupon_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get a coupon by its code/barcode"""
    from fastapi import HTTPException
    coupon = service.coupon_service.get_coupon_by_code(db, coupon_code)
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return coupon


@router.post(
    "/coupons/",
    response_model=schemas.CustomerCuponCodes,
    status_code=status.HTTP_201_CREATED,
    summary="Create Coupon",
    description="Create a new coupon",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_CREATE))]
)
def create_coupon(
    coupon: schemas.CustomerCuponCodesCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_CREATE))
):
    """Create a new coupon"""
    return service.coupon_service.create_coupon(db, coupon)


@router.put(
    "/coupons/{coupon_id}",
    response_model=schemas.CustomerCuponCodes,
    summary="Update Coupon",
    description="Update an existing coupon",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))]
)
def update_coupon(
    coupon_id: int,
    coupon: schemas.CustomerCuponCodesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE))
):
    """Update an existing coupon"""
    return service.coupon_service.update_coupon(db, coupon_id, coupon)


@router.delete(
    "/coupons/{coupon_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Coupon",
    description="Delete a coupon (only if not used)",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_DELETE))]
)
def delete_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_DELETE))
):
    """Delete a coupon"""
    return service.coupon_service.delete_coupon(db, coupon_id)


@router.post(
    "/coupons/validate",
    response_model=schemas.CouponValidationResponse,
    summary="Validate Coupon",
    description="Validate a coupon for use on an invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def validate_coupon(
    request: schemas.CouponValidationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Validate a coupon code for use on an invoice"""
    return service.coupon_service.validate_coupon(db, request)


@router.get(
    "/coupons/{coupon_id}/usage",
    response_model=List[schemas.CouponUsage],
    summary="Get Coupon Usage History",
    description="Get usage history for a coupon",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_coupon_usage_history(
    coupon_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get usage history for a coupon"""
    return service.coupon_service.get_coupon_usage_history(db, coupon_id, skip, limit)


# ==================== GIFT VOUCHER ENDPOINTS ====================

@router.get(
    "/vouchers/",
    response_model=List[schemas.GiftVoucher],
    summary="List All Gift Vouchers",
    description="Get list of all gift vouchers with pagination",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def list_vouchers(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of records to return"),
    active_only: bool = Query(False, description="Only return active vouchers"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get all gift vouchers"""
    return service.voucher_service.get_all_vouchers(db, skip, limit, active_only)


@router.get(
    "/vouchers/{voucher_id}",
    response_model=schemas.GiftVoucher,
    summary="Get Voucher by ID",
    description="Retrieve voucher details by ID",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_voucher(
    voucher_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get a single voucher by ID"""
    return service.voucher_service.get_voucher(db, voucher_id)


@router.get(
    "/vouchers/barcode/{barcode_no}",
    response_model=schemas.GiftVoucher,
    summary="Get Voucher by Barcode",
    description="Retrieve voucher details by barcode number",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_voucher_by_barcode(
    barcode_no: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get a voucher by its barcode"""
    from fastapi import HTTPException
    voucher = service.voucher_service.get_voucher_by_barcode(db, barcode_no)
    if not voucher:
        raise HTTPException(status_code=404, detail="Voucher not found")
    return voucher


@router.post(
    "/vouchers/",
    response_model=schemas.GiftVoucher,
    status_code=status.HTTP_201_CREATED,
    summary="Create Gift Voucher",
    description="Create a new gift voucher",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_CREATE))]
)
def create_voucher(
    voucher: schemas.GiftVoucherCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_CREATE))
):
    """Create a new gift voucher"""
    return service.voucher_service.create_voucher(db, voucher)


@router.put(
    "/vouchers/{voucher_id}",
    response_model=schemas.GiftVoucher,
    summary="Update Voucher",
    description="Update an existing voucher",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))]
)
def update_voucher(
    voucher_id: int,
    voucher: schemas.GiftVoucherUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE))
):
    """Update an existing voucher"""
    return service.voucher_service.update_voucher(db, voucher_id, voucher)


@router.delete(
    "/vouchers/{voucher_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Voucher",
    description="Delete a voucher (only if not used)",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_DELETE))]
)
def delete_voucher(
    voucher_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_DELETE))
):
    """Delete a voucher"""
    return service.voucher_service.delete_voucher(db, voucher_id)


@router.post(
    "/vouchers/validate",
    response_model=schemas.VoucherValidationResponse,
    summary="Validate Gift Voucher",
    description="Validate a gift voucher for use on an invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def validate_voucher(
    request: schemas.VoucherValidationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Validate a gift voucher code for use on an invoice"""
    return service.voucher_service.validate_voucher(db, request)


@router.post(
    "/vouchers/redeem",
    response_model=schemas.VoucherRedeemResponse,
    summary="Redeem Gift Voucher",
    description="Redeem a gift voucher on an invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def redeem_voucher(
    redemption: schemas.VoucherRedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """Redeem a gift voucher on an invoice"""
    return service.voucher_service.redeem_voucher_api(db, redemption)


@router.get(
    "/vouchers/{voucher_id}/usage",
    response_model=List[schemas.VoucherUsage],
    summary="Get Voucher Usage History",
    description="Get usage history for a voucher",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def get_voucher_usage_history(
    voucher_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    """Get usage history for a voucher"""
    return service.voucher_service.get_voucher_usage_history(db, voucher_id, skip, limit)
