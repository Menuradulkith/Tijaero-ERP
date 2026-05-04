"""
Seed 50 suppliers for a computer shop.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.purchasing.models import Supplier
from app.modules.common.models import Country, Approvals, Locations
from app.auth.models import Branch, Group, User, Permission
from app.modules.employees.models import Employee
from app.modules.sales.models import Invoice
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
from app.modules.sales.models import InvoiceItems
from app.modules.purchasing.models import (
    PurchasingOrderItems, PurchasingReturnItems,
    SupplierCreditsSettle, SupplierCreditsSettleTransaction,
)
from app.modules.support.models import CSJobItem
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.warehouse.models import ItemTransferNoteItems, ItemTransferNoteItemProduct
from app.modules.customers.models import (
    CustomerCuponCodes, Customer,
    CustomerAdvancePayments, CustomerCreditNotes,
    CustomerCreditsSettle, CustomerCreditsSettleTransaction,
)
from app.modules.finance.models import BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves
from datetime import datetime, date

# 50 tech/computer suppliers
SUPPLIERS = [
    # Major brand distributors
    {"name": "Apple Authorized Distributor Ltd",      "company": "Apple Authorized Distributor Ltd",    "gender": "other",  "civil_status": "other", "mobile": "0771000001", "email": "orders@apple-dist.com",      "credit_days": 30, "max_credit": 500000},
    {"name": "Dell Technologies Direct",              "company": "Dell Technologies Direct LLC",         "gender": "other",  "civil_status": "other", "mobile": "0771000002", "email": "sales@dell-direct.com",      "credit_days": 30, "max_credit": 400000},
    {"name": "HP Enterprise Solutions",               "company": "HP Enterprise Solutions PLC",          "gender": "other",  "civil_status": "other", "mobile": "0771000003", "email": "sales@hp-enterprise.com",    "credit_days": 45, "max_credit": 350000},
    {"name": "Lenovo Business Partner",               "company": "Lenovo Business Partner Corp",         "gender": "other",  "civil_status": "other", "mobile": "0771000004", "email": "orders@lenovo-bp.com",       "credit_days": 30, "max_credit": 300000},
    {"name": "ASUS Official Distributor",             "company": "ASUS Official Distributor Ltd",        "gender": "other",  "civil_status": "other", "mobile": "0771000005", "email": "sales@asus-official.com",    "credit_days": 30, "max_credit": 250000},
    {"name": "Acer Certified Reseller",               "company": "Acer Certified Reseller Inc",          "gender": "other",  "civil_status": "other", "mobile": "0771000006", "email": "orders@acer-reseller.com",   "credit_days": 30, "max_credit": 200000},
    {"name": "MSI Gaming Distribution",               "company": "MSI Gaming Distribution Co",           "gender": "other",  "civil_status": "other", "mobile": "0771000007", "email": "sales@msi-dist.com",         "credit_days": 45, "max_credit": 180000},
    {"name": "Samsung Electronics Supply",            "company": "Samsung Electronics Supply Chain",     "gender": "other",  "civil_status": "other", "mobile": "0771000008", "email": "b2b@samsung-supply.com",     "credit_days": 30, "max_credit": 600000},
    {"name": "LG Electronics B2B",                   "company": "LG Electronics B2B Division",          "gender": "other",  "civil_status": "other", "mobile": "0771000009", "email": "b2b@lg-direct.com",          "credit_days": 30, "max_credit": 300000},
    {"name": "Sony Professional Solutions",           "company": "Sony Professional Solutions Ltd",      "gender": "other",  "civil_status": "other", "mobile": "0771000010", "email": "pro@sony-solutions.com",     "credit_days": 45, "max_credit": 200000},
    # Peripherals & accessories suppliers
    {"name": "Logitech Wholesale Partners",           "company": "Logitech Wholesale Partners Ltd",      "gender": "other",  "civil_status": "other", "mobile": "0771000011", "email": "wholesale@logitech-wp.com",  "credit_days": 30, "max_credit": 150000},
    {"name": "Razer Authorized Wholesaler",           "company": "Razer Authorized Wholesaler Co",       "gender": "other",  "civil_status": "other", "mobile": "0771000012", "email": "orders@razer-wholesale.com", "credit_days": 30, "max_credit": 120000},
    {"name": "Corsair Gaming Supply Co",              "company": "Corsair Gaming Supply Co",             "gender": "other",  "civil_status": "other", "mobile": "0771000013", "email": "sales@corsair-supply.com",   "credit_days": 45, "max_credit": 100000},
    {"name": "Anker Innovations Distributor",         "company": "Anker Innovations Distributor Ltd",    "gender": "other",  "civil_status": "other", "mobile": "0771000014", "email": "dist@anker-innovations.com", "credit_days": 30, "max_credit": 80000},
    {"name": "Belkin Wholesale Distribution",         "company": "Belkin Wholesale Distribution Inc",    "gender": "other",  "civil_status": "other", "mobile": "0771000015", "email": "orders@belkin-wholesale.com","credit_days": 30, "max_credit": 90000},
    # Storage suppliers
    {"name": "Western Digital Channel Partner",       "company": "Western Digital Channel Partner Ltd",  "gender": "other",  "civil_status": "other", "mobile": "0771000016", "email": "channel@wd-partner.com",     "credit_days": 30, "max_credit": 200000},
    {"name": "Seagate Authorized Distributor",        "company": "Seagate Authorized Distributor Ltd",   "gender": "other",  "civil_status": "other", "mobile": "0771000017", "email": "sales@seagate-auth.com",     "credit_days": 30, "max_credit": 180000},
    {"name": "Kingston Memory Wholesale",             "company": "Kingston Memory Wholesale Corp",       "gender": "other",  "civil_status": "other", "mobile": "0771000018", "email": "orders@kingston-wh.com",     "credit_days": 30, "max_credit": 120000},
    {"name": "Samsung Storage Division",              "company": "Samsung Storage & Memory Division",    "gender": "other",  "civil_status": "other", "mobile": "0771000019", "email": "storage@samsung-b2b.com",    "credit_days": 45, "max_credit": 250000},
    {"name": "Corsair Storage & Memory",              "company": "Corsair Storage & Memory Ltd",         "gender": "other",  "civil_status": "other", "mobile": "0771000020", "email": "memory@corsair-trade.com",   "credit_days": 30, "max_credit": 100000},
    # Components & hardware suppliers
    {"name": "Intel Authorized Reseller",             "company": "Intel Authorized Reseller Corp",       "gender": "other",  "civil_status": "other", "mobile": "0771000021", "email": "reseller@intel-auth.com",    "credit_days": 30, "max_credit": 500000},
    {"name": "AMD Channel Distributor",               "company": "AMD Channel Distributor Ltd",          "gender": "other",  "civil_status": "other", "mobile": "0771000022", "email": "channel@amd-dist.com",       "credit_days": 30, "max_credit": 400000},
    {"name": "Nvidia GPU Wholesale",                  "company": "Nvidia GPU Wholesale Solutions",       "gender": "other",  "civil_status": "other", "mobile": "0771000023", "email": "gpu@nvidia-wholesale.com",   "credit_days": 45, "max_credit": 600000},
    {"name": "ASUS Components Division",              "company": "ASUS Components & Boards Division",    "gender": "other",  "civil_status": "other", "mobile": "0771000024", "email": "components@asus-div.com",    "credit_days": 30, "max_credit": 150000},
    {"name": "MSI Motherboard Distributor",           "company": "MSI Motherboard Distributor Ltd",      "gender": "other",  "civil_status": "other", "mobile": "0771000025", "email": "boards@msi-dist.com",        "credit_days": 30, "max_credit": 120000},
    # Networking & power suppliers
    {"name": "TP-Link Trade Distributor",             "company": "TP-Link Trade Distributor Co",         "gender": "other",  "civil_status": "other", "mobile": "0771000026", "email": "trade@tplink-dist.com",      "credit_days": 30, "max_credit": 100000},
    {"name": "APC Power Solutions Ltd",               "company": "APC Power Solutions Ltd",              "gender": "other",  "civil_status": "other", "mobile": "0771000027", "email": "power@apc-solutions.com",    "credit_days": 45, "max_credit": 200000},
    {"name": "Belkin Power & Cables",                 "company": "Belkin Power & Cables Wholesale",      "gender": "other",  "civil_status": "other", "mobile": "0771000028", "email": "cables@belkin-pw.com",       "credit_days": 30, "max_credit": 60000},
    # Display & audio suppliers
    {"name": "BenQ Monitor Distributor",              "company": "BenQ Monitor Distributor Ltd",         "gender": "other",  "civil_status": "other", "mobile": "0771000029", "email": "monitors@benq-dist.com",     "credit_days": 30, "max_credit": 150000},
    {"name": "Philips Display Solutions",             "company": "Philips Display Solutions Corp",       "gender": "other",  "civil_status": "other", "mobile": "0771000030", "email": "display@philips-b2b.com",    "credit_days": 30, "max_credit": 120000},
    # Local tech distributors
    {"name": "TechBase Trading Co",                  "company": "TechBase Trading Co (Pvt) Ltd",        "gender": "male",   "civil_status": "single","mobile": "0771000031", "email": "info@techbase-trading.com",  "credit_days": 30, "max_credit": 80000},
    {"name": "DigiMart Wholesale",                   "company": "DigiMart Wholesale Pvt Ltd",            "gender": "male",   "civil_status": "single","mobile": "0771000032", "email": "orders@digimart-wh.com",     "credit_days": 30, "max_credit": 70000},
    {"name": "CompuTrade International",             "company": "CompuTrade International Ltd",          "gender": "male",   "civil_status": "married","mobile": "0771000033","email": "sales@computrade-int.com",  "credit_days": 45, "max_credit": 150000},
    {"name": "ByteSource Supply",                    "company": "ByteSource Supply Co",                  "gender": "female", "civil_status": "single","mobile": "0771000034", "email": "supply@bytesource.com",      "credit_days": 30, "max_credit": 60000},
    {"name": "NetPrime Distributors",                "company": "NetPrime Distributors Ltd",             "gender": "male",   "civil_status": "married","mobile": "0771000035","email": "dist@netprime.com",          "credit_days": 30, "max_credit": 90000},
    {"name": "PixelHouse Wholesale",                 "company": "PixelHouse Wholesale Corp",             "gender": "female", "civil_status": "single","mobile": "0771000036", "email": "orders@pixelhouse-wh.com",   "credit_days": 30, "max_credit": 75000},
    {"name": "CoreTech Solutions",                   "company": "CoreTech Solutions Ltd",                "gender": "male",   "civil_status": "married","mobile": "0771000037","email": "info@coretech-sol.com",      "credit_days": 45, "max_credit": 100000},
    {"name": "DataFlow Trading",                     "company": "DataFlow Trading Pvt Ltd",              "gender": "female", "civil_status": "single","mobile": "0771000038", "email": "sales@dataflow-trade.com",   "credit_days": 30, "max_credit": 50000},
    {"name": "TechGate Importers",                   "company": "TechGate Importers & Exporters",        "gender": "male",   "civil_status": "married","mobile": "0771000039","email": "import@techgate.com",        "credit_days": 30, "max_credit": 120000},
    {"name": "SiliconPath Distribution",             "company": "SiliconPath Distribution Ltd",          "gender": "male",   "civil_status": "single","mobile": "0771000040", "email": "dist@siliconpath.com",       "credit_days": 30, "max_credit": 80000},
    {"name": "NanoTech Supplies",                    "company": "NanoTech Supplies Co",                  "gender": "female", "civil_status": "married","mobile": "0771000041","email": "supply@nanotech-s.com",      "credit_days": 45, "max_credit": 60000},
    {"name": "Quantum IT Wholesale",                 "company": "Quantum IT Wholesale Ltd",              "gender": "male",   "civil_status": "single","mobile": "0771000042", "email": "it@quantum-wholesale.com",   "credit_days": 30, "max_credit": 100000},
    {"name": "AlphaByte Trading",                    "company": "AlphaByte Trading & Supplies",          "gender": "male",   "civil_status": "married","mobile": "0771000043","email": "trade@alphabyte.com",        "credit_days": 30, "max_credit": 90000},
    {"name": "GridTech Distributors",                "company": "GridTech Distributors Corp",            "gender": "female", "civil_status": "single","mobile": "0771000044", "email": "grid@gridtech-dist.com",     "credit_days": 30, "max_credit": 70000},
    {"name": "FlashTech Import Export",              "company": "FlashTech Import Export Ltd",           "gender": "male",   "civil_status": "married","mobile": "0771000045","email": "ie@flashtech.com",           "credit_days": 45, "max_credit": 130000},
    {"name": "MegaByte Wholesale",                   "company": "MegaByte Wholesale Solutions",          "gender": "male",   "civil_status": "single","mobile": "0771000046", "email": "wholesale@megabyte-sol.com", "credit_days": 30, "max_credit": 85000},
    {"name": "SmartLink Trading Co",                 "company": "SmartLink Trading Co Ltd",              "gender": "female", "civil_status": "married","mobile": "0771000047","email": "trade@smartlink-co.com",     "credit_days": 30, "max_credit": 65000},
    {"name": "TechVault Supplies",                   "company": "TechVault Supplies Pvt Ltd",            "gender": "male",   "civil_status": "single","mobile": "0771000048", "email": "vault@techvault-sup.com",    "credit_days": 30, "max_credit": 55000},
    {"name": "CyberSource International",            "company": "CyberSource International Ltd",         "gender": "male",   "civil_status": "married","mobile": "0771000049","email": "intl@cybersource-int.com",   "credit_days": 45, "max_credit": 200000},
    {"name": "PrimeTech Wholesale Group",            "company": "PrimeTech Wholesale Group Ltd",         "gender": "female", "civil_status": "single","mobile": "0771000050", "email": "group@primetech-wh.com",     "credit_days": 30, "max_credit": 160000},
]


def seed_suppliers():
    db: Session = SessionLocal()
    try:
        print("🌱 Seeding 50 suppliers...")

        # Ensure a country exists
        country = db.query(Country).filter(Country.iso == "LK").first()
        if not country:
            country = db.query(Country).first()
        if not country:
            country = Country(
                iso="LK", iso3="LKA", iso_numeric=144, name="Sri Lanka",
                currency_code="LKR", currency_symbol="Rs", phone="94",
            )
            db.add(country)
            db.flush()

        created = skipped = 0
        today = date.today()

        for s in SUPPLIERS:
            existing = db.query(Supplier).filter(Supplier.email == s["email"]).first()
            if existing:
                skipped += 1
                continue

            supplier = Supplier(
                title="Mr" if s["gender"] == "male" else ("Ms" if s["gender"] == "female" else "Co"),
                full_name=s["name"],
                name_in_cheque_card=s["name"],
                company_name=s["company"],
                company_contact_number=s["mobile"],
                company_postal_address=f"{s['company']}, Colombo, Sri Lanka",
                postal_address=f"{s['company']}, Colombo, Sri Lanka",
                permenent_address=f"{s['company']}, Colombo, Sri Lanka",
                email=s["email"],
                mobile_contact_number=s["mobile"],
                gender=s["gender"],
                civil_status=s["civil_status"],
                no_of_kids="0",
                credit_days=s["credit_days"],
                max_credit_limit=s["max_credit"],
                left_credit_amount=s["max_credit"],
                initial_credit_amount=s["max_credit"],
                active=True,
                date_joined=datetime.now(),
                birthdate=today,
                country_id=country.id,
            )
            db.add(supplier)
            created += 1

        db.commit()
        print(f"✅ Done — {created} suppliers created, {skipped} already existed.")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_suppliers()
