from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.modules.products import repository, schemas, models

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
        # First check if product exists
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        
        # Check if product is used in various business processes by checking the relationships
        usage_checks = []
        
        # Check relationships using the product's relationships
        if hasattr(product, 'invoice_items') and product.invoice_items:
            usage_checks.append(f"invoice items ({len(product.invoice_items)})")
        
        if hasattr(product, 'purchasing_order_items') and product.purchasing_order_items:
            usage_checks.append(f"purchase orders ({len(product.purchasing_order_items)})")
        
        if hasattr(product, 'purchasing_return_items') and product.purchasing_return_items:
            usage_checks.append(f"purchase returns ({len(product.purchasing_return_items)})")
        
        if hasattr(product, 'cs_job_items') and product.cs_job_items:
            usage_checks.append(f"service jobs ({len(product.cs_job_items)})")
        
        if hasattr(product, 'item_transfer_note_items') and product.item_transfer_note_items:
            usage_checks.append(f"transfer notes ({len(product.item_transfer_note_items)})")
        
        if hasattr(product, 'item_transfer_note_item_products') and product.item_transfer_note_item_products:
            usage_checks.append(f"transfer note products ({len(product.item_transfer_note_item_products)})")
        
        if hasattr(product, 'cupon_codes') and product.cupon_codes:
            usage_checks.append(f"coupon codes ({len(product.cupon_codes)})")
        
        if hasattr(product, 'company_assets') and product.company_assets:
            usage_checks.append(f"company assets ({len(product.company_assets)})")
        
        if hasattr(product, 'sales_stock') and product.sales_stock:
            usage_checks.append(f"sales stock records ({len(product.sales_stock)})")
        
        # If product is used anywhere, prevent deletion
        if usage_checks:
            usage_list = ", ".join(usage_checks)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete product '{product.name}' (Code: {product.item_code}). It is used in: {usage_list}. Please remove these references first or consider deactivating the product instead."
            )
        
        # Delete related MinimumPrice records first (they have cascade delete now, but being explicit)
        db.query(models.MinimumPrice).filter(models.MinimumPrice.product_id == product_id).delete()
        db.commit()
        
        # Now delete the product
        success = repository.product_repository.delete(db, product_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return {"message": f"Product '{product.name}' deleted successfully"}

class CategoryService:
    def get_category(self, db: Session, category_id: int) -> schemas.Category:
        category = repository.category_repository.get_by_id(db, category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        return category
    
    def get_all_categories(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[schemas.Category]:
        return repository.category_repository.get_all(db, skip, limit, active_only)
    
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
    
    def delete_category(self, db: Session, category_id: int) -> dict:
        # First check if category exists
        category = repository.category_repository.get_by_id(db, category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        
        # Check if category is assigned to any products
        products_count = db.query(models.Product).filter(models.Product.category_id == category_id).count()
        if products_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete category '{category.name}'. It is assigned to {products_count} product(s). Please reassign or delete those products first."
            )
        
        deleted = repository.category_repository.delete(db, category_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        return {"message": f"Category '{category.name}' deleted successfully"}

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
    
    def delete_brand(self, db: Session, brand_id: int) -> dict:
        # First check if brand exists
        brand = repository.brand_repository.get_by_id(db, brand_id)
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        
        # Check if brand is assigned to any products
        products_count = db.query(models.Product).filter(models.Product.items_brand_id == brand_id).count()
        if products_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete brand '{brand.brand_name}'. It is assigned to {products_count} product(s). Please reassign or delete those products first."
            )
        
        deleted = repository.brand_repository.delete(db, brand_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        return {"message": f"Brand '{brand.brand_name}' deleted successfully"}

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
