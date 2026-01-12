from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from typing import List, Optional
from app.modules.inventory import repository, schemas, models

class InventoryService:
    def get_product(self, db: Session, product_id: int):
        return repository.inventory_repository.get_by_id(db, product_id)


class SalesStockService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_all(
        self,
        branch_code: Optional[str] = None,
        product_id: Optional[int] = None,
        status: Optional[str] = None
    ) -> List[dict]:
        """Get all sales stock items with optional filters, including related data"""
        from sqlalchemy.orm import joinedload
        
        query = self.db.query(models.SalesStock).options(
            joinedload(models.SalesStock.product),
            joinedload(models.SalesStock.good_received_note)
        )
        
        if branch_code:
            query = query.filter(models.SalesStock.branch_code == branch_code)
        if product_id:
            query = query.filter(models.SalesStock.product_id == product_id)
        if status:
            query = query.filter(models.SalesStock.status == status)
        
        items = query.order_by(models.SalesStock.added_date.desc()).all()
        
        # Enrich with GRN number, location, and prices
        result = []
        for item in items:
            item_dict = {
                "id": item.id,
                "product_id": item.product_id,
                "barcode": item.barcode,
                "branch_code": item.branch_code,
                "good_received_note_id": item.good_received_note_id,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "warranty_month": item.warranty_month,
                "status": item.status,
                "added_date": item.added_date,
                "grn_no": item.good_received_note.good_received_no if item.good_received_note else None,
                "location_name": None,  # Will be fetched from location
                "cost_price": item.product.cost_price if item.product else None,
                "selling_price": item.product.selling_price if item.product else None,
            }
            
            # Get location name from GRN if available
            if item.good_received_note and item.good_received_note.good_received_locations_id:
                from app.modules.common.models import Locations
                location = self.db.query(Locations).filter(
                    Locations.id == item.good_received_note.good_received_locations_id
                ).first()
                if location:
                    item_dict["location_name"] = location.name
            
            result.append(item_dict)
        
        return result
    
    def create(self, item: schemas.SalesStockCreate) -> models.SalesStock:
        # Check if barcode already exists (prevent duplicates)
        existing = self.get_by_barcode(item.barcode)
        if existing:
            raise ValueError(f"Barcode '{item.barcode}' already exists in sales stock")
        
        db_item = models.SalesStock(
            product_id=item.product_id,
            barcode=item.barcode,
            branch_code=item.branch_code,
            good_received_note_id=item.good_received_note_id,
            purchasing_order_items_id=item.purchasing_order_items_id,
            warranty_month=item.warranty_month,
            status=item.status,
            added_date=datetime.now()
        )
        try:
            self.db.add(db_item)
            self.db.commit()
            self.db.refresh(db_item)
            return db_item
        except IntegrityError:
            self.db.rollback()
            raise ValueError(f"Barcode '{item.barcode}' already exists in sales stock")
    
    def barcode_exists(self, barcode: str) -> bool:
        """Check if barcode already exists in sales_stock table"""
        return self.db.query(models.SalesStock).filter(
            models.SalesStock.barcode == barcode
        ).first() is not None
    
    def get_by_grn(self, grn_id: int) -> List[models.SalesStock]:
        return self.db.query(models.SalesStock).filter(
            models.SalesStock.good_received_note_id == grn_id
        ).all()
    
    def get_available_by_branch(self, branch_code: str) -> List[models.SalesStock]:
        return self.db.query(models.SalesStock).filter(
            models.SalesStock.branch_code == branch_code,
            models.SalesStock.status == "available"
        ).all()
    
    def get_by_barcode(self, barcode: str) -> models.SalesStock:
        return self.db.query(models.SalesStock).filter(
            models.SalesStock.barcode == barcode
        ).first()
    
    def update_status(self, id: int, status: str) -> models.SalesStock:
        item = self.db.query(models.SalesStock).filter(models.SalesStock.id == id).first()
        if item:
            item.status = status
            self.db.commit()
            self.db.refresh(item)
        return item


class CompanyAssetService:
    """Service for Company Assets - Real table for company-owned items"""
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, item: schemas.CompanyAssetCreate) -> models.CompanyAssets:
        # Check if barcode already exists (prevent duplicates)
        if item.barcode:
            existing = self.get_by_barcode(item.barcode)
            if existing:
                raise ValueError(f"Barcode '{item.barcode}' already exists in company assets")
        
        # Check if inventory_no already exists
        existing_inv = self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.inventory_no == item.inventory_no
        ).first()
        if existing_inv:
            raise ValueError(f"Inventory number '{item.inventory_no}' already exists")
        
        from datetime import datetime
        db_item = models.CompanyAssets(
            product_id=item.product_id,
            inventory_no=item.inventory_no,
            item=item.item,
            description=item.description,
            branch_code=item.branch_code,
            asigned_to=item.asigned_to,
            barcode=item.barcode,
            warranty_month=item.warranty_month,
            good_received_note_id=item.good_received_note_id,
            purchasing_order_items_id=item.purchasing_order_items_id,
            status=item.status,
            added_date=datetime.now()
        )
        try:
            self.db.add(db_item)
            self.db.commit()
            self.db.refresh(db_item)
            return db_item
        except IntegrityError:
            self.db.rollback()
            raise ValueError(f"Barcode '{item.barcode}' or inventory number '{item.inventory_no}' already exists")
    
    def barcode_exists(self, barcode: str) -> bool:
        """Check if barcode already exists in company_assets table"""
        return self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.barcode == barcode
        ).first() is not None
    
    def get_by_branch(self, branch_code: str) -> List[models.CompanyAssets]:
        return self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.branch_code == branch_code
        ).all()
    
    def get_available_by_branch(self, branch_code: str) -> List[models.CompanyAssets]:
        return self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.branch_code == branch_code,
            models.CompanyAssets.status == "available"
        ).all()
    
    def get_by_barcode(self, barcode: str) -> Optional[models.CompanyAssets]:
        return self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.barcode == barcode
        ).first()
    
    def get_by_grn(self, grn_id: int) -> List[models.CompanyAssets]:
        return self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.good_received_note_id == grn_id
        ).all()
    
    def update_status(self, id: int, status: str) -> Optional[models.CompanyAssets]:
        item = self.db.query(models.CompanyAssets).filter(models.CompanyAssets.id == id).first()
        if item:
            item.status = status
            self.db.commit()
            self.db.refresh(item)
        return item


inventory_service = InventoryService()
