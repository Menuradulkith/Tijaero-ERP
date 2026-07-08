import csv
import io
from typing import List, Optional

from app.auth.dependencies import (
    get_current_user,
    get_user_branch_filter,
    validate_branch_access,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.inventory import schemas, service
from app.modules.products import service as products_service
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

router = APIRouter()


# Sales Stock Endpoints
@router.get("/sales-stock/export-csv", summary="Export Sales Stock to CSV", dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])
def export_sales_stock_csv(
    branch_code: Optional[str] = None,
    product_id: Optional[int] = None,
    stock_status: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100000, description="Max amount of records to pull"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export sales stock items with optional filters to CSV"""
    # Apply branch-based access control
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )

    sales_stock_service = service.SalesStockService(db)
    items = sales_stock_service.get_all(
        branch_code=branch_code,
        branch_codes=user_branches,
        product_id=product_id,
        status=stock_status,
    )

    if limit:
        items = items[:limit]

    # Pre-fetch products, brands, and categories to avoid N+1 issues but keep it simple here by resolving them
    # For a perfect optimized export, fetching these through joins in service is better,
    # but since this is sales stock export, we can just resolve from items that have relation properties if they exist.

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Barcode",
            "Product",
            "Item Code",
            "Brand",
            "Category",
            "Branch",
            "Location",
            "Status",
            "GRN No",
            "Received Date",
            "Cost Price",
            "Selling Price",
            "Created At",
            "Updated At",
        ]
    )

    for item in items:
        # Depending on how items are returned, they might be SQLAlchemy dicts or Pydantic items
        # from get_all. Let's safely access properties.
        barcode = (
            getattr(item, "barcode", item.get("barcode", ""))
            if isinstance(item, dict)
            else item.barcode
        )
        product_id_val = (
            getattr(item, "product_id", item.get("product_id", None))
            if isinstance(item, dict)
            else item.product_id
        )

        # Get product via items if available, or fetch it. Actually the service get_all seems to attach it in a dict:
        is_dict = isinstance(item, dict)

        # Access attributes
        barcode_val = (
            item.get("barcode", "") if is_dict else getattr(item, "barcode", "")
        )
        branch_val = (
            item.get("branch_code", "") if is_dict else getattr(item, "branch_code", "")
        )
        status_val = item.get("status", "") if is_dict else getattr(item, "status", "")
        grn_no = item.get("grn_no", "") if is_dict else getattr(item, "grn_no", "")
        recv_date = (
            item.get("added_date", "") if is_dict else getattr(item, "added_date", "")
        )
        cost = (
            item.get("cost_price", "") if is_dict else getattr(item, "cost_price", "")
        )
        sell = (
            item.get("selling_price", "")
            if is_dict
            else getattr(item, "selling_price", "")
        )
        loc = (
            item.get("location_name", "")
            if is_dict
            else getattr(item, "location_name", "")
        )

        # Product level elements
        prod_name = (
            item.get("product_name", "")
            if is_dict
            else getattr(item, "product_name", "")
        )
        item_code = (
            item.get("item_code", "") if is_dict else getattr(item, "item_code", "")
        )

        # Create/Update Date - Added to stock table tracking if any
        created_at = (
            getattr(item, "created_at", getattr(item, "added_date", ""))
            if not is_dict
            else item.get("created_at", item.get("added_date", ""))
        )
        updated_at = (
            getattr(item, "updated_at", getattr(item, "updated_date", ""))
            if not is_dict
            else item.get("updated_at", item.get("updated_date", ""))
        )

        # In Python ISO
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        if hasattr(updated_at, "isoformat"):
            updated_at = updated_at.isoformat()
        if hasattr(recv_date, "isoformat"):
            recv_date = recv_date.isoformat()

        # In current inventory design, product relationships might not be fully embedded in dict.
        # But frontend logic extracted some from `getProduct` etc.
        writer.writerow(
            [
                barcode_val,
                prod_name,
                item_code,
                "",
                "",
                branch_val,
                loc,
                status_val,
                grn_no,
                recv_date,
                cost,
                sell,
                created_at,
                updated_at,
            ]
        )

    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=sales_stock.csv"
    return response


@router.get("/sales-stock", response_model=List[schemas.SalesStock], dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])
def get_all_sales_stock(
    branch_code: Optional[str] = None,
    product_id: Optional[int] = None,
    stock_status: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get all sales stock items with optional filters"""
    # Apply branch-based access control
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )

    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_all(
        branch_code=branch_code,
        branch_codes=user_branches,  # Pass list of allowed branches for filtering
        product_id=product_id,
        status=stock_status,
    )


@router.get(
    "/sales-stock/paginated",
    response_model=schemas.SalesStockPaginated,
    dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))],
)
def get_paginated_sales_stock(
    branch_code: Optional[str] = None,
    product_id: Optional[int] = None,
    stock_status: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    brand_id: Optional[int] = None,
    location_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Server-side paginated + filtered sales stock, with branch-scoped KPI summary."""
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )

    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_paginated(
        branch_code=branch_code,
        branch_codes=user_branches,
        product_id=product_id,
        status=stock_status,
        search=search,
        brand_id=brand_id,
        location_id=location_id,
        date_from=date_from,
        date_to=date_to,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/sales-stock",
    response_model=schemas.SalesStock,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_CREATE))],
)
def create_sales_stock(
    item: schemas.SalesStockCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a sales stock item from GRN"""
    # Branch isolation: users may only create stock in branches they can access
    if not validate_branch_access(current_user, item.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {item.branch_code}",
        )
    sales_stock_service = service.SalesStockService(db)
    try:
        return sales_stock_service.create(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sales-stock/check-barcode/{barcode}", dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])
def check_barcode_exists(barcode: str, db: Session = Depends(get_db)):
    """Check if a barcode already exists in sales_stock table"""
    sales_stock_service = service.SalesStockService(db)
    exists = sales_stock_service.barcode_exists(barcode)
    return {"exists": exists, "barcode": barcode}


@router.get("/sales-stock/grn/{grn_id}", response_model=List[schemas.SalesStock], dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])
def get_sales_stock_by_grn(grn_id: int, db: Session = Depends(get_db)):
    """Get all sales stock items for a GRN"""
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_by_grn(grn_id)


@router.get(
    "/sales-stock/branch/{branch_code}", response_model=List[schemas.SalesStock],
    dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))],
)
def get_available_sales_stock(
    branch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all available sales stock items for a branch"""
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {branch_code}",
        )
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_available_by_branch(branch_code)


@router.get("/sales-stock/barcode/{barcode}", dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])
def get_sales_stock_by_barcode(barcode: str, db: Session = Depends(get_db)):
    """Get sales stock item by barcode with enriched product data"""
    sales_stock_service = service.SalesStockService(db)
    item = sales_stock_service.get_by_barcode(barcode)
    if not item:
        raise HTTPException(status_code=404, detail="Sales stock item not found")
    return item


@router.patch("/sales-stock/{id}/status", dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_UPDATE))])
def update_sales_stock_status(
    id: int,
    status: str = Query(
        ..., description="New status: available, reserved or damaged"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Update sales stock item status (manual transitions only, audited)."""
    sales_stock_service = service.SalesStockService(db)
    try:
        item = sales_stock_service.update_status(
            id, status, user_id=current_user.id, allowed_branches=user_branches
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not item:
        raise HTTPException(status_code=404, detail="Sales stock item not found")
    return item


@router.get("/sales-stock/{id}/tracking", dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])
def get_sales_stock_tracking(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get full tracking timeline for a sales stock item.

    Aggregates events from GRN, invoices, sale returns, purchase returns,
    and item transfer notes into a chronological timeline.
    """
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_tracking(id)


# Company Assets Endpoints - Real table for company-owned items
@router.get("/company-assets", response_model=List[schemas.CompanyAsset], dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_VIEW))])
def get_all_company_assets(
    branch_code: Optional[str] = None,
    product_id: Optional[int] = None,
    asset_status: Optional[str] = Query(None, alias="status"),
    source: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get all company assets with optional filters"""
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )

    company_asset_service = service.CompanyAssetService(db)
    return company_asset_service.get_all(
        branch_code=branch_code,
        branch_codes=user_branches,
        product_id=product_id,
        status=asset_status,
        source=source,
    )


@router.post(
    "/company-assets",
    response_model=schemas.CompanyAsset,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_CREATE))],
)
def create_company_asset(
    item: schemas.CompanyAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a company asset from GRN"""
    # Branch isolation: users may only create assets in branches they can access
    if not validate_branch_access(current_user, item.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {item.branch_code}",
        )
    company_asset_service = service.CompanyAssetService(db)
    try:
        return company_asset_service.create(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/company-assets/check-barcode/{barcode}", dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_VIEW))])
def check_company_asset_barcode_exists(barcode: str, db: Session = Depends(get_db)):
    """Check if a barcode already exists in company_assets table"""
    company_asset_service = service.CompanyAssetService(db)
    exists = company_asset_service.barcode_exists(barcode)
    return {"exists": exists, "barcode": barcode}


@router.get("/company-assets/grn/{grn_id}", response_model=List[schemas.CompanyAsset], dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_VIEW))])
def get_company_assets_by_grn(grn_id: int, db: Session = Depends(get_db)):
    """Get all company assets for a GRN"""
    company_asset_service = service.CompanyAssetService(db)
    return company_asset_service.get_by_grn(grn_id)


@router.get(
    "/company-assets/branch/{branch_code}", response_model=List[schemas.CompanyAsset],
    dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_VIEW))],
)
def get_company_assets_by_branch(
    branch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all company assets for a branch"""
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {branch_code}",
        )
    company_asset_service = service.CompanyAssetService(db)
    return company_asset_service.get_by_branch(branch_code)


@router.get("/company-assets/barcode/{barcode}", response_model=schemas.CompanyAsset, dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_VIEW))])
def get_company_asset_by_barcode(barcode: str, db: Session = Depends(get_db)):
    """Get company asset by barcode"""
    company_asset_service = service.CompanyAssetService(db)
    item = company_asset_service.get_by_barcode(barcode)
    if not item:
        raise HTTPException(status_code=404, detail="Company asset not found")
    return item


@router.patch("/company-assets/{id}/status", dependencies=[Depends(require_permission(*Permissions.COMPANY_ASSET_UPDATE))])
def update_company_asset_status(
    id: int,
    status: str = Query(
        ..., description="New status: available, in_use, retired, disposed"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Update company asset status (manual transitions only, audited)."""
    company_asset_service = service.CompanyAssetService(db)
    try:
        item = company_asset_service.update_status(
            id, status, user_id=current_user.id, allowed_branches=user_branches
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not item:
        raise HTTPException(status_code=404, detail="Company asset not found")
    return item
