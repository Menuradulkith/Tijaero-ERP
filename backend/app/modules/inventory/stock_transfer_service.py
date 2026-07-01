"""Stock Transfer Service"""
from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy import text, desc, and_
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.modules.inventory.stock_transfer_model import (
    StockTransfer,
    TransferTypeEnum,
    TransferStatusEnum
)
from app.modules.inventory.models import SalesStock, CompanyAssets
from app.modules.products.models import Product
from app.auth.models import User


class StockTransferService:
    """Service for managing stock transfers"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def validate_sales_stock_transfer(self, sales_stock_id: int) -> tuple[bool, str]:
        """
        Validate that a sales stock item can be transferred to company assets.
        
        Returns:
            tuple: (is_valid, error_message)
        """
        stock = self.db.query(SalesStock).filter(
            SalesStock.id == sales_stock_id
        ).first()
        
        if not stock:
            return False, "Sales stock item not found"
        
        if stock.status != 'available':
            return False, f"Item status is '{stock.status}', must be 'available'"
        
        if not stock.barcode:
            return False, "Item missing barcode"
        
        product = self.db.query(Product).filter(
            Product.id == stock.product_id
        ).first()
        
        if not product:
            return False, "Item product not found"
        
        if stock.transferred_to_company_asset_id:
            return False, "Item already transferred to company assets"
        
        return True, ""
    
    def validate_company_asset_transfer(
        self,
        company_asset_id: int,
        reason: str
    ) -> tuple[bool, str]:
        """
        Validate that a company asset can be transferred to sales stock.
        
        Returns:
            tuple: (is_valid, error_message)
        """
        asset = self.db.query(CompanyAssets).filter(
            CompanyAssets.id == company_asset_id
        ).first()
        
        if not asset:
            return False, "Company asset not found"
        
        if asset.status != 'available':
            return False, f"Asset status is '{asset.status}', must be 'available'"
        
        if not reason or not reason.strip():
            return False, "Reason is required for company asset transfers"
        
        if asset.transferred_from_sales_stock_id:
            return False, "Asset cannot be transferred (already transferred from sales stock)"
        
        product = self.db.query(Product).filter(
            Product.id == asset.product_id
        ).first()
        
        if not product:
            return False, "Asset product not found"
        
        return True, ""
    
    def transfer_sales_stock_to_company_asset(
        self,
        sales_stock_id: int,
        reason: Optional[str],
        initiated_by: int,
        branch_code: str
    ) -> dict:
        """
        Transfer a sales stock item to company assets.
        
        Args:
            sales_stock_id: ID of sales stock item
            reason: Reason for transfer
            initiated_by: User ID initiating transfer
            branch_code: Branch code for audit
            
        Returns:
            dict: Transfer information
            
        Raises:
            HTTPException: If validation fails
        """
        # Validate
        is_valid, error_msg = self.validate_sales_stock_transfer(sales_stock_id)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )
        
        # Get source item
        source_stock = self.db.query(SalesStock).filter(
            SalesStock.id == sales_stock_id
        ).first()
        
        # Create destination company asset
        new_asset = CompanyAssets(
            product_id=source_stock.product_id,
            barcode=source_stock.barcode,
            branch_code=source_stock.branch_code,
            status='available',
            source='sales_stock_transfer',  # Track origin
            created_at=datetime.utcnow()
        )
        
        self.db.add(new_asset)
        self.db.flush()  # Get ID without committing
        
        # Create transfer audit record
        transfer = StockTransfer(
            transfer_type=TransferTypeEnum.SALES_TO_ASSET.value,
            source_table='sales_stock',
            source_id=sales_stock_id,
            source_barcode=source_stock.barcode,
            source_status=source_stock.status,
            destination_table='company_assets',
            destination_id=new_asset.id,
            destination_barcode=new_asset.barcode,
            product_id=source_stock.product_id,
            branch_code=branch_code,
            reason=reason or "Sales stock reclassified as company asset",
            initiated_by=initiated_by,
            status='completed',
            initiated_at=datetime.utcnow(),
            completed_at=datetime.utcnow()
        )
        
        self.db.add(transfer)
        self.db.flush()
        
        # Update source stock
        source_stock.status = 'transferred'
        source_stock.transferred_to_company_asset_id = new_asset.id
        source_stock.transfer_id = transfer.id
        source_stock.transfer_date = datetime.utcnow()
        source_stock.transfer_reason = reason
        
        # Update destination asset
        new_asset.transfer_id = transfer.id
        new_asset.transfer_date = datetime.utcnow()
        new_asset.transfer_reason = reason
        new_asset.transferred_from_sales_stock_id = sales_stock_id
        
        self.db.commit()
        
        return {
            "success": True,
            "message": "Item transferred to company assets",
            "transfer_id": transfer.id,
            "company_asset_id": new_asset.id,
            "barcode": new_asset.barcode,
            "product_id": new_asset.product_id
        }
    
    def transfer_company_asset_to_sales_stock(
        self,
        company_asset_id: int,
        reason: str,
        initiated_by: int,
        branch_code: str,
        location_id: Optional[int] = None
    ) -> dict:
        """
        Transfer a company asset to sales stock.
        
        Args:
            company_asset_id: ID of company asset
            reason: Reason for transfer (required)
            initiated_by: User ID initiating transfer
            branch_code: Branch code for audit
            location_id: Target location for new stock
            
        Returns:
            dict: Transfer information
            
        Raises:
            HTTPException: If validation fails
        """
        # Validate
        is_valid, error_msg = self.validate_company_asset_transfer(
            company_asset_id,
            reason
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )
        
        # Get source asset
        source_asset = self.db.query(CompanyAssets).filter(
            CompanyAssets.id == company_asset_id
        ).first()
        
        # Create destination sales stock
        new_stock = SalesStock(
            product_id=source_asset.product_id,
            barcode=source_asset.barcode,
            branch_code=source_asset.branch_code,
            location_id=location_id,
            status='available',
            created_at=datetime.utcnow()
        )
        
        self.db.add(new_stock)
        self.db.flush()
        
        # Create transfer audit record
        transfer = StockTransfer(
            transfer_type=TransferTypeEnum.ASSET_TO_SALES.value,
            source_table='company_assets',
            source_id=company_asset_id,
            source_barcode=source_asset.barcode,
            source_status=source_asset.status,
            destination_table='sales_stock',
            destination_id=new_stock.id,
            destination_barcode=new_stock.barcode,
            product_id=source_asset.product_id,
            branch_code=branch_code,
            reason=reason,
            initiated_by=initiated_by,
            status='completed',
            initiated_at=datetime.utcnow(),
            completed_at=datetime.utcnow()
        )
        
        self.db.add(transfer)
        self.db.flush()
        
        # Update source asset
        source_asset.status = 'transferred'
        source_asset.transfer_id = transfer.id
        source_asset.transfer_date = datetime.utcnow()
        source_asset.transfer_reason = reason
        
        # Update destination stock
        new_stock.transfer_id = transfer.id
        new_stock.transfer_date = datetime.utcnow()
        new_stock.transfer_reason = reason
        
        self.db.commit()
        
        return {
            "success": True,
            "message": "Item transferred to sales stock",
            "transfer_id": transfer.id,
            "sales_stock_id": new_stock.id,
            "barcode": new_stock.barcode,
            "product_id": new_stock.product_id
        }
    
    def get_transfer_history(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        transfer_type: Optional[str] = None,
        status: Optional[str] = None,
        branch_code: Optional[str] = None,
        initiated_by: Optional[int] = None,
        product_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 50
    ) -> tuple[List[StockTransfer], int]:
        """
        Get stock transfer history with filtering.
        
        Returns:
            tuple: (transfers, total_count)
        """
        query = self.db.query(StockTransfer)
        
        # Apply filters
        filters = []
        
        if start_date:
            filters.append(StockTransfer.created_at >= start_date)
        
        if end_date:
            filters.append(StockTransfer.created_at <= end_date)
        
        if transfer_type:
            filters.append(StockTransfer.transfer_type == transfer_type)
        
        if status:
            filters.append(StockTransfer.status == status)
        
        if branch_code:
            filters.append(StockTransfer.branch_code == branch_code)
        
        if initiated_by:
            filters.append(StockTransfer.initiated_by == initiated_by)
        
        if product_id:
            filters.append(StockTransfer.product_id == product_id)
        
        if filters:
            query = query.filter(and_(*filters))
        
        # Get total count
        total_count = query.count()
        
        # Apply pagination and sorting
        transfers = query.order_by(
            desc(StockTransfer.created_at)
        ).offset(skip).limit(limit).all()
        
        return transfers, total_count
    
    def reverse_transfer(
        self,
        transfer_id: int,
        reverse_reason: str,
        initiated_by: int
    ) -> dict:
        """
        Reverse a stock transfer (undo operation).
        
        Can only reverse transfers within 24 hours.
        """
        transfer = self.db.query(StockTransfer).filter(
            StockTransfer.id == transfer_id
        ).first()
        
        if not transfer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transfer not found"
            )
        
        # Check if transfer is within 24 hours
        time_diff = datetime.utcnow() - transfer.completed_at
        if time_diff > timedelta(hours=24):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot reverse transfers older than 24 hours"
            )
        
        if transfer.status == 'reversed':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfer already reversed"
            )
        
        # Revert changes based on transfer type
        if transfer.transfer_type == TransferTypeEnum.SALES_TO_ASSET.value:
            # Restore sales stock, mark asset as transferred back
            source_stock = self.db.query(SalesStock).filter(
                SalesStock.id == transfer.source_id
            ).first()
            
            dest_asset = self.db.query(CompanyAssets).filter(
                CompanyAssets.id == transfer.destination_id
            ).first()
            
            if source_stock:
                source_stock.status = 'available'
                source_stock.transferred_to_company_asset_id = None
                source_stock.transfer_id = None
            
            if dest_asset:
                dest_asset.status = 'transferred_back'
        
        elif transfer.transfer_type == TransferTypeEnum.ASSET_TO_SALES.value:
            # Restore company asset, mark stock as transferred back
            source_asset = self.db.query(CompanyAssets).filter(
                CompanyAssets.id == transfer.source_id
            ).first()
            
            dest_stock = self.db.query(SalesStock).filter(
                SalesStock.id == transfer.destination_id
            ).first()
            
            if source_asset:
                source_asset.status = 'available'
                source_asset.transfer_id = None
            
            if dest_stock:
                dest_stock.status = 'transferred_back'
        
        # Mark transfer as reversed
        transfer.status = 'reversed'
        transfer.reversed_at = datetime.utcnow()
        transfer.reverse_reason = reverse_reason
        
        self.db.commit()
        
        return {
            "success": True,
            "message": "Transfer reversed successfully",
            "transfer_id": transfer_id
        }
