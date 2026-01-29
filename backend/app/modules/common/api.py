from fastapi import APIRouter, Depends, status, Query, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from . import schemas, service
from .approval_service import approval_service as centralized_approval_service, ApprovalType, ApprovalStatus

router = APIRouter(prefix="/common", tags=["common"])




@router.get("/reference-data", response_model=schemas.ReferenceDataResponse)
def get_reference_data(
    include: str = Query(
        "branches",
        description="Comma-separated list of data to include: branches,categories,brands,locations,products,countries,suppliers,customers,employees,sales_stock"
    ),
    products_limit: int = Query(500, ge=1, le=2000, description="Max products to return"),
    db: Session = Depends(get_db)
):

    includes = [i.strip().lower() for i in include.split(",")]
    result = {}
    
    if "branches" in includes:
        from app.modules.branches.service import branch_service
        branches = branch_service.get_all_branches(db, skip=0, limit=100)
        result["branches"] = [{"id": b.id, "branch_code": b.branch_code, "branch_name": b.branch_name} for b in branches]
    
    if "categories" in includes:
        from app.modules.products.service import category_service
        categories = category_service.get_all_categories(db, skip=0, limit=1000, active_only=False)
        result["categories"] = [{"id": c.id, "name": c.name, "active": c.active} for c in categories]
    
    if "brands" in includes:
        from app.modules.products.service import brand_service
        brands = brand_service.get_all_brands(db, skip=0, limit=1000)
        result["brands"] = [{"id": b.id, "brand_name": b.brand_name} for b in brands]
    
    if "locations" in includes:
        location_service = service.LocationService(db)
        locations = location_service.get_all()
        result["locations"] = [{"id": l.id, "name": l.name, "branch_code": l.branch_code} for l in locations]
    
    if "products" in includes:
        from app.modules.products.service import product_service
        products = product_service.get_all_products(db, skip=0, limit=products_limit, active_only=True)
        result["products"] = [
            {
                "id": p.id, 
                "name": p.name, 
                "item_code": p.item_code,
                "category_id": p.category_id,
                "items_brand_id": p.items_brand_id,
                "cost_price": p.cost_price,
                "selling_price": p.selling_price,
                "item_type": p.item_type,
                "website_active": p.website_active,
                "active": p.active,
                "description": p.description,
                "model": p.model,
                "website_price": p.website_price
            } for p in products
        ]
    
    if "countries" in includes:
        country_service = service.CountryService(db)
        countries = country_service.get_all()
        result["countries"] = [{"id": c.id, "name": c.name, "iso": c.iso} for c in countries]
    
    if "suppliers" in includes:
        from app.modules.purchasing.service import SupplierService
        from app.modules.purchasing.schemas import SupplierListFilter
        supplier_service = SupplierService(db)
        suppliers = supplier_service.list_suppliers(SupplierListFilter(active=True, limit=500))
        result["suppliers"] = [{"id": s.id, "full_name": s.full_name, "company_name": s.company_name} for s in suppliers]
    
    if "customers" in includes:
        from app.modules.customers.service import customer_service
        customers = customer_service.get_all_customers(db, skip=0, limit=500)
        result["customers"] = [{"id": c.id, "customer_name": c.customer_name} for c in customers]

    if "employees" in includes:
        from app.modules.employees.service import employee_service
        employees = employee_service.get_all_employees(db, skip=0, limit=500)
        result["employees"] = [{"id": e.id, "employee_id": e.employee_id, "first_name": e.first_name, "last_name": e.last_name, "full_name": f"{e.first_name} {e.last_name}"} for e in employees]

    if "sales_stock" in includes:
        from app.modules.sales.service import sales_service
        # Use the sales service to get available products from stock
        # This returns products grouped with their available quantities
        result["sales_stock"] = sales_service.get_available_products_from_stock(db)
    
    return result

@router.get("/countries", response_model=List[schemas.Country])
def list_countries(db: Session = Depends(get_db)):

    country_service = service.CountryService(db)
    return country_service.get_all()

@router.get("/countries/{country_id}", response_model=schemas.Country)
def get_country(country_id: int, db: Session = Depends(get_db)):

    country_service = service.CountryService(db)
    return country_service.get_by_id(country_id)

@router.get("/locations", response_model=List[schemas.Location])
def list_locations(branch_code: str = None, db: Session = Depends(get_db)):

    location_service = service.LocationService(db)
    if branch_code:
        return location_service.get_by_branch(branch_code)
    return location_service.get_all()

@router.get("/locations/{location_id}", response_model=schemas.Location)
def get_location(location_id: int, db: Session = Depends(get_db)):

    location_service = service.LocationService(db)
    return location_service.get_by_id(location_id)

@router.post("/locations", response_model=schemas.Location, status_code=status.HTTP_201_CREATED)
def create_location(location: schemas.LocationCreate, db: Session = Depends(get_db)):

    location_service = service.LocationService(db)
    return location_service.create(location)

@router.put("/locations/{location_id}", response_model=schemas.Location)
def update_location(location_id: int, location: schemas.LocationCreate, db: Session = Depends(get_db)):

    location_service = service.LocationService(db)
    return location_service.update(location_id, location)

@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int, db: Session = Depends(get_db)):

    location_service = service.LocationService(db)
    location_service.delete(location_id)

@router.get("/approvals/{approval_id}", response_model=schemas.Approval)
def get_approval(approval_id: int, db: Session = Depends(get_db)):

    approval_service = service.ApprovalService(db)
    return approval_service.get_by_id(approval_id)

@router.post("/approvals", response_model=schemas.Approval, status_code=status.HTTP_201_CREATED)
def create_approval(approval: schemas.ApprovalCreate, db: Session = Depends(get_db)):
    approval_service = service.ApprovalService(db)
    return approval_service.create(approval)

@router.patch("/approvals/{approval_id}", response_model=schemas.Approval)
def update_approval(approval_id: int, approval: schemas.ApprovalUpdate, db: Session = Depends(get_db)):
    approval_service = service.ApprovalService(db)
    return approval_service.update(approval_id, approval)


# ============================================================================
# Centralized Approval System Endpoints
# ============================================================================

class ApprovalActionRequest(BaseModel):
    remarks: Optional[str] = None


class ApprovalStatisticsResponse(BaseModel):
    total_pending: int
    pending_by_type: Dict[str, int]


@router.get(
    "/approvals/pending",
    response_model=List[schemas.Approval],
    summary="Get All Pending Approvals",
)
def get_pending_approvals(
    approval_type: Optional[str] = Query(None, description="Filter by type: sales_order, sale_return, purchase_return, etc."),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """
    Get list of all pending approvals across the ERP.
    Permitted users can view and approve these requests.
    """
    type_filter = None
    if approval_type:
        try:
            type_filter = ApprovalType(approval_type)
        except ValueError:
            pass
    
    return centralized_approval_service.get_pending_approvals(db, type_filter, None, skip, limit)


@router.get(
    "/approvals/statistics",
    response_model=ApprovalStatisticsResponse,
    summary="Get Approval Statistics",
)
def get_approval_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get statistics on pending approvals across all modules."""
    return centralized_approval_service.get_approval_statistics(db)


@router.get(
    "/approvals/types",
    response_model=List[str],
    summary="Get Approval Types",
)
def get_approval_types(
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get list of all available approval types."""
    return [t.value for t in ApprovalType]


@router.post(
    "/approvals/{approval_id}/approve",
    response_model=schemas.Approval,
    summary="Approve Request",
)
def approve_request(
    approval_id: int,
    request: ApprovalActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
):
    """
    Approve a pending approval request through the centralized system.
    This will automatically update the status of the related record.
    """
    from .models import Approvals
    
    approval = db.query(Approvals).filter(Approvals.id == approval_id).first()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval record not found"
        )
    
    if approval.status != 'pending':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve. Current status: {approval.status}"
        )
    
    # Parse the approval_for to get type and reference
    if approval.approval_for:
        parts = approval.approval_for.split(":")
        if len(parts) >= 2:
            approval_type = parts[0]
            reference_id = int(parts[1])
            
            # Update the source record based on type
            if approval_type == ApprovalType.SALES_ORDER.value:
                from app.modules.sales.service import sales_service
                sales_service.approve_invoice(db, reference_id, current_user.id)
            elif approval_type == ApprovalType.SALE_RETURN.value:
                from app.modules.sales.service import sales_service
                sales_service.approve_sale_return(db, reference_id, current_user.id)
            elif approval_type == ApprovalType.PURCHASE_RETURN.value:
                from app.modules.purchasing.service import PurchasingReturnService
                return_service = PurchasingReturnService(db)
                return_service.approve_return(reference_id, approve=True, remarks=request.remarks, user_id=current_user.id)
            elif approval_type == ApprovalType.PURCHASE_ORDER.value:
                from app.modules.purchasing.service import PurchasingOrderService
                po_service = PurchasingOrderService(db)
                po_service.approve_order(reference_id, approve=True, remarks=request.remarks, user_id=current_user.id)
            elif approval_type == ApprovalType.ITEM_TRANSFER.value:
                from app.modules.warehouse.service import ItemTransferNoteService
                transfer_service = ItemTransferNoteService(db)
                transfer_service.approve_transfer_note(reference_id, user_id=current_user.id, remarks=request.remarks)
            else:
                # Generic approval update
                approval.status = 'approved'
                approval.status_changed_by = current_user.id
                approval.remark = request.remarks or f"Approved by user {current_user.id}"
                db.commit()
    
    db.refresh(approval)
    return approval


@router.post(
    "/approvals/{approval_id}/reject",
    response_model=schemas.Approval,
    summary="Reject Request",
)
def reject_request(
    approval_id: int,
    request: ApprovalActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
):
    """
    Reject a pending approval request.
    Reason/remarks are required for rejection.
    """
    from .models import Approvals
    
    if not request.remarks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rejection reason is required"
        )
    
    approval = db.query(Approvals).filter(Approvals.id == approval_id).first()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval record not found"
        )
    
    if approval.status != 'pending':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reject. Current status: {approval.status}"
        )
    
    # Parse the approval_for to get type and reference
    if approval.approval_for:
        parts = approval.approval_for.split(":")
        if len(parts) >= 2:
            approval_type = parts[0]
            reference_id = int(parts[1])
            
            # Update the source record based on type
            if approval_type == ApprovalType.SALE_RETURN.value:
                from app.modules.sales.service import sales_service
                sales_service.reject_sale_return(db, reference_id, current_user.id, request.remarks)
            elif approval_type == ApprovalType.PURCHASE_RETURN.value:
                from app.modules.purchasing.service import PurchasingReturnService
                return_service = PurchasingReturnService(db)
                return_service.approve_return(reference_id, approve=False, remarks=request.remarks, user_id=current_user.id)
            elif approval_type == ApprovalType.PURCHASE_ORDER.value:
                from app.modules.purchasing.service import PurchasingOrderService
                po_service = PurchasingOrderService(db)
                po_service.approve_order(reference_id, approve=False, remarks=request.remarks, user_id=current_user.id)
            elif approval_type == ApprovalType.ITEM_TRANSFER.value:
                from app.modules.warehouse.service import ItemTransferNoteService
                transfer_service = ItemTransferNoteService(db)
                transfer_service.reject_transfer_note(reference_id, user_id=current_user.id, remarks=request.remarks)
            elif approval_type == ApprovalType.SALES_ORDER.value:
                # Cancel the credit sales order
                from app.modules.sales.service import sales_service
                sales_service.cancel_invoice(db, reference_id, current_user.id)
                approval.status = 'rejected'
                approval.status_changed_by = current_user.id
                approval.remark = request.remarks
                db.commit()
            else:
                # Generic rejection
                approval.status = 'rejected'
                approval.status_changed_by = current_user.id
                approval.remark = request.remarks
                db.commit()
    
    db.refresh(approval)
    return approval

