"""
Document Reports Service
Generates HTML/PDF reports for Purchase Orders, GRNs, and Purchase Returns
"""

from typing import Optional, Literal
from datetime import datetime
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException

from app.modules.purchasing.models import (
    PurchasingOrder, PurchasingOrderItems, GoodReceivedNote,
    PurchasingReturn, PurchasingReturnItems, Supplier
)
from app.modules.inventory.models import SalesStock
from app.modules.products.models import Product
from app.modules.settings.models import Settings
from app.auth.models import Branch


class DocumentReportService:
    """Service for generating document reports (PO, GRN, Purchase Return)"""
    
    def __init__(self, db: Session):
        self.db = db
        # Setup Jinja2 template environment
        template_dir = Path(__file__).parent / "templates"
        self.env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=True
        )
    
    def _get_company_info(self) -> dict:
        """Get company information from settings"""
        try:
            settings = self.db.query(Settings).first()
            if settings:
                return {
                    "name": settings.company_name or "Tijaero ERP",
                    "address": settings.company_address or "",
                    "phone": settings.company_telephone_number or "",
                    "fax": settings.company_fax_number or "",
                    "email": settings.company_email or ""
                }
        except Exception:
            self.db.rollback()  # Rollback failed transaction
        return {
            "name": "Tijaero ERP",
            "address": "",
            "phone": "",
            "fax": "",
            "email": ""
        }
    
    def _get_branch_info(self, branch_code: str) -> dict:
        """Get branch information"""
        branch = self.db.query(Branch).filter(Branch.branch_code == branch_code).first()
        if branch:
            return {
                "branch_code": branch.branch_code,
                "branch_name": branch.branch_name,
                "address": getattr(branch, 'address', ''),
                "phone": getattr(branch, 'telephone', '')
            }
        return {
            "branch_code": branch_code,
            "branch_name": branch_code,
            "address": "",
            "phone": ""
        }
    
    def _get_supplier_info(self, supplier_id: int) -> dict:
        """Get supplier information"""
        supplier = self.db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if supplier:
            return {
                "id": supplier.id,
                "full_name": supplier.full_name,
                "company_name": supplier.company_name or "",
                "mobile_contact_number": supplier.mobile_contact_number or "",
                "home_contact_number": supplier.home_contact_number or "",
                "email": supplier.email or "",
                "address": supplier.postal_address or ""
            }
        return {
            "id": supplier_id,
            "full_name": f"Supplier #{supplier_id}",
            "company_name": "",
            "mobile_contact_number": "",
            "home_contact_number": "",
            "email": "",
            "address": ""
        }
    
    def generate_purchase_order_report(self, po_id: int) -> str:
        """Generate HTML report for a Purchase Order"""
        # Fetch PO with items
        po = self.db.query(PurchasingOrder).options(
            joinedload(PurchasingOrder.items)
        ).filter(PurchasingOrder.id == po_id).first()
        
        if not po:
            raise HTTPException(status_code=404, detail=f"Purchase Order #{po_id} not found")
        
        # Get related data
        company = self._get_company_info()
        supplier = self._get_supplier_info(po.first_suppliers_id)
        branch = self._get_branch_info(po.branch_code)
        
        # Build items data
        items = []
        subtotal = 0
        for item in po.items:
            product = self.db.query(Product).filter(Product.id == item.product_id).first()
            item_total = (item.quantity or 0) * (item.unit_price or 0)
            items.append({
                "product_id": item.product_id,
                "product_name": product.name if product else f"Product #{item.product_id}",
                "description": getattr(item, 'description', '') or '',
                "quantity": item.quantity,
                "unit_price": item.unit_price or 0,
                "total": item_total
            })
            subtotal += item_total
        
        # Render template
        template = self.env.get_template("purchase_order.html")
        return template.render(
            company=company,
            po={
                "id": po.id,
                "purchasing_order_no": po.purchasing_order_no,
                "purchasing_order_date": str(po.purchasing_order_date) if po.purchasing_order_date else "",
                "purchasing_invoice_no": po.purchasing_invoice_no or "",
                "status": po.status or "pending",
                "payment_terms": getattr(po, 'payment_terms', '') or "",
                "delivery_terms": getattr(po, 'delivery_terms', '') or ""
            },
            supplier=supplier,
            branch=branch,
            items=items,
            subtotal=subtotal,
            generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )
    
    def generate_grn_report(self, grn_id: int) -> str:
        """Generate HTML report for a Good Received Note"""
        # Fetch GRN
        grn = self.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
        
        if not grn:
            raise HTTPException(status_code=404, detail=f"GRN #{grn_id} not found")
        
        # Get PO info
        po = self.db.query(PurchasingOrder).filter(
            PurchasingOrder.id == grn.purchasingorders_id
        ).first() if grn.purchasingorders_id else None
        
        # Get related data
        company = self._get_company_info()
        supplier_id = po.first_suppliers_id if po else None
        supplier = self._get_supplier_info(supplier_id) if supplier_id else {}
        branch = self._get_branch_info(grn.branch_code)
        
        # Get received items from SalesStock linked to this GRN
        from sqlalchemy.orm import joinedload
        stock_items = self.db.query(SalesStock).options(
            joinedload(SalesStock.product),
            joinedload(SalesStock.purchasing_order_item)
        ).filter(
            SalesStock.good_received_note_id == grn_id
        ).all()
        
        items = []
        total_quantity = 0
        total_value = 0
        
        for stock in stock_items:
            # Get price from purchasing order item
            unit_price = float(stock.purchasing_order_item.unit_price) if stock.purchasing_order_item else 0
            product_name = stock.product.name if stock.product else f"Product #{stock.product_id}"
            items.append({
                "product_id": stock.product_id,
                "product_name": product_name,
                "barcode": stock.barcode,
                "quantity": 1,  # Each stock item is a single unit
                "unit_price": unit_price,
                "warranty_month": stock.warranty_month or "-",
                "status": stock.status
            })
            total_quantity += 1
            total_value += unit_price
        
        # Render template
        template = self.env.get_template("grn.html")
        return template.render(
            company=company,
            grn={
                "id": grn.id,
                "good_received_no": grn.good_received_no,
                "added_date": str(grn.added_date) if grn.added_date else "",
                "branch_code": grn.branch_code,
                "received_by": getattr(grn, 'received_by', None),
                "remarks": getattr(grn, 'remarks', None)
            },
            po={
                "purchasing_order_no": po.purchasing_order_no if po else "N/A",
                "purchasing_order_date": str(po.purchasing_order_date) if po else "N/A",
                "purchasing_invoice_no": po.purchasing_invoice_no if po else "N/A"
            },
            supplier=supplier,
            branch=branch,
            items=items,
            total_quantity=total_quantity,
            total_value=total_value,
            generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )
    
    def generate_purchase_return_report(self, return_id: int) -> str:
        """Generate HTML report for a Purchase Return"""
        # Fetch return with items
        purchase_return = self.db.query(PurchasingReturn).options(
            joinedload(PurchasingReturn.items).joinedload(PurchasingReturnItems.product),
            joinedload(PurchasingReturn.items).joinedload(PurchasingReturnItems.sales_stock)
        ).filter(PurchasingReturn.id == return_id).first()
        
        if not purchase_return:
            raise HTTPException(status_code=404, detail=f"Purchase Return #{return_id} not found")
        
        # Get GRN
        grn = self.db.query(GoodReceivedNote).filter(
            GoodReceivedNote.id == purchase_return.goodreceivednote_id
        ).first() if purchase_return.goodreceivednote_id else None
        
        # Get PO
        po = None
        if grn and grn.purchasingorders_id:
            po = self.db.query(PurchasingOrder).filter(
                PurchasingOrder.id == grn.purchasingorders_id
            ).first()
        
        # Get related data
        company = self._get_company_info()
        supplier_id = po.first_suppliers_id if po else purchase_return.supplier_id if hasattr(purchase_return, 'supplier_id') else None
        supplier = self._get_supplier_info(supplier_id) if supplier_id else {}
        branch = self._get_branch_info(purchase_return.branch_code)
        
        # Build items data
        items = []
        total_quantity = 0
        total_value = 0
        
        for item in purchase_return.items:
            unit_price = item.purchasing_price or 0
            product_name = item.product.name if item.product else f"Product #{item.product_id}"
            stock_status = item.sales_stock.status if item.sales_stock else "unknown"
            branch_code = item.sales_stock.branch_code if item.sales_stock else purchase_return.branch_code
            added_date = str(item.added_date) if hasattr(item, 'added_date') and item.added_date else ""
            
            items.append({
                "product_id": item.product_id,
                "product_name": product_name,
                "barcode": item.barcode,
                "branch_code": branch_code,
                "purchasing_price": unit_price,
                "status": stock_status,
                "added_date": added_date
            })
            total_quantity += 1
            total_value += unit_price
        
        # Render template
        template = self.env.get_template("purchase_return.html")
        return template.render(
            company=company,
            return_data={
                "id": purchase_return.id,
                "purchasing_return_no": purchase_return.purchasing_return_no,
                "branch_code": purchase_return.branch_code,
                "added_date": str(purchase_return.added_date) if purchase_return.added_date else "",
                "status": purchase_return.status,
                "is_approved": purchase_return.status == "approved",
                "approved_date": str(purchase_return.approved_date) if purchase_return.approved_date else None,
                "remark": purchase_return.remark
            },
            grn={
                "good_received_no": grn.good_received_no if grn else "N/A"
            },
            po={
                "purchasing_order_no": po.purchasing_order_no if po else "N/A",
                "purchasing_order_date": str(po.purchasing_order_date) if po else "N/A"
            },
            supplier=supplier,
            branch=branch,
            items=items,
            total_quantity=total_quantity,
            total_value=total_value,
            generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )


def get_document_report_service(db: Session) -> DocumentReportService:
    """Factory function to get document report service"""
    return DocumentReportService(db)
