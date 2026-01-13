from app.db.base import Base
from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Boolean,
    Column,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship


class CustomerSupport(Base):
    __tablename__ = "customer_support"

    id = Column(Integer, primary_key=True, index=True)
    job_number = Column(String(255), nullable=False)
    job_type = Column(String(100), nullable=False)
    date = Column(Date, nullable=False)
    job_description = Column(Text)
    contact_person = Column(String(100), nullable=False)
    branch_code = Column(String(200), nullable=False)
    assigned_user_id = Column(
        BigInteger, ForeignKey("accounts_user.id"), nullable=False
    )
    customer_id = Column(Integer, ForeignKey("customers.id"))
    invoice_id = Column(Integer, ForeignKey("invoices.id"))

    # Relationships
    assigned_user = relationship("User", foreign_keys=[assigned_user_id], viewonly=True)
    customer = relationship("Customer", back_populates="support_tickets", viewonly=True)
    invoice = relationship("Invoice", back_populates="customer_support", viewonly=True)
    job_items = relationship("CSJobItem", back_populates="customer_support")
    call_logs = relationship("CustomerCallLog", back_populates="customer_support")


class CSJobItem(Base):
    __tablename__ = "cs_job_item"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(TIMESTAMP, nullable=False)
    fault_type = Column(String(100), nullable=False)
    job_status = Column(String(100), nullable=False)
    quantity = Column(Integer)
    active = Column(Boolean, nullable=False)
    comment = Column(Text)
    customer_support_id = Column(
        Integer, ForeignKey("customer_support.id"), nullable=False
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    warrent_claim_id = Column(Integer, ForeignKey("warranty_claims.id"))

    # Relationships
    customer_support = relationship("CustomerSupport", back_populates="job_items")
    product = relationship("Product", back_populates="cs_job_items")
    warranty_claim = relationship("WarrantyClaims", back_populates="cs_job_items")


class CustomerCallLog(Base):
    __tablename__ = "customer_call_log"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(TIMESTAMP, nullable=False)
    contact_person = Column(String(60))
    comment = Column(Text)
    customer_support_id = Column(Integer, ForeignKey("customer_support.id"))

    # Relationships
    customer_support = relationship("CustomerSupport", back_populates="call_logs")


class WarrantyClaims(Base):
    __tablename__ = "warranty_claims"

    id = Column(Integer, primary_key=True, index=True)
    warranty_type = Column(String(30), nullable=False)
    warranty_status = Column(String(30), nullable=False)
    product_barcode_old_code = Column(String(255), nullable=False)
    product_barcode_new_code = Column(String(255))
    comment = Column(Text)
    created_date = Column(TIMESTAMP, nullable=False)
    order_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    supplier_warrenty_claims = Column(Boolean, nullable=False, default=False)

    # Relationships
    order = relationship("Invoice", back_populates="warranty_claims")
    cs_job_items = relationship("CSJobItem", back_populates="warranty_claim")
    order = relationship("Invoice", back_populates="warranty_claims")
    cs_job_items = relationship("CSJobItem", back_populates="warranty_claim")
