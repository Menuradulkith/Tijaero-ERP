"""Product Design Brief: the Item Catalog items (tags, stickers, bags, ...) a product needs,
each with its design brief. A brief is confirmed once and is then locked for good."""
from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.db.base import Base


class ProductDesignBrief(Base, AuditMixin):
    __tablename__ = "product_design_briefs"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'confirmed', 'rejected')", name="ck_product_design_briefs_status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, unique=True)
    status = Column(String(20), nullable=False, server_default="draft", default="draft")
    notes = Column(Text)
    confirmed_by = Column(Integer, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    # The latest rejection; kept after the brief is edited back to draft so the reason stays visible.
    rejected_by = Column(Integer, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    reject_reason = Column(Text)

    lines = relationship(
        "ProductDesignBriefLine", back_populates="design_brief", cascade="all, delete-orphan",
        order_by="ProductDesignBriefLine.sort_order",
    )


class ProductDesignBriefLine(Base, AuditMixin):
    __tablename__ = "product_design_brief_lines"
    __table_args__ = (
        UniqueConstraint("brief_id", "material_id", name="uq_product_design_brief_lines_item"),
    )

    id = Column(Integer, primary_key=True, index=True)
    brief_id = Column(Integer, ForeignKey("product_design_briefs.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    # Snapshot of the item when the line was saved, so a confirmed brief reads the same later.
    item_code = Column(String(255), nullable=False)
    item_name = Column(String(255), nullable=False)
    category_id = Column(Integer, nullable=True)
    category_name = Column(String(255))
    brief = Column(Text)
    sort_order = Column(Integer, nullable=False, server_default="0")

    design_brief = relationship("ProductDesignBrief", back_populates="lines")
