from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.common.audit import log_audit, diff_changes
from app.modules.products import repository, schemas, models

def _attach_user_names(db: Session, records: List) -> None:
    """Resolve created_by/updated_by ids to display names, in one batched
    query, and stamp them onto each record as dynamic attributes. Shared
    across Product/Category/Brand — all follow the same AuditMixin shape."""
    from app.auth.models import User

    user_ids = {
        uid for r in records for uid in (getattr(r, "created_by", None), getattr(r, "updated_by", None)) if uid
    }
    if not user_ids:
        for r in records:
            r.created_by_name = None
            r.updated_by_name = None
        return

    users = db.query(User).filter(User.id.in_(user_ids)).all()
    name_map = {
        u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
        for u in users
    }
    for r in records:
        r.created_by_name = name_map.get(getattr(r, "created_by", None))
        r.updated_by_name = name_map.get(getattr(r, "updated_by", None))


def _attach_minimum_prices(db: Session, products: List) -> None:
    """Stamp each product's current (latest) minimum selling price, in one
    batched query — same shape as _attach_user_names above."""
    price_by_product = repository.minimum_price_repository.get_current_for_products(
        db, [p.id for p in products]
    )
    for p in products:
        p.minimum_selling_price = price_by_product.get(p.id)


def _attach_preferred_suppliers(db: Session, products: List) -> None:
    """Stamp each product's preferred-supplier company name, in one batched
    query — same shape as _attach_user_names above."""
    from app.modules.purchasing.repository import SupplierProductRepository

    name_by_product = SupplierProductRepository(db).get_preferred_for_products(
        [p.id for p in products]
    )
    for p in products:
        p.preferred_supplier_name = name_by_product.get(p.id)


class ProductService:
    def get_product(self, db: Session, product_id: int) -> schemas.Product:
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        _attach_user_names(db, [product])
        _attach_minimum_prices(db, [product])
        _attach_preferred_suppliers(db, [product])
        return product

    def get_all_products(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = True) -> List[schemas.Product]:
        products = repository.product_repository.get_all(db, skip, limit, active_only)
        _attach_user_names(db, products)
        _attach_minimum_prices(db, products)
        _attach_preferred_suppliers(db, products)
        return products

    def search_products(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[schemas.Product]:
        products = repository.product_repository.search(db, query, skip, limit)
        _attach_user_names(db, products)
        _attach_minimum_prices(db, products)
        _attach_preferred_suppliers(db, products)
        return products

    def create_product(self, db: Session, product: schemas.ProductCreate, user_id: int) -> schemas.Product:
        existing = repository.product_repository.get_by_item_code(db, product.item_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product with item_code {product.item_code} already exists"
            )

        existing_name = repository.product_repository.get_by_name(db, product.name)
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product with name '{product.name}' already exists"
            )

        if product.selling_price is not None and product.selling_price < product.cost_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selling price cannot be less than cost price."
            )
        if product.website_price is not None and product.website_price > 0 and product.website_price < product.cost_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Website price cannot be less than cost price."
            )
        created = repository.product_repository.create(db, product, user_id)
        log_audit(
            db,
            user_id=user_id or 0,
            action="create",
            entity_type="product",
            entity_id=created.id,
            changes={"name": created.name, "item_code": created.item_code},
        )
        db.commit()
        _attach_user_names(db, [created])
        return created

    def update_product(self, db: Session, product_id: int, product: schemas.ProductUpdate, user_id: int) -> schemas.Product:
        curr_product = repository.product_repository.get_by_id(db, product_id)
        if not curr_product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )

        if product.name:
            existing_name = repository.product_repository.get_by_name(db, product.name)
            if existing_name and existing_name.id != product_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Product with name '{product.name}' already exists"
                )

        new_cost_price = product.cost_price if product.cost_price is not None else curr_product.cost_price
        new_selling_price = product.selling_price if product.selling_price is not None else curr_product.selling_price
        new_website_price = product.website_price if product.website_price is not None else curr_product.website_price

        if new_selling_price is not None and new_selling_price < new_cost_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selling price cannot be less than cost price."
            )
        if new_website_price is not None and new_website_price > 0 and new_website_price < new_cost_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Website price cannot be less than cost price."
            )
        submitted_fields = product.model_dump(exclude_unset=True)
        before_values = {field: getattr(curr_product, field) for field in submitted_fields}

        updated_product = repository.product_repository.update(db, product_id, product, user_id)
        if not updated_product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )

        changes = diff_changes(before_values, submitted_fields)
        if changes:
            log_audit(
                db,
                user_id=user_id or 0,
                action="update",
                entity_type="product",
                entity_id=updated_product.id,
                changes=changes,
            )
            db.commit()

        _attach_user_names(db, [updated_product])
        return updated_product

    def update_image(self, db: Session, product_id: int, relative_path: str) -> schemas.Product:
        from app.common.file_storage import delete_file

        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        old_path = product.image_url
        product.image_url = relative_path
        db.commit()
        db.refresh(product)
        # Only clean up files this uploader saved — a pasted external URL
        # (the old free-text behavior) isn't ours to delete.
        if old_path and old_path != relative_path and not old_path.startswith("http"):
            delete_file(old_path)
        _attach_user_names(db, [product])
        return product

    def remove_image(self, db: Session, product_id: int) -> schemas.Product:
        from app.common.file_storage import delete_file

        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        old_path = product.image_url
        product.image_url = None
        db.commit()
        db.refresh(product)
        if old_path and not old_path.startswith("http"):
            delete_file(old_path)
        _attach_user_names(db, [product])
        return product

    def delete_product(self, db: Session, product_id: int, user_id: Optional[int] = None) -> dict:
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        
        usage_checks = []
        
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
        
        if usage_checks:
            usage_list = ", ".join(usage_checks)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete product '{product.name}' (Code: {product.item_code}). It is used in: {usage_list}. Please remove these references first or consider deactivating the product instead."
            )
        
        db.query(models.MinimumPrice).filter(models.MinimumPrice.product_id == product_id).delete()
        db.commit()
        
        success = repository.product_repository.delete(db, product_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        log_audit(
            db,
            user_id=user_id or 0,
            action="delete",
            entity_type="product",
            entity_id=product_id,
            changes={"name": product.name, "item_code": product.item_code},
        )
        db.commit()
        return {"message": f"Product '{product.name}' deleted successfully"}

class CategoryService:
    def get_category(self, db: Session, category_id: int) -> schemas.Category:
        category = repository.category_repository.get_by_id(db, category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        _attach_user_names(db, [category])
        return category

    def get_all_categories(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[schemas.Category]:
        categories = repository.category_repository.get_all(db, skip, limit, active_only)
        _attach_user_names(db, categories)
        return categories

    def create_category(self, db: Session, category: schemas.CategoryCreate, user_id: int) -> schemas.Category:
        existing = repository.category_repository.get_by_code(db, category.category_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Category with code '{category.category_code}' already exists"
            )
        existing_name = repository.category_repository.get_by_name(db, category.name)
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Category with name '{category.name}' already exists"
            )
        from sqlalchemy.exc import IntegrityError
        try:
            created = repository.category_repository.create(db, category, user_id)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Category with name '{category.name}' or code '{category.category_code}' already exists"
            )
        log_audit(
            db,
            user_id=user_id or 0,
            action="create",
            entity_type="category",
            entity_id=created.id,
            changes={"name": created.name, "category_code": created.category_code},
        )
        db.commit()
        _attach_user_names(db, [created])
        return created

    def update_category(self, db: Session, category_id: int, category: schemas.CategoryUpdate, user_id: int) -> schemas.Category:
        curr_category = repository.category_repository.get_by_id(db, category_id)
        if not curr_category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        if category.category_code:
            existing_code = repository.category_repository.get_by_code(db, category.category_code)
            if existing_code and existing_code.id != category_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Category with code '{category.category_code}' already exists"
                )
        if category.name:
            existing_name = repository.category_repository.get_by_name(db, category.name)
            if existing_name and existing_name.id != category_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Category with name '{category.name}' already exists"
                )

        submitted_fields = category.model_dump(exclude_unset=True)
        before_values = {field: getattr(curr_category, field) for field in submitted_fields}

        updated_category = repository.category_repository.update(db, category_id, category, user_id)
        if not updated_category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )

        changes = diff_changes(before_values, submitted_fields)
        if changes:
            log_audit(
                db,
                user_id=user_id or 0,
                action="update",
                entity_type="category",
                entity_id=updated_category.id,
                changes=changes,
            )
            db.commit()

        _attach_user_names(db, [updated_category])
        return updated_category

    def delete_category(self, db: Session, category_id: int, user_id: Optional[int] = None) -> dict:
        category = repository.category_repository.get_by_id(db, category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )

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
        log_audit(
            db,
            user_id=user_id or 0,
            action="delete",
            entity_type="category",
            entity_id=category_id,
            changes={"name": category.name},
        )
        db.commit()
        return {"message": f"Category '{category.name}' deleted successfully"}

class BrandService:
    def get_brand(self, db: Session, brand_id: int) -> schemas.Brand:
        brand = repository.brand_repository.get_by_id(db, brand_id)
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        _attach_user_names(db, [brand])
        return brand

    def get_all_brands(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[schemas.Brand]:
        brands = repository.brand_repository.get_all(db, skip, limit, active_only)
        _attach_user_names(db, brands)
        return brands

    def create_brand(self, db: Session, brand: schemas.BrandCreate, user_id: Optional[int] = None) -> schemas.Brand:
        existing = repository.brand_repository.get_by_code(db, brand.brand_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Brand with code '{brand.brand_code}' already exists"
            )
        existing_name = repository.brand_repository.get_by_name(db, brand.brand_name)
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Brand with name '{brand.brand_name}' already exists"
            )
        from sqlalchemy.exc import IntegrityError
        try:
            created = repository.brand_repository.create(db, brand)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Brand with name '{brand.brand_name}' or code '{brand.brand_code}' already exists"
            )
        log_audit(
            db,
            user_id=user_id or 0,
            action="create",
            entity_type="brand",
            entity_id=created.id,
            changes={"brand_name": created.brand_name, "brand_code": created.brand_code},
        )
        db.commit()
        _attach_user_names(db, [created])
        return created

    def update_brand(self, db: Session, brand_id: int, brand: schemas.BrandUpdate, user_id: Optional[int] = None) -> schemas.Brand:
        curr_brand = repository.brand_repository.get_by_id(db, brand_id)
        if not curr_brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )
        if brand.brand_code:
            existing_code = repository.brand_repository.get_by_code(db, brand.brand_code)
            if existing_code and existing_code.id != brand_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Brand with code '{brand.brand_code}' already exists"
                )
        if brand.brand_name:
            existing_name = repository.brand_repository.get_by_name(db, brand.brand_name)
            if existing_name and existing_name.id != brand_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Brand with name '{brand.brand_name}' already exists"
                )

        submitted_fields = brand.model_dump(exclude_unset=True)
        before_values = {field: getattr(curr_brand, field) for field in submitted_fields}

        updated_brand = repository.brand_repository.update(db, brand_id, brand)
        if not updated_brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )

        changes = diff_changes(before_values, submitted_fields)
        if changes:
            log_audit(
                db,
                user_id=user_id or 0,
                action="update",
                entity_type="brand",
                entity_id=updated_brand.id,
                changes=changes,
            )
            db.commit()

        _attach_user_names(db, [updated_brand])
        return updated_brand

    def delete_brand(self, db: Session, brand_id: int, user_id: Optional[int] = None) -> dict:
        brand = repository.brand_repository.get_by_id(db, brand_id)
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Brand with id {brand_id} not found"
            )

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
        log_audit(
            db,
            user_id=user_id or 0,
            action="delete",
            entity_type="brand",
            entity_id=brand_id,
            changes={"brand_name": brand.brand_name},
        )
        db.commit()
        return {"message": f"Brand '{brand.brand_name}' deleted successfully"}

product_service = ProductService()
category_service = CategoryService()
brand_service = BrandService()

class MinimumPriceService:
    def get_product_price_history(self, db: Session, product_id: int) -> List[schemas.MinimumPrice]:
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return repository.minimum_price_repository.get_by_product_id(db, product_id)
    
    def get_current_minimum_price(self, db: Session, product_id: int) -> Optional[schemas.MinimumPrice]:
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
        return repository.minimum_price_repository.get_current_for_product(db, product_id)
    
    def set_minimum_price(self, db: Session, product_id: int, minimum_price: float) -> schemas.MinimumPrice:
        product = repository.product_repository.get_by_id(db, product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found"
            )
            
        if minimum_price < product.cost_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Minimum selling price cannot be less than cost price."
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
