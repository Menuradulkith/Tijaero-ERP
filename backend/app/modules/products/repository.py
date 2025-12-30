from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_
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
        from datetime import datetime, date
        db_product = Product(
            **product.dict(),
            created_date=date.today(),
            added_date=datetime.utcnow(),
            created_by=created_by,
            updated_by=created_by
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
        
        db_product.updated_by = updated_by
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
        query = db.query(Product)
        if active_only:
            query = query.filter(Product.active == True)
        return query.count()

class CategoryRepository:
    def get_by_id(self, db: Session, category_id: int) -> Optional[Category]:
        return db.query(Category).filter(Category.id == category_id).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[Category]:
        return db.query(Category).filter(Category.active == True).offset(skip).limit(limit).all()
    
    def create(self, db: Session, category: CategoryCreate, created_by: int) -> Category:
        from datetime import datetime
        db_category = Category(
            **category.dict(),
            created_date=datetime.utcnow(),
            created_by=created_by,
            updated_by=created_by
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
        
        db_category.updated_by = updated_by
        db.commit()
        db.refresh(db_category)
        return db_category

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

product_repository = ProductRepository()
category_repository = CategoryRepository()
brand_repository = BrandRepository()
