from fastapi import APIRouter, Depends, status, Query, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.session import get_db
from app.auth.models import User
from app.auth.dependencies import get_current_user, get_user_branch_filter, validate_branch_access
from app.modules.inventory import schemas, service

router = APIRouter()

# Sales Stock Endpoints
@router.get("/sales-stock", response_model=List[schemas.SalesStock])
def get_all_sales_stock(
    branch_code: Optional[str] = None,
    product_id: Optional[int] = None,
    stock_status: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter)
):
    """Get all sales stock items with optional filters"""
    # Apply branch-based access control
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}"
            )
    
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_all(
        branch_code=branch_code,
        branch_codes=user_branches,  # Pass list of allowed branches for filtering
        product_id=product_id,
        status=stock_status
    )


@router.post("/sales-stock", response_model=schemas.SalesStock, status_code=status.HTTP_201_CREATED)
def create_sales_stock(
    item: schemas.SalesStockCreate,
    db: Session = Depends(get_db)
):
    """Create a sales stock item from GRN"""
    sales_stock_service = service.SalesStockService(db)
    try:
        return sales_stock_service.create(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sales-stock/check-barcode/{barcode}")
def check_barcode_exists(barcode: str, db: Session = Depends(get_db)):
    """Check if a barcode already exists in sales_stock table"""
    sales_stock_service = service.SalesStockService(db)
    exists = sales_stock_service.barcode_exists(barcode)
    return {"exists": exists, "barcode": barcode}


@router.get("/sales-stock/grn/{grn_id}", response_model=List[schemas.SalesStock])
def get_sales_stock_by_grn(grn_id: int, db: Session = Depends(get_db)):
    """Get all sales stock items for a GRN"""
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_by_grn(grn_id)


@router.get("/sales-stock/branch/{branch_code}", response_model=List[schemas.SalesStock])
def get_available_sales_stock(
    branch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all available sales stock items for a branch"""
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {branch_code}"
        )
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_available_by_branch(branch_code)


@router.get("/sales-stock/barcode/{barcode}")
def get_sales_stock_by_barcode(barcode: str, db: Session = Depends(get_db)):
    """Get sales stock item by barcode with enriched product data"""
    sales_stock_service = service.SalesStockService(db)
    item = sales_stock_service.get_by_barcode(barcode)
    if not item:
        raise HTTPException(status_code=404, detail="Sales stock item not found")
    return item


@router.patch("/sales-stock/{id}/status")
def update_sales_stock_status(
    id: int,
    status: str = Query(..., description="New status: available, sold, reserved, returned"),
    db: Session = Depends(get_db)
):
    """Update sales stock item status"""
    sales_stock_service = service.SalesStockService(db)
    item = sales_stock_service.update_status(id, status)
    if not item:
        raise HTTPException(status_code=404, detail="Sales stock item not found")
    return item


@router.get("/sales-stock/{id}/tracking")
def get_sales_stock_tracking(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get full tracking timeline for a sales stock item.
    
    Aggregates events from GRN, invoices, sale returns, purchase returns,
    and item transfer notes into a chronological timeline.
    """
    sales_stock_service = service.SalesStockService(db)
    return sales_stock_service.get_tracking(id)


# Company Assets Endpoints - Real table for company-owned items
@router.post("/company-assets", response_model=schemas.CompanyAsset, status_code=status.HTTP_201_CREATED)
def create_company_asset(
    item: schemas.CompanyAssetCreate,
    db: Session = Depends(get_db)
):
    """Create a company asset from GRN"""
    company_asset_service = service.CompanyAssetService(db)
    try:
        return company_asset_service.create(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/company-assets/check-barcode/{barcode}")
def check_company_asset_barcode_exists(barcode: str, db: Session = Depends(get_db)):
    """Check if a barcode already exists in company_assets table"""
    company_asset_service = service.CompanyAssetService(db)
    exists = company_asset_service.barcode_exists(barcode)
    return {"exists": exists, "barcode": barcode}


@router.get("/company-assets/grn/{grn_id}", response_model=List[schemas.CompanyAsset])
def get_company_assets_by_grn(grn_id: int, db: Session = Depends(get_db)):
    """Get all company assets for a GRN"""
    company_asset_service = service.CompanyAssetService(db)
    return company_asset_service.get_by_grn(grn_id)


@router.get("/company-assets/branch/{branch_code}", response_model=List[schemas.CompanyAsset])
def get_company_assets_by_branch(
    branch_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all company assets for a branch"""
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {branch_code}"
        )
    company_asset_service = service.CompanyAssetService(db)
    return company_asset_service.get_by_branch(branch_code)


@router.get("/company-assets/barcode/{barcode}", response_model=schemas.CompanyAsset)
def get_company_asset_by_barcode(barcode: str, db: Session = Depends(get_db)):
    """Get company asset by barcode"""
    company_asset_service = service.CompanyAssetService(db)
    item = company_asset_service.get_by_barcode(barcode)
    if not item:
        raise HTTPException(status_code=404, detail="Company asset not found")
    return item


@router.patch("/company-assets/{id}/status")
def update_company_asset_status(
    id: int,
    status: str = Query(..., description="New status: available, in_use, retired, disposed"),
    db: Session = Depends(get_db)
):
    """Update company asset status"""
    company_asset_service = service.CompanyAssetService(db)
    item = company_asset_service.update_status(id, status)
    if not item:
        raise HTTPException(status_code=404, detail="Company asset not found")
    return item
