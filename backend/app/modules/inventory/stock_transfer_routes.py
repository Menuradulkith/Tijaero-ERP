"""Stock Transfer API Endpoints"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.modules.inventory.stock_transfer_service import StockTransferService
from app.modules.inventory import stock_transfer_schemas as schemas
from app.modules.inventory.models import SalesStock, CompanyAssets


router = APIRouter(
    prefix="/inventory/stock-transfers",
    tags=["inventory", "stock-transfers"]
)


def get_transfer_service(db: Session = Depends(get_db)) -> StockTransferService:
    """Dependency to get transfer service"""
    return StockTransferService(db)


@router.post(
    "/sales-stock/{id}/transfer-to-company-assets",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def transfer_sales_stock_to_company_asset(
    id: int,
    request: schemas.StockTransferRequest,
    db: Session = Depends(get_db),
    service: StockTransferService = Depends(get_transfer_service),
    current_user: User = Depends(get_current_user)
):
    """
    Transfer a sales stock item to company assets.
    
    Request Body:
    ```json
    {
        "reason": "Equipment for branch office"
    }
    ```
    """
    # Check permission
    if not current_user.has_permission("transfer_stock_to_assets"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to transfer stock items"
        )
    
    try:
        result = service.transfer_sales_stock_to_company_asset(
            sales_stock_id=id,
            reason=request.reason,
            initiated_by=current_user.id,
            branch_code=current_user.branch_code or "HQ"
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transfer failed: {str(e)}"
        )


@router.post(
    "/company-assets/{id}/transfer-to-sales-stock",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def transfer_company_asset_to_sales_stock(
    id: int,
    request: schemas.StockTransferRequest,
    db: Session = Depends(get_db),
    service: StockTransferService = Depends(get_transfer_service),
    current_user: User = Depends(get_current_user)
):
    """
    Transfer a company asset to sales stock.
    
    Request Body:
    ```json
    {
        "reason": "Surplus - returned for resale",
        "location_id": 123
    }
    ```
    """
    # Check permission
    if not current_user.has_permission("transfer_assets_to_stock"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to transfer asset items"
        )
    
    try:
        result = service.transfer_company_asset_to_sales_stock(
            company_asset_id=id,
            reason=request.reason,
            initiated_by=current_user.id,
            branch_code=current_user.branch_code or "HQ",
            location_id=request.location_id
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transfer failed: {str(e)}"
        )


@router.get(
    "/history",
    response_model=dict
)
async def get_stock_transfer_history(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    transfer_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    branch_code: Optional[str] = None,
    initiated_by: Optional[int] = None,
    product_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 50,
    service: StockTransferService = Depends(get_transfer_service),
    current_user: User = Depends(get_current_user)
):
    """
    Get stock transfer history with filtering.
    
    Query Parameters:
    - start_date: Filter transfers after this date (ISO format)
    - end_date: Filter transfers before this date (ISO format)
    - transfer_type: 'sales_to_asset' or 'asset_to_sales'
    - status_filter: 'pending', 'completed', 'reversed'
    - branch_code: Filter by branch
    - initiated_by: Filter by user ID
    - product_id: Filter by product ID
    - skip: Pagination offset (default: 0)
    - limit: Pagination limit (default: 50, max: 100)
    """
    # Check permission
    if not current_user.has_permission("view_stock_transfers"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view stock transfer history"
        )
    
    try:
        transfers, total_count = service.get_transfer_history(
            start_date=start_date,
            end_date=end_date,
            transfer_type=transfer_type,
            status=status_filter,
            branch_code=branch_code or current_user.branch_code,
            initiated_by=initiated_by,
            product_id=product_id,
            skip=skip,
            limit=min(limit, 100)
        )
        
        return {
            "total": total_count,
            "skip": skip,
            "limit": limit,
            "transfers": [
                {
                    "id": t.id,
                    "transfer_type": t.transfer_type,
                    "source_table": t.source_table,
                    "source_id": t.source_id,
                    "source_barcode": t.source_barcode,
                    "destination_table": t.destination_table,
                    "destination_id": t.destination_id,
                    "destination_barcode": t.destination_barcode,
                    "product_id": t.product_id,
                    "branch_code": t.branch_code,
                    "reason": t.reason,
                    "status": t.status,
                    "initiated_at": t.initiated_at,
                    "completed_at": t.completed_at,
                    "created_at": t.created_at
                }
                for t in transfers
            ]
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve transfer history: {str(e)}"
        )


@router.post(
    "/{transfer_id}/reverse",
    response_model=dict
)
async def reverse_stock_transfer(
    transfer_id: int,
    request: schemas.TransferReversal,
    service: StockTransferService = Depends(get_transfer_service),
    current_user: User = Depends(get_current_user)
):
    """
    Reverse a stock transfer (undo operation).
    
    Can only reverse transfers within 24 hours.
    
    Request Body:
    ```json
    {
        "reverse_reason": "Incorrect transfer - item needed for different purpose"
    }
    ```
    """
    # Check permission
    if not current_user.has_permission("reverse_stock_transfers"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to reverse stock transfers"
        )
    
    try:
        result = service.reverse_transfer(
            transfer_id=transfer_id,
            reverse_reason=request.reverse_reason,
            initiated_by=current_user.id
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reversal failed: {str(e)}"
        )
