"""Product BOM Structure: the steps a product goes through in the company until it is packed
(e.g. Cutting -> Sewing -> Finishing -> Packing), each with the Item Catalog materials used in that
step. Kept on the product page, separate from the Manufacturing BOMs. Draft -> confirmed (locked)."""
from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.db.base import Base


class ProductBomStructure(Base, AuditMixin):
    __tablename__ = "product_bom_structures"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'confirmed', 'rejected')", name="ck_product_bom_structures_status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, unique=True)
    status = Column(String(20), nullable=False, server_default="draft", default="draft")
    notes = Column(Text)
    confirmed_by = Column(Integer, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    # The latest rejection; kept after the structure is edited back to draft so the reason stays visible.
    rejected_by = Column(Integer, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    reject_reason = Column(Text)

    steps = relationship(
        "ProductBomStep", back_populates="structure", cascade="all, delete-orphan",
        order_by="ProductBomStep.sort_order",
    )


class ProductBomStep(Base, AuditMixin):
    __tablename__ = "product_bom_steps"
    __table_args__ = (
        CheckConstraint("minutes_per_unit IS NULL OR minutes_per_unit >= 0", name="ck_product_bom_steps_minutes"),
    )

    id = Column(Integer, primary_key=True, index=True)
    structure_id = Column(
        Integer, ForeignKey("product_bom_structures.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    sort_order = Column(Integer, nullable=False, server_default="0")
    name = Column(String(150), nullable=False)
    work_area = Column(String(150))
    minutes_per_unit = Column(Numeric(10, 2))
    instructions = Column(Text)

    structure = relationship("ProductBomStructure", back_populates="steps")
    materials = relationship(
        "ProductBomMaterial", back_populates="step", cascade="all, delete-orphan",
        order_by="ProductBomMaterial.sort_order",
    )


class ProductBomMaterial(Base, AuditMixin):
    __tablename__ = "product_bom_materials"
    __table_args__ = (
        UniqueConstraint("step_id", "material_id", name="uq_product_bom_materials_step_item"),
        CheckConstraint("quantity > 0", name="ck_product_bom_materials_quantity"),
        CheckConstraint("scrap_pct >= 0 AND scrap_pct < 100", name="ck_product_bom_materials_scrap"),
    )

    id = Column(Integer, primary_key=True, index=True)
    step_id = Column(Integer, ForeignKey("product_bom_steps.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    # Snapshot of the item when the line was saved, so a confirmed structure reads the same later.
    item_code = Column(String(255), nullable=False)
    item_name = Column(String(255), nullable=False)
    category_id = Column(Integer, nullable=True)
    category_name = Column(String(255))
    unit_of_measure = Column(String(20))
    # Per one unit of the product
    quantity = Column(Numeric(18, 4), nullable=False)
    scrap_pct = Column(Numeric(5, 2), nullable=False, server_default="0", default=0)
    notes = Column(Text)
    sort_order = Column(Integer, nullable=False, server_default="0")

    step = relationship("ProductBomStep", back_populates="materials")
