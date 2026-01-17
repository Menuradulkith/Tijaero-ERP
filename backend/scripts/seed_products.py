"""
Seed products, categories, and brands.
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.auth.models import User
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
# Import other models to ensure relationships are resolved
from app.modules.sales.models import InvoiceItems
from app.modules.purchasing.models import PurchasingOrderItems, PurchasingReturnItems
from app.modules.support.models import CSJobItem
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.warehouse.models import ItemTransferNoteItems, ItemTransferNoteItemProduct
from app.modules.employees.models import Employee
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
)
from app.modules.customers.models import (
    CustomerCuponCodes, Customer,
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle, CustomerCreditsSettleTransaction
)
from app.modules.purchasing.models import (
    PurchasingOrderItems, PurchasingReturnItems,
    SupplierCreditsSettle, SupplierCreditsSettleTransaction
)
from app.modules.common.models import Approvals, Country, Locations
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves
from datetime import datetime, date
from decimal import Decimal

def seed_products():
    db: Session = SessionLocal()
    
    try:
        print("🌱 Seeding products...")
        
        # 1. Categories
        print("📦 Checking categories...")
        categories_data = [
            {"name": "Electronics", "code": "ELEC", "desc": "Electronic devices and accessories"},
            {"name": "Furniture", "code": "FURN", "desc": "Office and home furniture"},
            {"name": "Stationery", "code": "STAT", "desc": "Office supplies and stationery"},
            {"name": "Computers", "code": "COMP", "desc": "Computers and accessories"},
            {"name": "Appliances", "code": "APPL", "desc": "Home and office appliances"},
        ]
        
        category_map = {} # name -> id

        for cat_data in categories_data:
            category = db.query(Category).filter(Category.category_code == cat_data["code"]).first()
            if not category:
                print(f"   Creating category: {cat_data['name']}")
                category = Category(
                    name=cat_data["name"],
                    category_code=cat_data["code"],
                    description=cat_data["desc"],
                    active=True,
                    created_date=datetime.now()
                )
                db.add(category)
                db.flush()
            else:
                print(f"   Category exists: {cat_data['name']}")
            
            category_map[cat_data["name"]] = category.id

        # 2. Brands
        print("🏷️  Checking brands...")
        brands_data = [
            {"name": "Samsung", "code": "SAMS", "desc": "Samsung Electronics"},
            {"name": "Apple", "code": "APPL", "desc": "Apple Inc."},
            {"name": "IKEA", "code": "IKEA", "desc": "IKEA Furniture"},
            {"name": "Dell", "code": "DELL", "desc": "Dell Technologies"},
            {"name": "HP", "code": "HP", "desc": "HP Inc."},
            {"name": "Sony", "code": "SONY", "desc": "Sony Corporation"},
            {"name": "LG", "code": "LG", "desc": "LG Electronics"},
        ]
        
        brand_map = {} # name -> id

        for brand_data in brands_data:
            brand = db.query(ItemsBrand).filter(ItemsBrand.brand_code == brand_data["code"]).first()
            if not brand:
                print(f"   Creating brand: {brand_data['name']}")
                brand = ItemsBrand(
                    brand_name=brand_data["name"],
                    brand_code=brand_data["code"],
                    description=brand_data["desc"]
                )
                db.add(brand)
                db.flush()
            else:
                 print(f"   Brand exists: {brand_data['name']}")
            
            brand_map[brand_data["name"]] = brand.id

        # 3. Products
        print("📱 Checking products...")
        products_data = [
             # Electronics
            {
                "name": "Samsung Galaxy S23",
                "item_code": "SAMS-S23-001",
                "model": "Galaxy S23",
                "item_type": "smartphone",
                "description": "Latest Samsung flagship smartphone with 256GB storage",
                "website_active": True,
                "website_price": Decimal("999.99"),
                "active": True,
                "cost_price": Decimal("750.00"),
                "category": "Electronics",
                "brand": "Samsung"
            },
            {
                "name": "iPhone 15 Pro",
                "item_code": "APPL-IP15-001",
                "model": "iPhone 15 Pro",
                "item_type": "smartphone",
                "description": "Apple iPhone 15 Pro with 512GB storage",
                "website_active": True,
                "website_price": Decimal("1199.99"),
                "active": True,
                "cost_price": Decimal("900.00"),
                "category": "Electronics",
                "brand": "Apple"
            },
            {
                "name": "Samsung 55\" 4K TV",
                "item_code": "SAMS-TV55-001",
                "model": "QN55Q80C",
                "item_type": "television",
                "description": "55-inch 4K QLED Smart TV",
                "website_active": True,
                "website_price": Decimal("1299.99"),
                "active": True,
                "cost_price": Decimal("950.00"),
                "category": "Electronics",
                "brand": "Samsung"
            },
            {
                "name": "Sony WH-1000XM5",
                "item_code": "SONY-WH1000-001",
                "model": "WH-1000XM5",
                "item_type": "headphones",
                "description": "Premium noise-canceling wireless headphones",
                "website_active": True,
                "website_price": Decimal("399.99"),
                "active": True,
                "cost_price": Decimal("280.00"),
                "category": "Electronics",
                "brand": "Sony"
            },
            # Furniture
            {
                "name": "Office Desk",
                "item_code": "IKEA-DESK-001",
                "model": "BEKANT",
                "item_type": "furniture",
                "description": "Adjustable office desk 160x80cm",
                "website_active": True,
                "website_price": Decimal("299.99"),
                "active": True,
                "cost_price": Decimal("150.00"),
                "category": "Furniture",
                "brand": "IKEA"
            },
            {
                "name": "Office Chair",
                "item_code": "IKEA-CHAIR-001",
                "model": "MARKUS",
                "item_type": "furniture",
                "description": "Ergonomic office chair with lumbar support",
                "website_active": True,
                "website_price": Decimal("199.99"),
                "active": True,
                "cost_price": Decimal("100.00"),
                "category": "Furniture",
                "brand": "IKEA"
            },
             {
                "name": "Bookshelf",
                "item_code": "IKEA-SHELF-001",
                "model": "BILLY",
                "item_type": "furniture",
                "description": "Classic bookshelf 80x202cm",
                "website_active": True,
                "website_price": Decimal("79.99"),
                "active": True,
                "cost_price": Decimal("40.00"),
                "category": "Furniture",
                "brand": "IKEA"
            },
            # Computers
            {
                "name": "Dell XPS 15",
                "item_code": "DELL-XPS15-001",
                "model": "XPS 15 9530",
                "item_type": "laptop",
                "description": "15.6\" laptop with Intel i7, 16GB RAM, 512GB SSD",
                "website_active": True,
                "website_price": Decimal("1799.99"),
                "active": True,
                "cost_price": Decimal("1400.00"),
                "category": "Computers",
                "brand": "Dell"
            },
            {
                "name": "HP ProBook 450",
                "item_code": "HP-PB450-001",
                "model": "ProBook 450 G10",
                "item_type": "laptop",
                "description": "Business laptop with Intel i5, 8GB RAM, 256GB SSD",
                "website_active": True,
                "website_price": Decimal("899.99"),
                "active": True,
                "cost_price": Decimal("650.00"),
                "category": "Computers",
                "brand": "HP"
            },
            {
                "name": "Dell UltraSharp Monitor",
                "item_code": "DELL-MON27-001",
                "model": "U2723DE",
                "item_type": "monitor",
                "description": "27\" 4K USB-C monitor",
                "website_active": True,
                "website_price": Decimal("649.99"),
                "active": True,
                "cost_price": Decimal("450.00"),
                "category": "Computers",
                "brand": "Dell"
            },
            # Appliances
             {
                "name": "LG Refrigerator",
                "item_code": "LG-FRIDGE-001",
                "model": "LRFVS3006S",
                "item_type": "appliance",
                "description": "French door refrigerator 30 cu. ft.",
                "website_active": True,
                "website_price": Decimal("2299.99"),
                "active": True,
                "cost_price": Decimal("1700.00"),
                "category": "Appliances",
                "brand": "LG"
            },
            {
                "name": "Samsung Microwave",
                "item_code": "SAMS-MICRO-001",
                "model": "MS14K6000AS",
                "item_type": "appliance",
                "description": "1.4 cu. ft. countertop microwave",
                "website_active": True,
                "website_price": Decimal("199.99"),
                "active": True,
                "cost_price": Decimal("120.00"),
                "category": "Appliances",
                "brand": "Samsung"
            },
        ]
        
        for pd in products_data:
            product = db.query(Product).filter(Product.item_code == pd["item_code"]).first()
            if not product:
                print(f"   Creating product: {pd['name']}")
                product = Product(
                    name=pd["name"],
                    item_code=pd["item_code"],
                    model=pd["model"],
                    item_type=pd["item_type"],
                    description=pd["description"],
                    website_active=pd["website_active"],
                    website_price=pd["website_price"],
                    active=pd["active"],
                    cost_price=pd["cost_price"],
                    category_id=category_map[pd["category"]],
                    items_brand_id=brand_map[pd["brand"]],
                    created_date=date.today(),
                    added_date=datetime.now()
                )
                db.add(product)
                db.flush()
                
                # Add minimum price
                min_price = MinimumPrice(
                    minimum_price=float(pd["cost_price"]) * 1.1,
                    created_date=datetime.now(),
                    product_id=product.id
                )
                db.add(min_price)
            else:
                 print(f"   Product exists: {pd['name']}")
        
        db.commit()
        print("✅ Product seeding completed successfully!")

    except Exception as e:
        print(f"❌ Error seeding products: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_products()
