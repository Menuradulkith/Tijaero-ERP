from sqlalchemy import Column, Integer, String, Text, Boolean, Date, TIMESTAMP, Numeric, SmallInteger, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin, AuditMixin

class Country(Base, AuditMixin):
    __tablename__ = "country"
    
    id = Column(Integer, primary_key=True, index=True)
    iso = Column(String(2), nullable=False)
    iso3 = Column(String(3), nullable=False)
    iso_numeric = Column(Integer, nullable=False)
    fips = Column(String(3))
    name = Column(String(255), nullable=False)
    capital = Column(String(255))
    area = Column(Numeric(11, 2))
    population = Column(Integer)
    continent = Column(String(2))
    tld = Column(String(255))
    currency_code = Column(String(3))
    currency_symbol = Column(String(255))
    currency_name = Column(String(255))
    phone = Column(String(255))
    postal_code_format = Column(String(255))
    postal_code_regex = Column(String(255))
    languages = Column(String(255))
    geonameid = Column(Integer)
    neighbours = Column(String(255))
    equivalent_fips_code = Column(String(4))

    users = relationship("User", back_populates="country")
    customers = relationship("Customer", back_populates="country")
    suppliers = relationship("Supplier", back_populates="country")

class Approvals(Base, AuditMixin):
    __tablename__ = "approvals"
    
    id = Column(Integer, primary_key=True, index=True)
    approval_for = Column(String(255))
    status = Column(String(255))
    status_changed_by = Column(Integer)
    next_approval_group = Column(String(255))
    next_user_to_approve = Column(Integer)
    remark = Column(String(255))
    
    approver = relationship(
        "User",
        primaryjoin="Approvals.status_changed_by == User.id",
        foreign_keys="[Approvals.status_changed_by]",
        uselist=False,
    )
    
    invoices = relationship("Invoice", back_populates="approval_record")
    purchasing_orders = relationship("PurchasingOrder", back_populates="approval")
    purchasing_returns = relationship("PurchasingReturn", back_populates="approval")
    sale_returns = relationship("SaleReturn", back_populates="approval")
    item_transfer_notes = relationship("ItemTransferNote", back_populates="approval")
    leaves = relationship("Leaves", back_populates="approval")
    reimbursements = relationship("Reimbursements", back_populates="approval")
    salary_deductions = relationship("SalaryDeductions", back_populates="approval")

class Locations(Base, AuditMixin):
    __tablename__ = "good_received_locations"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    branch_code = Column(String(255), ForeignKey("branches.branch_code"), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)

    branch = relationship("Branch")
    good_received_notes = relationship("GoodReceivedNote", back_populates="location")
    sale_returns = relationship("SaleReturn", back_populates="location")
    item_transfer_notes_from = relationship("ItemTransferNote", foreign_keys="ItemTransferNote.from_location_id", back_populates="from_location")
    item_transfer_notes_to = relationship("ItemTransferNote", foreign_keys="ItemTransferNote.to_location_id", back_populates="to_location")
    sales_stock_items = relationship("SalesStock", back_populates="location")

