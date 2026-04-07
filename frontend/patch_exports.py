import os
import re

def append_to_file(filepath, content):
    with open(filepath, 'a') as f:
        f.write("\n\n" + content)

# 1. Products Export
PROD_EXPORT = """
from fastapi.responses import StreamingResponse
import io
import csv

@router.get(
    "/export-csv",
    summary="Export Products to CSV",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def export_products_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    products = service.product_service.get_all_products(db, skip, limit, active_only)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Item Code", "Name", "Model", "Item Type", "Description", 
        "Cost Price", "Selling Price", "Website Price", 
        "Active", "Website Active", "Added Date"
    ])
    for p in products:
        writer.writerow([
            p.item_code or "",
            p.name or "",
            p.model or "",
            p.item_type or "",
            p.description or "",
            p.cost_price or 0,
            p.selling_price or 0,
            p.website_price or 0,
            "Yes" if p.active else "No",
            "Yes" if p.website_active else "No",
            p.added_date or ""
        ])
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=products.csv"
    return response
"""
append_to_file("backend/app/modules/products/api.py", PROD_EXPORT)

# 2. Sales Export
SALES_EXPORT = """
from fastapi.responses import StreamingResponse
import io
import csv

@router.get(
    "/export-csv",
    summary="Export Sales Orders to CSV",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def export_sales_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    branch_codes: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    invoices = service.sales_service.get_all_invoices(db, skip, limit, branch_codes)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Invoice No", "Branch Code", "Created Date", "Customer Name", 
        "Payment Method", "Status", "Total"
    ])
    for inv in invoices:
        writer.writerow([
            inv.invoice_no or "",
            inv.branch_code or "",
            inv.created_date or "",
            inv.customer.customer_name if getattr(inv, 'customer', None) else "",
            inv.payment_method or "",
            inv.approval_status or "",
            (inv.cash_amount or 0) + (inv.card_visa_amount or 0) + (inv.cheque_amount or 0) + (inv.credit_amount or 0)
        ])
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=sales_orders.csv"
    return response
"""
append_to_file("backend/app/modules/sales/api.py", SALES_EXPORT)

# 3. Purchasing Export
PURCH_EXPORT = """
from fastapi.responses import StreamingResponse
import io
import csv

@router.get(
    "/export-csv",
    summary="Export Purchase Orders to CSV",
    dependencies=[Depends(require_permission(*Permissions.PURCHASING_VIEW))]
)
def export_po_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    branch_codes: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PURCHASING_VIEW))
):
    pos = service.purchasing_service.get_all_purchasing_orders(db, skip, limit, branch_codes)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "PO Number", "Date", "Branch", "Payment Method", "Status", 
        "Remarks", "Total Amount", "Paid Amount"
    ])
    for order in pos:
        writer.writerow([
            order.purchasing_order_no or "",
            order.purchasing_order_date or "",
            order.branch_code or "",
            order.payment_method or "",
            order.status or "",
            order.remarks or "",
            order.total_amount or 0,
            order.paid_amount or 0,
        ])
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=purchase_orders.csv"
    return response
"""
append_to_file("backend/app/modules/purchasing/api.py", PURCH_EXPORT)

print("Backend APIs appended!")
