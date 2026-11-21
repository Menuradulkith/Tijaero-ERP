"""Product Design Detail: the production spec that follows a confirmed Design Brief. It starts from the
brief's lines (items can be added / removed) and adds Quantity (M), colour, size and the design URL per
line, plus special and packing / loading instructions. Confirmed once, then locked for good."""
from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.db.base import Base


class ProductDesignDetail(Base, AuditMixin):
    __tablename__ = "product_design_details"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'confirmed', 'rejected')", name="ck_product_design_details_status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, unique=True)
    status = Column(String(20), nullable=False, server_default="draft", default="draft")
    special_instructions = Column(Text)
    packing_instructions = Column(Text)
    confirmed_by = Column(Integer, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    # The latest rejection; kept after the detail is edited back to draft so the reason stays visible.
    rejected_by = Column(Integer, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    reject_reason = Column(Text)

    lines = relationship(
        "ProductDesignDetailLine", back_populates="design_detail", cascade="all, delete-orphan",
        order_by="ProductDesignDetailLine.sort_order",
    )


class ProductDesignDetailLine(Base, AuditMixin):
    __tablename__ = "product_design_detail_lines"
    __table_args__ = (
        UniqueConstraint("detail_id", "material_id", name="uq_product_design_detail_lines_item"),
        CheckConstraint("quantity > 0", name="ck_product_design_detail_lines_quantity"),
    )

    id = Column(Integer, primary_key=True, index=True)
    detail_id = Column(Integer, ForeignKey("product_design_details.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    # Snapshot of the item (and its confirmed brief text, if it came from the brief) when saved.
    item_code = Column(String(255), nullable=False)
    item_name = Column(String(255), nullable=False)
    category_id = Column(Integer, nullable=True)
    category_name = Column(String(255))
    brief = Column(Text)
    quantity = Column(Numeric(18, 3), nullable=False)
    colour = Column(String(120))
    size = Column(String(120))
    design_url = Column(String(500))
    sort_order = Column(Integer, nullable=False, server_default="0")

    design_detail = relationship("ProductDesignDetail", back_populates="lines")
