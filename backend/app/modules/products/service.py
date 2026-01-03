from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.modules.products import repository, schemas

class ProductService:
    def get_product(self, db: Session, product_id: int) -> schemas.Product:
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return product
    
    def get_all_products(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = True) -> List[schemas.Product]:
        return repository.product_repository.get_all(db, skip, limit, active_only)
    
    def search_products(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[schemas.Product]:
        return repository.product_repository.search(db, query, skip, limit)
    
    def create_product(self, db: Session, product: schemas.ProductCreate, user_id: int) -> schemas.Product:
        # Check if item_code already exists
        existing = repository.product_repository.get_by_item_code(db, product.item_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product with item_code {product.item_code} already exists"
            )
        return repository.product_repository.create(db, product, user_id)
    
    def update_product(self, db: Session, product_id: int, product: schemas.ProductUpdate, user_id: int) -> schemas.Product:
        updated_product = repository.product_repository.update(db, product_id, product, user_id)
        if not updated_product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return updated_product
    
    def delete_product(self, db: Session, product_id: int) -> dict:
        success = repository.product_repository.delete(db, product_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return {"message": "Product deleted successfully"}

class CategoryService:
    def get_category(self, db: Session, category_id: int) -> schemas.Category:
        category = repository.category_repository.get_by_id(db, category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        return category
    
    def get_all_categories(self, db: Session, skip: int = 0, limit: int = 100) -> List[schemas.Category]:
        return repository.category_repository.get_all(db, skip, limit)
    
    def create_category(self, db: Session, category: schemas.CategoryCreate, user_id: int) -> schemas.Category:
        return repository.category_repository.create(db, category, user_id)
    
    def update_category(self, db: Session, category_id: int, category: schemas.CategoryUpdate, user_id: int) -> schemas.Category:
        updated_category = repository.category_repository.update(db, category_id, category, user_id)
        if not updated_category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        return updated_category
    
    def delete_category(self, db: Session, category_id: int) -> bool:
        deleted = repository.category_repository.delete(db, category_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        return True

class BrandService:
    def get_brand(self, db: Session, brand_id: int) -> schemas.Brand:
        brand = repository.brand_repository.get_by_id(db, brand_id)
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        return brand
    
    def get_all_brands(self, db: Session, skip: int = 0, limit: int = 100) -> List[schemas.Brand]:
        return repository.brand_repository.get_all(db, skip, limit)
    
    def create_brand(self, db: Session, brand: schemas.BrandCreate) -> schemas.Brand:
        return repository.brand_repository.create(db, brand)
    
    def update_brand(self, db: Session, brand_id: int, brand: schemas.BrandUpdate) -> schemas.Brand:
        updated_brand = repository.brand_repository.update(db, brand_id, brand)
        if not updated_brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        return updated_brand
    
    def delete_brand(self, db: Session, brand_id: int) -> bool:
        deleted = repository.brand_repository.delete(db, brand_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        return True

product_service = ProductService()
category_service = CategoryService()
brand_service = BrandService()

class MinimumPriceService:
    def get_product_price_history(self, db: Session, product_id: int) -> List[schemas.MinimumPrice]:
        # Verify product exists
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return repository.minimum_price_repository.get_by_product_id(db, product_id)
    
    def get_current_minimum_price(self, db: Session, product_id: int) -> Optional[schemas.MinimumPrice]:
        # Verify product exists
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return repository.minimum_price_repository.get_current_for_product(db, product_id)
    
    def set_minimum_price(self, db: Session, product_id: int, minimum_price: float) -> schemas.MinimumPrice:
        # Verify product exists
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return repository.minimum_price_repository.create(db, product_id, minimum_price)
    
    def delete_minimum_price(self, db: Session, price_id: int) -> dict:
        success = repository.minimum_price_repository.delete(db, price_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Minimum price with id {price_id} not found"
            )
        return {"message": "Minimum price deleted successfully"}

minimum_price_service = MinimumPriceService()
