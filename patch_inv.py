import re

with open('backend/app/modules/inventory/service.py', 'r') as f:
    text = f.read()

target = """        # Batch-load all locations in one query to avoid N+1
        location_ids = set()
        for item in items:
            loc_id = item.location_id
            if not loc_id and item.good_received_note:
                loc_id = item.good_received_note.good_received_locations_id
            if loc_id:
                location_ids.add(loc_id)
        
        locations_map = {}
        if location_ids:
            locations = self.db.query(Locations).filter(
                Locations.id.in_(location_ids)
            ).all()
            locations_map = {loc.id: loc.name for loc in locations}
        
        # Enrich with GRN number, location, and prices
        result = []
        for item in items:
            # Resolve location from item's current location_id, falling back to GRN location
            location_id_to_use = item.location_id
            if not location_id_to_use and item.good_received_note:
                location_id_to_use = item.good_received_note.good_received_locations_id
            
            item_dict = {
                "id": item.id,
                "product_id": item.product_id,
                "barcode": item.barcode,
                "branch_code": item.branch_code,
                "location_id": item.location_id,
                "good_received_note_id": item.good_received_note_id,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "warranty_month": item.warranty_month,
                "status": item.status,
                "added_date": item.added_date,
                "grn_no": item.good_received_note.good_received_no if item.good_received_note else None,
                "location_name": locations_map.get(location_id_to_use) if location_id_to_use else None,
                "cost_price": item.product.cost_price if item.product else None,
                "selling_price": item.product.selling_price if item.product else None,
                # Add product details directly
                "product_name": item.product.name if item.product else None,
                "item_code": item.product.item_code if item.product else None,
                "brand_id": item.product.items_brand_id if item.product else None,
            }"""

replacement = """        # Batch-load all locations in one query to avoid N+1
        location_ids = set()
        brand_ids = set()
        category_ids = set()
        
        for item in items:
            loc_id = item.location_id
            if not loc_id and item.good_received_note:
                loc_id = item.good_received_note.good_received_locations_id
            if loc_id:
                location_ids.add(loc_id)
            if item.product:
                if item.product.items_brand_id:
                    brand_ids.add(item.product.items_brand_id)
                if item.product.category_id:
                    category_ids.add(item.product.category_id)
        
        locations_map = {}
        if location_ids:
            locations = self.db.query(Locations).filter(Locations.id.in_(location_ids)).all()
            locations_map = {loc.id: loc.name for loc in locations}
            
        brands_map = {}
        if brand_ids:
            from app.modules.products.models import ItemsBrand
            brands = self.db.query(ItemsBrand).filter(ItemsBrand.id.in_(brand_ids)).all()
            brands_map = {b.id: b.brand_name for b in brands}
            
        categories_map = {}
        if category_ids:
            from app.modules.products.models import Category
            cats = self.db.query(Category).filter(Category.id.in_(category_ids)).all()
            categories_map = {c.id: c.name for c in cats}
        
        # Enrich with GRN number, location, and prices
        result = []
        for item in items:
            # Resolve location from item's current location_id, falling back to GRN location
            location_id_to_use = item.location_id
            if not location_id_to_use and item.good_received_note:
                location_id_to_use = item.good_received_note.good_received_locations_id
            
            created_at = getattr(item, 'created_at', getattr(item, 'added_date', None))
            updated_at = getattr(item, 'updated_at', getattr(item, 'updated_date', None))
            
            item_dict = {
                "id": item.id,
                "product_id": item.product_id,
                "barcode": item.barcode,
                "branch_code": item.branch_code,
                "location_id": item.location_id,
                "good_received_note_id": item.good_received_note_id,
                "purchasing_order_items_id": item.purchasing_order_items_id,
                "warranty_month": item.warranty_month,
                "status": item.status,
                "added_date": item.added_date,
                "created_at": created_at,
                "updated_at": updated_at,
                "grn_no": item.good_received_note.good_received_no if item.good_received_note else None,
                "location_name": locations_map.get(location_id_to_use) if location_id_to_use else None,
                "cost_price": item.product.cost_price if item.product else None,
                "selling_price": item.product.selling_price if item.product else None,
                # Add product details directly
                "product_name": item.product.name if item.product else None,
                "item_code": item.product.item_code if item.product else None,
                "brand_id": item.product.items_brand_id if item.product else None,
                "brand_name": brands_map.get(item.product.items_brand_id) if item.product else None,
                "category_id": item.product.category_id if item.product else None,
                "category_name": categories_map.get(item.product.category_id) if item.product else None,
            }"""

if target in text:
    text = text.replace(target, replacement)
    with open('backend/app/modules/inventory/service.py', 'w') as f:
        f.write(text)
    print("Patched inventory service!")
else:
    print("Could not find target in service.")
