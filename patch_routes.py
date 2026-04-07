import re

with open('backend/app/modules/products/api.py', 'r') as f:
    text = f.read()

# truncate everything after 'def delete_minimum_price(...)'
# line 288 is `    return service.minimum_price_service.delete_minimum_price(db, price_id)`
idx = text.find('    return service.minimum_price_service.delete_minimum_price(db, price_id)')
if idx != -1:
    end_idx = idx + len('    return service.minimum_price_service.delete_minimum_price(db, price_id)')
    
    clean_text = text[:end_idx] + "\n\n\nfrom fastapi.responses import StreamingResponse\nimport io\nimport csv\n\n"
    clean_text += """@router.get(
    "/products/export-csv",
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
        "Active", "Website Active", "Added Date", "Created At", "Updated At"
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
            p.added_date or "",
            p.created_at.isoformat() if getattr(p, 'created_at', None) else "",
            p.updated_at.isoformat() if getattr(p, 'updated_at', None) else ""
        ])
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=products.csv"
    return response
"""
    with open('backend/app/modules/products/api.py', 'w') as f:
        f.write(clean_text)
    print("Fixed backend products API dups and path!")

