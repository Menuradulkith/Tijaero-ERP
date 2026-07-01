"""Stock Transfer Model"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
import enum

from app.db.base_class import Base


class TransferTypeEnum(str, enum.Enum):
    """Transfer type enumeration"""
    SALES_TO_ASSET = "sales_to_asset"
    ASSET_TO_SALES = "asset_to_sales"


class TransferStatusEnum(str, enum.Enum):
    """Transfer status enumeration"""
    PENDING = "pending"
    COMPLETED = "completed"
    REVERSED = "reversed"
    FAILED = "failed"


class StockTransfer(Base):
    """Stock Transfer audit trail"""
    
    __tablename__ = "stock_transfers"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Transfer Details
    transfer_type = Column(
        String(50),
        nullable=False,
        comment="'sales_to_asset' or 'asset_to_sales'"
    )
    
    # Source Item
    source_table = Column(
        String(50),
        nullable=False,
        comment="'sales_stock' or 'company_assets'"
    )
    source_id = Column(Integer, nullable=False, index=True)
    source_barcode = Column(String(200), nullable=True)
    source_status = Column(String(50), nullable=True)
    
    # Destination Item
    destination_table = Column(
        String(50),
        nullable=False,
        comment="'company_assets' or 'sales_stock'"
    )
    destination_id = Column(Integer, nullable=True, index=True)
    destination_barcode = Column(String(200), nullable=True)
    
    # Common Fields
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    branch_code = Column(String(200), nullable=False, index=True)
    
    # Reason & Context
    reason = Column(String(500), nullable=True)
    initiated_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    
    # Status & Timestamps
    status = Column(String(50), default="completed", nullable=False, index=True)
    initiated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    reversed_at = Column(DateTime, nullable=True)
    reverse_reason = Column(String(500), nullable=True)
    
    # Audit
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    product = relationship("Product", foreign_keys=[product_id])
    initiator = relationship(
        "User",
        foreign_keys=[initiated_by],
        primaryjoin="StockTransfer.initiated_by == User.id"
    )
    approver = relationship(
        "User",
        foreign_keys=[approved_by],
        primaryjoin="StockTransfer.approved_by == User.id"
    )
    
    def __repr__(self):
        return f"<StockTransfer {self.id}: {self.transfer_type} ({self.status})>"
