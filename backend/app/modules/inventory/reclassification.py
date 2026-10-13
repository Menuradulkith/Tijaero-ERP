"""Reclassify a serial unit between sales stock and company assets.

Standard ERP practice (SAP "goods issue to asset", ERPNext "asset capitalization"):
goods are always received into stock, and a separate, audited document moves a
unit to fixed assets (or back) later - the receiving clerk does not decide at GRN.

A unit (barcode) has at most one row per table, so the row on the side it has
left is kept with status ``transferred`` and re-activated if the unit comes back.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.common.audit import log_audit
from app.common.enums import AssetStatus, StockStatus
from app.core import timezone as tz
from app.modules.inventory.models import CompanyAssets, SalesStock


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


class ReclassificationService:
    def __init__(self, db: Session):
        self.db = db

    def move_stock_to_company_asset(self, stock_id: int, reason: str, user_id: int) -> dict:
        stock = self.db.query(SalesStock).filter(SalesStock.id == stock_id).with_for_update().first()
        if not stock:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sales stock item not found")
        if not stock.barcode:
            raise _bad("Only serial-tracked units (with a barcode) can be moved to company assets.")
        if stock.status != StockStatus.AVAILABLE or not stock.is_active:
            raise _bad(f"Only available stock can be moved to company assets (current status: {stock.status}).")

        from app.modules.products.models import Product
        product = self.db.query(Product).filter(Product.id == stock.product_id).first()
        grn_no = stock.good_received_note.good_received_no if stock.good_received_note else None

        asset = self.db.query(CompanyAssets).filter(CompanyAssets.barcode == stock.barcode).with_for_update().first()
        if asset is not None:
            if asset.status != AssetStatus.TRANSFERRED:
                raise _bad(f"This barcode already exists in company assets (status: {asset.status}).")
            # The unit is coming back to assets: reactivate its old row.
            asset.status = AssetStatus.AVAILABLE
            asset.branch_code = stock.branch_code
            asset.asigned_to = None
            asset.source = "stock_reclass"
        else:
            asset = CompanyAssets(
                product_id=stock.product_id,
                inventory_no=f"INV-{grn_no}-{stock.barcode}" if grn_no else f"INV-{stock.barcode}",
                item=product.name if product else f"Product {stock.product_id}",
                description=f"Moved from sales stock: {reason}",
                branch_code=stock.branch_code,
                barcode=stock.barcode,
                warranty_month=stock.warranty_month,
                good_received_note_id=stock.good_received_note_id,
                purchasing_order_items_id=stock.purchasing_order_items_id,
                status=AssetStatus.AVAILABLE,
                source="stock_reclass",
                added_date=tz.now(),
            )
            self.db.add(asset)
        stock.status = StockStatus.TRANSFERRED
        stock.is_active = False
        self.db.flush()

        changes = {"barcode": stock.barcode, "reason": reason, "company_asset_id": asset.id}
        log_audit(self.db, user_id=user_id, action="reclassify_to_asset", entity_type="sales_stock",
                  entity_id=stock.id, changes=changes)
        log_audit(self.db, user_id=user_id, action="reclassify_from_stock", entity_type="company_assets",
                  entity_id=asset.id, changes={**changes, "sales_stock_id": stock.id})
        self.db.commit()
        return {"success": True, "barcode": stock.barcode, "sales_stock_id": stock.id,
                "company_asset_id": asset.id, "message": "Moved to company assets"}

    def return_asset_to_stock(self, asset_id: int, reason: str, user_id: int,
                              location_id: Optional[int] = None) -> dict:
        asset = self.db.query(CompanyAssets).filter(CompanyAssets.id == asset_id).with_for_update().first()
        if not asset:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company asset not found")
        if not asset.barcode:
            raise _bad("Only serial units (with a barcode) can be returned to sales stock.")
        if asset.status != AssetStatus.AVAILABLE:
            raise _bad(f"Only available assets can be returned to sales stock (current status: {asset.status}).")
        if asset.asigned_to:
            raise _bad("This asset is assigned to an employee; unassign it first.")

        stock = self.db.query(SalesStock).filter(SalesStock.barcode == asset.barcode).with_for_update().first()
        if stock is not None:
            if stock.status != StockStatus.TRANSFERRED:
                raise _bad(f"This barcode already exists in sales stock (status: {stock.status}).")
            stock.status = StockStatus.AVAILABLE
            stock.is_active = True
            stock.branch_code = asset.branch_code
            if location_id:
                stock.location_id = location_id
        else:
            if not (asset.good_received_note_id and asset.purchasing_order_items_id):
                raise _bad("This asset has no GRN reference, so it cannot be returned to sales stock.")
            stock = SalesStock(
                product_id=asset.product_id,
                barcode=asset.barcode,
                branch_code=asset.branch_code,
                location_id=location_id,
                good_received_note_id=asset.good_received_note_id,
                purchasing_order_items_id=asset.purchasing_order_items_id,
                warranty_month=asset.warranty_month,
                status=StockStatus.AVAILABLE,
                added_date=tz.now(),
            )
            self.db.add(stock)
        asset.status = AssetStatus.TRANSFERRED
        self.db.flush()

        changes = {"barcode": asset.barcode, "reason": reason, "sales_stock_id": stock.id}
        log_audit(self.db, user_id=user_id, action="reclassify_to_stock", entity_type="company_assets",
                  entity_id=asset.id, changes=changes)
        log_audit(self.db, user_id=user_id, action="reclassify_from_asset", entity_type="sales_stock",
                  entity_id=stock.id, changes={**changes, "company_asset_id": asset.id})
        self.db.commit()
        return {"success": True, "barcode": asset.barcode, "sales_stock_id": stock.id,
                "company_asset_id": asset.id, "message": "Returned to sales stock"}
