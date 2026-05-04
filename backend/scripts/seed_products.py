"""
Seed 100 computer shop products — categories, brands, and products.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.auth.models import User
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
from app.modules.sales.models import InvoiceItems
from app.modules.purchasing.models import PurchasingOrderItems, PurchasingReturnItems, SupplierCreditsSettle, SupplierCreditsSettleTransaction
from app.modules.support.models import CSJobItem
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.warehouse.models import ItemTransferNoteItems, ItemTransferNoteItemProduct
from app.modules.employees.models import Employee
from app.modules.finance.models import BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
from app.modules.customers.models import (
    CustomerCuponCodes, Customer,
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle, CustomerCreditsSettleTransaction,
)
from app.modules.common.models import Approvals, Country, Locations
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves
from datetime import datetime, date
from decimal import Decimal

CATEGORIES = [
    {"name": "Laptops",        "code": "LAP", "desc": "Portable computers and notebooks"},
    {"name": "Desktops",       "code": "DKT", "desc": "Desktop computers and towers"},
    {"name": "Monitors",       "code": "MON", "desc": "Computer monitors and displays"},
    {"name": "Components",     "code": "CMP", "desc": "Internal PC components"},
    {"name": "Networking",     "code": "NET", "desc": "Routers, switches and network gear"},
    {"name": "Storage",        "code": "STG", "desc": "Hard drives, SSDs and flash storage"},
    {"name": "Peripherals",    "code": "PER", "desc": "Keyboards, mice and input devices"},
    {"name": "Audio & Video",  "code": "AV",  "desc": "Headsets, speakers and webcams"},
    {"name": "Power & Cables", "code": "PWR", "desc": "UPS, surge protectors and cables"},
    {"name": "Accessories",    "code": "ACC", "desc": "Bags, stands and miscellaneous"},
]

BRANDS = [
    {"name": "Apple",          "code": "APPL", "desc": "Apple Inc."},
    {"name": "Dell",           "code": "DELL", "desc": "Dell Technologies"},
    {"name": "HP",             "code": "HP",   "desc": "HP Inc."},
    {"name": "Lenovo",         "code": "LEN",  "desc": "Lenovo Group"},
    {"name": "ASUS",           "code": "ASUS", "desc": "ASUSTeK Computer"},
    {"name": "Acer",           "code": "ACER", "desc": "Acer Inc."},
    {"name": "MSI",            "code": "MSI",  "desc": "Micro-Star International"},
    {"name": "Samsung",        "code": "SAMS", "desc": "Samsung Electronics"},
    {"name": "LG",             "code": "LG",   "desc": "LG Electronics"},
    {"name": "Sony",           "code": "SONY", "desc": "Sony Corporation"},
    {"name": "Logitech",       "code": "LOGI", "desc": "Logitech International"},
    {"name": "Razer",          "code": "RZR",  "desc": "Razer Inc."},
    {"name": "Corsair",        "code": "COR",  "desc": "Corsair Gaming"},
    {"name": "Western Digital","code": "WD",   "desc": "Western Digital"},
    {"name": "Seagate",        "code": "SEA",  "desc": "Seagate Technology"},
    {"name": "Kingston",       "code": "KNG",  "desc": "Kingston Technology"},
    {"name": "Intel",          "code": "INT",  "desc": "Intel Corporation"},
    {"name": "AMD",            "code": "AMD",  "desc": "Advanced Micro Devices"},
    {"name": "Nvidia",         "code": "NVD",  "desc": "Nvidia Corporation"},
    {"name": "TP-Link",        "code": "TPL",  "desc": "TP-Link Technologies"},
    {"name": "Belkin",         "code": "BLK",  "desc": "Belkin International"},
    {"name": "APC",            "code": "APC",  "desc": "APC by Schneider Electric"},
    {"name": "Philips",        "code": "PHI",  "desc": "Philips Electronics"},
    {"name": "BenQ",           "code": "BNQ",  "desc": "BenQ Corporation"},
    {"name": "Anker",          "code": "ANK",  "desc": "Anker Innovations"},
]

# 100 computer shop products
PRODUCTS = [
    # LAPTOPS (15)
    {"name": "Apple MacBook Pro 14\"",           "code": "APPL-MBP14-001",  "model": "MacBook Pro 14 M3",        "type": "laptop",         "cat": "Laptops",      "brand": "Apple",    "cost": "1650.00", "price": "1999.99"},
    {"name": "Apple MacBook Air 15\"",            "code": "APPL-MBA15-001",  "model": "MacBook Air 15 M2",        "type": "laptop",         "cat": "Laptops",      "brand": "Apple",    "cost": "1150.00", "price": "1399.99"},
    {"name": "Dell XPS 15",                       "code": "DELL-XPS15-001",  "model": "XPS 15 9530",              "type": "laptop",         "cat": "Laptops",      "brand": "Dell",     "cost": "1400.00", "price": "1799.99"},
    {"name": "Dell Latitude 5540",                "code": "DELL-LAT55-001",  "model": "Latitude 5540",            "type": "laptop",         "cat": "Laptops",      "brand": "Dell",     "cost": "750.00",  "price": "999.99"},
    {"name": "HP EliteBook 840 G10",              "code": "HP-EB840-001",    "model": "EliteBook 840 G10",        "type": "laptop",         "cat": "Laptops",      "brand": "HP",       "cost": "900.00",  "price": "1199.99"},
    {"name": "HP ProBook 450 G10",                "code": "HP-PB450-001",    "model": "ProBook 450 G10",          "type": "laptop",         "cat": "Laptops",      "brand": "HP",       "cost": "650.00",  "price": "849.99"},
    {"name": "Lenovo ThinkPad X1 Carbon Gen11",   "code": "LEN-X1C-001",     "model": "ThinkPad X1 Carbon Gen11", "type": "laptop",         "cat": "Laptops",      "brand": "Lenovo",   "cost": "1100.00", "price": "1449.99"},
    {"name": "Lenovo IdeaPad 5 Pro 16\"",         "code": "LEN-IP5P-001",    "model": "IdeaPad 5 Pro 16",         "type": "laptop",         "cat": "Laptops",      "brand": "Lenovo",   "cost": "700.00",  "price": "929.99"},
    {"name": "ASUS ROG Zephyrus G14",             "code": "ASUS-ROGG14-001", "model": "ROG Zephyrus G14 2024",   "type": "gaming_laptop",  "cat": "Laptops",      "brand": "ASUS",     "cost": "1300.00", "price": "1699.99"},
    {"name": "ASUS VivoBook 15",                  "code": "ASUS-VB15-001",   "model": "VivoBook 15 X1502",        "type": "laptop",         "cat": "Laptops",      "brand": "ASUS",     "cost": "480.00",  "price": "629.99"},
    {"name": "Acer Aspire 5",                     "code": "ACER-ASP5-001",   "model": "Aspire 5 A515-58",         "type": "laptop",         "cat": "Laptops",      "brand": "Acer",     "cost": "430.00",  "price": "579.99"},
    {"name": "Acer Predator Helios 16",           "code": "ACER-PH16-001",   "model": "Predator Helios 16",       "type": "gaming_laptop",  "cat": "Laptops",      "brand": "Acer",     "cost": "1200.00", "price": "1549.99"},
    {"name": "MSI Titan GT77 HX",                 "code": "MSI-GT77-001",    "model": "Titan GT77 HX",            "type": "gaming_laptop",  "cat": "Laptops",      "brand": "MSI",      "cost": "2200.00", "price": "2899.99"},
    {"name": "MSI Modern 14",                     "code": "MSI-MOD14-001",   "model": "Modern 14 C13M",           "type": "laptop",         "cat": "Laptops",      "brand": "MSI",      "cost": "490.00",  "price": "649.99"},
    {"name": "Samsung Galaxy Book3 Pro 360",      "code": "SAMS-GB3P-001",   "model": "Galaxy Book3 Pro 360",     "type": "laptop",         "cat": "Laptops",      "brand": "Samsung",  "cost": "1050.00", "price": "1349.99"},
    # DESKTOPS (8)
    {"name": "Apple Mac Mini M2",                 "code": "APPL-MMINI-001",  "model": "Mac Mini M2",              "type": "desktop",        "cat": "Desktops",     "brand": "Apple",    "cost": "480.00",  "price": "599.99"},
    {"name": "Apple Mac Studio M2 Ultra",         "code": "APPL-MSTU-001",   "model": "Mac Studio M2 Ultra",      "type": "desktop",        "cat": "Desktops",     "brand": "Apple",    "cost": "1800.00", "price": "1999.99"},
    {"name": "Dell OptiPlex 7010 MT",             "code": "DELL-OPT70-001",  "model": "OptiPlex 7010 MT",         "type": "desktop",        "cat": "Desktops",     "brand": "Dell",     "cost": "580.00",  "price": "749.99"},
    {"name": "HP EliteDesk 800 G9",               "code": "HP-ED800-001",    "model": "EliteDesk 800 G9",         "type": "desktop",        "cat": "Desktops",     "brand": "HP",       "cost": "650.00",  "price": "849.99"},
    {"name": "Lenovo ThinkCentre M90q Gen4",      "code": "LEN-M90Q-001",    "model": "ThinkCentre M90q Gen4",    "type": "desktop",        "cat": "Desktops",     "brand": "Lenovo",   "cost": "550.00",  "price": "729.99"},
    {"name": "ASUS ROG Strix G10DK",              "code": "ASUS-ROGG10-001", "model": "ROG Strix G10DK",          "type": "gaming_desktop", "cat": "Desktops",     "brand": "ASUS",     "cost": "950.00",  "price": "1249.99"},
    {"name": "Acer Aspire TC-1780",               "code": "ACER-TC17-001",   "model": "Aspire TC-1780",           "type": "desktop",        "cat": "Desktops",     "brand": "Acer",     "cost": "380.00",  "price": "499.99"},
    {"name": "MSI MAG Infinite S3 13NUC",         "code": "MSI-MAGI-001",    "model": "MAG Infinite S3 13NUC",    "type": "gaming_desktop", "cat": "Desktops",     "brand": "MSI",      "cost": "820.00",  "price": "1099.99"},
    # MONITORS (10)
    {"name": "Dell UltraSharp U2723DE 27\"",      "code": "DELL-U2723-001",  "model": "U2723DE",                  "type": "monitor",        "cat": "Monitors",     "brand": "Dell",     "cost": "420.00",  "price": "549.99"},
    {"name": "Dell S3222DGM 32\" Curved",         "code": "DELL-S3222-001",  "model": "S3222DGM",                 "type": "gaming_monitor", "cat": "Monitors",     "brand": "Dell",     "cost": "300.00",  "price": "399.99"},
    {"name": "LG UltraWide 34\" WQHD",            "code": "LG-UW34-001",     "model": "34WP65C-B",                "type": "monitor",        "cat": "Monitors",     "brand": "LG",       "cost": "320.00",  "price": "429.99"},
    {"name": "LG 27\" 4K UHD IPS",                "code": "LG-27UK-001",     "model": "27UL850-W",                "type": "monitor",        "cat": "Monitors",     "brand": "LG",       "cost": "250.00",  "price": "329.99"},
    {"name": "Samsung 27\" Odyssey G5",           "code": "SAMS-OG5-001",    "model": "Odyssey G5 LS27CG552",     "type": "gaming_monitor", "cat": "Monitors",     "brand": "Samsung",  "cost": "220.00",  "price": "299.99"},
    {"name": "ASUS ProArt PA278QV 27\"",          "code": "ASUS-PA278-001",  "model": "ProArt PA278QV",           "type": "monitor",        "cat": "Monitors",     "brand": "ASUS",     "cost": "280.00",  "price": "369.99"},
    {"name": "BenQ PD2725U 27\" 4K",              "code": "BNQ-PD27-001",    "model": "PD2725U",                  "type": "monitor",        "cat": "Monitors",     "brand": "BenQ",     "cost": "380.00",  "price": "499.99"},
    {"name": "Philips 242E1GAJ 24\" FHD 165Hz",   "code": "PHI-242E-001",    "model": "242E1GAJ",                 "type": "gaming_monitor", "cat": "Monitors",     "brand": "Philips",  "cost": "140.00",  "price": "189.99"},
    {"name": "Acer Nitro XV240YM3 24\"",          "code": "ACER-XV240-001",  "model": "Nitro XV240YM3",           "type": "gaming_monitor", "cat": "Monitors",     "brand": "Acer",     "cost": "160.00",  "price": "219.99"},
    {"name": "HP E27 G5 27\" FHD",                "code": "HP-E27G5-001",    "model": "E27 G5",                   "type": "monitor",        "cat": "Monitors",     "brand": "HP",       "cost": "175.00",  "price": "229.99"},
    # COMPONENTS (12)
    {"name": "Intel Core i9-13900K CPU",          "code": "INT-I913900K-001","model": "Core i9-13900K",           "type": "cpu",            "cat": "Components",   "brand": "Intel",    "cost": "480.00",  "price": "589.99"},
    {"name": "Intel Core i5-13600K CPU",          "code": "INT-I513600K-001","model": "Core i5-13600K",           "type": "cpu",            "cat": "Components",   "brand": "Intel",    "cost": "240.00",  "price": "299.99"},
    {"name": "AMD Ryzen 9 7950X CPU",             "code": "AMD-R97950-001",  "model": "Ryzen 9 7950X",            "type": "cpu",            "cat": "Components",   "brand": "AMD",      "cost": "480.00",  "price": "599.99"},
    {"name": "AMD Ryzen 5 7600X CPU",             "code": "AMD-R57600-001",  "model": "Ryzen 5 7600X",            "type": "cpu",            "cat": "Components",   "brand": "AMD",      "cost": "200.00",  "price": "259.99"},
    {"name": "Nvidia RTX 4090 GPU",               "code": "NVD-RTX4090-001", "model": "GeForce RTX 4090",         "type": "gpu",            "cat": "Components",   "brand": "Nvidia",   "cost": "1400.00", "price": "1799.99"},
    {"name": "Nvidia RTX 4070 GPU",               "code": "NVD-RTX4070-001", "model": "GeForce RTX 4070",         "type": "gpu",            "cat": "Components",   "brand": "Nvidia",   "cost": "520.00",  "price": "649.99"},
    {"name": "Corsair Vengeance 32GB DDR5 RAM",   "code": "COR-V32-001",     "model": "Vengeance DDR5-5600 32GB", "type": "ram",            "cat": "Components",   "brand": "Corsair",  "cost": "95.00",   "price": "129.99"},
    {"name": "Kingston Fury 16GB DDR4 RAM",       "code": "KNG-F16-001",     "model": "Fury Beast DDR4-3200 16GB","type": "ram",            "cat": "Components",   "brand": "Kingston", "cost": "38.00",   "price": "54.99"},
    {"name": "ASUS ROG Strix B650-E Motherboard", "code": "ASUS-B650E-001",  "model": "ROG Strix B650-E Gaming",  "type": "motherboard",    "cat": "Components",   "brand": "ASUS",     "cost": "270.00",  "price": "349.99"},
    {"name": "MSI MAG B760M Mortar Motherboard",  "code": "MSI-B760M-001",   "model": "MAG B760M Mortar WiFi",    "type": "motherboard",    "cat": "Components",   "brand": "MSI",      "cost": "140.00",  "price": "184.99"},
    {"name": "Corsair RM1000x 1000W PSU",         "code": "COR-RM1000-001",  "model": "RM1000x SHIFT",            "type": "psu",            "cat": "Components",   "brand": "Corsair",  "cost": "150.00",  "price": "199.99"},
    {"name": "Corsair 4000D Airflow Case",         "code": "COR-4000D-001",   "model": "4000D Airflow",            "type": "case",           "cat": "Components",   "brand": "Corsair",  "cost": "75.00",   "price": "104.99"},
    # STORAGE (10)
    {"name": "Samsung 990 Pro 2TB NVMe SSD",      "code": "SAMS-990P2-001",  "model": "990 Pro 2TB",              "type": "ssd_nvme",       "cat": "Storage",      "brand": "Samsung",  "cost": "140.00",  "price": "189.99"},
    {"name": "Samsung 870 EVO 1TB SATA SSD",      "code": "SAMS-870E1-001",  "model": "870 EVO 1TB",              "type": "ssd_sata",       "cat": "Storage",      "brand": "Samsung",  "cost": "75.00",   "price": "99.99"},
    {"name": "WD Black SN850X 1TB NVMe SSD",      "code": "WD-SN850X1-001",  "model": "WD Black SN850X 1TB",      "type": "ssd_nvme",       "cat": "Storage",      "brand": "Western Digital","cost": "90.00","price": "119.99"},
    {"name": "WD Red Plus 4TB NAS HDD",           "code": "WD-RP4-001",      "model": "WD Red Plus 4TB",          "type": "hdd",            "cat": "Storage",      "brand": "Western Digital","cost": "85.00","price": "114.99"},
    {"name": "Seagate Barracuda 2TB HDD",         "code": "SEA-BRC2-001",    "model": "Barracuda 2TB 7200RPM",    "type": "hdd",            "cat": "Storage",      "brand": "Seagate",  "cost": "42.00",   "price": "59.99"},
    {"name": "Seagate IronWolf 8TB NAS HDD",      "code": "SEA-IW8-001",     "model": "IronWolf 8TB",             "type": "hdd",            "cat": "Storage",      "brand": "Seagate",  "cost": "165.00",  "price": "219.99"},
    {"name": "Kingston NV2 500GB NVMe SSD",       "code": "KNG-NV25-001",    "model": "NV2 500GB",                "type": "ssd_nvme",       "cat": "Storage",      "brand": "Kingston", "cost": "32.00",   "price": "44.99"},
    {"name": "Corsair MP600 Pro 2TB NVMe SSD",    "code": "COR-MP6P2-001",   "model": "MP600 Pro 2TB",            "type": "ssd_nvme",       "cat": "Storage",      "brand": "Corsair",  "cost": "155.00",  "price": "199.99"},
    {"name": "Samsung 64GB USB 3.1 Flash Drive",  "code": "SAMS-USB64-001",  "model": "Bar Plus 64GB",            "type": "flash_drive",    "cat": "Storage",      "brand": "Samsung",  "cost": "12.00",   "price": "17.99"},
    {"name": "Kingston 256GB microSD Card",       "code": "KNG-MSD256-001",  "model": "Canvas Select Plus 256GB", "type": "memory_card",    "cat": "Storage",      "brand": "Kingston", "cost": "18.00",   "price": "24.99"},
    # NETWORKING (8)
    {"name": "TP-Link Archer AX6000 Wi-Fi 6",     "code": "TPL-AX6K-001",    "model": "Archer AX6000",            "type": "router",         "cat": "Networking",   "brand": "TP-Link",  "cost": "165.00",  "price": "219.99"},
    {"name": "TP-Link TL-SG108 8-Port Switch",    "code": "TPL-SG108-001",   "model": "TL-SG108",                 "type": "switch",         "cat": "Networking",   "brand": "TP-Link",  "cost": "20.00",   "price": "27.99"},
    {"name": "TP-Link RE700X Wi-Fi 6 Extender",   "code": "TPL-RE700-001",   "model": "RE700X",                   "type": "extender",       "cat": "Networking",   "brand": "TP-Link",  "cost": "55.00",   "price": "74.99"},
    {"name": "TP-Link Deco XE75 Mesh 3-Pack",     "code": "TPL-XE75-001",    "model": "Deco XE75 (3-pack)",       "type": "mesh_wifi",      "cat": "Networking",   "brand": "TP-Link",  "cost": "200.00",  "price": "269.99"},
    {"name": "Belkin USB-C 7-in-1 Hub",           "code": "BLK-USB7-001",    "model": "F4U092",                   "type": "usb_hub",        "cat": "Networking",   "brand": "Belkin",   "cost": "48.00",   "price": "64.99"},
    {"name": "Anker 10-Port USB-A Hub",           "code": "ANK-10HUB-001",   "model": "A7515",                    "type": "usb_hub",        "cat": "Networking",   "brand": "Anker",    "cost": "28.00",   "price": "37.99"},
    {"name": "Anker USB-C to RJ45 Adapter",       "code": "ANK-CETH-001",    "model": "A8312",                    "type": "adapter",        "cat": "Networking",   "brand": "Anker",    "cost": "14.00",   "price": "19.99"},
    {"name": "Belkin DisplayPort 1.4 Cable 6ft",   "code": "BLK-DP14-001",   "model": "Belkin DP 1.4 6ft",        "type": "cable",          "cat": "Networking",   "brand": "Belkin",   "cost": "14.00",   "price": "19.99"},
    # PERIPHERALS (18)
    {"name": "Logitech MX Keys S Keyboard",       "code": "LOGI-MXKS-001",   "model": "MX Keys S",                "type": "keyboard",       "cat": "Peripherals",  "brand": "Logitech", "cost": "88.00",   "price": "119.99"},
    {"name": "Logitech MX Master 3S Mouse",       "code": "LOGI-MXM3S-001",  "model": "MX Master 3S",             "type": "mouse",          "cat": "Peripherals",  "brand": "Logitech", "cost": "70.00",   "price": "99.99"},
    {"name": "Logitech G Pro X Superlight 2",     "code": "LOGI-GPX2-001",   "model": "G Pro X Superlight 2",     "type": "gaming_mouse",   "cat": "Peripherals",  "brand": "Logitech", "cost": "110.00",  "price": "159.99"},
    {"name": "Logitech G915 TKL Keyboard",        "code": "LOGI-G915-001",   "model": "G915 TKL Lightspeed",      "type": "gaming_keyboard","cat": "Peripherals",  "brand": "Logitech", "cost": "145.00",  "price": "199.99"},
    {"name": "Razer DeathAdder V3 Mouse",         "code": "RZR-DAV3-001",    "model": "DeathAdder V3",            "type": "gaming_mouse",   "cat": "Peripherals",  "brand": "Razer",    "cost": "62.00",   "price": "89.99"},
    {"name": "Razer BlackWidow V4 Keyboard",      "code": "RZR-BWV4-001",    "model": "BlackWidow V4",            "type": "gaming_keyboard","cat": "Peripherals",  "brand": "Razer",    "cost": "88.00",   "price": "129.99"},
    {"name": "Razer Goliathus Extended Mousepad", "code": "RZR-GOLE-001",    "model": "Goliathus Extended",       "type": "mousepad",       "cat": "Peripherals",  "brand": "Razer",    "cost": "22.00",   "price": "34.99"},
    {"name": "Corsair K100 RGB Keyboard",         "code": "COR-K100-001",    "model": "K100 RGB Optical",         "type": "gaming_keyboard","cat": "Peripherals",  "brand": "Corsair",  "cost": "145.00",  "price": "199.99"},
    {"name": "Corsair Harpoon RGB Wireless Mouse","code": "COR-HARP-001",    "model": "Harpoon RGB Wireless",     "type": "gaming_mouse",   "cat": "Peripherals",  "brand": "Corsair",  "cost": "40.00",   "price": "54.99"},
    {"name": "HP 125 Wired Keyboard",             "code": "HP-125KB-001",    "model": "125 Wired Keyboard",       "type": "keyboard",       "cat": "Peripherals",  "brand": "HP",       "cost": "14.00",   "price": "19.99"},
    {"name": "HP 125 Wired Mouse",                "code": "HP-125MS-001",    "model": "HP 125 Wired Mouse",       "type": "mouse",          "cat": "Peripherals",  "brand": "HP",       "cost": "10.00",   "price": "14.99"},
    {"name": "Dell KB216 Wired Keyboard",         "code": "DELL-KB216-001",  "model": "KB216",                    "type": "keyboard",       "cat": "Peripherals",  "brand": "Dell",     "cost": "12.00",   "price": "17.99"},
    {"name": "Apple Magic Keyboard Touch ID",     "code": "APPL-MGKB-001",   "model": "Magic Keyboard Touch ID",  "type": "keyboard",       "cat": "Peripherals",  "brand": "Apple",    "cost": "80.00",   "price": "109.99"},
    {"name": "Apple Magic Mouse",                 "code": "APPL-MGMS-001",   "model": "Magic Mouse",              "type": "mouse",          "cat": "Peripherals",  "brand": "Apple",    "cost": "62.00",   "price": "79.99"},
    {"name": "Logitech Combo MK470 Wireless",     "code": "LOGI-MK470-001",  "model": "MK470 Slim Combo",         "type": "keyboard",       "cat": "Peripherals",  "brand": "Logitech", "cost": "44.00",   "price": "59.99"},
    {"name": "Anker Vertical Ergonomic Mouse",    "code": "ANK-VEM-001",     "model": "Anker 2.4G Ergonomic",     "type": "mouse",          "cat": "Peripherals",  "brand": "Anker",    "cost": "22.00",   "price": "29.99"},
    {"name": "Razer Strider XXL Mousepad",        "code": "RZR-STRXXL-001",  "model": "Strider XXL",              "type": "mousepad",       "cat": "Peripherals",  "brand": "Razer",    "cost": "32.00",   "price": "44.99"},
    {"name": "Corsair MM700 RGB Mousepad XL",     "code": "COR-MM700-001",   "model": "MM700 RGB XL",             "type": "mousepad",       "cat": "Peripherals",  "brand": "Corsair",  "cost": "45.00",   "price": "59.99"},
    # AUDIO & VIDEO (10)
    {"name": "Sony WH-1000XM5 Wireless Headset",  "code": "SONY-WH1000-001", "model": "WH-1000XM5",              "type": "headphones",     "cat": "Audio & Video","brand": "Sony",     "cost": "250.00",  "price": "349.99"},
    {"name": "Razer BlackShark V2 Pro Headset",   "code": "RZR-BSV2P-001",   "model": "BlackShark V2 Pro",        "type": "gaming_headset", "cat": "Audio & Video","brand": "Razer",    "cost": "90.00",   "price": "129.99"},
    {"name": "Corsair HS80 RGB Wireless Headset", "code": "COR-HS80-001",    "model": "HS80 RGB Wireless",        "type": "gaming_headset", "cat": "Audio & Video","brand": "Corsair",  "cost": "80.00",   "price": "109.99"},
    {"name": "Logitech G435 Wireless Headset",    "code": "LOGI-G435-001",   "model": "G435 Lightspeed",          "type": "gaming_headset", "cat": "Audio & Video","brand": "Logitech", "cost": "60.00",   "price": "79.99"},
    {"name": "Logitech Brio 4K Webcam",           "code": "LOGI-BRIO-001",   "model": "Brio 4K",                  "type": "webcam",         "cat": "Audio & Video","brand": "Logitech", "cost": "140.00",  "price": "189.99"},
    {"name": "Razer Kiyo Pro Webcam 1080p",       "code": "RZR-KIYO-001",    "model": "Kiyo Pro",                 "type": "webcam",         "cat": "Audio & Video","brand": "Razer",    "cost": "75.00",   "price": "99.99"},
    {"name": "Anker PowerConf S330 Speakerphone", "code": "ANK-S330-001",    "model": "PowerConf S330",           "type": "speakerphone",   "cat": "Audio & Video","brand": "Anker",    "cost": "55.00",   "price": "74.99"},
    {"name": "Logitech MeetUp 4K Conference Cam", "code": "LOGI-MEET-001",   "model": "MeetUp",                   "type": "conference_cam", "cat": "Audio & Video","brand": "Logitech", "cost": "600.00",  "price": "749.99"},
    {"name": "Sony SRS-XB23 Bluetooth Speaker",   "code": "SONY-XB23-001",   "model": "SRS-XB23",                 "type": "speaker",        "cat": "Audio & Video","brand": "Sony",     "cost": "55.00",   "price": "74.99"},
    {"name": "Corsair Elgato Wave:3 Microphone",  "code": "COR-WAVE3-001",   "model": "Elgato Wave:3",            "type": "microphone",     "cat": "Audio & Video","brand": "Corsair",  "cost": "110.00",  "price": "149.99"},
    # POWER & CABLES (10)
    {"name": "APC Back-UPS 1500VA",               "code": "APC-BX1500-001",  "model": "Back-UPS BX1500M",         "type": "ups",            "cat": "Power & Cables","brand": "APC",     "cost": "120.00",  "price": "159.99"},
    {"name": "APC Smart-UPS 3000VA",              "code": "APC-SMT3K-001",   "model": "Smart-UPS SMT3000",        "type": "ups",            "cat": "Power & Cables","brand": "APC",     "cost": "650.00",  "price": "849.99"},
    {"name": "Belkin Surge Protector 12-Outlet",   "code": "BLK-SP12-001",    "model": "BSV1201",                  "type": "surge_protector","cat": "Power & Cables","brand": "Belkin",  "cost": "38.00",   "price": "49.99"},
    {"name": "Anker 65W USB-C GaN Charger",       "code": "ANK-65W-001",     "model": "Anker 65W USB-C",          "type": "charger",        "cat": "Power & Cables","brand": "Anker",   "cost": "28.00",   "price": "39.99"},
    {"name": "Anker 10ft USB-C to USB-C Cable",   "code": "ANK-C10-001",     "model": "Anker USB-C 10ft",         "type": "cable",          "cat": "Power & Cables","brand": "Anker",   "cost": "10.00",   "price": "14.99"},
    {"name": "Belkin BoostCharge 4-Port USB Hub",  "code": "BLK-BC4P-001",   "model": "BoostCharge 4-Port",       "type": "charger",        "cat": "Power & Cables","brand": "Belkin",  "cost": "25.00",   "price": "34.99"},
    {"name": "Anker 6ft HDMI 2.1 Cable 8K",       "code": "ANK-HDMI21-001",  "model": "Anker HDMI 2.1 6ft",      "type": "cable",          "cat": "Power & Cables","brand": "Anker",   "cost": "12.00",   "price": "17.99"},
    {"name": "APC Essential SurgeArrest 6-Outlet", "code": "APC-PM6-001",    "model": "PM6",                      "type": "surge_protector","cat": "Power & Cables","brand": "APC",     "cost": "20.00",   "price": "27.99"},
    {"name": "Anker Nano Power Bank 10000mAh",    "code": "ANK-NP10-001",    "model": "Nano Power Bank 10000",    "type": "power_bank",     "cat": "Power & Cables","brand": "Anker",   "cost": "28.00",   "price": "39.99"},
    {"name": "Corsair RM750x 750W PSU",           "code": "COR-RM750X-001",  "model": "RM750x",                   "type": "psu",            "cat": "Power & Cables","brand": "Corsair", "cost": "95.00",   "price": "124.99"},
    # ACCESSORIES (7)
    {"name": "Logitech MX Desk Mat",              "code": "LOGI-MXDM-001",   "model": "MX Desk Mat",              "type": "desk_mat",       "cat": "Accessories",  "brand": "Logitech", "cost": "35.00",   "price": "49.99"},
    {"name": "Razer Laptop Stand V2 Pro",         "code": "RZR-LSND-001",    "model": "Laptop Stand V2 Pro",      "type": "stand",          "cat": "Accessories",  "brand": "Razer",    "cost": "45.00",   "price": "64.99"},
    {"name": "Corsair Gaming Chair T3 Rush",      "code": "COR-T3R-001",     "model": "T3 Rush 2023",             "type": "chair",          "cat": "Accessories",  "brand": "Corsair",  "cost": "220.00",  "price": "299.99"},
    {"name": "Anker 7-in-1 USB-C Docking Station","code": "ANK-7DS-001",    "model": "A8346",                    "type": "docking_station","cat": "Accessories",  "brand": "Anker",    "cost": "60.00",   "price": "79.99"},
    {"name": "Belkin 17\" Laptop Backpack",       "code": "BLK-BP17-001",    "model": "Active Pro Backpack 17\"", "type": "bag",            "cat": "Accessories",  "brand": "Belkin",   "cost": "42.00",   "price": "59.99"},
    {"name": "MSI Dragon Shield Laptop Bag 15\"", "code": "MSI-DSB15-001",   "model": "Dragon Shield 15.6\"",     "type": "bag",            "cat": "Accessories",  "brand": "MSI",      "cost": "28.00",   "price": "39.99"},
    {"name": "Razer Mouse Bungee V3",             "code": "RZR-MB3-001",     "model": "Mouse Bungee V3",          "type": "bungee",         "cat": "Accessories",  "brand": "Razer",    "cost": "22.00",   "price": "29.99"},
]


def seed_products():
    db: Session = SessionLocal()
    try:
        print("🌱 Seeding computer shop products...")

        # ── Categories ────────────────────────────────────────────────
        print("📦 Categories...")
        cat_map: dict = {}
        for c in CATEGORIES:
            obj = db.query(Category).filter(Category.category_code == c["code"]).first()
            if not obj:
                obj = Category(
                    name=c["name"], category_code=c["code"],
                    description=c["desc"], active=True,
                    created_date=datetime.now(),
                )
                db.add(obj)
                db.flush()
                print(f"   ✚ {c['name']}")
            cat_map[c["name"]] = obj.id

        # ── Brands ────────────────────────────────────────────────────
        print("🏷️  Brands...")
        brand_map: dict = {}
        for b in BRANDS:
            obj = db.query(ItemsBrand).filter(ItemsBrand.brand_code == b["code"]).first()
            if not obj:
                obj = ItemsBrand(
                    brand_name=b["name"], brand_code=b["code"],
                    description=b["desc"],
                )
                db.add(obj)
                db.flush()
                print(f"   ✚ {b['name']}")
            brand_map[b["name"]] = obj.id

        # ── Products ──────────────────────────────────────────────────
        print("💻 Products...")
        created = skipped = 0
        for p in PRODUCTS:
            if db.query(Product).filter(Product.item_code == p["code"]).first():
                skipped += 1
                continue

            cost  = Decimal(p["cost"])
            price = Decimal(p["price"])
            product = Product(
                name=p["name"],
                item_code=p["code"],
                model=p["model"],
                item_type=p["type"],
                description=f"{p['name']} — {p['brand']}",
                website_active=True,
                website_price=price,
                active=True,
                cost_price=cost,
                category_id=cat_map[p["cat"]],
                items_brand_id=brand_map[p["brand"]],
                created_date=date.today(),
                added_date=datetime.now(),
            )
            db.add(product)
            db.flush()
            db.add(MinimumPrice(
                minimum_price=float(cost) * 1.05,
                created_date=datetime.now(),
                product_id=product.id,
            ))
            created += 1

        db.commit()
        print(f"✅ Done — {created} products created, {skipped} already existed.")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_products()

    db: Session = SessionLocal()
    
    try:
        print("🌱 Seeding products...")
        
        # 1. Categories
        print("📦 Checking categories...")
        categories_data = [
            {"name": "Electronics", "code": "ELEC", "desc": "Electronic devices and accessories"},
            {"name": "Furniture", "code": "FURN", "desc": "Office and home furniture"},
            {"name": "Stationery", "code": "STAT", "desc": "Office supplies and stationery"},
            {"name": "Computers", "code": "COMP", "desc": "Computers and accessories"},
            {"name": "Appliances", "code": "APPL", "desc": "Home and office appliances"},
        ]
        
        category_map = {} # name -> id

        for cat_data in categories_data:
            category = db.query(Category).filter(Category.category_code == cat_data["code"]).first()
            if not category:
                print(f"   Creating category: {cat_data['name']}")
                category = Category(
                    name=cat_data["name"],
                    category_code=cat_data["code"],
                    description=cat_data["desc"],
                    active=True,
                    created_date=datetime.now()
                )
                db.add(category)
                db.flush()
            else:
                print(f"   Category exists: {cat_data['name']}")
            
            category_map[cat_data["name"]] = category.id

        # 2. Brands
        print("🏷️  Checking brands...")
        brands_data = [
            {"name": "Samsung", "code": "SAMS", "desc": "Samsung Electronics"},
            {"name": "Apple", "code": "APPL", "desc": "Apple Inc."},
            {"name": "IKEA", "code": "IKEA", "desc": "IKEA Furniture"},
            {"name": "Dell", "code": "DELL", "desc": "Dell Technologies"},
            {"name": "HP", "code": "HP", "desc": "HP Inc."},
            {"name": "Sony", "code": "SONY", "desc": "Sony Corporation"},
            {"name": "LG", "code": "LG", "desc": "LG Electronics"},
        ]
        
        brand_map = {} # name -> id

        for brand_data in brands_data:
            brand = db.query(ItemsBrand).filter(ItemsBrand.brand_code == brand_data["code"]).first()
            if not brand:
                print(f"   Creating brand: {brand_data['name']}")
                brand = ItemsBrand(
                    brand_name=brand_data["name"],
                    brand_code=brand_data["code"],
                    description=brand_data["desc"]
                )
                db.add(brand)
                db.flush()
            else:
                 print(f"   Brand exists: {brand_data['name']}")
            
            brand_map[brand_data["name"]] = brand.id

        # 3. Products
        print("📱 Checking products...")
        products_data = [
             # Electronics
            {
                "name": "Samsung Galaxy S23",
                "item_code": "SAMS-S23-001",
                "model": "Galaxy S23",
                "item_type": "smartphone",
                "description": "Latest Samsung flagship smartphone with 256GB storage",
                "website_active": True,
                "website_price": Decimal("999.99"),
                "active": True,
                "cost_price": Decimal("750.00"),
                "category": "Electronics",
                "brand": "Samsung"
            },
            {
                "name": "iPhone 15 Pro",
                "item_code": "APPL-IP15-001",
                "model": "iPhone 15 Pro",
                "item_type": "smartphone",
                "description": "Apple iPhone 15 Pro with 512GB storage",
                "website_active": True,
                "website_price": Decimal("1199.99"),
                "active": True,
                "cost_price": Decimal("900.00"),
                "category": "Electronics",
                "brand": "Apple"
            },
            {
                "name": "Samsung 55\" 4K TV",
                "item_code": "SAMS-TV55-001",
                "model": "QN55Q80C",
                "item_type": "television",
                "description": "55-inch 4K QLED Smart TV",
                "website_active": True,
                "website_price": Decimal("1299.99"),
                "active": True,
                "cost_price": Decimal("950.00"),
                "category": "Electronics",
                "brand": "Samsung"
            },
            {
                "name": "Sony WH-1000XM5",
                "item_code": "SONY-WH1000-001",
                "model": "WH-1000XM5",
                "item_type": "headphones",
                "description": "Premium noise-canceling wireless headphones",
                "website_active": True,
                "website_price": Decimal("399.99"),
                "active": True,
                "cost_price": Decimal("280.00"),
                "category": "Electronics",
                "brand": "Sony"
            },
            # Furniture
            {
                "name": "Office Desk",
                "item_code": "IKEA-DESK-001",
                "model": "BEKANT",
                "item_type": "furniture",
                "description": "Adjustable office desk 160x80cm",
                "website_active": True,
                "website_price": Decimal("299.99"),
                "active": True,
                "cost_price": Decimal("150.00"),
                "category": "Furniture",
                "brand": "IKEA"
            },
            {
                "name": "Office Chair",
                "item_code": "IKEA-CHAIR-001",
                "model": "MARKUS",
                "item_type": "furniture",
                "description": "Ergonomic office chair with lumbar support",
                "website_active": True,
                "website_price": Decimal("199.99"),
                "active": True,
                "cost_price": Decimal("100.00"),
                "category": "Furniture",
                "brand": "IKEA"
            },
             {
                "name": "Bookshelf",
                "item_code": "IKEA-SHELF-001",
                "model": "BILLY",
                "item_type": "furniture",
                "description": "Classic bookshelf 80x202cm",
                "website_active": True,
                "website_price": Decimal("79.99"),
                "active": True,
                "cost_price": Decimal("40.00"),
                "category": "Furniture",
                "brand": "IKEA"
            },
            # Computers
            {
                "name": "Dell XPS 15",
                "item_code": "DELL-XPS15-001",
                "model": "XPS 15 9530",
                "item_type": "laptop",
                "description": "15.6\" laptop with Intel i7, 16GB RAM, 512GB SSD",
                "website_active": True,
                "website_price": Decimal("1799.99"),
                "active": True,
                "cost_price": Decimal("1400.00"),
                "category": "Computers",
                "brand": "Dell"
            },
            {
                "name": "HP ProBook 450",
                "item_code": "HP-PB450-001",
                "model": "ProBook 450 G10",
                "item_type": "laptop",
                "description": "Business laptop with Intel i5, 8GB RAM, 256GB SSD",
                "website_active": True,
                "website_price": Decimal("899.99"),
                "active": True,
                "cost_price": Decimal("650.00"),
                "category": "Computers",
                "brand": "HP"
            },
            {
                "name": "Dell UltraSharp Monitor",
                "item_code": "DELL-MON27-001",
                "model": "U2723DE",
                "item_type": "monitor",
                "description": "27\" 4K USB-C monitor",
                "website_active": True,
                "website_price": Decimal("649.99"),
                "active": True,
                "cost_price": Decimal("450.00"),
                "category": "Computers",
                "brand": "Dell"
            },
            # Appliances
             {
                "name": "LG Refrigerator",
                "item_code": "LG-FRIDGE-001",
                "model": "LRFVS3006S",
                "item_type": "appliance",
                "description": "French door refrigerator 30 cu. ft.",
                "website_active": True,
                "website_price": Decimal("2299.99"),
                "active": True,
                "cost_price": Decimal("1700.00"),
                "category": "Appliances",
                "brand": "LG"
            },
            {
                "name": "Samsung Microwave",
                "item_code": "SAMS-MICRO-001",
                "model": "MS14K6000AS",
                "item_type": "appliance",
                "description": "1.4 cu. ft. countertop microwave",
                "website_active": True,
                "website_price": Decimal("199.99"),
                "active": True,
                "cost_price": Decimal("120.00"),
                "category": "Appliances",
                "brand": "Samsung"
            },
        ]
        
        for pd in products_data:
            product = db.query(Product).filter(Product.item_code == pd["item_code"]).first()
            if not product:
                print(f"   Creating product: {pd['name']}")
                product = Product(
                    name=pd["name"],
                    item_code=pd["item_code"],
                    model=pd["model"],
                    item_type=pd["item_type"],
                    description=pd["description"],
                    website_active=pd["website_active"],
                    website_price=pd["website_price"],
                    active=pd["active"],
                    cost_price=pd["cost_price"],
                    category_id=category_map[pd["category"]],
                    items_brand_id=brand_map[pd["brand"]],
                    created_date=date.today(),
                    added_date=datetime.now()
                )
                db.add(product)
                db.flush()
                
                # Add minimum price
                min_price = MinimumPrice(
                    minimum_price=float(pd["cost_price"]) * 1.1,
                    created_date=datetime.now(),
                    product_id=product.id
                )
                db.add(min_price)
            else:
                 print(f"   Product exists: {pd['name']}")
        
        db.commit()
        print("✅ Product seeding completed successfully!")

    except Exception as e:
        print(f"❌ Error seeding products: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_products()
