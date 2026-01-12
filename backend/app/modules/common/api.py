from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from typing import List
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/common", tags=["common"])

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
