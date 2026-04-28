#!/usr/bin/env python3
"""
Scenario 29: Chart of Accounts Setup

Seeds the complete Chart of Accounts hierarchy for the ERP system.
Includes:
- Assets (1xxx)
- Liabilities (2xxx)
- Equity (3xxx)
- Revenue (4xxx)
- Expenses (5xxx)

Usage:
    docker exec erp_backend python scripts/seed_chart_of_accounts.py
"""

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(env_path)

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.finance.accounting_models import ChartOfAccounts
import app.models  # noqa: F401


# ─── COA Definition ──────────────────────────────────────────────────────────
# Each tuple: (account_code, account_name, account_type, account_category,
#               normal_balance, is_system_account, description, parent_code)
# parent_code=None means top-level account.

COA_DATA = [
    # ═══════════════════════════════════════════════════════════════════════════
    # ASSETS
    # ═══════════════════════════════════════════════════════════════════════════
    ("1000", "Cash & Bank", "Asset", "Cash", "Debit", False,
     "Parent account for all cash and bank accounts", None),
    ("1010", "Cash on Hand", "Asset", "Cash", "Debit", True,
     "Physical cash held at branches", "1000"),
    ("1020", "Bank Account - Main", "Asset", "Bank", "Debit", True,
     "Primary operating bank account", "1000"),
    ("1030", "Petty Cash", "Asset", "Cash", "Debit", True,
     "Petty cash fund for small expenses", "1000"),
    ("1040", "Cheques in Hand", "Asset", "Cash", "Debit", True,
     "Cheques received from customers awaiting deposit/clearance", "1000"),
    ("1050", "Card Receivables", "Asset", "Cash", "Debit", True,
     "Card-based receipts pending settlement from acquiring bank", "1000"),

    ("1100", "Accounts Receivable", "Asset", "Receivable", "Debit", False,
     "Parent account for receivables", None),
    ("1110", "Trade Debtors", "Asset", "Receivable", "Debit", True,
     "Amounts owed by customers for credit sales", "1100"),
    ("1120", "Customer Advances", "Asset", "Receivable", "Debit", True,
     "Advance payments made by customers (contra account)", "1100"),

    ("1200", "Inventory", "Asset", "Inventory", "Debit", False,
     "Parent account for inventory items", None),
    ("1210", "Finished Goods Inventory", "Asset", "Inventory", "Debit", True,
     "Stock of finished goods ready for sale", "1200"),
    ("1220", "Goods in Transit", "Asset", "Inventory", "Debit", True,
     "Inventory currently in transit from suppliers", "1200"),

    ("1300", "Fixed Assets", "Asset", "Fixed Asset", "Debit", False,
     "Parent account for fixed/non-current assets", None),
    ("1310", "Equipment", "Asset", "Fixed Asset", "Debit", False,
     "Office and operational equipment", "1300"),
    ("1320", "Furniture & Fixtures", "Asset", "Fixed Asset", "Debit", False,
     "Office furniture and fixtures", "1300"),
    ("1330", "Accumulated Depreciation", "Asset", "Fixed Asset", "Credit", False,
     "Accumulated depreciation on fixed assets (contra account)", "1300"),

    # ═══════════════════════════════════════════════════════════════════════════
    # LIABILITIES
    # ═══════════════════════════════════════════════════════════════════════════
    ("2000", "Accounts Payable", "Liability", "Payable", "Credit", False,
     "Parent account for payables", None),
    ("2010", "Trade Creditors", "Liability", "Payable", "Credit", True,
     "Amounts owed to suppliers for purchases", "2000"),
    ("2020", "Supplier Advances", "Liability", "Payable", "Credit", True,
     "Advance payments received from suppliers", "2000"),

    ("2100", "Payroll Liabilities", "Liability", "Payroll", "Credit", False,
     "Parent account for payroll-related liabilities", None),
    ("2110", "Salaries Payable", "Liability", "Payroll", "Credit", True,
     "Net salaries due to employees", "2100"),
    ("2120", "EPF Payable", "Liability", "Payroll", "Credit", True,
     "Employee Provident Fund contributions payable", "2100"),
    ("2130", "ETF Payable", "Liability", "Payroll", "Credit", True,
     "Employee Trust Fund contributions payable", "2100"),
    ("2140", "Other Payroll Deductions", "Liability", "Payroll", "Credit", True,
     "Late deductions, loan repayments, and other payroll deductions payable", "2100"),
    ("2150", "APIT Payable", "Liability", "Payroll", "Credit", True,
     "Advance Personal Income Tax payable to IRD", "2100"),

    ("2200", "Tax Payable", "Liability", "Tax", "Credit", False,
     "Parent account for tax liabilities", None),
    ("2210", "VAT/Tax Payable", "Liability", "Tax", "Credit", True,
     "Value Added Tax and other taxes payable", "2200"),

    ("2300", "Long-term Debt", "Liability", "Long-term", "Credit", False,
     "Parent account for long-term borrowings and loans", None),
    ("2310", "Bank Loans", "Liability", "Long-term", "Credit", True,
     "Loans payable to banks and financial institutions", "2300"),
    ("2320", "Other Long-term Debt", "Liability", "Long-term", "Credit", True,
     "Other long-term borrowings and obligations", "2300"),

    ("2500", "Customer Liabilities", "Liability", "Customer", "Credit", False,
     "Parent account for customer-related liabilities", None),
    ("2510", "Gift Vouchers Outstanding", "Liability", "Customer", "Credit", True,
     "Unearned revenue from gift vouchers sold but not redeemed", "2500"),
    ("2520", "Customer Deposits", "Liability", "Customer", "Credit", True,
     "Advance payments/deposits received from customers", "2500"),
    ("2530", "Customer Credit Notes Outstanding", "Liability", "Customer", "Credit", True,
     "Issued customer credit notes not yet redeemed against future invoices", "2500"),

    # ═══════════════════════════════════════════════════════════════════════════
    # EQUITY
    # ═══════════════════════════════════════════════════════════════════════════
    ("3000", "Owner's Equity", "Equity", "Equity", "Credit", False,
     "Owner's capital investment", None),
    ("3100", "Retained Earnings", "Equity", "Equity", "Credit", True,
     "Accumulated profits from prior periods", None),
    ("3200", "Current Year Profit/Loss", "Equity", "Equity", "Credit", True,
     "Net income or loss for the current fiscal year", None),

    # ═══════════════════════════════════════════════════════════════════════════
    # REVENUE
    # ═══════════════════════════════════════════════════════════════════════════
    ("4000", "Sales Revenue", "Revenue", "Sales", "Credit", False,
     "Parent account for all sales income", None),
    ("4010", "Cash Sales", "Revenue", "Sales", "Credit", True,
     "Revenue from cash sales transactions", "4000"),
    ("4020", "Credit Sales", "Revenue", "Sales", "Credit", True,
     "Revenue from credit sales transactions", "4000"),
    ("4030", "Sales Returns", "Revenue", "Sales", "Debit", True,
     "Returns and allowances reducing sales (contra account)", "4000"),

    ("4100", "Other Income", "Revenue", "Other", "Credit", False,
     "Parent account for non-operating income", None),
    ("4110", "Discount Received", "Revenue", "Other", "Credit", False,
     "Discounts received from suppliers", "4100"),

    # ═══════════════════════════════════════════════════════════════════════════
    # EXPENSES
    # ═══════════════════════════════════════════════════════════════════════════
    ("5000", "Cost of Goods Sold", "Expense", "COGS", "Debit", False,
     "Parent account for direct costs", None),
    ("5010", "Purchase Cost", "Expense", "COGS", "Debit", True,
     "Cost of goods purchased for resale", "5000"),
    ("5020", "Freight & Shipping", "Expense", "COGS", "Debit", False,
     "Freight and shipping costs for purchased goods", "5000"),

    ("5100", "Operating Expenses", "Expense", "Operating", "Debit", False,
     "Parent account for operating expenses", None),
    ("5110", "Salaries Expense", "Expense", "Operating", "Debit", True,
     "Employee salary and wage expenses", "5100"),
    ("5120", "Rent Expense", "Expense", "Operating", "Debit", False,
     "Office and store rental expenses", "5100"),
    ("5130", "Utilities Expense", "Expense", "Operating", "Debit", False,
     "Electricity, water, internet expenses", "5100"),
    ("5140", "Travel Expense", "Expense", "Operating", "Debit", False,
     "Business travel and transport expenses", "5100"),
    ("5150", "Commission Expense", "Expense", "Operating", "Debit", True,
     "Sales agent and broker commissions", "5100"),
    ("5160", "Discount Given Expense", "Expense", "Operating", "Debit", True,
     "Discounts and coupons given to customers", "5100"),
    ("5170", "Depreciation Expense", "Expense", "Operating", "Debit", True,
     "Monthly depreciation on fixed assets and equipment", "5100"),
    ("5180", "Office Supplies Expense", "Expense", "Operating", "Debit", True,
     "Stationery, consumables, office supplies", "5100"),
    ("5181", "Repairs & Maintenance", "Expense", "Operating", "Debit", True,
     "Repairs and maintenance of equipment, vehicles, premises", "5100"),
    ("5182", "Marketing & Advertising", "Expense", "Operating", "Debit", True,
     "Advertising, promotions, marketing campaigns", "5100"),
    ("5183", "Insurance Expense", "Expense", "Operating", "Debit", True,
     "Property, vehicle, liability insurance premiums", "5100"),
    ("5190", "Miscellaneous Expense", "Expense", "Operating", "Debit", True,
     "Catch-all for unclassified operating expenses", "5100"),

    ("5200", "Payroll Taxes", "Expense", "Payroll", "Debit", False,
     "Parent account for employer payroll taxes", None),
    ("5210", "EPF Employer Expense", "Expense", "Payroll", "Debit", True,
     "Employer contribution to EPF (12%)", "5200"),
    ("5220", "ETF Employer Expense", "Expense", "Payroll", "Debit", True,
     "Employer contribution to ETF (3%)", "5200"),
]


def seed_chart_of_accounts(db: Session, force: bool = False) -> dict:
    """
    Seed the Chart of Accounts.

    Args:
        db: Database session
        force: If True, skip existing accounts and insert only missing ones.
               If False, abort if any accounts already exist.

    Returns:
        dict with created, skipped, total counts
    """
    existing_count = db.query(ChartOfAccounts).count()
    if existing_count > 0 and not force:
        print(f"⚠️  Chart of Accounts already has {existing_count} records.")
        print("   Use --force to add missing accounts without duplicating existing ones.")
        return {"created": 0, "skipped": existing_count, "total": existing_count}

    # Build lookup of existing account codes
    existing_codes = {
        row.account_code
        for row in db.query(ChartOfAccounts.account_code).all()
    }

    # First pass: create all accounts without parent references
    code_to_id: dict[str, int] = {}
    created_count = 0
    skipped_count = 0

    # Collect existing code → id mapping
    for row in db.query(ChartOfAccounts.id, ChartOfAccounts.account_code).all():
        code_to_id[row.account_code] = row.id

    for (code, name, acc_type, category, normal_bal,
         is_system, description, parent_code) in COA_DATA:

        if code in existing_codes:
            skipped_count += 1
            continue

        account = ChartOfAccounts(
            account_code=code,
            account_name=name,
            account_type=acc_type,
            account_category=category,
            normal_balance=normal_bal,
            is_system_account=is_system,
            description=description,
            is_active=True,
            created_by=0,
        )
        db.add(account)
        db.flush()  # Get the ID
        code_to_id[code] = account.id
        created_count += 1

    db.commit()

    # Second pass: set parent_account_id relationships
    parent_updates = 0
    for (code, name, acc_type, category, normal_bal,
         is_system, description, parent_code) in COA_DATA:

        if parent_code and parent_code in code_to_id and code in code_to_id:
            account = db.query(ChartOfAccounts).filter(
                ChartOfAccounts.id == code_to_id[code]
            ).first()
            if account and account.parent_account_id != code_to_id[parent_code]:
                account.parent_account_id = code_to_id[parent_code]
                parent_updates += 1

    db.commit()

    total = db.query(ChartOfAccounts).count()
    return {
        "created": created_count,
        "skipped": skipped_count,
        "parent_links_set": parent_updates,
        "total": total,
    }


def main():
    force = "--force" in sys.argv

    print("=" * 60)
    print("Scenario 29: Chart of Accounts Setup")
    print("=" * 60)

    db = SessionLocal()
    try:
        result = seed_chart_of_accounts(db, force=force)
        print(f"\n✅ Chart of Accounts seeded successfully!")
        print(f"   Created:      {result['created']}")
        print(f"   Skipped:      {result['skipped']}")
        print(f"   Parent links: {result.get('parent_links_set', 0)}")
        print(f"   Total:        {result['total']}")
        print()

        # Summary by account type
        from sqlalchemy import func as sqlfunc
        rows = db.query(
            ChartOfAccounts.account_type,
            sqlfunc.count(ChartOfAccounts.id),
        ).group_by(ChartOfAccounts.account_type).order_by(ChartOfAccounts.account_type).all()

        print("   Breakdown by type:")
        for acc_type, count in rows:
            print(f"     {acc_type:<12} {count:>3} accounts")

        # Show system accounts
        sys_count = db.query(ChartOfAccounts).filter(
            ChartOfAccounts.is_system_account == True
        ).count()
        print(f"\n   System accounts: {sys_count}")

    except Exception as e:
        db.rollback()
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
