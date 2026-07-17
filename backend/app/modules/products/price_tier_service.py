from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import timezone as tz
from app.modules.products.price_tier_models import ProductPriceTier
from app.modules.products.price_tier_schemas import PriceTierCreate, PriceTierUpdate


class PriceTierService:
    # ──────────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _get_product_or_404(self, db: Session, product_id: int):
        from app.modules.products.models import Product
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id {product_id} not found",
            )
        return product

    def _get_tier_or_404(self, db: Session, product_id: int, tier_id: int) -> ProductPriceTier:
        tier = (
            db.query(ProductPriceTier)
            .filter(
                ProductPriceTier.id == tier_id,
                ProductPriceTier.product_id == product_id,
            )
            .first()
        )
        if not tier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Price tier {tier_id} not found for product {product_id}",
            )
        return tier

    def _validate_prices(self, cost: float, min_sell: float, sell: float, website: Optional[float]):
        if min_sell < cost:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Minimum selling price cannot be less than cost price.",
            )
        if sell < min_sell:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selling price cannot be less than minimum selling price.",
            )
        if website is not None and website > 0 and website < cost:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Website price cannot be less than cost price.",
            )

    # ──────────────────────────────────────────────────────────────────────────
    # CRUD
    # ──────────────────────────────────────────────────────────────────────────

    def list_tiers(self, db: Session, product_id: int, active_only: bool = False) -> List[ProductPriceTier]:
        self._get_product_or_404(db, product_id)
        q = db.query(ProductPriceTier).filter(ProductPriceTier.product_id == product_id)
        if active_only:
            q = q.filter(ProductPriceTier.is_active == True)
        return q.order_by(ProductPriceTier.id).all()

    def get_tier(self, db: Session, product_id: int, tier_id: int) -> ProductPriceTier:
        return self._get_tier_or_404(db, product_id, tier_id)

    def create_tier(self, db: Session, product_id: int, data: PriceTierCreate, user_id: int) -> ProductPriceTier:
        self._get_product_or_404(db, product_id)
        self._validate_prices(data.cost_price, data.minimum_selling_price, data.selling_price, data.website_price)

        tier = ProductPriceTier(
            product_id=product_id,
            cost_price=data.cost_price,
            minimum_selling_price=data.minimum_selling_price,
            selling_price=data.selling_price,
            website_price=data.website_price,
            remark=data.remark,
            is_active=data.is_active,
            created_at=tz.now(),
            updated_at=tz.now(),
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(tier)
        db.commit()
        db.refresh(tier)
        return tier

    def update_tier(self, db: Session, product_id: int, tier_id: int, data: PriceTierUpdate, user_id: int) -> ProductPriceTier:
        tier = self._get_tier_or_404(db, product_id, tier_id)

        update_data = data.dict(exclude_unset=True)

        # Merge with current values for validation
        new_cost = update_data.get("cost_price", float(tier.cost_price))
        new_min = update_data.get("minimum_selling_price", float(tier.minimum_selling_price))
        new_sell = update_data.get("selling_price", float(tier.selling_price))
        new_web = update_data.get("website_price", float(tier.website_price) if tier.website_price else None)

        self._validate_prices(new_cost, new_min, new_sell, new_web)

        for field, value in update_data.items():
            setattr(tier, field, value)
        tier.updated_at = tz.now()
        tier.updated_by = user_id

        db.commit()
        db.refresh(tier)
        return tier

    def toggle_active(self, db: Session, product_id: int, tier_id: int, is_active: bool, user_id: int) -> ProductPriceTier:
        """Activate or deactivate a tier. Prevents deactivating the last active tier."""
        tier = self._get_tier_or_404(db, product_id, tier_id)

        if not is_active:
            # Ensure at least one other tier remains active
            active_count = (
                db.query(ProductPriceTier)
                .filter(
                    ProductPriceTier.product_id == product_id,
                    ProductPriceTier.is_active == True,
                    ProductPriceTier.id != tier_id,
                )
                .count()
            )
            if active_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot deactivate the last active price tier. A product must have at least one active tier.",
                )

        tier.is_active = is_active
        tier.updated_at = tz.now()
        tier.updated_by = user_id
        db.commit()
        db.refresh(tier)
        return tier

    def delete_tier(self, db: Session, product_id: int, tier_id: int) -> dict:
        """Soft-delete by deactivating. Hard-delete only if no invoice/quote items reference it."""
        tier = self._get_tier_or_404(db, product_id, tier_id)

        # Check if any invoice items reference this tier
        from app.modules.sales.models import InvoiceItems
        from app.modules.sales.quotation_models import SalesQuoteItem
        invoice_count = db.query(InvoiceItems).filter(InvoiceItems.price_tier_id == tier_id).count()
        quote_count = db.query(SalesQuoteItem).filter(SalesQuoteItem.price_tier_id == tier_id).count()

        if invoice_count > 0 or quote_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot delete this price tier — it is referenced by "
                    f"{invoice_count} invoice line(s) and {quote_count} quotation line(s). "
                    "Deactivate it instead."
                ),
            )

        # Check at least one other tier remains (active or not)
        total_tiers = (
            db.query(ProductPriceTier)
            .filter(ProductPriceTier.product_id == product_id, ProductPriceTier.id != tier_id)
            .count()
        )
        if total_tiers == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete the only price tier for this product.",
            )

        db.delete(tier)
        db.commit()
        return {"detail": "Price tier deleted successfully."}


price_tier_service = PriceTierService()
