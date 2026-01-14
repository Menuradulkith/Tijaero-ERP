from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin


class GoodReceivedNote(Base):
    __tablename__ = "good_received_note"
    
    id = Column(Integer, primary_key=True, index=True)
    good_received_no = Column(String(200), unique=True, nullable=False)
    good_received_date = Column(Date, nullable=False)
    supplier_invoice_no = Column(String(200), nullable=False)
    supplier_invoice_date = Column(Date, nullable=False)
    remark = Column(Text)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(Date, nullable=False)
    good_received_locations_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=False)
    purchasingorders_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    location = relationship("Locations", back_populates="good_received_notes")
    purchasing_order = relationship("PurchasingOrder", back_populates="good_received_notes")
    purchasing_returns = relationship("PurchasingReturn", back_populates="good_received_note")
    credit_settle_transactions = relationship("SupplierCreditsSettleTransaction", back_populates="good_received_note")
    sales_stock_items = relationship("SalesStock", back_populates="good_received_note")
    company_asset_items = relationship("CompanyAssets", back_populates="good_received_note")


class GoodReceivedItems(Base):
    """Good Received Items - Basket/staging table where all scanned items first go before distribution"""
    __tablename__ = "good_received_items"
    
    id = Column(Integer, primary_key=True, index=True)
    good_received_note = Column(String(355), nullable=False)
    barcode = Column(Text, nullable=False)
    branch_code = Column(String(200), nullable=False)
    active = Column(Boolean, nullable=False)
    created_date = Column(Date, nullable=False)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="good_received_items")
    invoice_barcodes = relationship("InvoiceItemsBarcode", back_populates="good_received_item")


class Supplier(Base, TimestampMixin):
    __tablename__ = "supplier"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(30), nullable=False)
    full_name = Column(String(255), nullable=False)
    name_in_cheque_card = Column(String(255))
    occupation = Column(String(255))
    company_name = Column(String(255))
    company_registration_number = Column(String(255))
    company_postal_address = Column(Text)
    company_contact_number = Column(String(12))
    company_website = Column(String(200))
    postal_address = Column(Text, nullable=False)
    permenent_address = Column(Text, nullable=False)
    bank_details = Column(Text)
    date_joined = Column(TIMESTAMP, nullable=False)
    birthdate = Column(Date)
    id_card_number = Column(String(12))
    gender = Column(String(30), nullable=False)
    civil_status = Column(String(30), nullable=False)
    passport_no = Column(String(50))
    no_of_kids = Column(String(30), nullable=False)
    email = Column(String(75))
    home_contact_number = Column(String(12))
    mobile_contact_number = Column(String(12), nullable=False)
    credit_days = Column(Integer, nullable=False)
    max_credit_limit = Column(Integer, nullable=False)
    left_credit_amount = Column(Integer)
    initial_credit_amount = Column(Integer)
    active = Column(Boolean, nullable=False)
    country_id = Column(Integer, ForeignKey("country.id"))
    
    # Relationships
    country = relationship("Country", back_populates="suppliers")
    purchasing_orders_first = relationship("PurchasingOrder", foreign_keys="PurchasingOrder.first_suppliers_id", back_populates="first_supplier")
    purchasing_orders_second = relationship("PurchasingOrder", foreign_keys="PurchasingOrder.second_suppliers_id", back_populates="second_supplier")
    credit_settlements = relationship("SupplierCreditsSettle", back_populates="supplier")
    payments = relationship("SupplierPayment", back_populates="supplier")

class PurchasingOrder(Base):
    __tablename__ = "purchasing_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    purchasing_order_no = Column(String(200), nullable=False)
    purchasing_invoice_no = Column(String(200), nullable=False)
    branch_code = Column(String(200), nullable=False)
    payment_method = Column(String(30), nullable=False)
    purchasing_order_date = Column(Date, nullable=False)
    good_received_note_date = Column(Date, nullable=False)
    remarks = Column(Text)
    credit_date = Column(Integer)
    created_date = Column(Date, nullable=False)
    first_suppliers_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    second_suppliers_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    status = Column(String(30), nullable=False, default="pending")
    
    # Relationships
    first_supplier = relationship("Supplier", foreign_keys=[first_suppliers_id], back_populates="purchasing_orders_first")
    second_supplier = relationship("Supplier", foreign_keys=[second_suppliers_id], back_populates="purchasing_orders_second")
    approval = relationship("Approvals", back_populates="purchasing_orders")
    items = relationship("PurchasingOrderItems", back_populates="purchasing_order")
    good_received_notes = relationship("GoodReceivedNote", back_populates="purchasing_order")
    payments = relationship("SupplierPayment", back_populates="purchasing_order")

class PurchasingOrderItems(Base):
    __tablename__ = "purchasing_order_items"
    
    id = Column(Integer, primary_key=True, index=True)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(60, 2), nullable=False)
    warrenty_month = Column(String(30), nullable=False)
    remark = Column(String(200))
    created_date = Column(Date, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    purchasingorders_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    product = relationship("Product", back_populates="purchasing_order_items")
    purchasing_order = relationship("PurchasingOrder", back_populates="items")
    good_received_items = relationship("GoodReceivedItems", back_populates="purchasing_order_item")
    sales_stock_items = relationship("SalesStock", back_populates="purchasing_order_item")
    company_asset_items = relationship("CompanyAssets", back_populates="purchasing_order_item")

class PurchasingReturn(Base):
    __tablename__ = "purchasing_return"
    
    id = Column(Integer, primary_key=True, index=True)
    purchasing_return_no = Column(String(200), nullable=False, unique=True)
    branch_code = Column(String(200), nullable=False)
    remark = Column(Text)
    status = Column(String(30), nullable=False, default="draft")  # draft, pending, approved, rejected
    added_date = Column(Date, nullable=False)
    approved_date = Column(TIMESTAMP, nullable=True)  # When return was approved
    goodreceivednote_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    
    # Relationships
    good_received_note = relationship("GoodReceivedNote", back_populates="purchasing_returns")
    approval = relationship("Approvals", back_populates="purchasing_returns")
    items = relationship("PurchasingReturnItems", back_populates="purchasing_return")
    returned_stock_items = relationship("SalesStock", back_populates="purchase_return")

class PurchasingReturnItems(Base):
    __tablename__ = "purchasing_return_items"
    
    id = Column(Integer, primary_key=True, index=True)
    purchasing_price = Column(Numeric(60, 2), nullable=False)
    return_price = Column(Numeric(60, 2), nullable=False)
    barcode = Column(Text, nullable=False)
    branch_code = Column(String(200), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    purchasingreturn_id = Column(Integer, ForeignKey("purchasing_return.id"), nullable=False)
    sales_stock_id = Column(Integer, ForeignKey("sales_stock.id"), nullable=True)  # Link to the stock item being returned
    
    # Relationships
    product = relationship("Product", back_populates="purchasing_return_items")
    purchasing_return = relationship("PurchasingReturn", back_populates="items")
    sales_stock = relationship("SalesStock")


class SupplierCreditsSettle(Base):
    __tablename__ = "supplier_credits_settle"
    
    id = Column(Integer, primary_key=True, index=True)
    supplier_credits_settle_no = Column(String(200), nullable=False)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    suppliers_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    
    # Relationships
    supplier = relationship("Supplier", back_populates="credit_settlements")
    transactions = relationship("SupplierCreditsSettleTransaction", back_populates="credit_settle")


class SupplierCreditsSettleTransaction(Base):
    __tablename__ = "supplier_credits_settle_transaction"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_method = Column(String(30), nullable=False)
    cheque_date = Column(Date, nullable=False)
    payment_amount = Column(Numeric(60, 2), nullable=False)
    payment_method_number = Column(String(300))
    remarks = Column(Text)
    created_date = Column(TIMESTAMP, nullable=False)
    good_received_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False)
    supplier_credit_settle_id = Column(Integer, ForeignKey("supplier_credits_settle.id"), nullable=False)
    
    # Relationships
    good_received_note = relationship("GoodReceivedNote", back_populates="credit_settle_transactions")
    credit_settle = relationship("SupplierCreditsSettle", back_populates="transactions")


class SupplierPayment(Base):
    """Supplier Payment - Direct payments to suppliers (non-credit payments like cash, bank, cheque)"""
    __tablename__ = "supplier_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_no = Column(String(200), unique=True, nullable=False)
    supplier_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    purchasing_order_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=True)  # Optional PO reference
    payment_date = Column(Date, nullable=False)
    payment_method = Column(String(30), nullable=False)  # Cash, Bank Transfer, Cheque
    payment_amount = Column(Numeric(60, 2), nullable=False)
    reference_number = Column(String(300))  # Cheque no, transaction ref, etc.
    bank_name = Column(String(255))  # For bank/cheque payments
    branch_code = Column(String(200), nullable=False)
    payment_for = Column(String(100), nullable=False)  # Purchase, Advance, Refund, Other
    invoice_reference = Column(String(200))  # External invoice reference if any
    remarks = Column(Text)
    status = Column(String(30), nullable=False, default="pending")  # pending, verified, cancelled
    verified_by = Column(Integer, nullable=True)  # User ID who verified (no FK - users may not exist)
    verified_date = Column(TIMESTAMP, nullable=True)
    created_date = Column(TIMESTAMP, nullable=False)
    created_by = Column(Integer, nullable=True)  # User ID who created (no FK - users may not exist)
    
    # Relationships
    supplier = relationship("Supplier", back_populates="payments")
    purchasing_order = relationship("PurchasingOrder", back_populates="payments")

