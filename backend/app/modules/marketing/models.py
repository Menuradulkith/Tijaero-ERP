from sqlalchemy import Column, Integer, String, ForeignKey, Date, Numeric, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base

class CustomerCuponCodes(Base):
    __tablename__ = "customer_cupon_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    cupon_code = Column(String(10), nullable=False)
    limit_by_usage = Column(Integer, nullable=False, default=1000)
    limit_for_customer = Column(Integer, nullable=False, default=10)
    valid_until_date = Column(Date, nullable=False)
    limit_validity_product_id = Column(Integer, ForeignKey("products.id"))
    
    # Relationships
    product = relationship("Product", back_populates="cupon_codes")
    invoices = relationship("Invoice", back_populates="cupon")

class CustomerGiftVoucher(Base):
    __tablename__ = "customer_gift_voucher"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    barcode_no = Column(Integer, nullable=False)
    valid_period_in_months = Column(Integer, nullable=False, default=12)
    claimed_date = Column(TIMESTAMP)
    purchased_invoice_no = Column(String(200))
    claimed_invoice_no = Column(String(200))

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
    post_type = Column(String(50), nullable=True)  # blog, announcement, product_highlight
    created_date = Column(TIMESTAMP, nullable=True)
    published_date = Column(TIMESTAMP, nullable=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)
    active = Column(String(1), default="Y")
