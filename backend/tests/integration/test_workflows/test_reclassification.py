"""
QA suite - moving a serial unit between sales stock and company assets.

* stock -> asset needs an available, serial unit and a reason; the stock row
  is kept as ``transferred`` and the asset is created from the unit's GRN data.
* asset -> stock re-activates that row; a second round trip reuses both rows
  (barcodes are unique per table).
* lots, non-available stock, assigned assets and missing permissions are refused.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func

from app.common.enums import AssetStatus, StockStatus
from app.modules.inventory.models import CompanyAssets, SalesStock

I = "/api/v1/inventory"


def _asset(db, barcode):
    return db.query(CompanyAssets).filter(CompanyAssets.barcode == barcode).one()


class TestMoveToAssets:
    def test_stock_to_asset_and_back_twice(self, db, superclient, make_sales_stock):
        stock = make_sales_stock()
        bc = stock.barcode

        r = superclient.post(f"{I}/sales-stock/{stock.id}/move-to-company-assets", json={"reason": "Office laptop"})
        assert r.status_code == 200, r.text
        db.refresh(stock)
        assert (stock.status, stock.is_active) == (StockStatus.TRANSFERRED, False)
        asset = _asset(db, bc)
        assert asset.status == AssetStatus.AVAILABLE and asset.source == "stock_reclass"
        assert asset.good_received_note_id == stock.good_received_note_id and asset.product_id == stock.product_id

        r = superclient.post(f"{I}/company-assets/{asset.id}/return-to-sales-stock", json={"reason": "Not needed"})
        assert r.status_code == 200, r.text
        db.refresh(stock)
        db.refresh(asset)
        assert (stock.status, stock.is_active) == (StockStatus.AVAILABLE, True)
        assert asset.status == AssetStatus.TRANSFERRED

        # second round trip reuses the same rows (unique barcodes)
        assert superclient.post(f"{I}/sales-stock/{stock.id}/move-to-company-assets", json={"reason": "Again"}).status_code == 200
        db.refresh(asset)
        assert asset.status == AssetStatus.AVAILABLE
        assert db.query(func.count(CompanyAssets.id)).filter(CompanyAssets.barcode == bc).scalar() == 1
        assert db.query(func.count(SalesStock.id)).filter(SalesStock.barcode == bc).scalar() == 1

    def test_guards(self, db, superclient, make_sales_stock):
        sold = make_sales_stock(status=StockStatus.SOLD, is_active=False)
        r = superclient.post(f"{I}/sales-stock/{sold.id}/move-to-company-assets", json={"reason": "x y z"})
        assert r.status_code == 400 and "available" in r.json()["detail"]

        reserved = make_sales_stock(status=StockStatus.RESERVED)
        assert superclient.post(f"{I}/sales-stock/{reserved.id}/move-to-company-assets", json={"reason": "x y z"}).status_code == 400

        lot = make_sales_stock()
        lot.barcode, lot.quantity = None, 10
        db.flush()
        r = superclient.post(f"{I}/sales-stock/{lot.id}/move-to-company-assets", json={"reason": "x y z"})
        assert r.status_code == 400 and "serial" in r.json()["detail"]

        ok = make_sales_stock()
        assert superclient.post(f"{I}/sales-stock/{ok.id}/move-to-company-assets", json={"reason": ""}).status_code == 422
        assert superclient.post(f"{I}/sales-stock/999999999/move-to-company-assets", json={"reason": "x y z"}).status_code == 404

    def test_assigned_asset_cannot_return(self, db, superclient, make_sales_stock):
        stock = make_sales_stock()
        superclient.post(f"{I}/sales-stock/{stock.id}/move-to-company-assets", json={"reason": "Office laptop"})
        asset = _asset(db, stock.barcode)
        asset.asigned_to = 1
        db.flush()
        r = superclient.post(f"{I}/company-assets/{asset.id}/return-to-sales-stock", json={"reason": "back"})
        assert r.status_code == 400 and "assigned" in r.json()["detail"]

    def test_requires_both_permissions(self, db, api, make_user, make_branch, make_sales_stock):
        branch = make_branch()
        stock = make_sales_stock(branch=branch)
        _, tok = make_user(permissions=[("sales_stock", "update")], branches=[branch])  # lacks company_assets:create
        assert api(tok).post(f"{I}/sales-stock/{stock.id}/move-to-company-assets", json={"reason": "x y z"}).status_code == 403
        _, tok2 = make_user(permissions=[("sales_stock", "update"), ("company_assets", "create")], branches=[branch])
        assert api(tok2).post(f"{I}/sales-stock/{stock.id}/move-to-company-assets", json={"reason": "x y z"}).status_code == 200

    def test_branch_isolation(self, db, api, make_user, make_branch, make_sales_stock):
        stock = make_sales_stock(branch=make_branch())
        _, tok = make_user(
            permissions=[("sales_stock", "update"), ("company_assets", "create")], branches=[make_branch()]
        )
        assert api(tok).post(f"{I}/sales-stock/{stock.id}/move-to-company-assets", json={"reason": "x y z"}).status_code == 403
