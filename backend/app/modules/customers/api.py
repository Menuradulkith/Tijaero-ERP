from typing import List, Optional

from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.customers import schemas, service
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

# All customer endpoints require authentication
router = APIRouter(dependencies=[Depends(get_current_active_user)])


@router.get(
    "/",
    response_model=List[schemas.Customer],
    summary="List All Customers",
    description="Get list of all customers with pagination",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def list_customers(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(
        100, ge=1, le=1000, description="Maximum number of records to return"
    ),
    active_only: bool = Query(False, description="Only return active customers"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    return service.customer_service.get_all_customers(db, skip, limit, active_only)


@router.get(
    "/search",
    response_model=List[schemas.Customer],
    summary="Search Customers",
    description="Search customers by name, email, or phone",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def search_customers(
    q: str = Query(..., min_length=1, description="Search query"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    return service.customer_service.search_customers(db, q, skip, limit)


import csv
import io

from fastapi.responses import StreamingResponse


@router.get(
    "/export-csv",
    summary="Export Customers to CSV",
    description="Export all customers or filtered customers to CSV format",
)
def export_customers_csv(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(
        100000, ge=1, le=100000, description="Maximum number of records to export"
    ),
    active_only: bool = Query(False, description="Only export active customers"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    customers = service.customer_service.get_all_customers(db, skip, limit, active_only)

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(
        [
            "Title",
            "Customer Name",
            "Email",
            "Mobile Contact",
            "Home Contact",
            "Company Name",
            "Occupation",
            "Gender",
            "Civil Status",
            "No of Kids",
            "Birthdate",
            "ID Card Number",
            "Passport No",
            "Payment Address",
            "Delivery Address",
            "Bank Details",
            "Name in Cheque/Card",
            "Credit Days",
            "Max Credit Limit",
            "Active",
            "Agent",
            "Commission Rate",
            "Created At",
            "Updated At",
        ]
    )

    for customer in customers:
        writer.writerow(
            [
                customer.title or "",
                customer.customer_name or "",
                customer.email or "",
                customer.mobile_contact_number or "",
                customer.home_contact_number or "",
                customer.company_name or "",
                customer.occupation or "",
                "Male" if customer.gender == "m" else "Female",
                customer.civil_status or "",
                customer.no_of_kids or "0",
                customer.birthdate or "",
                customer.id_card_number or "",
                customer.passport_no or "",
                customer.payment_address or "",
                customer.delivery_address or "",
                customer.bank_details or "",
                customer.name_in_cheque_card or "",
                customer.credit_days or 0,
                customer.max_credit_limit or 0,
                "Yes" if customer.active else "No",
                "Yes" if customer.is_customer_agent else "No",
                customer.commission_rate or 0,
                (
                    customer.created_at.isoformat()
                    if getattr(customer, "created_at", None)
                    else ""
                ),
                (
                    customer.updated_at.isoformat()
                    if getattr(customer, "updated_at", None)
                    else ""
                ),
            ]
        )

    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    # prepend utf-8 BOM
    response.headers["Content-Disposition"] = "attachment; filename=customers.csv"
    return response


@router.get(
    "/{customer_id}",
    response_model=schemas.Customer,
    summary="Get Customer by ID",
    description="Retrieve customer details by ID",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    return service.customer_service.get_customer(db, customer_id)


@router.post(
    "/",
    response_model=schemas.Customer,
    status_code=status.HTTP_201_CREATED,
    summary="Create Customer",
    description="Create a new customer record",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_CREATE))],
)
def create_customer(
    customer: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_CREATE)),
):
    return service.customer_service.create_customer(db, customer, current_user.id)


@router.put(
    "/{customer_id}",
    response_model=schemas.Customer,
    summary="Update Customer",
    description="Update an existing customer",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))],
)
def update_customer(
    customer_id: int,
    customer: schemas.CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE)),
):
    return service.customer_service.update_customer(
        db, customer_id, customer, current_user.id
    )


@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Customer",
    description="Delete a customer",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_DELETE))],
)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_DELETE)),
):

    return service.customer_service.delete_customer(db, customer_id)


from datetime import date

from app.modules.customers.credit_service import customer_credit_service


@router.get(
    "/{customer_id}/credit-summary",
    summary="Get Customer Credit Summary",
    description="Get complete credit status including limits, outstanding, and aging",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_customer_credit_summary(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    return customer_credit_service.get_customer_credit_summary(db, customer_id)


@router.post(
    "/{customer_id}/credit-check",
    summary="Check Credit Availability",
    description="Validate if a credit sale can be made",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def check_customer_credit(
    customer_id: int,
    sale_amount: float = Query(..., description="Amount of the proposed credit sale"),
    allow_over_limit: bool = Query(
        False, description="Allow sale if over limit (warning only)"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    from decimal import Decimal

    return customer_credit_service.check_credit_availability(
        db, customer_id, Decimal(str(sale_amount)), allow_over_limit
    )


@router.post(
    "/{customer_id}/credit-sale-validation",
    summary="Comprehensive Credit Sale Validation",
    description="Full validation for credit sales including time restriction, customer eligibility, and credit limit check",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def validate_credit_sale_comprehensive(
    customer_id: int,
    sale_amount: float = Query(..., description="Amount of the proposed credit sale"),
    skip_time_check: bool = Query(False, description="Skip time restriction check"),
    allow_over_limit: bool = Query(
        False, description="Allow if over limit (requires approval)"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """
    Comprehensive validation for credit sales.
    Checks:
    1. Time restriction (09:00 AM - 06:00 PM unless skipped)
    2. Customer eligibility (active, name, phone, email, address)
    3. Credit limit (blocking by default)
    4. Overdue invoices (warning)
    """
    from decimal import Decimal

    return customer_credit_service.validate_credit_sale_comprehensive(
        db,
        customer_id,
        Decimal(str(sale_amount)),
        skip_time_check=skip_time_check,
        allow_over_limit=allow_over_limit,
    )


@router.get(
    "/{customer_id}/aging-report",
    summary="Get Customer Aging Report",
    description="Get aging report for customer receivables",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_customer_aging_report(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    return customer_credit_service.get_aging_report(db, customer_id)


@router.get(
    "/reports/aging",
    summary="Get All Customers Aging Report",
    description="Get aging report for all customer receivables",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_all_customers_aging_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    return customer_credit_service.get_aging_report(db)


@router.get(
    "/{customer_id}/statement",
    summary="Get Customer Statement",
    description="Get detailed statement of all credit transactions",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_customer_statement(
    customer_id: int,
    from_date: Optional[date] = Query(None, description="Start date for statement"),
    to_date: Optional[date] = Query(None, description="End date for statement"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    return customer_credit_service.get_customer_statement(
        db, customer_id, from_date, to_date
    )


@router.post(
    "/{customer_id}/credit-settlements",
    response_model=schemas.CustomerCreditsSettle,
    status_code=status.HTTP_201_CREATED,
    summary="Create Credit Settlement",
    description="Record payment received against credit invoices",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))],
)
def create_customer_credit_settlement(
    customer_id: int,
    settlement: schemas.CustomerCreditsSettleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE)),
):

    if settlement.customers_id != customer_id:
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Settlement customer_id doesn't match URL customer_id",
        )
    return customer_credit_service.create_credit_settlement(db, settlement)


@router.get(
    "/{customer_id}/credit-settlements",
    response_model=List[schemas.CustomerCreditsSettle],
    summary="List Customer Credit Settlements",
    description="Get all credit settlements for a customer",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def list_customer_credit_settlements(
    customer_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    return customer_credit_service.get_customer_settlements(
        db, customer_id, skip, limit
    )


@router.get(
    "/{customer_id}/credit-settlements/{settlement_id}",
    response_model=schemas.CustomerCreditsSettleWithTransactions,
    summary="Get Credit Settlement Details",
    description="Get settlement with all transaction details",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_customer_credit_settlement(
    customer_id: int,
    settlement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):

    return customer_credit_service.get_settlement_with_transactions(db, settlement_id)


# ==================== PAYMENT REPORT ENDPOINT ====================


@router.get(
    "/payments/report",
    response_model=schemas.CustomerPaymentReport,
    summary="Customer Payment Report",
    description="Consolidated report of all customer credit settlements",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_customer_payment_report(
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    customer_id: Optional[int] = Query(None),
    branch_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    from datetime import date as date_type

    parsed_from = date_type.fromisoformat(date_from) if date_from else None
    parsed_to = date_type.fromisoformat(date_to) if date_to else None
    return customer_credit_service.get_payment_report(
        db, parsed_from, parsed_to, customer_id, branch_code
    )


# ==================== OUTSTANDING DOCUMENTS ENDPOINT ====================


@router.get(
    "/outstanding-documents",
    response_model=schemas.OutstandingDocumentsReport,
    summary="Outstanding Documents Report",
    description="All unpaid/partial credit invoices across all customers",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_outstanding_documents(
    customer_id: Optional[int] = Query(None),
    branch_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    return customer_credit_service.get_outstanding_documents(
        db, customer_id=customer_id, branch_code=branch_code
    )


# ==================== COUPON ENDPOINTS ====================


@router.get(
    "/coupons/",
    response_model=List[schemas.CustomerCuponCodes],
    summary="List All Coupons",
    description="Get list of all coupons with pagination",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def list_coupons(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(
        100, ge=1, le=1000, description="Maximum number of records to return"
    ),
    active_only: bool = Query(False, description="Only return active coupons"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """Get all coupons with usage count"""
    return service.coupon_service.get_all_coupons(db, skip, limit, active_only)


@router.get(
    "/coupons/{coupon_id}",
    response_model=schemas.CustomerCuponCodes,
    summary="Get Coupon by ID",
    description="Retrieve coupon details by ID",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """Get a single coupon by ID"""
    return service.coupon_service.get_coupon(db, coupon_id)


@router.get(
    "/coupons/code/{coupon_code}",
    response_model=schemas.CustomerCuponCodes,
    summary="Get Coupon by Code",
    description="Retrieve coupon details by barcode/code",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_coupon_by_code(
    coupon_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
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
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_CREATE))],
)
def create_coupon(
    coupon: schemas.CustomerCuponCodesCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_CREATE)),
):
    """Create a new coupon"""
    return service.coupon_service.create_coupon(db, coupon)


@router.put(
    "/coupons/{coupon_id}",
    response_model=schemas.CustomerCuponCodes,
    summary="Update Coupon",
    description="Update an existing coupon",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))],
)
def update_coupon(
    coupon_id: int,
    coupon: schemas.CustomerCuponCodesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE)),
):
    """Update an existing coupon"""
    return service.coupon_service.update_coupon(db, coupon_id, coupon)


@router.delete(
    "/coupons/{coupon_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Coupon",
    description="Delete a coupon (only if not used)",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_DELETE))],
)
def delete_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_DELETE)),
):
    """Delete a coupon"""
    return service.coupon_service.delete_coupon(db, coupon_id)


@router.post(
    "/coupons/validate",
    response_model=schemas.CouponValidationResponse,
    summary="Validate Coupon",
    description="Validate a coupon for use on an invoice",
    dependencies=[Depends(require_permission(*Permissions.COUPON_VIEW))],
)
def validate_coupon(
    request: schemas.CouponValidationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.COUPON_VIEW)),
):
    """Validate a coupon code for use on an invoice"""
    return service.coupon_service.validate_coupon(db, request)


@router.get(
    "/coupons/{coupon_id}/usage",
    response_model=List[schemas.CouponUsage],
    summary="Get Coupon Usage History",
    description="Get usage history for a coupon",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_coupon_usage_history(
    coupon_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """Get usage history for a coupon"""
    return service.coupon_service.get_coupon_usage_history(db, coupon_id, skip, limit)


# ==================== GIFT VOUCHER ENDPOINTS ====================


@router.get(
    "/vouchers/",
    response_model=List[schemas.GiftVoucher],
    summary="List All Gift Vouchers",
    description="Get list of all gift vouchers with pagination",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def list_vouchers(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(
        100, ge=1, le=1000, description="Maximum number of records to return"
    ),
    active_only: bool = Query(False, description="Only return active vouchers"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """Get all gift vouchers"""
    return service.voucher_service.get_all_vouchers(db, skip, limit, active_only)


@router.get(
    "/vouchers/{voucher_id}",
    response_model=schemas.GiftVoucher,
    summary="Get Voucher by ID",
    description="Retrieve voucher details by ID",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_voucher(
    voucher_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """Get a single voucher by ID"""
    return service.voucher_service.get_voucher(db, voucher_id)


@router.get(
    "/vouchers/barcode/{barcode_no}",
    response_model=schemas.GiftVoucher,
    summary="Get Voucher by Barcode",
    description="Retrieve voucher details by barcode number",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_voucher_by_barcode(
    barcode_no: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
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
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_CREATE))],
)
def create_voucher(
    voucher: schemas.GiftVoucherCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_CREATE)),
):
    """Create a new gift voucher"""
    return service.voucher_service.create_voucher(db, voucher)


@router.put(
    "/vouchers/{voucher_id}",
    response_model=schemas.GiftVoucher,
    summary="Update Voucher",
    description="Update an existing voucher",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_UPDATE))],
)
def update_voucher(
    voucher_id: int,
    voucher: schemas.GiftVoucherUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_UPDATE)),
):
    """Update an existing voucher"""
    return service.voucher_service.update_voucher(db, voucher_id, voucher)


@router.delete(
    "/vouchers/{voucher_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Voucher",
    description="Delete a voucher (only if not used)",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_DELETE))],
)
def delete_voucher(
    voucher_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_DELETE)),
):
    """Delete a voucher"""
    return service.voucher_service.delete_voucher(db, voucher_id)


@router.post(
    "/vouchers/validate",
    response_model=schemas.VoucherValidationResponse,
    summary="Validate Gift Voucher",
    description="Validate a gift voucher for use on an invoice",
    dependencies=[Depends(require_permission(*Permissions.GIFT_VOUCHER_VIEW))],
)
def validate_voucher(
    request: schemas.VoucherValidationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GIFT_VOUCHER_VIEW)),
):
    """Validate a gift voucher code for use on an invoice"""
    return service.voucher_service.validate_voucher(db, request)


@router.post(
    "/vouchers/redeem",
    response_model=schemas.VoucherRedeemResponse,
    summary="Redeem Gift Voucher",
    description="Redeem a gift voucher on an invoice",
    dependencies=[Depends(require_permission(*Permissions.GIFT_VOUCHER_UPDATE))],
)
def redeem_voucher(
    redemption: schemas.VoucherRedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GIFT_VOUCHER_UPDATE)),
):
    """Redeem a gift voucher on an invoice"""
    return service.voucher_service.redeem_voucher_api(db, redemption)


@router.get(
    "/vouchers/{voucher_id}/usage",
    response_model=List[schemas.VoucherUsage],
    summary="Get Voucher Usage History",
    description="Get usage history for a voucher",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))],
)
def get_voucher_usage_history(
    voucher_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW)),
):
    """Get usage history for a voucher"""
    return service.voucher_service.get_voucher_usage_history(
        db, voucher_id, skip, limit
    )
