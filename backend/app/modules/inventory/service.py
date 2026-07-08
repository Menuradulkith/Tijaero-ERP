from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from typing import List, Optional
from app.core import timezone as tz
from app.common.audit import log_audit
from app.common.enums import StockStatus, AssetStatus
from app.modules.inventory import repository, schemas, models

# Statuses a user may set manually on a sales-stock item. sold / transferred /
# returned states are driven by their own document flows (invoices, transfer
# notes, returns) and must never be reachable through the generic status setter.
MANUAL_STOCK_STATUS_TRANSITIONS = {"available", "reserved", "damaged"}

# Statuses a user may set manually on a company asset. "returned" is produced by
# the sale-return flow and must not be settable through the generic setter.
MANUAL_ASSET_STATUS_TRANSITIONS = {
    AssetStatus.AVAILABLE,
    AssetStatus.IN_USE,
    AssetStatus.RETIRED,
    AssetStatus.DISPOSED,
}


class InventoryService:
    def get_product(self, db: Session, product_id: int):
        return repository.inventory_repository.get_by_id(db, product_id)


class SalesStockService:
    def __init__(self, db: Session):
        self.db = db
    
    def _base_query(
        self,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
        product_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        brand_id: Optional[int] = None,
        location_id: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ):
        """Build the filtered SalesStock query shared by list, paginated and CSV export."""
        from app.modules.products.models import Product
        from app.modules.purchasing.models import GoodReceivedNote
        from sqlalchemy import or_, and_, func

        query = self.db.query(models.SalesStock).options(
            joinedload(models.SalesStock.product).selectinload(Product.minimum_prices),
            joinedload(models.SalesStock.good_received_note),
        ).filter(
            # Exclude items permanently removed from the sales cycle
            # (non-restockable returns that moved to company assets)
            models.SalesStock.status != StockStatus.RETURNED_NON_RESTOCKABLE
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
        if brand_id:
            query = query.filter(
                models.SalesStock.product.has(Product.items_brand_id == brand_id)
            )
        if search:
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    models.SalesStock.barcode.ilike(term),
                    models.SalesStock.product.has(
                        or_(Product.name.ilike(term), Product.item_code.ilike(term))
                    ),
                )
            )
        if location_id:
            # Effective location = the item's own location_id, falling back to the
            # GRN's location when the item has not been moved.
            query = query.filter(
                or_(
                    models.SalesStock.location_id == location_id,
                    and_(
                        models.SalesStock.location_id.is_(None),
                        models.SalesStock.good_received_note.has(
                            GoodReceivedNote.good_received_locations_id == location_id
                        ),
                    ),
                )
            )
        if date_from:
            query = query.filter(func.date(models.SalesStock.added_date) >= date_from)
        if date_to:
            query = query.filter(func.date(models.SalesStock.added_date) <= date_to)

        return query

    def get_all(
        self,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
        product_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        brand_id: Optional[int] = None,
        location_id: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[dict]:
        """Get all matching sales stock items (unpaginated) with related data."""
        items = (
            self._base_query(
                branch_code=branch_code,
                branch_codes=branch_codes,
                product_id=product_id,
                status=status,
                search=search,
                brand_id=brand_id,
                location_id=location_id,
                date_from=date_from,
                date_to=date_to,
            )
            .order_by(models.SalesStock.added_date.desc())
            .all()
        )
        return self._enrich_items(items)

    def get_paginated(
        self,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
        product_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        brand_id: Optional[int] = None,
        location_id: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> dict:
        """Server-side paginated + filtered sales stock, with a branch-scoped summary."""
        query = self._base_query(
            branch_code=branch_code,
            branch_codes=branch_codes,
            product_id=product_id,
            status=status,
            search=search,
            brand_id=brand_id,
            location_id=location_id,
            date_from=date_from,
            date_to=date_to,
        )
        total = query.count()
        items = (
            query.order_by(models.SalesStock.added_date.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return {
            "items": self._enrich_items(items),
            "total": total,
            "summary": self.get_summary(
                branch_code=branch_code, branch_codes=branch_codes
            ),
        }

    def get_summary(
        self,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
    ) -> dict:
        """Branch-scoped KPI counts (independent of the other list filters)."""
        from sqlalchemy import func
        from app.modules.sales.models import Invoice, InvoiceItems

        status_q = self.db.query(
            models.SalesStock.status, func.count(models.SalesStock.id)
        ).filter(models.SalesStock.status != StockStatus.RETURNED_NON_RESTOCKABLE)
        if branch_code:
            status_q = status_q.filter(models.SalesStock.branch_code == branch_code)
        elif branch_codes:
            status_q = status_q.filter(models.SalesStock.branch_code.in_(branch_codes))
        counts = {
            str(s): int(c)
            for s, c in status_q.group_by(models.SalesStock.status).all()
        }

        # "Sold today" is derived from invoices created today that reference a
        # stock item — SalesStock itself has no sold-date column.
        sold_q = (
            self.db.query(func.count(func.distinct(InvoiceItems.sales_stock_id)))
            .join(Invoice, Invoice.id == InvoiceItems.invoice_id)
            .filter(
                InvoiceItems.sales_stock_id.isnot(None),
                Invoice.created_date == tz.today(),
            )
        )
        if branch_code:
            sold_q = sold_q.filter(Invoice.branch_code == branch_code)
        elif branch_codes:
            sold_q = sold_q.filter(Invoice.branch_code.in_(branch_codes))

        return {
            "in_stock": counts.get("available", 0),
            "reserved": counts.get("reserved", 0),
            "sold_today": int(sold_q.scalar() or 0),
            "returned": counts.get("returned_to_supplier", 0)
            + counts.get("return_pending", 0),
        }

    def _enrich_items(self, items: List[models.SalesStock]) -> List[dict]:
        """Attach GRN/location/brand/category/price fields to raw stock rows."""
        from app.modules.common.models import Locations

        # Batch-load all locations in one query to avoid N+1
        location_ids = set()
        brand_ids = set()
        category_ids = set()
        
        for item in items:
            loc_id = item.location_id
            if not loc_id and item.good_received_note:
                loc_id = item.good_received_note.good_received_locations_id
            if loc_id:
                location_ids.add(loc_id)
            if item.product:
                if item.product.items_brand_id:
                    brand_ids.add(item.product.items_brand_id)
                if item.product.category_id:
                    category_ids.add(item.product.category_id)
        
        locations_map = {}
        if location_ids:
            locations = self.db.query(Locations).filter(Locations.id.in_(location_ids)).all()
            locations_map = {loc.id: loc.name for loc in locations}
            
        brands_map = {}
        if brand_ids:
            from app.modules.products.models import ItemsBrand
            brands = self.db.query(ItemsBrand).filter(ItemsBrand.id.in_(brand_ids)).all()
            brands_map = {b.id: b.brand_name for b in brands}
            
        categories_map = {}
        if category_ids:
            from app.modules.products.models import Category
            cats = self.db.query(Category).filter(Category.id.in_(category_ids)).all()
            categories_map = {c.id: c.name for c in cats}
        
        # Enrich with GRN number, location, and prices
        result = []
        for item in items:
            # Resolve location from item's current location_id, falling back to GRN location
            location_id_to_use = item.location_id
            if not location_id_to_use and item.good_received_note:
                location_id_to_use = item.good_received_note.good_received_locations_id
            
            created_at = getattr(item, 'created_at', getattr(item, 'added_date', None))
            updated_at = getattr(item, 'updated_at', getattr(item, 'updated_date', None))
            
            # Get minimum price from MinimumPrice table (kept as Decimal for money precision)
            minimum_price = None
            if item.product and item.product.minimum_prices:
                latest_min_price = max(item.product.minimum_prices, key=lambda x: x.created_date)
                minimum_price = latest_min_price.minimum_price if latest_min_price else None

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
                "created_at": created_at,
                "updated_at": updated_at,
                "grn_no": item.good_received_note.good_received_no if item.good_received_note else None,
                "location_name": locations_map.get(location_id_to_use) if location_id_to_use else None,
                "cost_price": item.product.cost_price if item.product else None,
                "selling_price": item.product.selling_price if item.product else None,
                "minimum_price": minimum_price,
                "minimum_selling_price": minimum_price,
                # Add product details directly
                "product_name": item.product.name if item.product else None,
                "item_code": item.product.item_code if item.product else None,
                "brand_id": item.product.items_brand_id if item.product else None,
                "brand_name": brands_map.get(item.product.items_brand_id) if item.product else None,
                "category_id": item.product.category_id if item.product else None,
                "category_name": categories_map.get(item.product.category_id) if item.product else None,
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
        
        # Get minimum price from MinimumPrice table (kept as Decimal for money precision)
        minimum_price = None
        if item.product and item.product.minimum_prices:
            # Get the most recent minimum price
            latest_min_price = max(item.product.minimum_prices, key=lambda x: x.created_date)
            minimum_price = latest_min_price.minimum_price if latest_min_price else None
        
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
    
    def update_status(
        self,
        id: int,
        status: str,
        user_id: Optional[int] = None,
        allowed_branches: Optional[List[str]] = None,
    ) -> Optional[models.SalesStock]:
        """Manually set a sales-stock item's status.

        Only the statuses in ``MANUAL_STOCK_STATUS_TRANSITIONS`` may be set this
        way; sold / transferred / returned states are owned by their document
        flows. Raises ``ValueError`` on an invalid target status so the API
        layer can return a 400, and ``PermissionError`` when the caller may not
        touch the item's branch (mapped to 403). Every change is audited.
        """
        if status not in MANUAL_STOCK_STATUS_TRANSITIONS:
            allowed = ", ".join(sorted(MANUAL_STOCK_STATUS_TRANSITIONS))
            raise ValueError(
                f"Status '{status}' cannot be set manually. Allowed: {allowed}."
            )

        item = self.db.query(models.SalesStock).filter(
            models.SalesStock.id == id
        ).with_for_update().first()
        if not item:
            return None

        # Branch isolation: reject edits to items outside the caller's branches
        # (allowed_branches is None for all-branch / superuser access).
        if allowed_branches is not None and item.branch_code not in allowed_branches:
            raise PermissionError(f"Access denied to branch: {item.branch_code}")

        old_status = item.status
        if old_status == status:
            return item

        item.status = status
        log_audit(
            self.db,
            user_id=user_id,
            action="status_change",
            entity_type="sales_stock",
            entity_id=item.id,
            changes={"status": {"from": str(old_status), "to": status}},
        )
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

        # Batch-load the parent invoices in a single query (avoids N+1)
        invoice_ids = {i.invoice_id for i in sold_invoice_items if i.invoice_id}
        invoices_map = {}
        if invoice_ids:
            invoices_map = {
                inv.id: inv
                for inv in self.db.query(Invoice).filter(Invoice.id.in_(invoice_ids)).all()
            }

        for inv_item in sold_invoice_items:
            invoice = invoices_map.get(inv_item.invoice_id)
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

        # Batch-load the parent sale returns in a single query (avoids N+1)
        sale_return_ids = {r.sale_return_id for r in return_items if r.sale_return_id}
        sale_returns_map = {}
        if sale_return_ids:
            sale_returns_map = {
                sr.id: sr
                for sr in self.db.query(SaleReturn).filter(
                    SaleReturn.id.in_(sale_return_ids)
                ).all()
            }

        for ret_item in return_items:
            sale_return = sale_returns_map.get(ret_item.sale_return_id)
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

        # Batch-load the parent purchase returns in a single query (avoids N+1)
        pr_ids = {p.purchasingreturn_id for p in pr_items if p.purchasingreturn_id}
        pr_map = {}
        if pr_ids:
            pr_map = {
                pr.id: pr
                for pr in self.db.query(PurchasingReturn).filter(
                    PurchasingReturn.id.in_(pr_ids)
                ).all()
            }

        for pr_item in pr_items:
            pr = pr_map.get(pr_item.purchasingreturn_id)
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

        # Batch-load transfer notes and all referenced locations in one pass each
        itn_ids = {t.itemtransfernote_id for t in itn_items if t.itemtransfernote_id}
        itn_map = {}
        if itn_ids:
            itn_map = {
                n.id: n
                for n in self.db.query(ItemTransferNote).filter(
                    ItemTransferNote.id.in_(itn_ids)
                ).all()
            }
        transfer_loc_ids = set()
        for n in itn_map.values():
            if n.from_location_id:
                transfer_loc_ids.add(n.from_location_id)
            if n.to_location_id:
                transfer_loc_ids.add(n.to_location_id)
        transfer_loc_map = {}
        if transfer_loc_ids:
            transfer_loc_map = {
                loc.id: loc.name
                for loc in self.db.query(Locations).filter(
                    Locations.id.in_(transfer_loc_ids)
                ).all()
            }

        for itn_item in itn_items:
            itn = itn_map.get(itn_item.itemtransfernote_id)
            if itn:
                events.append({
                    "date": itn_item.created_date.isoformat() if itn_item.created_date else None,
                    "action": "Transferred",
                    "details": f"Transfer Note #{itn.item_transfer_note}",
                    "reference_type": "ITN",
                    "reference_no": itn.item_transfer_note,
                    "extra": {
                        "from_location": transfer_loc_map.get(itn.from_location_id),
                        "to_location": transfer_loc_map.get(itn.to_location_id),
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
    
    def get_all(
        self,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
        product_id: Optional[int] = None,
        status: Optional[str] = None,
        source: Optional[str] = None,
    ) -> List[dict]:
        """Get all company assets with enriched product data"""
        from app.modules.purchasing.models import GoodReceivedNote
        
        query = self.db.query(models.CompanyAssets).options(
            joinedload(models.CompanyAssets.product),
            joinedload(models.CompanyAssets.good_received_note),
        )
        
        if branch_code:
            query = query.filter(models.CompanyAssets.branch_code == branch_code)
        elif branch_codes:
            query = query.filter(models.CompanyAssets.branch_code.in_(branch_codes))
        if product_id:
            query = query.filter(models.CompanyAssets.product_id == product_id)
        if status:
            query = query.filter(models.CompanyAssets.status == status)
        if source:
            query = query.filter(models.CompanyAssets.source == source)
        
        items = query.order_by(models.CompanyAssets.added_date.desc()).all()
        
        result = []
        for item in items:
            item_dict = {
                "id": item.id,
                "product_id": item.product_id,
                "inventory_no": item.inventory_no,
                "item": item.item,
                "description": item.description,
                "branch_code": item.branch_code,
                "asigned_to": item.asigned_to,
                "barcode": item.barcode,
                "warranty_month": item.warranty_month,
                "good_received_note_id": item.good_received_note_id,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "status": item.status,
                "return_reason": item.return_reason,
                "sale_return_id": item.sale_return_id,
                "source": item.source or "grn",
                "added_date": item.added_date,
                "product_name": item.product.name if item.product else item.item,
                "item_code": item.product.item_code if item.product else None,
                "brand_id": item.product.items_brand_id if item.product else None,
                "cost_price": item.product.cost_price if item.product else None,
                "grn_no": item.good_received_note.good_received_no if item.good_received_note else None,
            }
            result.append(item_dict)
        
        return result
    
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
            return_reason=item.return_reason,
            sale_return_id=item.sale_return_id,
            source=item.source or "grn",
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
    
    def update_status(
        self,
        id: int,
        status: str,
        user_id: Optional[int] = None,
        allowed_branches: Optional[List[str]] = None,
    ) -> Optional[models.CompanyAssets]:
        """Manually set a company asset's status.

        Only statuses in ``MANUAL_ASSET_STATUS_TRANSITIONS`` may be set this way.
        Raises ``ValueError`` on an invalid target (mapped to 400) and
        ``PermissionError`` when the caller may not touch the item's branch
        (mapped to 403). Every change is audited.
        """
        if status not in MANUAL_ASSET_STATUS_TRANSITIONS:
            allowed = ", ".join(sorted(MANUAL_ASSET_STATUS_TRANSITIONS))
            raise ValueError(
                f"Status '{status}' cannot be set manually. Allowed: {allowed}."
            )

        item = self.db.query(models.CompanyAssets).filter(
            models.CompanyAssets.id == id
        ).with_for_update().first()
        if not item:
            return None

        if allowed_branches is not None and item.branch_code not in allowed_branches:
            raise PermissionError(f"Access denied to branch: {item.branch_code}")

        old_status = item.status
        if old_status == status:
            return item

        item.status = status
        log_audit(
            self.db,
            user_id=user_id,
            action="status_change",
            entity_type="company_asset",
            entity_id=item.id,
            changes={"status": {"from": str(old_status), "to": status}},
        )
        self.db.commit()
        self.db.refresh(item)
        return item


inventory_service = InventoryService()
