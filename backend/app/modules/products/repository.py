from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core import timezone as tz
from app.modules.products.models import Product, Category, ItemsBrand, MinimumPrice
from app.modules.products.schemas import ProductCreate, ProductUpdate, CategoryCreate, CategoryUpdate, BrandCreate, BrandUpdate, NON_COLUMN_UPDATE_FIELDS

# create/update/delete here only flush — the service owns the transaction and
# commits once (together with the audit row and any MinimumPrice row), so a
# failure part-way through can't leave half-written catalog data behind.

class ProductRepository:
    def get_by_id(self, db: Session, product_id: int) -> Optional[Product]:
        return db.query(Product).filter(Product.id == product_id).first()
    
    def get_by_item_code(self, db: Session, item_code: str) -> Optional[Product]:
        from sqlalchemy import func
        return db.query(Product).filter(func.lower(func.btrim(Product.item_code)) == (item_code or "").strip().lower()).first()
    
    def get_by_name(self, db: Session, name: str) -> Optional[Product]:
        from sqlalchemy import func
        return db.query(Product).filter(func.lower(func.btrim(Product.name)) == (name or "").strip().lower()).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = True) -> List[Product]:
        query = db.query(Product)
        if active_only:
            query = query.filter(Product.active == True)
        return query.offset(skip).limit(limit).all()
    
    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[Product]:
        # % and _ are LIKE wildcards: escape them so the search is literal
        # (searching "%" used to match every product).
        term = (query or "").strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{term}%"
        search_filter = or_(
            Product.name.ilike(pattern, escape="\\"),
            Product.item_code.ilike(pattern, escape="\\"),
            Product.model.ilike(pattern, escape="\\")
        )
        return db.query(Product).filter(search_filter).offset(skip).limit(limit).all()
    
    def create(self, db: Session, product: ProductCreate, created_by: int) -> Product:
        db_product = Product(
            **product.dict(exclude=NON_COLUMN_UPDATE_FIELDS),
            created_date=tz.today(),
            added_date=tz.now(),
        )
        db.add(db_product)
        db.flush()
        
        # Seed a default price tier for the new product
        from app.modules.products.price_tier_models import ProductPriceTier
        default_tier = ProductPriceTier(
            product_id=db_product.id,
            cost_price=db_product.cost_price,
            minimum_selling_price=db_product.selling_price if db_product.selling_price is not None else db_product.cost_price,
            selling_price=db_product.selling_price if db_product.selling_price is not None else db_product.cost_price,
            website_price=db_product.website_price,
            remark="Default",
            is_active=True,
            created_at=tz.now(),
            updated_at=tz.now(),
            created_by=created_by,
            updated_by=created_by,
        )
        db.add(default_tier)
        db.flush()
        return db_product
    
    def update(self, db: Session, product_id: int, product: ProductUpdate, updated_by: int) -> Optional[Product]:
        db_product = self.get_by_id(db, product_id)
        if not db_product:
            return None
        
        update_data = product.dict(exclude_unset=True, exclude=NON_COLUMN_UPDATE_FIELDS)
        for field, value in update_data.items():
            setattr(db_product, field, value)
        
        db.flush()
        return db_product
    
    def delete(self, db: Session, product_id: int) -> bool:
        db_product = self.get_by_id(db, product_id)
        if not db_product:
            return False
        db.delete(db_product)
        db.flush()
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
    
    def get_by_code(self, db: Session, category_code: str) -> Optional[Category]:
        from sqlalchemy import func
        return db.query(Category).filter(func.lower(func.btrim(Category.category_code)) == (category_code or "").strip().lower()).first()
    
    def get_by_name(self, db: Session, name: str) -> Optional[Category]:
        from sqlalchemy import func
        return db.query(Category).filter(func.lower(func.btrim(Category.name)) == (name or "").strip().lower()).first()
    
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
        db.flush()
        return db_category
    
    def update(self, db: Session, category_id: int, category: CategoryUpdate, updated_by: int) -> Optional[Category]:
        db_category = self.get_by_id(db, category_id)
        if not db_category:
            return None
        
        update_data = category.dict(exclude_unset=True, exclude=NON_COLUMN_UPDATE_FIELDS)
        for field, value in update_data.items():
            setattr(db_category, field, value)
        
        db.flush()
        return db_category
    
    def delete(self, db: Session, category_id: int) -> bool:
        db_category = self.get_by_id(db, category_id)
        if not db_category:
            return False
        db.delete(db_category)
        db.flush()
        return True

class BrandRepository:
    def get_by_id(self, db: Session, brand_id: int) -> Optional[ItemsBrand]:
        return db.query(ItemsBrand).filter(ItemsBrand.id == brand_id).first()
    
    def get_by_code(self, db: Session, brand_code: str) -> Optional[ItemsBrand]:
        from sqlalchemy import func
        return db.query(ItemsBrand).filter(func.lower(func.btrim(ItemsBrand.brand_code)) == (brand_code or "").strip().lower()).first()
    
    def get_by_name(self, db: Session, brand_name: str) -> Optional[ItemsBrand]:
        from sqlalchemy import func
        return db.query(ItemsBrand).filter(func.lower(func.btrim(ItemsBrand.brand_name)) == (brand_name or "").strip().lower()).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[ItemsBrand]:
        query = db.query(ItemsBrand)
        if active_only:
            query = query.filter(ItemsBrand.active == True)
        return query.offset(skip).limit(limit).all()
    
    def create(self, db: Session, brand: BrandCreate) -> ItemsBrand:
        db_brand = ItemsBrand(**brand.dict())
        db.add(db_brand)
        db.flush()
        return db_brand
    
    def update(self, db: Session, brand_id: int, brand: BrandUpdate) -> Optional[ItemsBrand]:
        db_brand = self.get_by_id(db, brand_id)
        if not db_brand:
            return None
        
        update_data = brand.dict(exclude_unset=True, exclude=NON_COLUMN_UPDATE_FIELDS)
        for field, value in update_data.items():
            setattr(db_brand, field, value)
        
        db.flush()
        return db_brand
    
    def delete(self, db: Session, brand_id: int) -> bool:
        db_brand = self.get_by_id(db, brand_id)
        if not db_brand:
            return False
        db.delete(db_brand)
        db.flush()
        return True

class MinimumPriceRepository:
    def get_by_id(self, db: Session, price_id: int) -> Optional[MinimumPrice]:
        return db.query(MinimumPrice).filter(MinimumPrice.id == price_id).first()
    
    def get_by_product_id(self, db: Session, product_id: int) -> List[MinimumPrice]:
        return db.query(MinimumPrice).filter(MinimumPrice.product_id == product_id).order_by(MinimumPrice.created_date.desc()).all()
    
    def get_current_for_product(self, db: Session, product_id: int) -> Optional[MinimumPrice]:
        return db.query(MinimumPrice).filter(MinimumPrice.product_id == product_id).order_by(MinimumPrice.created_date.desc()).first()

    def get_current_for_products(self, db: Session, product_ids: List[int]) -> dict:
        """Latest minimum-price row per product, in one query — the bulk
        equivalent of get_current_for_product, for list endpoints. Mirrors
        SupplierRepository.get_average_lead_times' one-query-many-ids shape."""
        if not product_ids:
            return {}
        rows = (
            db.query(MinimumPrice)
            .filter(MinimumPrice.product_id.in_(product_ids))
            .order_by(MinimumPrice.product_id, MinimumPrice.created_date.desc())
            .distinct(MinimumPrice.product_id)
            .all()
        )
        return {row.product_id: row.minimum_price for row in rows}

    def create(self, db: Session, product_id: int, minimum_price: float, commit: bool = True) -> MinimumPrice:
        db_price = MinimumPrice(
            product_id=product_id,
            minimum_price=minimum_price,
            created_date=tz.now(),
        )
        db.add(db_price)
        if commit:
            db.commit()
            db.refresh(db_price)
        else:
            db.flush()
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


# ---- server-side paging -----------------------------------------------------

def _like_pattern(q: Optional[str]) -> Optional[str]:
    """Literal contains-pattern: % _ and \ in the search text are escaped."""
    term = (q or "").strip()
    if not term:
        return None
    return "%" + term.replace("\\", "\\\\").replace("%", "\%").replace("_", "\_") + "%"


def _page_query(query, order_cols, tiebreaker, page: int, size: int):
    """Total (before paging) + the requested page, with a stable ORDER BY."""
    from sqlalchemy import func

    total = query.order_by(None).with_entities(func.count(tiebreaker)).scalar() or 0
    rows = query.order_by(*order_cols, tiebreaker).offset(page * size).limit(size).all()
    return rows, total


def _order(col, order: str, text: bool = False):
    from sqlalchemy import func

    expr = func.lower(col) if text else col
    return expr.desc() if order == "desc" else expr.asc()


PRODUCT_SORTS = {
    "item_code": (Product.item_code, True),
    "name": (Product.name, True),
    "model": (Product.model, True),
    "category_name": (Category.name, True),
    "brand_name": (ItemsBrand.brand_name, True),
    "cost_price": (Product.cost_price, False),
    "selling_price": (Product.selling_price, False),
    "active": (Product.active, False),
}
CATEGORY_SORTS = {
    "name": (Category.name, True),
    "category_code": (Category.category_code, True),
    "active": (Category.active, False),
}
BRAND_SORTS = {
    "brand_name": (ItemsBrand.brand_name, True),
    "brand_code": (ItemsBrand.brand_code, True),
    "active": (ItemsBrand.active, False),
}


def _sort_cols(sorts: dict, default: str, sort_by: Optional[str], order: str):
    col, text = sorts.get(sort_by or default) or sorts[default]
    return [_order(col, order, text)]


def products_page(db: Session, *, page: int, size: int, q=None, active=None, category_id=None,
                  brand_id=None, supplier_id=None, sort_by=None, order="asc"):
    from sqlalchemy.orm import joinedload
    from app.modules.purchasing.models import SupplierProduct

    query = (
        db.query(Product)
        .join(Category, Product.category_id == Category.id)
        .join(ItemsBrand, Product.items_brand_id == ItemsBrand.id)
        .options(joinedload(Product.category), joinedload(Product.brand))
    )
    pat = _like_pattern(q)
    if pat:
        query = query.filter(or_(
            Product.name.ilike(pat, escape="\\"),
            Product.item_code.ilike(pat, escape="\\"),
            Product.model.ilike(pat, escape="\\"),
        ))
    if active is not None:
        query = query.filter(Product.active == active)
    if category_id:
        query = query.filter(Product.category_id == category_id)
    if brand_id:
        query = query.filter(Product.items_brand_id == brand_id)
    if supplier_id:
        query = query.filter(Product.id.in_(
            db.query(SupplierProduct.product_id).filter(SupplierProduct.supplier_id == supplier_id)
        ))
    return _page_query(query, _sort_cols(PRODUCT_SORTS, "item_code", sort_by, order), Product.id, page, size)


def categories_page(db: Session, *, page: int, size: int, q=None, active=None, sort_by=None, order="asc"):
    query = db.query(Category)
    pat = _like_pattern(q)
    if pat:
        query = query.filter(or_(Category.name.ilike(pat, escape="\\"), Category.category_code.ilike(pat, escape="\\")))
    if active is not None:
        query = query.filter(Category.active == active)
    return _page_query(query, _sort_cols(CATEGORY_SORTS, "name", sort_by, order), Category.id, page, size)


def brands_page(db: Session, *, page: int, size: int, q=None, active=None, sort_by=None, order="asc"):
    query = db.query(ItemsBrand)
    pat = _like_pattern(q)
    if pat:
        query = query.filter(or_(ItemsBrand.brand_name.ilike(pat, escape="\\"), ItemsBrand.brand_code.ilike(pat, escape="\\")))
    if active is not None:
        query = query.filter(ItemsBrand.active == active)
    return _page_query(query, _sort_cols(BRAND_SORTS, "brand_name", sort_by, order), ItemsBrand.id, page, size)
