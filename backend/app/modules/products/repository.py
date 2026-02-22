from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core import timezone as tz
from app.modules.products.models import Product, Category, ItemsBrand, MinimumPrice
from app.modules.products.schemas import ProductCreate, ProductUpdate, CategoryCreate, CategoryUpdate, BrandCreate, BrandUpdate

class ProductRepository:
    def get_by_id(self, db: Session, product_id: int) -> Optional[Product]:
        return db.query(Product).filter(Product.id == product_id).first()
    
    def get_by_item_code(self, db: Session, item_code: str) -> Optional[Product]:
        return db.query(Product).filter(Product.item_code == item_code).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = True) -> List[Product]:
        query = db.query(Product)
        if active_only:
            query = query.filter(Product.active == True)
        return query.offset(skip).limit(limit).all()
    
    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[Product]:
        search_filter = or_(
            Product.name.ilike(f"%{query}%"),
            Product.item_code.ilike(f"%{query}%"),
            Product.model.ilike(f"%{query}%")
        )
        return db.query(Product).filter(search_filter).offset(skip).limit(limit).all()
    
    def create(self, db: Session, product: ProductCreate, created_by: int) -> Product:
        db_product = Product(
            **product.dict(),
            created_date=tz.today(),
            added_date=tz.now(),
        )
        db.add(db_product)
        db.commit()
        db.refresh(db_product)
        return db_product
    
    def update(self, db: Session, product_id: int, product: ProductUpdate, updated_by: int) -> Optional[Product]:
        db_product = self.get_by_id(db, product_id)
        if not db_product:
            return None
        
        update_data = product.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_product, field, value)
        
        db.commit()
        db.refresh(db_product)
        return db_product
    
    def delete(self, db: Session, product_id: int) -> bool:
        db_product = self.get_by_id(db, product_id)
        if not db_product:
            return False
        db.delete(db_product)
        db.commit()
        return True
    
    def count(self, db: Session, active_only: bool = True) -> int:
        from sqlalchemy import func
        query = db.query(func.count(Product.id))
        if active_only:
            query = query.filter(Product.active == True)
        return query.scalar() or 0

class CategoryRepository:
    def get_by_id(self, db: Session, category_id: int) -> Optional[Category]:
        return db.query(Category).filter(Category.id == category_id).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[Category]:
        query = db.query(Category)
        if active_only:
            query = query.filter(Category.active == True)
        return query.offset(skip).limit(limit).all()
    
    def create(self, db: Session, category: CategoryCreate, created_by: int) -> Category:
        db_category = Category(
            **category.dict(),
            created_date=tz.now(),
        )
        db.add(db_category)
        db.commit()
        db.refresh(db_category)
        return db_category
    
    def update(self, db: Session, category_id: int, category: CategoryUpdate, updated_by: int) -> Optional[Category]:
        db_category = self.get_by_id(db, category_id)
        if not db_category:
            return None
        
        update_data = category.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_category, field, value)
        
        db.commit()
        db.refresh(db_category)
        return db_category
    
    def delete(self, db: Session, category_id: int) -> bool:
        db_category = self.get_by_id(db, category_id)
        if not db_category:
            return False
        db.delete(db_category)
        db.commit()
        return True

class BrandRepository:
    def get_by_id(self, db: Session, brand_id: int) -> Optional[ItemsBrand]:
        return db.query(ItemsBrand).filter(ItemsBrand.id == brand_id).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[ItemsBrand]:
        return db.query(ItemsBrand).offset(skip).limit(limit).all()
    
    def create(self, db: Session, brand: BrandCreate) -> ItemsBrand:
        db_brand = ItemsBrand(**brand.dict())
        db.add(db_brand)
        db.commit()
        db.refresh(db_brand)
        return db_brand
    
    def update(self, db: Session, brand_id: int, brand: BrandUpdate) -> Optional[ItemsBrand]:
        db_brand = self.get_by_id(db, brand_id)
        if not db_brand:
            return None
        
        update_data = brand.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_brand, field, value)
        
        db.commit()
        db.refresh(db_brand)
        return db_brand
    
    def delete(self, db: Session, brand_id: int) -> bool:
        db_brand = self.get_by_id(db, brand_id)
        if not db_brand:
            return False
        db.delete(db_brand)
        db.commit()
        return True

class MinimumPriceRepository:
    def get_by_id(self, db: Session, price_id: int) -> Optional[MinimumPrice]:
        return db.query(MinimumPrice).filter(MinimumPrice.id == price_id).first()
    
    def get_by_product_id(self, db: Session, product_id: int) -> List[MinimumPrice]:
        return db.query(MinimumPrice).filter(MinimumPrice.product_id == product_id).order_by(MinimumPrice.created_date.desc()).all()
    
    def get_current_for_product(self, db: Session, product_id: int) -> Optional[MinimumPrice]:
        return db.query(MinimumPrice).filter(MinimumPrice.product_id == product_id).order_by(MinimumPrice.created_date.desc()).first()
    
    def create(self, db: Session, product_id: int, minimum_price: float) -> MinimumPrice:
        db_price = MinimumPrice(
            product_id=product_id,
            minimum_price=minimum_price,
            created_date=tz.now(),
        )
        db.add(db_price)
        db.commit()
        db.refresh(db_price)
        return db_price
    
    def delete(self, db: Session, price_id: int) -> bool:
        db_price = self.get_by_id(db, price_id)
        if not db_price:
            return False
        db.delete(db_price)
        db.commit()
        return True

product_repository = ProductRepository()
category_repository = CategoryRepository()
brand_repository = BrandRepository()
minimum_price_repository = MinimumPriceRepository()
