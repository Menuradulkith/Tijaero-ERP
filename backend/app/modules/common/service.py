from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from fastapi import HTTPException, status
from app.core import timezone as tz
from . import schemas
from .models import Country, Locations, Approvals

class CountryService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_all(self) -> List[Country]:
        return self.db.query(Country).order_by(Country.name).all()
    
    def get_by_id(self, country_id: int) -> Country:
        country = self.db.query(Country).filter(Country.id == country_id).first()
        if not country:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Country with id {country_id} not found"
            )
        return country

class LocationService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_all(self) -> List[Locations]:
        return self.db.query(Locations).order_by(Locations.name).all()
    
    def get_by_branch(self, branch_code: str) -> List[Locations]:
        return self.db.query(Locations).filter(Locations.branch_code == branch_code).order_by(Locations.name).all()
    
    def get_by_id(self, location_id: int) -> Locations:
        location = self.db.query(Locations).filter(Locations.id == location_id).first()
        if not location:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Location with id {location_id} not found"
            )
        return location
    
    def _ensure_branch_has_no_location(self, branch_code: str, exclude_id: Optional[int] = None) -> None:
        """Each branch has exactly one location. The branch row is locked first
        so two concurrent creates cannot both pass the check."""
        from app.auth.models import Branch

        branch = self.db.query(Branch).filter(Branch.branch_code == branch_code).with_for_update().first()
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Branch {branch_code} not found",
            )
        query = self.db.query(Locations.id).filter(Locations.branch_code == branch_code)
        if exclude_id is not None:
            query = query.filter(Locations.id != exclude_id)
        if query.first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This branch already has a location. Edit the existing location instead.",
            )

    def create(self, data: schemas.LocationCreate) -> Locations:
        self._ensure_branch_has_no_location(data.branch_code)
        location = Locations(
            name=data.name,
            branch_code=data.branch_code,
            created_date=tz.now()
        )
        self.db.add(location)
        self.db.commit()
        self.db.refresh(location)
        return location
    
    def update(self, location_id: int, data: schemas.LocationCreate) -> Locations:
        location = self.get_by_id(location_id)
        if data.branch_code != location.branch_code:
            self._ensure_branch_has_no_location(data.branch_code, exclude_id=location_id)
        location.name = data.name
        location.branch_code = data.branch_code
        self.db.commit()
        self.db.refresh(location)
        return location
    
    def delete(self, location_id: int) -> bool:
        location = self.get_by_id(location_id)
        self.db.delete(location)
        self.db.commit()
        return True

class ApprovalService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_by_id(self, approval_id: int) -> Approvals:
        approval = self.db.query(Approvals).filter(Approvals.id == approval_id).first()
        if not approval:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval with id {approval_id} not found"
            )
        return approval
    
    def create(self, data: schemas.ApprovalCreate) -> Approvals:
        approval = Approvals(**data.model_dump())
        self.db.add(approval)
        self.db.commit()
        self.db.refresh(approval)
        return approval
    
    def update(self, approval_id: int, data: schemas.ApprovalUpdate) -> Approvals:
        approval = self.get_by_id(approval_id)
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(approval, field, value)
        self.db.commit()
        self.db.refresh(approval)
        return approval
