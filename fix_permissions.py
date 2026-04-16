"""
Bulk permission replacement script.
Replaces old module-level Permissions.XXX references with new granular per-page permissions.
"""
import re
import os

BASE = r"c:\MyProjects\TijaeroERP"


def replace_in_file(filepath, replacements):
    """Replace old permission strings with new ones in a file."""
    full_path = os.path.join(BASE, filepath)
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()

    original = content
    for old, new in replacements:
        content = content.replace(old, new)

    if content != original:
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        count = sum(1 for old, new in replacements if old in original)
        print(f"  ✅ Updated: {filepath} ({len(original) - len(content)} char diff)")
    else:
        print(f"  ⏭ No changes: {filepath}")


# ═══════════════════════════════════════════════════════════════════
# 1. SALES API (sales/api.py)
# ═══════════════════════════════════════════════════════════════════
# This file has:
# - Sales Order CRUD (lines 19-260) → SALES_ORDER_*
# - Sale Returns (lines 271-415) → SALES_RETURN_*
# - Invoice Workflow approve/complete (lines 427-480) → SO_APPROVAL_APPROVE
# - Cancel (line 463) → SALES_ORDER_DELETE
# - Credit Payment Settlement (lines 482-520) → SALES_ORDER_UPDATE (settle payment)
# - Payment History (lines 505-520) → SALES_ORDER_VIEW
# - Bank Transfer (lines 523-600) → BANK_TRANSFER_VERIFY_*
# - Payment Card Settings (lines 604-680) → SALES_SETTINGS_*
# - GL Entries (lines 687-790) → SALES_ORDER_VIEW for read, SO_APPROVAL_APPROVE for post
# - Export CSV (line 791) → SALES_ORDER_VIEW
#
# Strategy: We can't do simple global replace because SALES_VIEW is used for both
# orders, returns, payment history, bank transfers, settings, GL.
# But since ALL view endpoints use SALES_VIEW, and create/update/delete are specific,
# the simplest correct approach: Replace ALL SALES_VIEW → SALES_ORDER_VIEW,
# ALL SALES_CREATE → SALES_ORDER_CREATE, ALL SALES_UPDATE → SALES_ORDER_UPDATE,
# ALL SALES_DELETE → SALES_ORDER_DELETE, ALL SALES_APPROVE → SO_APPROVAL_APPROVE,
# ALL SALES_MANAGE → SALES_SETTINGS_UPDATE.
# This is acceptable because:
# - The sales API primarily manages sales orders
# - Returns are closely tied to sales orders
# - All these were previously under one "sales" permission anyway

print("\n=== sales/api.py ===")
replace_in_file("backend/app/modules/sales/api.py", [
    ("Permissions.SALES_VIEW", "Permissions.SALES_ORDER_VIEW"),
    ("Permissions.SALES_CREATE", "Permissions.SALES_ORDER_CREATE"),
    ("Permissions.SALES_UPDATE", "Permissions.SALES_ORDER_UPDATE"),
    ("Permissions.SALES_DELETE", "Permissions.SALES_ORDER_DELETE"),
    ("Permissions.SALES_APPROVE", "Permissions.SO_APPROVAL_APPROVE"),
    ("Permissions.SALES_MANAGE", "Permissions.SALES_SETTINGS_UPDATE"),
])


# ═══════════════════════════════════════════════════════════════════
# 2. SALES QUOTATION API (sales/quotation_api.py)
# ═══════════════════════════════════════════════════════════════════
print("\n=== sales/quotation_api.py ===")
replace_in_file("backend/app/modules/sales/quotation_api.py", [
    ("Permissions.SALES_VIEW", "Permissions.QUOTATION_VIEW"),
    ("Permissions.SALES_CREATE", "Permissions.QUOTATION_CREATE"),
    ("Permissions.SALES_UPDATE", "Permissions.QUOTATION_UPDATE"),
    ("Permissions.SALES_DELETE", "Permissions.QUOTATION_DELETE"),
    ("Permissions.SALES_APPROVE", "Permissions.QUOTATION_UPDATE"),
])


# ═══════════════════════════════════════════════════════════════════
# 3. PURCHASING API (purchasing/api.py)
# ═══════════════════════════════════════════════════════════════════
# Only 3 references: router-level PURCHASING_VIEW, and CSV export PURCHASING_VIEW
# The rest are unprotected. We map PURCHASING_VIEW → PURCHASE_ORDER_VIEW
print("\n=== purchasing/api.py ===")
replace_in_file("backend/app/modules/purchasing/api.py", [
    ("Permissions.PURCHASING_VIEW", "Permissions.PURCHASE_ORDER_VIEW"),
    ("Permissions.PURCHASING_CREATE", "Permissions.PURCHASE_ORDER_CREATE"),
    ("Permissions.PURCHASING_UPDATE", "Permissions.PURCHASE_ORDER_UPDATE"),
    ("Permissions.PURCHASING_DELETE", "Permissions.PURCHASE_ORDER_DELETE"),
    ("Permissions.PURCHASING_APPROVE", "Permissions.PO_APPROVAL_APPROVE"),
])


# ═══════════════════════════════════════════════════════════════════
# 4. PRODUCTS API (products/api.py)
# ═══════════════════════════════════════════════════════════════════
# ALL endpoints use INVENTORY_VIEW/CREATE/UPDATE/DELETE
# Products, Categories, Brands, Minimum Prices all share same permission
# Map to PRODUCT_VIEW/CREATE/UPDATE/DELETE (the main entity)
print("\n=== products/api.py ===")
replace_in_file("backend/app/modules/products/api.py", [
    ("Permissions.INVENTORY_VIEW", "Permissions.PRODUCT_VIEW"),
    ("Permissions.INVENTORY_CREATE", "Permissions.PRODUCT_CREATE"),
    ("Permissions.INVENTORY_UPDATE", "Permissions.PRODUCT_UPDATE"),
    ("Permissions.INVENTORY_DELETE", "Permissions.PRODUCT_DELETE"),
])


# ═══════════════════════════════════════════════════════════════════
# 5. HR API (hr/api.py)
# ═══════════════════════════════════════════════════════════════════
# Router-level: HR_VIEW (line 22)
# All endpoints use HR_VIEW/CREATE/UPDATE/DELETE/APPROVE
# Covers: salary deductions, reimbursements, payroll, payroll batches,
#          salary profiles, promotions, employee assets
# Map HR_VIEW → HR_DASHBOARD_VIEW for the router level,
# HR_CREATE → PAYROLL_CREATE, HR_UPDATE → PAYROLL_UPDATE, etc.
# But since they all share the same permission, simplest: map to salary_profile level
# Actually the router has HR_VIEW at router level - all sub-endpoints inherit it
# Simplest correct approach: HR_VIEW → SALARY_PROFILE_VIEW (baseline),
# HR_CREATE → SALARY_PROFILE_CREATE, etc.
# Wait - the sub-agents said ALL 38 endpoints use HR_VIEW/CREATE/UPDATE/DELETE.
# Since these cover multiple sub-pages, let's use HR_DASHBOARD_VIEW as the baseline
# and map CRUD to salary profiles (the most common entity)
print("\n=== hr/api.py ===")
replace_in_file("backend/app/modules/hr/api.py", [
    ("Permissions.HR_VIEW", "Permissions.HR_DASHBOARD_VIEW"),
    ("Permissions.HR_CREATE", "Permissions.PAYROLL_CREATE"),
    ("Permissions.HR_UPDATE", "Permissions.PAYROLL_UPDATE"),
    ("Permissions.HR_DELETE", "Permissions.PAYROLL_DELETE"),
    ("Permissions.HR_APPROVE", "Permissions.PAYROLL_APPROVAL_APPROVE"),
])


# ═══════════════════════════════════════════════════════════════════
# 6. REPORTING API (reporting/api.py)
# ═══════════════════════════════════════════════════════════════════
# 6 endpoints use REPORTING_VIEW, all are aggregate POST reports
# Map to REPORTING_SALES_VIEW (since they're general reporting)
print("\n=== reporting/api.py ===")
replace_in_file("backend/app/modules/reporting/api.py", [
    ("Permissions.REPORTING_VIEW", "Permissions.REPORTING_DASHBOARD_VIEW"),
    ("Permissions.REPORTING_GENERATE", "Permissions.REPORTING_SALES_GENERATE"),
])


# ═══════════════════════════════════════════════════════════════════
# 7. CUSTOMERS API (customers/api.py)
# ═══════════════════════════════════════════════════════════════════
# Mostly CUSTOMER_VIEW (which still exists as CUSTOMER_VIEW in new permissions)
# Also has CUSTOMER_CREATE/UPDATE/DELETE which exist in new permissions
# Also has SALES_VIEW (lines 518, 523, 662, 667) for coupons validate / voucher validate
# And SALES_CREATE (lines 678, 683) for voucher redeem
print("\n=== customers/api.py ===")
replace_in_file("backend/app/modules/customers/api.py", [
    # CUSTOMER_VIEW/CREATE/UPDATE/DELETE already match new names! No change needed.
    # But SALES_VIEW and SALES_CREATE need updating:
    ("Permissions.SALES_VIEW", "Permissions.SALES_ORDER_VIEW"),
    ("Permissions.SALES_CREATE", "Permissions.SALES_ORDER_CREATE"),
])


# ═══════════════════════════════════════════════════════════════════
# 8. CUSTOMERS COMMISSION API (customers/commission_api.py)
# ═══════════════════════════════════════════════════════════════════
# Mostly CUSTOMER_VIEW (already matches new permissions)
# Has SALES_APPROVE for commission approve and payment verify
print("\n=== customers/commission_api.py ===")
replace_in_file("backend/app/modules/customers/commission_api.py", [
    ("Permissions.CUSTOMER_VIEW", "Permissions.AGENT_COMMISSION_VIEW"),
    ("Permissions.CUSTOMER_CREATE", "Permissions.AGENT_COMMISSION_CREATE"),
    ("Permissions.CUSTOMER_UPDATE", "Permissions.AGENT_COMMISSION_UPDATE"),
    ("Permissions.CUSTOMER_DELETE", "Permissions.AGENT_COMMISSION_DELETE"),
    ("Permissions.SALES_APPROVE", "Permissions.COMMISSION_APPROVAL_APPROVE"),
])


# ═══════════════════════════════════════════════════════════════════
# 9. COMMON API (common/api.py)
# ═══════════════════════════════════════════════════════════════════
# Lines 256, 281, 293 use SALES_VIEW for approval endpoints
# These are centralized approval endpoints - should use a common permission
print("\n=== common/api.py ===")
replace_in_file("backend/app/modules/common/api.py", [
    ("Permissions.SALES_VIEW", "Permissions.COMMON_VIEW"),
    ("Permissions.SALES_CREATE", "Permissions.COMMON_CREATE"),
    ("Permissions.SALES_APPROVE", "Permissions.COMMON_UPDATE"),
])


# ═══════════════════════════════════════════════════════════════════
# 10. Check for remaining old permission references in OTHER files
# ═══════════════════════════════════════════════════════════════════
print("\n\n=== Scanning for remaining old permission references ===")

old_perms = [
    "Permissions.SALES_VIEW", "Permissions.SALES_CREATE", "Permissions.SALES_UPDATE",
    "Permissions.SALES_DELETE", "Permissions.SALES_APPROVE", "Permissions.SALES_MANAGE",
    "Permissions.PURCHASING_VIEW", "Permissions.PURCHASING_CREATE", "Permissions.PURCHASING_UPDATE",
    "Permissions.PURCHASING_DELETE", "Permissions.PURCHASING_APPROVE",
    "Permissions.INVENTORY_VIEW", "Permissions.INVENTORY_CREATE", "Permissions.INVENTORY_UPDATE",
    "Permissions.INVENTORY_DELETE",
    "Permissions.FINANCE_VIEW", "Permissions.FINANCE_CREATE", "Permissions.FINANCE_UPDATE",
    "Permissions.FINANCE_DELETE", "Permissions.FINANCE_APPROVE",
    "Permissions.HR_VIEW", "Permissions.HR_CREATE", "Permissions.HR_UPDATE",
    "Permissions.HR_DELETE", "Permissions.HR_APPROVE",
    "Permissions.WAREHOUSE_VIEW", "Permissions.WAREHOUSE_CREATE", "Permissions.WAREHOUSE_UPDATE",
    "Permissions.WAREHOUSE_DELETE", "Permissions.WAREHOUSE_APPROVE",
    "Permissions.SUPPORT_VIEW", "Permissions.SUPPORT_CREATE", "Permissions.SUPPORT_UPDATE",
    "Permissions.SUPPORT_DELETE",
    "Permissions.REPORTING_VIEW", "Permissions.REPORTING_GENERATE",
    # Note: CUSTOMER_VIEW/CREATE/UPDATE/DELETE still exist in new permissions, so NOT old
]

for root, dirs, files in os.walk(os.path.join(BASE, "backend", "app")):
    for fname in files:
        if fname.endswith(".py"):
            fpath = os.path.join(root, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            for old_perm in old_perms:
                if old_perm in content:
                    # Get line numbers
                    for i, line in enumerate(content.split("\n"), 1):
                        if old_perm in line:
                            rel = os.path.relpath(fpath, BASE)
                            print(f"  ⚠️  {rel}:{i} → {old_perm}")


print("\n\n✅ Done! Permission replacement complete.")
