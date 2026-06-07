from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP, text
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin, AuditMixin


class GoodReceivedNote(Base, AuditMixin):
    __tablename__ = "good_received_note"
    
    id = Column(Integer, primary_key=True, index=True)
    good_received_no = Column(String(200), unique=True, nullable=False)
    good_received_date = Column(Date, nullable=False)
    supplier_invoice_no = Column(String(200), nullable=False)
    supplier_invoice_date = Column(Date, nullable=False)
    remark = Column(Text)
    branch_code = Column(String(200), nullable=False, index=True)
    created_date = Column(Date, nullable=False)
    good_received_locations_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=False)
    purchasingorders_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)

    location = relationship("Locations", back_populates="good_received_notes")
    purchasing_order = relationship("PurchasingOrder", back_populates="good_received_notes")
    purchasing_returns = relationship("PurchasingReturn", back_populates="good_received_note")
    credit_settle_transactions = relationship("SupplierCreditsSettleTransaction", back_populates="good_received_note")
    sales_stock_items = relationship("SalesStock", back_populates="good_received_note")
    company_asset_items = relationship("CompanyAssets", back_populates="good_received_note")
    advance_applications = relationship("SupplierAdvanceApplication", back_populates="good_received_note")


class GoodReceivedItems(Base, AuditMixin):
    __tablename__ = "good_received_items"
    
    id = Column(Integer, primary_key=True, index=True)
    good_received_note = Column(String(355), nullable=False)
    barcode = Column(Text, nullable=False)
    branch_code = Column(String(200), nullable=False)
    active = Column(Boolean, nullable=False)
    created_date = Column(Date, nullable=False)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)

    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="good_received_items")
    invoice_barcodes = relationship("InvoiceItemsBarcode", back_populates="good_received_item")


class Supplier(Base, AuditMixin):
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

    country = relationship("Country", back_populates="suppliers")
    purchasing_orders_first = relationship("PurchasingOrder", foreign_keys="PurchasingOrder.first_suppliers_id", back_populates="first_supplier")
    purchasing_orders_second = relationship("PurchasingOrder", foreign_keys="PurchasingOrder.second_suppliers_id", back_populates="second_supplier")
    credit_settlements = relationship("SupplierCreditsSettle", back_populates="supplier")
    payments = relationship("SupplierPayment", back_populates="supplier")
    advance_payments = relationship("SupplierAdvancePayment", back_populates="supplier")

class PurchasingOrder(Base, AuditMixin):
    __tablename__ = "purchasing_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    purchasing_order_no = Column(String(200), nullable=False)
    purchasing_invoice_no = Column(String(200), nullable=True)
    branch_code = Column(String(200), nullable=False, index=True)
    payment_method = Column(String(30), nullable=False)
    purchasing_order_date = Column(Date, nullable=False)
    good_received_note_date = Column(Date, nullable=False)
    remarks = Column(Text)
    credit_date = Column(Integer)
    created_date = Column(Date, nullable=False)
    first_suppliers_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    second_suppliers_id = Column(Integer, ForeignKey("supplier.id"), nullable=True)
    added_date = Column(TIMESTAMP, nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    status = Column(String(30), nullable=False, default="pending", index=True)
    sales_quote_id = Column(Integer, ForeignKey("sales_quotes.id"), nullable=True)  # Link to source quotation
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)

    first_supplier = relationship("Supplier", foreign_keys=[first_suppliers_id], back_populates="purchasing_orders_first")
    second_supplier = relationship("Supplier", foreign_keys=[second_suppliers_id], back_populates="purchasing_orders_second")
    approval = relationship("Approvals", back_populates="purchasing_orders")
    items = relationship("PurchasingOrderItems", back_populates="purchasing_order")
    good_received_notes = relationship("GoodReceivedNote", back_populates="purchasing_order")
    payments = relationship("SupplierPayment", back_populates="purchasing_order")
    sales_quote = relationship("SalesQuote", foreign_keys=[sales_quote_id], backref="purchasing_orders")

class PurchasingOrderItems(Base, AuditMixin):
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

    product = relationship("Product", back_populates="purchasing_order_items")
    purchasing_order = relationship("PurchasingOrder", back_populates="items")
    good_received_items = relationship("GoodReceivedItems", back_populates="purchasing_order_item")
    sales_stock_items = relationship("SalesStock", back_populates="purchasing_order_item")
    company_asset_items = relationship("CompanyAssets", back_populates="purchasing_order_item")

class PurchasingReturn(Base, AuditMixin):
    __tablename__ = "purchasing_return"
    
    id = Column(Integer, primary_key=True, index=True)
    purchasing_return_no = Column(String(200), nullable=False, unique=True)
    branch_code = Column(String(200), nullable=False)
    remark = Column(Text)
    status = Column(String(30), nullable=False, default="draft")
    added_date = Column(Date, nullable=False)
    approved_date = Column(TIMESTAMP, nullable=True)
    goodreceivednote_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)

    good_received_note = relationship("GoodReceivedNote", back_populates="purchasing_returns")
    approval = relationship("Approvals", back_populates="purchasing_returns")
    items = relationship("PurchasingReturnItems", back_populates="purchasing_return")
    returned_stock_items = relationship("SalesStock", back_populates="purchase_return")

class PurchasingReturnItems(Base, AuditMixin):
    __tablename__ = "purchasing_return_items"
    
    id = Column(Integer, primary_key=True, index=True)
    purchasing_price = Column(Numeric(60, 2), nullable=False)
    return_price = Column(Numeric(60, 2), nullable=False)
    barcode = Column(Text, nullable=False)
    branch_code = Column(String(200), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    purchasingreturn_id = Column(Integer, ForeignKey("purchasing_return.id"), nullable=False)
    sales_stock_id = Column(Integer, ForeignKey("sales_stock.id"), nullable=True)
    
    product = relationship("Product", back_populates="purchasing_return_items")
    purchasing_return = relationship("PurchasingReturn", back_populates="items")
    sales_stock = relationship("SalesStock")


class SupplierCreditsSettle(Base, AuditMixin):
    __tablename__ = "supplier_credits_settle"
    
    id = Column(Integer, primary_key=True, index=True)
    supplier_credits_settle_no = Column(String(200), nullable=False)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    suppliers_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    status = Column(String(30), nullable=False, default="pending")  # pending, verified, cancelled
    verified_by = Column(Integer, nullable=True)  # User ID who verified
    verified_date = Column(TIMESTAMP, nullable=True)
    
    # Relationships
    supplier = relationship("Supplier", back_populates="credit_settlements")
    transactions = relationship("SupplierCreditsSettleTransaction", back_populates="credit_settle")


class SupplierCreditsSettleTransaction(Base, AuditMixin):
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

    good_received_note = relationship("GoodReceivedNote", back_populates="credit_settle_transactions")
    credit_settle = relationship("SupplierCreditsSettle", back_populates="transactions")


class SupplierPayment(Base, AuditMixin):
    __tablename__ = "supplier_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_no = Column(String(200), unique=True, nullable=False)
    supplier_id = Column(Integer, ForeignKey("supplier.id"), nullable=False)
    purchasing_order_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=True)
    payment_date = Column(Date, nullable=False)
    payment_method = Column(String(30), nullable=False)
    payment_amount = Column(Numeric(60, 2), nullable=False)
    reference_number = Column(String(300))
    bank_name = Column(String(255))
    branch_code = Column(String(200), nullable=False)
    payment_for = Column(String(100), nullable=False)
    invoice_reference = Column(String(200))
    remarks = Column(Text)
    status = Column(String(30), nullable=False, default="pending")
    verified_by = Column(Integer, nullable=True)
    verified_date = Column(TIMESTAMP, nullable=True)
    created_date = Column(TIMESTAMP, nullable=False)
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)
    
    supplier = relationship("Supplier", back_populates="payments")
    purchasing_order = relationship("PurchasingOrder", back_populates="payments")


class SupplierAdvancePayment(Base, AuditMixin):
    """
    Supplier Advance Payment - Payments made to supplier before goods/services are received.
    ERP Best Practice: Track advance payments separately for proper accounting and adjustment.
    
    Workflow:
    1. Create advance payment (status: active)
    2. Apply against GRN when goods received
    3. Track remaining balance
    4. Optionally refund unused advances
    """
    __tablename__ = "supplier_advance_payment"
    
    id = Column(Integer, primary_key=True, index=True)
    advance_no = Column(String(50), unique=True, nullable=False, index=True)  # Auto-generated: ADV-YYYY-XXXXX
    supplier_id = Column(Integer, ForeignKey("supplier.id"), nullable=False, index=True)
    purchasing_order_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=True, index=True)
    payment_voucher_id = Column(Integer, nullable=True)  # Optional link to voucher (no FK constraint)
    payment_date = Column(Date, nullable=False, index=True)
    branch_code = Column(String(200), nullable=False)
    payment_method = Column(String(30), nullable=False)  # Cash, Bank Transfer, Cheque
    original_amount = Column(Numeric(18, 2), nullable=False)  # Original advance amount
    applied_amount = Column(Numeric(18, 2), nullable=False, default=0)  # Amount already applied
    remaining_amount = Column(Numeric(18, 2), nullable=False)  # Remaining balance
    reference_number = Column(String(100))  # Cheque no, transaction ref, etc.
    bank_name = Column(String(100))  # For bank/cheque payments
    is_fully_applied = Column(Boolean, nullable=False, default=False)  # True when fully applied
    returned_amount = Column(Numeric(18, 2), nullable=False, default=0)  # Amount returned by supplier
    return_date = Column(Date, nullable=True)
    return_method = Column(String(30), nullable=True)  # Cash, Bank Transfer, Cheque
    return_reference = Column(String(100), nullable=True)
    return_remarks = Column(Text, nullable=True)
    remarks = Column(Text)
    created_by = Column(Integer, nullable=True)  # No FK constraint
    updated_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    
    # Relationships
    supplier = relationship("Supplier", back_populates="advance_payments")
    purchasing_order = relationship("PurchasingOrder")
    applications = relationship("SupplierAdvanceApplication", back_populates="advance_payment", cascade="all, delete-orphan")

    @property
    def po_no(self):
        if self.purchasing_order:
            return self.purchasing_order.purchasing_order_no
        return None


class SupplierAdvanceApplication(Base, AuditMixin):
    """
    Supplier Advance Application - Records application of advance payment against GRN.
    Each application reduces the advance remaining balance and settles the corresponding GRN.
    """
    __tablename__ = "supplier_advance_application"
    
    id = Column(Integer, primary_key=True, index=True)
    advance_id = Column(Integer, ForeignKey("supplier_advance_payment.id", ondelete="CASCADE"), nullable=False, index=True)
    grn_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False, index=True)
    applied_amount = Column(Numeric(18, 2), nullable=False)  # Amount applied from advance
    application_date = Column(Date, nullable=False)
    remarks = Column(Text)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    
    # Relationships
    advance_payment = relationship("SupplierAdvancePayment", back_populates="applications")
    good_received_note = relationship("GoodReceivedNote", back_populates="advance_applications")


