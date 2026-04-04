from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from typing import List, Optional
from app.core import timezone as tz
from app.common.enums import StockStatus
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
        branch_codes: Optional[List[str]] = None,
        product_id: Optional[int] = None,
        status: Optional[str] = None
    ) -> List[dict]:
        """Get all sales stock items with optional filters, including related data"""
        from app.modules.common.models import Locations
        
        query = self.db.query(models.SalesStock).options(
            joinedload(models.SalesStock.product),
            joinedload(models.SalesStock.good_received_note)
        )
        
        if branch_code:
            query = query.filter(models.SalesStock.branch_code == branch_code)
        elif branch_codes:
            # Multi-branch filtering for branch-based access control
            query = query.filter(models.SalesStock.branch_code.in_(branch_codes))
        if product_id:
            query = query.filter(models.SalesStock.product_id == product_id)
        if status:
            query = query.filter(models.SalesStock.status == status)
        
        items = query.order_by(models.SalesStock.added_date.desc()).all()
        
        # Batch-load all locations in one query to avoid N+1
        location_ids = set()
        for item in items:
            loc_id = item.location_id
            if not loc_id and item.good_received_note:
                loc_id = item.good_received_note.good_received_locations_id
            if loc_id:
                location_ids.add(loc_id)
        
        locations_map = {}
        if location_ids:
            locations = self.db.query(Locations).filter(
                Locations.id.in_(location_ids)
            ).all()
            locations_map = {loc.id: loc.name for loc in locations}
        
        # Enrich with GRN number, location, and prices
        result = []
        for item in items:
            # Resolve location from item's current location_id, falling back to GRN location
            location_id_to_use = item.location_id
            if not location_id_to_use and item.good_received_note:
                location_id_to_use = item.good_received_note.good_received_locations_id
            
            item_dict = {
                "id": item.id,
                "product_id": item.product_id,
                "barcode": item.barcode,
                "branch_code": item.branch_code,
                "location_id": item.location_id,
                "good_received_note_id": item.good_received_note_id,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "warranty_month": item.warranty_month,
                "status": item.status,
                "added_date": item.added_date,
                "grn_no": item.good_received_note.good_received_no if item.good_received_note else None,
                "location_name": locations_map.get(location_id_to_use) if location_id_to_use else None,
                "cost_price": item.product.cost_price if item.product else None,
                "selling_price": item.product.selling_price if item.product else None,
                # Add product details directly
                "product_name": item.product.name if item.product else None,
                "item_code": item.product.item_code if item.product else None,
                "brand_id": item.product.items_brand_id if item.product else None,
            }
            
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
            location_id=item.location_id,
            good_received_note_id=item.good_received_note_id,
            purchasing_order_items_id=item.purchasing_order_items_id,
            warranty_month=item.warranty_month,
            status=item.status,
            added_date=tz.now()
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
            models.SalesStock.status == StockStatus.AVAILABLE
        ).all()
    
    def get_by_barcode(self, barcode: str) -> Optional[dict]:
        """Get sales stock by barcode with enriched product data"""
        item = self.db.query(models.SalesStock).filter(
            models.SalesStock.barcode == barcode
        ).options(joinedload(models.SalesStock.product)).first()
        
        if not item:
            return None
        
        # Get minimum price from MinimumPrice table
        minimum_price = None
        if item.product and item.product.minimum_prices:
            # Get the most recent minimum price
            latest_min_price = max(item.product.minimum_prices, key=lambda x: x.created_date)
            minimum_price = float(latest_min_price.minimum_price) if latest_min_price else None
        
        # Return enriched data similar to get_all
        return {
            "id": item.id,
            "product_id": item.product_id,
            "barcode": item.barcode,
            "branch_code": item.branch_code,
            "good_received_note_id": item.good_received_note_id,
            "purchasing_order_items_id": item.purchasing_order_items_id,
            "warranty_month": item.warranty_month,
            "status": item.status,
            "added_date": item.added_date,
            "cost_price": item.product.cost_price if item.product else None,
            "selling_price": item.product.selling_price if item.product else None,
            "minimum_price": minimum_price,
            "product_name": item.product.name if item.product else None,
            "item_code": item.product.item_code if item.product else None,
            "product": {
                "id": item.product.id if item.product else None,
                "product_name": item.product.name if item.product else None,
                "name": item.product.name if item.product else None,
                "item_code": item.product.item_code if item.product else None,
                "selling_price": item.product.selling_price if item.product else None,
                "cost_price": item.product.cost_price if item.product else None,
                "minimum_price": minimum_price,
            } if item.product else None,
        }
    
    def update_status(self, id: int, status: str) -> models.SalesStock:
        """Update status with row-level lock to prevent concurrent overwrites."""
        item = self.db.query(models.SalesStock).filter(
            models.SalesStock.id == id
        ).with_for_update().first()
        if item:
            item.status = status
            self.db.commit()
            self.db.refresh(item)
        return item

    def get_tracking(self, stock_id: int) -> List[dict]:
        """Build a chronological tracking timeline for a sales stock item by querying related tables."""
        from app.modules.purchasing.models import (
            GoodReceivedNote, PurchasingOrder, PurchasingReturn, PurchasingReturnItems
        )
        from app.modules.sales.models import (
            Invoice, InvoiceItems, SaleReturn, SaleReturnItems
        )
        from app.modules.warehouse.models import (
            ItemTransferNote, ItemTransferNoteItems
        )
        from app.modules.common.models import Locations

        item = self.db.query(models.SalesStock).filter(
            models.SalesStock.id == stock_id
        ).options(
            joinedload(models.SalesStock.good_received_note),
            joinedload(models.SalesStock.purchase_return),
        ).first()

        if not item:
            return []

        events: List[dict] = []

        # 1. Received via GRN
        if item.good_received_note:
            grn = item.good_received_note
            # Get PO number
            po_no = None
            if grn.purchasingorders_id:
                po = self.db.query(PurchasingOrder).filter(
                    PurchasingOrder.id == grn.purchasingorders_id
                ).first()
                po_no = po.purchasing_order_no if po else None
            # Get location name
            loc_name = None
            loc_id = item.location_id or grn.good_received_locations_id
            if loc_id:
                loc = self.db.query(Locations).filter(Locations.id == loc_id).first()
                loc_name = loc.name if loc else None

            events.append({
                "date": item.added_date.isoformat() if item.added_date else None,
                "action": "Received",
                "details": f"Received via GRN #{grn.good_received_no}",
                "reference_type": "GRN",
                "reference_no": grn.good_received_no,
                "extra": {
                    "po_no": po_no,
                    "location": loc_name,
                    "branch": item.branch_code,
                },
                "color": "#2196F3",
            })

        # 2. Sold via invoice
        sold_invoice_items = self.db.query(InvoiceItems).filter(
            InvoiceItems.sales_stock_id == stock_id
        ).all()
        # Also match by barcode if sales_stock_id is not set
        if not sold_invoice_items:
            sold_invoice_items = self.db.query(InvoiceItems).filter(
                InvoiceItems.barcode == item.barcode
            ).all()

        for inv_item in sold_invoice_items:
            invoice = self.db.query(Invoice).filter(Invoice.id == inv_item.invoice_id).first()
            if invoice:
                events.append({
                    "date": invoice.created_date_time.isoformat() if invoice.created_date_time else (
                        invoice.created_date.isoformat() if invoice.created_date else None
                    ),
                    "action": "Sold",
                    "details": f"Sold via Invoice #{invoice.invoice_no}",
                    "reference_type": "Invoice",
                    "reference_no": invoice.invoice_no,
                    "extra": {
                        "selling_price": float(inv_item.selling_price) if inv_item.selling_price else None,
                        "branch": invoice.branch_code,
                    },
                    "color": "#4CAF50",
                })

        # 3. Sale return
        return_items = self.db.query(SaleReturnItems).filter(
            SaleReturnItems.sales_stock_id == stock_id
        ).all()
        if not return_items:
            return_items = self.db.query(SaleReturnItems).filter(
                SaleReturnItems.barcode == item.barcode
            ).all()

        for ret_item in return_items:
            sale_return = self.db.query(SaleReturn).filter(
                SaleReturn.id == ret_item.sale_return_id
            ).first()
            if sale_return:
                events.append({
                    "date": ret_item.added_date.isoformat() if ret_item.added_date else None,
                    "action": "Customer Return",
                    "details": f"Returned via Sale Return #{sale_return.sale_return_no}",
                    "reference_type": "SaleReturn",
                    "reference_no": sale_return.sale_return_no,
                    "extra": {
                        "return_price": float(ret_item.return_price) if ret_item.return_price else None,
                        "condition": ret_item.condition,
                        "restocked": ret_item.restocked,
                        "status": sale_return.status,
                    },
                    "color": "#FF9800",
                })

        # 4. Purchase return (returned to supplier)
        pr_items = self.db.query(PurchasingReturnItems).filter(
            PurchasingReturnItems.sales_stock_id == stock_id
        ).all()
        if not pr_items:
            pr_items = self.db.query(PurchasingReturnItems).filter(
                PurchasingReturnItems.barcode == item.barcode
            ).all()

        for pr_item in pr_items:
            pr = self.db.query(PurchasingReturn).filter(
                PurchasingReturn.id == pr_item.purchasingreturn_id
            ).first()
            if pr:
                events.append({
                    "date": pr_item.added_date.isoformat() if pr_item.added_date else None,
                    "action": "Returned to Supplier",
                    "details": f"Purchase Return #{pr.purchasing_return_no}",
                    "reference_type": "PurchaseReturn",
                    "reference_no": pr.purchasing_return_no,
                    "extra": {
                        "return_price": float(pr_item.return_price) if pr_item.return_price else None,
                        "status": pr.status,
                    },
                    "color": "#F44336",
                })

        # 5. Transfers (ITN)
        itn_items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.barcode == item.barcode
        ).all()

        for itn_item in itn_items:
            itn = self.db.query(ItemTransferNote).filter(
                ItemTransferNote.id == itn_item.itemtransfernote_id
            ).first()
            if itn:
                from_loc = self.db.query(Locations).filter(Locations.id == itn.from_location_id).first()
                to_loc = self.db.query(Locations).filter(Locations.id == itn.to_location_id).first()
                events.append({
                    "date": itn_item.created_date.isoformat() if itn_item.created_date else None,
                    "action": "Transferred",
                    "details": f"Transfer Note #{itn.item_transfer_note}",
                    "reference_type": "ITN",
                    "reference_no": itn.item_transfer_note,
                    "extra": {
                        "from_location": from_loc.name if from_loc else None,
                        "to_location": to_loc.name if to_loc else None,
                        "received": itn_item.item_recieved,
                        "status": itn.status,
                    },
                    "color": "#9C27B0",
                })

        # 6. If marked as damaged (from current status)
        if item.status == "damaged":
            events.append({
                "date": None,
                "action": "Marked Damaged",
                "details": "Item marked as damaged",
                "reference_type": None,
                "reference_no": None,
                "extra": {},
                "color": "#F44336",
            })

        # Sort by date chronologically
        def sort_key(e):
            d = e.get("date")
            if d is None:
                return ""
            return d

        events.sort(key=sort_key)

        return events


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
            added_date=tz.now()
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
        """Update status with row-level lock to prevent concurrent overwrites."""
        item = self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.id == id
        ).with_for_update().first()
        if item:
            item.status = status
            self.db.commit()
            self.db.refresh(item)
        return item


inventory_service = InventoryService()
