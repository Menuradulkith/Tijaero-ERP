
import sys
import os
from datetime import date
sys.path.append(os.path.join(os.path.dirname(__file__), '../'))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.purchasing import models, schemas, service
from app.modules.common.models import Locations

def reproduce():
    db = SessionLocal()
    try:
        # 1. Create a dummy supplier
        supplier_data = schemas.SupplierCreate(
            title="Mr",
            full_name="Test Supplier for GRN Conflict",
            mobile_contact_number="0771234567",
            gender="Male",
            civil_status="Single",
            no_of_kids="None",
            credit_days=30,
            max_credit_limit=100000,
            active=True,
            postal_address="123 Test St",
            permenent_address="123 Test St"
        )
        supplier_service = service.SupplierService(db)
        supplier = supplier_service.create_supplier(supplier_data)
        print(f"Created Supplier ID: {supplier.id}")

        # 2. Create a dummy PO
        po_data = schemas.PurchasingOrderCreate(
            purchasing_order_no="PO-TEST-CONFLICT",
            purchasing_invoice_no="INV-TEST-CONFLICT",
            branch_code="HEAD_OFFICE",
            payment_method="cash",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            first_suppliers_id=supplier.id,
            second_suppliers_id=supplier.id,
            items=[
                schemas.PurchasingOrderItemCreate(
                    quantity=10,
                    unit_price=100.0,
                    warrenty_month="12",
                    product_id=1 # Assuming product 1 exists, if not we might fail here. 
                )
            ]
        )
        # Hack: Check if product 1 exists, if not create one? 
        # For now assume product 1 exists or use a valid one from DB.
        from app.modules.products.models import Product
        product = db.query(Product).first()
        if not product:
            print("No products found, cannot create PO. Aborting reproduction.")
            return

        po_data.items[0].product_id = product.id
        
        po_service = service.PurchasingOrderService(db)
        po = po_service.create_order(po_data)
        print(f"Created PO ID: {po.id}")

        # 3. Try to create GRN with INVALID Location ID
        invalid_location_id = 999999
        grn_data = schemas.GoodReceivedNoteCreate(
            good_received_no="GRN-TEST-CONFLICT",
            good_received_date=date.today(),
            supplier_invoice_no="INV-SUP-TEST",
            supplier_invoice_date=date.today(),
            branch_code="HEAD_OFFICE",
            good_received_locations_id=invalid_location_id,
            purchasingorders_id=po.id
        )

        grn_service = service.GoodReceivedNoteService(db)
        print("Attempting to create GRN with invalid location ID...")
        try:
            grn_service.create(grn_data)
            print("UNEXPECTED: GRN created successfully despite invalid location ID.")
        except Exception as e:
            print(f"Caught expected exception: {e}")
            if "GRN number conflict" in str(e):
                print("SUCCESS: Reproduction confirmed. Invalid Location ID triggers 'GRN number conflict' error.")
            else:
                print("FAILURE: Different error message received.")

    except Exception as e:
        print(f"An error occurred during reproduction setup: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    reproduce()
