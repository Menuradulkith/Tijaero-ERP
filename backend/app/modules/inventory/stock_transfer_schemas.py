"""Stock Transfer Schemas"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class StockTransferRequest(BaseModel):
    """Request body for stock transfer operations"""
    reason: Optional[str] = Field(None, description="Reason for transfer")
    location_id: Optional[int] = Field(None, description="Target location for sales stock")
    approve: Optional[bool] = Field(False, description="Approve transfer immediately")


class StockTransferResponse(BaseModel):
    """Response for stock transfer operations"""
    id: int
    transfer_type: str
    source_table: str
    source_id: int
    destination_table: str
    destination_id: Optional[int]
    product_id: int
    branch_code: str
    reason: Optional[str]
    status: str
    initiated_at: datetime
    completed_at: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


class StockTransferHistoryFilter(BaseModel):
    """Filter parameters for transfer history"""
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    transfer_type: Optional[str] = None
    status: Optional[str] = None
    branch_code: Optional[str] = None
    initiated_by: Optional[int] = None
    product_id: Optional[int] = None
    skip: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=100)


class StockTransferHistory(BaseModel):
    """Stock transfer history item with related data"""
    id: int
    transfer_type: str
    source_table: str
    source_id: int
    source_barcode: Optional[str]
    destination_table: str
    destination_id: Optional[int]
    destination_barcode: Optional[str]
    product_name: str
    product_barcode: str
    branch_code: str
    reason: Optional[str]
    status: str
    initiated_by_name: Optional[str]
    approved_by_name: Optional[str]
    initiated_at: datetime
    completed_at: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


class BulkStockTransferRequest(BaseModel):
    """Request for bulk stock transfers"""
    item_ids: List[int] = Field(..., description="List of item IDs to transfer")
    reason: str = Field(..., description="Reason for bulk transfer")
    location_id: Optional[int] = None


class BulkStockTransferResponse(BaseModel):
    """Response for bulk stock transfers"""
    total_requested: int
    successful: int
    failed: int
    transfers: List[StockTransferResponse]
    errors: List[dict] = []


class TransferReversal(BaseModel):
    """Request to reverse a transfer"""
    reverse_reason: str = Field(..., description="Reason for reversal")
