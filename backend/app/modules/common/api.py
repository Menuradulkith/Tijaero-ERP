from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/common", tags=["common"])


# ==================== AGGREGATED REFERENCE DATA ====================
# This endpoint reduces multiple API calls to one for better performance

@router.get("/reference-data", response_model=schemas.ReferenceDataResponse)
def get_reference_data(
    include: str = Query(
        "branches",
        description="Comma-separated list of data to include: branches,categories,brands,locations,products,countries,suppliers,customers"
    ),
    products_limit: int = Query(500, ge=1, le=2000, description="Max products to return"),
    db: Session = Depends(get_db)
):
    """
    Get multiple reference datasets in a single API call.
    
    This endpoint is optimized for reducing the number of API calls needed
    when loading pages that require multiple reference datasets.
    
    Example usage:
    - /common/reference-data?include=branches,categories,brands
    - /common/reference-data?include=branches,locations,products&products_limit=200
    """
    includes = [i.strip().lower() for i in include.split(",")]
    result = {}
    
    if "branches" in includes:
        from app.modules.branches.service import branch_service
        branches = branch_service.get_all_branches(db, skip=0, limit=100)
        result["branches"] = [{"id": b.id, "branch_code": b.branch_code, "branch_name": b.branch_name} for b in branches]
    
    if "categories" in includes:
        from app.modules.products.service import category_service
        categories = category_service.get_all_categories(db, skip=0, limit=1000, active_only=False)
        result["categories"] = [{"id": c.id, "name": c.name, "is_active": c.is_active} for c in categories]
    
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
                "items_brand_id": p.items_brand_id
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
    
    return result


# Country Endpoints
@router.get("/countries", response_model=List[schemas.Country])
def list_countries(db: Session = Depends(get_db)):
    """List all countries"""
    country_service = service.CountryService(db)
    return country_service.get_all()

@router.get("/countries/{country_id}", response_model=schemas.Country)
def get_country(country_id: int, db: Session = Depends(get_db)):
    """Get country by ID"""
    country_service = service.CountryService(db)
    return country_service.get_by_id(country_id)

# Location Endpoints
@router.get("/locations", response_model=List[schemas.Location])
def list_locations(branch_code: str = None, db: Session = Depends(get_db)):
    """List all locations (good received locations), optionally filtered by branch_code"""
    location_service = service.LocationService(db)
    if branch_code:
        return location_service.get_by_branch(branch_code)
    return location_service.get_all()

@router.get("/locations/{location_id}", response_model=schemas.Location)
def get_location(location_id: int, db: Session = Depends(get_db)):
    """Get location by ID"""
    location_service = service.LocationService(db)
    return location_service.get_by_id(location_id)

@router.post("/locations", response_model=schemas.Location, status_code=status.HTTP_201_CREATED)
def create_location(location: schemas.LocationCreate, db: Session = Depends(get_db)):
    """Create a new location"""
    location_service = service.LocationService(db)
    return location_service.create(location)

@router.put("/locations/{location_id}", response_model=schemas.Location)
def update_location(location_id: int, location: schemas.LocationCreate, db: Session = Depends(get_db)):
    """Update a location"""
    location_service = service.LocationService(db)
    return location_service.update(location_id, location)

@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int, db: Session = Depends(get_db)):
    """Delete a location"""
    location_service = service.LocationService(db)
    location_service.delete(location_id)

# Approval Endpoints
@router.get("/approvals/{approval_id}", response_model=schemas.Approval)
def get_approval(approval_id: int, db: Session = Depends(get_db)):
    """Get approval by ID"""
    approval_service = service.ApprovalService(db)
    return approval_service.get_by_id(approval_id)

@router.post("/approvals", response_model=schemas.Approval, status_code=status.HTTP_201_CREATED)
def create_approval(approval: schemas.ApprovalCreate, db: Session = Depends(get_db)):
    """Create a new approval record"""
    approval_service = service.ApprovalService(db)
    return approval_service.create(approval)

@router.patch("/approvals/{approval_id}", response_model=schemas.Approval)
def update_approval(approval_id: int, approval: schemas.ApprovalUpdate, db: Session = Depends(get_db)):
    """Update an approval record"""
    approval_service = service.ApprovalService(db)
    return approval_service.update(approval_id, approval)
