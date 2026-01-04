from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class CompanyAssets(Base):
    __tablename__ = "company_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    inventory_no = Column(Text, nullable=False)
    item = Column(Text, nullable=False)
    description = Column(Text)
    branch_code = Column(String(200), nullable=False)
    asigned_to = Column(Integer)
    barcode = Column(Text)
    
    # Relationships
    product = relationship("Product", back_populates="company_assets")
    employee_assignments = relationship("EmployeesAssets", back_populates="asset")
