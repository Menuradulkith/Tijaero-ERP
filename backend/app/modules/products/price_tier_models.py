from sqlalchemy import Column, Integer, Text, ForeignKey, Numeric, Boolean
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.common.base_models import AuditMixin


class ProductPriceTier(Base, AuditMixin):
    """
    Stores multiple price tiers per product.

    Each tier carries four prices:
        cost_price              — what the product costs us
        minimum_selling_price   — the floor; reps cannot sell below this
        selling_price           — the standard / default selling price
        website_price           — optional public-facing price

    A product can have many tiers but at least one must be active.
    Inactive tiers are hidden from sales/quotation dropdowns but are
    preserved for historical reference on invoice items.
    """

    __tablename__ = "product_price_tiers"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(
        Integer,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Core prices
    cost_price = Column(Numeric(60, 2), nullable=False)
    minimum_selling_price = Column(Numeric(60, 2), nullable=False)
    selling_price = Column(Numeric(60, 2), nullable=False)
    website_price = Column(Numeric(60, 2), nullable=True)

    # Human-readable note (e.g. "Special Import Batch — June 2026")
    remark = Column(Text, nullable=True)

    # Toggle — only active tiers appear in sales/quotation dropdowns
    is_active = Column(Boolean, nullable=False, default=True)

    # Relationships
    product = relationship("Product", back_populates="price_tiers")
    invoice_items = relationship("InvoiceItems", back_populates="price_tier")
    quote_items = relationship("SalesQuoteItem", back_populates="price_tier")
