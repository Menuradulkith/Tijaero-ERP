from app.db.base import Base
from sqlalchemy import TIMESTAMP, Column, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import relationship

# NOTE: CustomerCuponCodes and CustomerGiftVoucher are defined in customers.models
# Import them from there when needed:
# from app.modules.customers.models import CustomerCuponCodes, CustomerGiftVoucher


class AdvanceReceipt(Base):
    __tablename__ = "advance_receipt"

    id = Column(Integer, primary_key=True, index=True)
    paid_price_currency = Column(String(3), nullable=False)
    paid_price = Column(Numeric(14, 2), nullable=False)
    special_note = Column(String)
    created_date = Column(TIMESTAMP, nullable=False)


class WebPosts(Base):
    """Website posts/content management with approval workflow"""

    __tablename__ = "web_posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=True)
    content = Column(String, nullable=True)
    post_type = Column(
        String(50), nullable=True
    )  # blog, announcement, product_highlight
    created_date = Column(TIMESTAMP, nullable=True)
    published_date = Column(TIMESTAMP, nullable=True)
    author_id = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)
    active = Column(String(1), default="Y")
    active = Column(String(1), default="Y")
