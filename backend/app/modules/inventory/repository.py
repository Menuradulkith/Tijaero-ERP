from sqlalchemy.orm import Session
from app.common.base_repository import BaseRepository
from app.modules.products.models import Product


class InventoryRepository(BaseRepository[Product]):
    model = Product


inventory_repository = InventoryRepository()
