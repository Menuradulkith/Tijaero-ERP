from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Boolean, TIMESTAMP, SmallInteger
from sqlalchemy.orm import relationship
from app.db.base import Base

class ItemTransferNote(Base):
    __tablename__ = "item_transfer_note"
    
    id = Column(Integer, primary_key=True, index=True)
    item_transfer_note = Column(String(355), unique=True, nullable=False)
    remark = Column(Text)
    created_date = Column(Date, nullable=False)
    from_location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=False)
    to_location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=False)
    branch_code = Column(String(200), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    
    # Relationships
    from_location = relationship("Locations", foreign_keys=[from_location_id], back_populates="item_transfer_notes_from")
    to_location = relationship("Locations", foreign_keys=[to_location_id], back_populates="item_transfer_notes_to")
    approval = relationship("Approvals", back_populates="item_transfer_notes")
    items = relationship("ItemTransferNoteItems", back_populates="item_transfer_note")
    item_products = relationship("ItemTransferNoteItemProduct", back_populates="item_transfer_note")
    approved_records = relationship("ItemTransferNoteApproved", back_populates="item_transfer_note")
    receive_notes = relationship("ItemReceiveNote", back_populates="item_transfer_note")

class ItemTransferNoteItems(Base):
    __tablename__ = "item_transfer_note_items"
    
    id = Column(Integer, primary_key=True, index=True)
    remark = Column(String(200))
    created_date = Column(TIMESTAMP, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    barcode = Column(Text)
    branch_code = Column(String(200), nullable=False)
    itemtransfernote_id = Column(Integer, ForeignKey("item_transfer_note.id"), nullable=False)
    item_recieved = Column(Boolean, nullable=False, default=False)
    
    # Relationships
    product = relationship("Product", back_populates="item_transfer_note_items")
    item_transfer_note = relationship("ItemTransferNote", back_populates="items")

class ItemTransferNoteItemProduct(Base):
    __tablename__ = "item_transfer_note_item_product"
    
    id = Column(Integer, primary_key=True, index=True)
    created_date = Column(TIMESTAMP, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    itemtransfernote_id = Column(Integer, ForeignKey("item_transfer_note.id"))
    
    # Relationships
    product = relationship("Product", back_populates="item_transfer_note_item_products")
    item_transfer_note = relationship("ItemTransferNote", back_populates="item_products")

class ItemTransferNoteApproved(Base):
    __tablename__ = "item_transfer_note_approved"
    
    id = Column(Integer, primary_key=True, index=True)
    item_transfer_note_id = Column(Integer, ForeignKey("item_transfer_note.id"))
    approved_status = Column(SmallInteger, nullable=False, default=0)
    approval_note = Column(String(355))
    approved_user_id = Column(Integer, ForeignKey("users.id"))
    approved_date = Column(TIMESTAMP)
    
    # Relationships
    item_transfer_note = relationship("ItemTransferNote", back_populates="approved_records")
    approved_user = relationship("User", foreign_keys=[approved_user_id], viewonly=True)

class ItemReceiveNote(Base):
    __tablename__ = "item_receive_note"
    
    id = Column(Integer, primary_key=True, index=True)
    item_transfer_note_id = Column(Integer, ForeignKey("item_transfer_note.id"), nullable=False)
    received_approval_status = Column(SmallInteger, nullable=False, default=0)
    received_note = Column(String(355))
    recieved_user = Column(Integer)
    recieved_date = Column(TIMESTAMP)
    
    # Relationships
    item_transfer_note = relationship("ItemTransferNote", back_populates="receive_notes")
