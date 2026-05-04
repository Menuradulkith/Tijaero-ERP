"""
Seed 300 customers (150 individual + 150 business) for a computer shop.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.customers.models import Customer
from app.modules.common.models import Country, Approvals, Locations
from app.auth.models import Branch, Group, User, Permission
from app.modules.employees.models import Employee
from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
from app.modules.purchasing.models import (
    PurchasingOrderItems, PurchasingReturnItems,
    SupplierCreditsSettle, SupplierCreditsSettleTransaction,
)
from app.modules.support.models import CSJobItem
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.warehouse.models import ItemTransferNoteItems, ItemTransferNoteItemProduct
from app.modules.customers.models import (
    CustomerCuponCodes,
    CustomerAdvancePayments, CustomerCreditNotes,
    CustomerCreditsSettle, CustomerCreditsSettleTransaction,
)
from app.modules.finance.models import BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves
from datetime import datetime

# ── 150 individual customers ──────────────────────────────────────────────────
# (name, gender, mobile, email, credit_days, max_credit, title)
INDIVIDUAL_CUSTOMERS = [
    ("Aiden Silva",         "Male",   "0771100001", "aiden.silva@mail.com",          30, 50000, "Mr"),
    ("Bianca Fernando",     "Female", "0771100002", "bianca.f@mail.com",             30, 50000, "Ms"),
    ("Callum Perera",       "Male",   "0771100003", "callum.perera@mail.com",        30, 50000, "Mr"),
    ("Diana Jayawardena",   "Female", "0771100004", "diana.j@mail.com",              30, 50000, "Ms"),
    ("Ethan Wickrama",      "Male",   "0771100005", "ethan.w@mail.com",              30, 50000, "Mr"),
    ("Fiona Bandara",       "Female", "0771100006", "fiona.b@mail.com",              30, 50000, "Ms"),
    ("George Rathnayake",   "Male",   "0771100007", "george.r@mail.com",             30, 50000, "Mr"),
    ("Hannah Rajapaksa",    "Female", "0771100008", "hannah.r@mail.com",             30, 50000, "Ms"),
    ("Ivan Dissanayake",    "Male",   "0771100009", "ivan.d@mail.com",               30, 50000, "Mr"),
    ("Julia Mendis",        "Female", "0771100010", "julia.m@mail.com",              30, 50000, "Ms"),
    ("Kevin Senaratne",     "Male",   "0771100011", "kevin.s@mail.com",              30, 50000, "Mr"),
    ("Laura Gunasekara",    "Female", "0771100012", "laura.g@mail.com",              30, 50000, "Ms"),
    ("Mark Amarasinghe",    "Male",   "0771100013", "mark.a@mail.com",               30, 50000, "Mr"),
    ("Nina Senanayake",     "Female", "0771100014", "nina.se@mail.com",              30, 50000, "Ms"),
    ("Oscar Gamage",        "Male",   "0771100015", "oscar.g@mail.com",              30, 50000, "Mr"),
    ("Paula Weerasinghe",   "Female", "0771100016", "paula.w@mail.com",              30, 50000, "Ms"),
    ("Quinn Kuruppu",       "Male",   "0771100017", "quinn.k@mail.com",              30, 50000, "Mr"),
    ("Rachel Samaraweera",  "Female", "0771100018", "rachel.s@mail.com",             30, 50000, "Ms"),
    ("Sam Liyanage",        "Male",   "0771100019", "sam.l@mail.com",                30, 50000, "Mr"),
    ("Tanya Karunaratne",   "Female", "0771100020", "tanya.k@mail.com",              30, 50000, "Ms"),
    ("Uma Dassanayake",     "Female", "0771100021", "uma.d@mail.com",                30, 50000, "Ms"),
    ("Victor Wijesinghe",   "Male",   "0771100022", "victor.w@mail.com",             30, 50000, "Mr"),
    ("Wendy Pathirana",     "Female", "0771100023", "wendy.p@mail.com",              30, 50000, "Ms"),
    ("Xavier Goonatilake",  "Male",   "0771100024", "xavier.g@mail.com",             30, 50000, "Mr"),
    ("Yasmin Herath",       "Female", "0771100025", "yasmin.h@mail.com",             30, 50000, "Ms"),
    ("Zack Alwis",          "Male",   "0771100026", "zack.a@mail.com",               30, 50000, "Mr"),
    ("Aaron Tissera",       "Male",   "0771100027", "aaron.t@mail.com",              30, 50000, "Mr"),
    ("Beth Ranasinghe",     "Female", "0771100028", "beth.r@mail.com",               30, 50000, "Ms"),
    ("Carl Weeratunge",     "Male",   "0771100029", "carl.w@mail.com",               30, 50000, "Mr"),
    ("Dana Peiris",         "Female", "0771100030", "dana.p@mail.com",               30, 50000, "Ms"),
    ("Eric Jayasuriya",     "Male",   "0771100031", "eric.j@mail.com",               30, 50000, "Mr"),
    ("Faye Abeykoon",       "Female", "0771100032", "faye.a@mail.com",               30, 50000, "Ms"),
    ("Glen Ratnasiri",      "Male",   "0771100033", "glen.r@mail.com",               30, 50000, "Mr"),
    ("Helen Nanayakkara",   "Female", "0771100034", "helen.n@mail.com",              30, 50000, "Ms"),
    ("Ian Kodagoda",        "Male",   "0771100035", "ian.k@mail.com",                30, 50000, "Mr"),
    ("Joan Vithanage",      "Female", "0771100036", "joan.v@mail.com",               30, 50000, "Ms"),
    ("Kyle Wijenayake",     "Male",   "0771100037", "kyle.w@mail.com",               30, 50000, "Mr"),
    ("Lisa Marasinghe",     "Female", "0771100038", "lisa.m@mail.com",               30, 50000, "Ms"),
    ("Mike Udawatte",       "Male",   "0771100039", "mike.u@mail.com",               30, 50000, "Mr"),
    ("Nancy Pieris",        "Female", "0771100040", "nancy.pie@mail.com",            30, 50000, "Ms"),
    ("Owen Gunawardena",    "Male",   "0771100041", "owen.g@mail.com",               30, 50000, "Mr"),
    ("Patty Samarakoon",    "Female", "0771100042", "patty.s@mail.com",              30, 50000, "Ms"),
    ("Rex Dharmasena",      "Male",   "0771100043", "rex.d@mail.com",                30, 50000, "Mr"),
    ("Sara Palihawadana",   "Female", "0771100044", "sara.pal@mail.com",             30, 50000, "Ms"),
    ("Tom Kahatapitiya",    "Male",   "0771100045", "tom.k@mail.com",                30, 50000, "Mr"),
    ("Ursula Wickramasinghe","Female","0771100046", "ursula.w@mail.com",             30, 50000, "Ms"),
    ("Vince Siriwardena",   "Male",   "0771100047", "vince.s@mail.com",              30, 50000, "Mr"),
    ("Wendy Abeysekara",    "Female", "0771100048", "wendy.ab@mail.com",             30, 50000, "Ms"),
    ("Xander Hulangamuwa",  "Male",   "0771100049", "xander.h@mail.com",             30, 50000, "Mr"),
    ("Yolanda Pinnawela",   "Female", "0771100050", "yolanda.p@mail.com",            30, 50000, "Ms"),
    ("Zachary Kulasuriya",  "Male",   "0771100051", "zachary.k@mail.com",            30, 50000, "Mr"),
    ("Alice Bowatte",       "Female", "0771100052", "alice.b@mail.com",              30, 50000, "Ms"),
    ("Brian Ekanayake",     "Male",   "0771100053", "brian.e@mail.com",              30, 50000, "Mr"),
    ("Claire Palliyaguru",  "Female", "0771100054", "claire.pa@mail.com",            30, 50000, "Ms"),
    ("Derek Sumathipala",   "Male",   "0771100055", "derek.su@mail.com",             30, 50000, "Mr"),
    ("Elena Hapugoda",      "Female", "0771100056", "elena.h@mail.com",              30, 50000, "Ms"),
    ("Fred Thennakoon",     "Male",   "0771100057", "fred.t@mail.com",               30, 50000, "Mr"),
    ("Grace Tennakoon",     "Female", "0771100058", "grace.te@mail.com",             30, 50000, "Ms"),
    ("Harry Balasuriya",    "Male",   "0771100059", "harry.b@mail.com",              30, 50000, "Mr"),
    ("Iris Chandrasekara",  "Female", "0771100060", "iris.c@mail.com",               30, 50000, "Ms"),
    ("Jack Dilrukshi",      "Male",   "0771100061", "jack.dil@mail.com",             30, 50000, "Mr"),
    ("Kim Indrajith",       "Female", "0771100062", "kim.i@mail.com",                30, 50000, "Ms"),
    ("Leo Wijeratne",       "Male",   "0771100063", "leo.wij@mail.com",              30, 50000, "Mr"),
    ("Mia Kulatunga",       "Female", "0771100064", "mia.kul@mail.com",              30, 50000, "Ms"),
    ("Ned Atukorale",       "Male",   "0771100065", "ned.at@mail.com",               30, 50000, "Mr"),
    ("Olive Hettiarachchi", "Female", "0771100066", "olive.h@mail.com",              30, 50000, "Ms"),
    ("Pete Dharmapriya",    "Male",   "0771100067", "pete.dp@mail.com",              30, 50000, "Mr"),
    ("Quinn Saparamadu",    "Female", "0771100068", "quinn.sa@mail.com",             30, 50000, "Ms"),
    ("Roy Ilangasinghe",    "Male",   "0771100069", "roy.il@mail.com",               30, 50000, "Mr"),
    ("Sandy Wimalasena",    "Female", "0771100070", "sandy.wim@mail.com",            30, 50000, "Ms"),
    ("Ted Weerawardena",    "Male",   "0771100071", "ted.ww@mail.com",               30, 50000, "Mr"),
    ("Uma Jayasinghe",      "Female", "0771100072", "uma.jay@mail.com",              30, 50000, "Ms"),
    ("Vince Dedigama",      "Male",   "0771100073", "vince.ded@mail.com",            30, 50000, "Mr"),
    ("Wilma Attanayake",    "Female", "0771100074", "wilma.at@mail.com",             30, 50000, "Ms"),
    ("Xena Liyanaarachchi", "Female", "0771100075", "xena.li@mail.com",              30, 50000, "Ms"),
    ("Yusuf Madugalle",     "Male",   "0771100076", "yusuf.m@mail.com",              30, 50000, "Mr"),
    ("Zara Premaratne",     "Female", "0771100077", "zara.p@mail.com",               30, 50000, "Ms"),
    ("Alex Thilakarathna",  "Male",   "0771100078", "alex.th@mail.com",              30, 50000, "Mr"),
    ("Bella Weerakoon",     "Female", "0771100079", "bella.w@mail.com",              30, 50000, "Ms"),
    ("Chris Jayatilake",    "Male",   "0771100080", "chris.jt@mail.com",             30, 50000, "Mr"),
    ("Daisy Randeniya",     "Female", "0771100081", "daisy.r@mail.com",              30, 50000, "Ms"),
    ("Ed Mahipala",         "Male",   "0771100082", "ed.mah@mail.com",               30, 50000, "Mr"),
    ("Faith Kaluarachchi",  "Female", "0771100083", "faith.k@mail.com",              30, 50000, "Ms"),
    ("Gus Serasinghe",      "Male",   "0771100084", "gus.se@mail.com",               30, 50000, "Mr"),
    ("Holly Pathmanathan",  "Female", "0771100085", "holly.pa@mail.com",             30, 50000, "Ms"),
    ("Iggy Dunuwila",       "Male",   "0771100086", "iggy.d@mail.com",               30, 50000, "Mr"),
    ("Jade Anandappa",      "Female", "0771100087", "jade.an@mail.com",              30, 50000, "Ms"),
    ("Kurt Gamage",         "Male",   "0771100088", "kurt.ga@mail.com",              30, 50000, "Mr"),
    ("Lena Hewawasam",      "Female", "0771100089", "lena.he@mail.com",              30, 50000, "Ms"),
    ("Milo Weerasooriya",   "Male",   "0771100090", "milo.w@mail.com",               30, 50000, "Mr"),
    ("Nora Gunaratne",      "Female", "0771100091", "nora.gu@mail.com",              30, 50000, "Ms"),
    ("Otto Amerasinghe",    "Male",   "0771100092", "otto.am@mail.com",              30, 50000, "Mr"),
    ("Pam Jayasekara",      "Female", "0771100093", "pam.ja@mail.com",               30, 50000, "Ms"),
    ("Quinn Samarasekara",  "Male",   "0771100094", "quinn.ss@mail.com",             30, 50000, "Mr"),
    ("Rose Kumarihamy",     "Female", "0771100095", "rose.ku@mail.com",              30, 50000, "Ms"),
    ("Sean Munasinghe",     "Male",   "0771100096", "sean.mu@mail.com",              30, 50000, "Mr"),
    ("Tina Daluwatte",      "Female", "0771100097", "tina.da@mail.com",              30, 50000, "Ms"),
    ("Uriah Wattegedara",   "Male",   "0771100098", "uriah.w@mail.com",              30, 50000, "Mr"),
    ("Vera Wickramanayake", "Female", "0771100099", "vera.wn@mail.com",              30, 50000, "Ms"),
    ("Will Karunaratne",    "Male",   "0771100100", "will.ka@mail.com",              30, 50000, "Mr"),
    ("Xia Peramunugama",    "Female", "0771100101", "xia.pe@mail.com",               30, 50000, "Ms"),
    ("Yann Illangakon",     "Male",   "0771100102", "yann.il@mail.com",              30, 50000, "Mr"),
    ("Zoe Withanarachchi",  "Female", "0771100103", "zoe.wi@mail.com",               30, 50000, "Ms"),
    ("Adam Kaluperuma",     "Male",   "0771100104", "adam.kp@mail.com",              30, 50000, "Mr"),
    ("Bonnie Hettimulla",   "Female", "0771100105", "bonnie.hm@mail.com",            30, 50000, "Ms"),
    ("Cole Weerakkody",     "Male",   "0771100106", "cole.wk@mail.com",              30, 50000, "Mr"),
    ("Demi Panditharathne", "Female", "0771100107", "demi.pa@mail.com",              30, 50000, "Ms"),
    ("Eli Rajanayake",      "Male",   "0771100108", "eli.rn@mail.com",               30, 50000, "Mr"),
    ("Fern Ranatunge",      "Female", "0771100109", "fern.rt@mail.com",              30, 50000, "Ms"),
    ("Gil Pathiranage",     "Male",   "0771100110", "gil.pr@mail.com",               30, 50000, "Mr"),
    ("Hana Gunathilaka",    "Female", "0771100111", "hana.gt@mail.com",              30, 50000, "Ms"),
    ("Ivor Siriwardhana",   "Male",   "0771100112", "ivor.sw@mail.com",              30, 50000, "Mr"),
    ("Jana Gallage",        "Female", "0771100113", "jana.ga@mail.com",              30, 50000, "Ms"),
    ("Kip Rupasinghe",      "Male",   "0771100114", "kip.ru@mail.com",               30, 50000, "Mr"),
    ("Lola Arachchige",     "Female", "0771100115", "lola.ar@mail.com",              30, 50000, "Ms"),
    ("Max Batuwanthudawe",  "Male",   "0771100116", "max.bt@mail.com",               30, 50000, "Mr"),
    ("Nell Rajapaksha",     "Female", "0771100117", "nell.rp@mail.com",              30, 50000, "Ms"),
    ("Ola Senavirathne",    "Female", "0771100118", "ola.sn@mail.com",               30, 50000, "Ms"),
    ("Pip Wijesooriya",     "Male",   "0771100119", "pip.wj@mail.com",               30, 50000, "Mr"),
    ("Rae Madurawala",      "Female", "0771100120", "rae.mw@mail.com",               30, 50000, "Ms"),
    ("Sal Dharmawardena",   "Male",   "0771100121", "sal.dw@mail.com",               30, 50000, "Mr"),
    ("Thea Karunanayake",   "Female", "0771100122", "thea.kn@mail.com",              30, 50000, "Ms"),
    ("Uri Welgama",         "Male",   "0771100123", "uri.wg@mail.com",               30, 50000, "Mr"),
    ("Val Senevirathna",    "Female", "0771100124", "val.sv@mail.com",               30, 50000, "Ms"),
    ("Wes Galagoda",        "Male",   "0771100125", "wes.gl@mail.com",               30, 50000, "Mr"),
    ("Xena Obeyesekera",    "Female", "0771100126", "xena.ob@mail.com",              30, 50000, "Ms"),
    ("Yogi Amaratunga",     "Male",   "0771100127", "yogi.at@mail.com",              30, 50000, "Mr"),
    ("Zara Lokuge",         "Female", "0771100128", "zara.lo@mail.com",              30, 50000, "Ms"),
    ("Abe Wimalaratne",     "Male",   "0771100129", "abe.wr@mail.com",               30, 50000, "Mr"),
    ("Bex Kariyawasam",     "Female", "0771100130", "bex.kw@mail.com",               30, 50000, "Ms"),
    ("Clem Illeperuma",     "Male",   "0771100131", "clem.il@mail.com",              30, 50000, "Mr"),
    ("Drew Pethiyagoda",    "Male",   "0771100132", "drew.py@mail.com",              30, 50000, "Mr"),
    ("Elle Warnapura",      "Female", "0771100133", "elle.wp@mail.com",              30, 50000, "Ms"),
    ("Finn Rajaguru",       "Male",   "0771100134", "finn.rg@mail.com",              30, 50000, "Mr"),
    ("Gem Wijegunawardena", "Female", "0771100135", "gem.wg@mail.com",               30, 50000, "Ms"),
    ("Hux Appuhami",        "Male",   "0771100136", "hux.ap@mail.com",               30, 50000, "Mr"),
    ("Ivy Dasanayaka",      "Female", "0771100137", "ivy.ds@mail.com",               30, 50000, "Ms"),
    ("Jax Udugampola",      "Male",   "0771100138", "jax.ud@mail.com",               30, 50000, "Mr"),
    ("Kit Nandasena",       "Female", "0771100139", "kit.nd@mail.com",               30, 50000, "Ms"),
    ("Lex Alagiyawanna",    "Male",   "0771100140", "lex.aw@mail.com",               30, 50000, "Mr"),
    ("May Dissanayaka",     "Female", "0771100141", "may.ds@mail.com",               30, 50000, "Ms"),
    ("Nix Siriratne",       "Male",   "0771100142", "nix.sr@mail.com",               30, 50000, "Mr"),
    ("Ora Perumal",         "Female", "0771100143", "ora.pe@mail.com",               30, 50000, "Ms"),
    ("Pax Heenkenda",       "Male",   "0771100144", "pax.hk@mail.com",               30, 50000, "Mr"),
    ("Ria Jayamanna",       "Female", "0771100145", "ria.jm@mail.com",               30, 50000, "Ms"),
    ("Sky Alahakoon",       "Male",   "0771100146", "sky.ak@mail.com",               30, 50000, "Mr"),
    ("Taz Weerasekera",     "Male",   "0771100147", "taz.wse@mail.com",              30, 50000, "Mr"),
    ("Ula Abeyratne",       "Female", "0771100148", "ula.ab@mail.com",               30, 50000, "Ms"),
    ("Vex Patabendige",     "Male",   "0771100149", "vex.pb@mail.com",               30, 50000, "Mr"),
    ("Wren Ranawaka",       "Female", "0771100150", "wren.rw@mail.com",              30, 50000, "Ms"),
]

# ── 150 business / corporate customers ───────────────────────────────────────
# (company_name, mobile, email, credit_days, max_credit)
BUSINESS_CUSTOMERS = [
    ("Alpha Tech Solutions",      "0771200001", "purchase@alpha-tech.lk",       60, 500000),
    ("Beta Systems Ltd",          "0771200002", "orders@beta-systems.lk",        60, 400000),
    ("Gamma IT Services",         "0771200003", "it@gamma-services.lk",          45, 300000),
    ("Delta Computers",           "0771200004", "supply@delta-computers.lk",     60, 350000),
    ("Epsilon Digital",           "0771200005", "digital@epsilon-lk.com",        30, 200000),
    ("Zeta Networks",             "0771200006", "network@zeta-net.lk",           45, 250000),
    ("Eta Software House",        "0771200007", "orders@eta-software.lk",        30, 150000),
    ("Theta Consulting",          "0771200008", "consult@theta-lk.com",          30, 100000),
    ("Iota Business Solutions",   "0771200009", "biz@iota-solutions.lk",         60, 450000),
    ("Kappa Enterprises",         "0771200010", "ent@kappa-ent.lk",              45, 300000),
    ("Lambda Technologies",       "0771200011", "tech@lambda-tech.lk",           60, 500000),
    ("Mu Digital Agency",         "0771200012", "agency@mu-digital.lk",          30, 120000),
    ("Nu IT Group",               "0771200013", "group@nu-it.lk",                45, 200000),
    ("Xi Corporation",            "0771200014", "corp@xi-corp.lk",               60, 600000),
    ("Omicron Media",             "0771200015", "media@omicron.lk",              30, 80000),
    ("Pi Analytics",              "0771200016", "analytics@pi-lk.com",           30, 90000),
    ("Rho Research Institute",    "0771200017", "research@rho-ri.lk",            60, 400000),
    ("Sigma Engineering",         "0771200018", "eng@sigma-eng.lk",              45, 350000),
    ("Tau Telecom",               "0771200019", "telecom@tau-lk.com",            60, 700000),
    ("Upsilon Bank",              "0771200020", "bank@upsilon-bank.lk",          60, 1000000),
    ("Phi Finance Ltd",           "0771200021", "finance@phi-fin.lk",            60, 800000),
    ("Chi Insurance Co",          "0771200022", "insurance@chi-ins.lk",          45, 500000),
    ("Psi Legal Services",        "0771200023", "legal@psi-legal.lk",            30, 100000),
    ("Omega Trading Co",          "0771200024", "trading@omega-trade.lk",        60, 600000),
    ("Apollo Systems",            "0771200025", "systems@apollo-sys.lk",         45, 250000),
    ("Apex Solutions Ltd",        "0771200026", "solutions@apex-lk.com",         60, 350000),
    ("Zenith Digital Works",      "0771200027", "digital@zenith-dw.lk",          30, 150000),
    ("Nexus IT Partners",         "0771200028", "it@nexus-partners.lk",          45, 300000),
    ("Vertex Business Group",     "0771200029", "biz@vertex-group.lk",           60, 450000),
    ("Pinnacle Tech Hub",         "0771200030", "hub@pinnacle-tech.lk",          30, 200000),
    ("Summit Technologies",       "0771200031", "tech@summit-technologies.lk",   45, 280000),
    ("Horizon Digital",           "0771200032", "digital@horizon-dl.lk",         30, 170000),
    ("Eclipse Software",          "0771200033", "software@eclipse-sw.lk",        45, 220000),
    ("Solaris IT",                "0771200034", "it@solaris-it.lk",              60, 380000),
    ("Nova Tech",                 "0771200035", "tech@nova-tech.lk",             30, 130000),
    ("Cosmos Computing",          "0771200036", "compute@cosmos-comp.lk",        45, 190000),
    ("Stellar Systems",           "0771200037", "systems@stellar-sys.lk",        60, 420000),
    ("Orbit Networks",            "0771200038", "net@orbit-net.lk",              30, 160000),
    ("Galaxy Tech Centre",        "0771200039", "centre@galaxy-tech.lk",         45, 240000),
    ("Pulsar IT Solutions",       "0771200040", "it@pulsar-sol.lk",              60, 330000),
    ("Vortex Computers",          "0771200041", "computers@vortex-comp.lk",      30, 110000),
    ("Quasar Digital",            "0771200042", "digital@quasar-dl.lk",          45, 210000),
    ("Nebula Software Co",        "0771200043", "software@nebula-sw.lk",         30, 95000),
    ("Comet Solutions",           "0771200044", "sol@comet-solutions.lk",        60, 370000),
    ("Meteor IT Group",           "0771200045", "group@meteor-it.lk",            45, 260000),
    ("Astro Tech",                "0771200046", "tech@astro-tech.lk",            30, 140000),
    ("Lunar Digital",             "0771200047", "digital@lunar-dl.lk",           60, 480000),
    ("Solar Systems Ltd",         "0771200048", "systems@solar-sys.lk",          45, 320000),
    ("Prism IT Services",         "0771200049", "it@prism-services.lk",          30, 180000),
    ("Spectrum Technologies",     "0771200050", "tech@spectrum-tech.lk",         60, 550000),
    ("Fusion Digital Works",      "0771200051", "works@fusion-dw.lk",            30, 120000),
    ("Matrix Solutions",          "0771200052", "sol@matrix-solutions.lk",       45, 230000),
    ("Catalyst IT",               "0771200053", "it@catalyst-it.lk",             60, 390000),
    ("Synergy Tech Group",        "0771200054", "group@synergy-tech.lk",         30, 160000),
    ("Torque Systems",            "0771200055", "systems@torque-sys.lk",         45, 270000),
    ("Kinetic IT",                "0771200056", "it@kinetic-it.lk",              60, 340000),
    ("Momentum Digital",          "0771200057", "digital@momentum-dl.lk",        30, 115000),
    ("Velocity Tech",             "0771200058", "tech@velocity-tech.lk",         45, 215000),
    ("Dynamic Systems",           "0771200059", "systems@dynamic-sys.lk",        60, 410000),
    ("Elastic IT Solutions",      "0771200060", "it@elastic-sol.lk",             30, 185000),
    ("Fluid Digital",             "0771200061", "digital@fluid-dl.lk",           45, 295000),
    ("Agile Tech Services",       "0771200062", "tech@agile-tech.lk",            60, 465000),
    ("Lean IT Group",             "0771200063", "group@lean-it.lk",              30, 125000),
    ("Swift Systems",             "0771200064", "systems@swift-sys.lk",          45, 225000),
    ("Rapid Tech",                "0771200065", "tech@rapid-tech.lk",            60, 360000),
    ("Flash IT",                  "0771200066", "it@flash-it.lk",                30, 145000),
    ("Blaze Digital",             "0771200067", "digital@blaze-dl.lk",           45, 245000),
    ("Spark Technologies",        "0771200068", "tech@spark-technologies.lk",    60, 430000),
    ("Bolt Systems",              "0771200069", "systems@bolt-sys.lk",           30, 175000),
    ("Arc IT Services",           "0771200070", "it@arc-services.lk",            45, 285000),
    ("Wave Tech",                 "0771200071", "tech@wave-tech.lk",             60, 455000),
    ("Pulse Digital Works",       "0771200072", "works@pulse-dw.lk",             30, 135000),
    ("Ripple IT",                 "0771200073", "it@ripple-it.lk",               45, 235000),
    ("Surge Systems",             "0771200074", "systems@surge-sys.lk",          60, 395000),
    ("Flow Tech Group",           "0771200075", "group@flow-tech.lk",            30, 165000),
    ("Stream Digital",            "0771200076", "digital@stream-dl.lk",          45, 275000),
    ("Current IT Solutions",      "0771200077", "it@current-sol.lk",             60, 445000),
    ("Voltage Tech",              "0771200078", "tech@voltage-tech.lk",          30, 105000),
    ("Amp Digital",               "0771200079", "digital@amp-dl.lk",             45, 205000),
    ("Watt Systems",              "0771200080", "systems@watt-sys.lk",           60, 375000),
    ("Ohm IT",                    "0771200081", "it@ohm-it.lk",                  30, 155000),
    ("Joule Tech",                "0771200082", "tech@joule-tech.lk",            45, 255000),
    ("Hertz Digital",             "0771200083", "digital@hertz-dl.lk",           60, 405000),
    ("Newton Systems",            "0771200084", "systems@newton-sys.lk",         30, 195000),
    ("Pascal IT Group",           "0771200085", "group@pascal-it.lk",            45, 305000),
    ("Tesla Technologies",        "0771200086", "tech@tesla-technologies.lk",    60, 535000),
    ("Edison Digital Works",      "0771200087", "works@edison-dw.lk",            30, 112000),
    ("Faraday IT",                "0771200088", "it@faraday-it.lk",              45, 212000),
    ("Maxwell Systems",           "0771200089", "systems@maxwell-sys.lk",        60, 382000),
    ("Bohr Tech",                 "0771200090", "tech@bohr-tech.lk",             30, 152000),
    ("Planck Digital",            "0771200091", "digital@planck-dl.lk",          45, 252000),
    ("Feynman IT Solutions",      "0771200092", "it@feynman-sol.lk",             60, 422000),
    ("Hawking Technologies",      "0771200093", "tech@hawking-tech.lk",          30, 172000),
    ("Turing Digital",            "0771200094", "digital@turing-dl.lk",          45, 282000),
    ("Shannon IT Group",          "0771200095", "group@shannon-it.lk",           60, 452000),
    ("Babbage Systems",           "0771200096", "systems@babbage-sys.lk",        30, 132000),
    ("Lovelace Tech",             "0771200097", "tech@lovelace-tech.lk",         45, 232000),
    ("Knuth Digital Works",       "0771200098", "works@knuth-dw.lk",             60, 392000),
    ("Dijkstra IT",               "0771200099", "it@dijkstra-it.lk",             30, 162000),
    ("Ritchie Technologies",      "0771200100", "tech@ritchie-tech.lk",          45, 272000),
    ("Torvalds Systems",          "0771200101", "systems@torvalds-sys.lk",       60, 442000),
    ("Stallman Digital",          "0771200102", "digital@stallman-dl.lk",        30, 182000),
    ("Wozniak IT Solutions",      "0771200103", "it@wozniak-sol.lk",             45, 292000),
    ("Gates Technologies",        "0771200104", "tech@gates-technologies.lk",    60, 512000),
    ("Jobs Digital",              "0771200105", "digital@jobs-dl.lk",            30, 142000),
    ("Zuckerberg IT",             "0771200106", "it@zuckerberg-it.lk",           45, 242000),
    ("Bezos Systems",             "0771200107", "systems@bezos-sys.lk",          60, 562000),
    ("Musk Tech",                 "0771200108", "tech@musk-tech.lk",             30, 122000),
    ("Page Digital Works",        "0771200109", "works@page-dw.lk",              45, 222000),
    ("Brin IT Group",             "0771200110", "group@brin-it.lk",              60, 362000),
    ("Cook Technologies",         "0771200111", "tech@cook-tech.lk",             30, 118000),
    ("Sundar Digital",            "0771200112", "digital@sundar-dl.lk",          45, 218000),
    ("Satya IT Solutions",        "0771200113", "it@satya-sol.lk",               60, 348000),
    ("Jensen Technologies",       "0771200114", "tech@jensen-tech.lk",           30, 138000),
    ("Lisa Digital",              "0771200115", "digital@lisa-dl.lk",            45, 238000),
    ("Andy Systems",              "0771200116", "systems@andy-sys.lk",           60, 408000),
    ("Pat IT",                    "0771200117", "it@pat-it.lk",                  30, 168000),
    ("Chris Technologies",        "0771200118", "tech@chris-tech.lk",            45, 278000),
    ("Sam Digital Works",         "0771200119", "works@sam-dw.lk",               60, 448000),
    ("Jordan IT Group",           "0771200120", "group@jordan-it.lk",            30, 128000),
    ("Morgan Systems",            "0771200121", "systems@morgan-sys.lk",         45, 228000),
    ("Taylor Technologies",       "0771200122", "tech@taylor-tech.lk",           60, 388000),
    ("Riley Digital",             "0771200123", "digital@riley-dl.lk",           30, 148000),
    ("Casey IT Solutions",        "0771200124", "it@casey-sol.lk",               45, 248000),
    ("Skylar Technologies",       "0771200125", "tech@skylar-tech.lk",           60, 428000),
    ("Avery Digital",             "0771200126", "digital@avery-dl.lk",           30, 178000),
    ("Blake IT",                  "0771200127", "it@blake-it.lk",                45, 288000),
    ("Cameron Systems",           "0771200128", "systems@cameron-sys.lk",        60, 458000),
    ("Drew Technologies",         "0771200129", "tech@drew-tech.lk",             30, 108000),
    ("Emery Digital Works",       "0771200130", "works@emery-dw.lk",             45, 208000),
    ("Finley IT Group",           "0771200131", "group@finley-it.lk",            60, 358000),
    ("Gray Technologies",         "0771200132", "tech@gray-tech.lk",             30, 128000),
    ("Harley Digital",            "0771200133", "digital@harley-dl.lk",          45, 228000),
    ("Indigo IT",                 "0771200134", "it@indigo-it.lk",               60, 388000),
    ("Jules Systems",             "0771200135", "systems@jules-sys.lk",          30, 168000),
    ("Kendall Tech",              "0771200136", "tech@kendall-tech.lk",          45, 268000),
    ("Lane Digital Works",        "0771200137", "works@lane-dw.lk",              60, 438000),
    ("Marlowe IT Solutions",      "0771200138", "it@marlowe-sol.lk",             30, 188000),
    ("Noel Technologies",         "0771200139", "tech@noel-tech.lk",             45, 298000),
    ("Ora Systems",               "0771200140", "systems@ora-sys.lk",            60, 468000),
    ("Piper Digital",             "0771200141", "digital@piper-dl.lk",           30, 138000),
    ("Quest IT Group",            "0771200142", "group@quest-it.lk",             45, 238000),
    ("Reed Technologies",         "0771200143", "tech@reed-tech.lk",             60, 378000),
    ("Sloane Digital Works",      "0771200144", "works@sloane-dw.lk",            30, 158000),
    ("Tatum IT",                  "0771200145", "it@tatum-it.lk",                45, 258000),
    ("Uri Technologies",          "0771200146", "tech@uri-technologies.lk",      60, 418000),
    ("Vesper Systems",            "0771200147", "systems@vesper-sys.lk",         30, 148000),
    ("Wade Digital",              "0771200148", "digital@wade-dl.lk",            45, 248000),
    ("Xander IT Solutions",       "0771200149", "it@xander-sol.lk",              60, 418000),
    ("Yael Technologies",         "0771200150", "tech@yael-tech.lk",             30, 198000),
]


def seed_customers():
    db: Session = SessionLocal()
    try:
        print("🌱 Seeding 300 customers (150 individual + 150 business)...")

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

        # ── Individual customers ──────────────────────────────────────
        print("👤 Individual customers...")
        for (name, gender, mobile, email, credit_days, max_credit, title) in INDIVIDUAL_CUSTOMERS:
            if db.query(Customer).filter(Customer.email == email).first():
                skipped += 1
                continue
            db.add(Customer(
                title=title,
                customer_name=name,
                mobile_contact_number=mobile,
                email=email,
                gender=gender,
                civil_status="Single",
                no_of_kids="0",
                credit_days=credit_days,
                max_credit_limit=float(max_credit),
                active=True,
                is_customer_agent=False,
                date_joined=datetime.now(),
                country_id=country.id,
            ))
            created += 1

        # ── Business / corporate customers ───────────────────────────
        print("🏢 Business customers...")
        for (company, mobile, email, credit_days, max_credit) in BUSINESS_CUSTOMERS:
            if db.query(Customer).filter(Customer.email == email).first():
                skipped += 1
                continue
            db.add(Customer(
                title="Co",
                customer_name=company,
                company_name=company,
                mobile_contact_number=mobile,
                email=email,
                gender="Other",
                civil_status="Other",
                no_of_kids="0",
                credit_days=credit_days,
                max_credit_limit=float(max_credit),
                active=True,
                is_customer_agent=False,
                date_joined=datetime.now(),
                country_id=country.id,
            ))
            created += 1

        db.commit()
        print(f"✅ Done — {created} customers created, {skipped} already existed.")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_customers()

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.customers.models import Customer
from app.modules.customers.enums import CustomerType
from app.modules.common.models import Country, Approvals, Locations
from datetime import datetime, date

# Comprehensive imports for mapper resolution
from app.auth.models import Branch, Group, User, Permission
from app.modules.employees.models import Employee
from app.modules.sales.models import Invoice
from app.modules.products.models import Category, ItemsBrand, Product, MinimumPrice
from app.modules.sales.models import InvoiceItems
from app.modules.purchasing.models import (
    PurchasingOrderItems, PurchasingReturnItems,
    SupplierCreditsSettle, SupplierCreditsSettleTransaction
)
from app.modules.support.models import CSJobItem
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.warehouse.models import ItemTransferNoteItems, ItemTransferNoteItemProduct
from app.modules.customers.models import (
    CustomerCuponCodes,
    CustomerAdvancePayments, CustomerCreditNotes, CustomerCreditsSettle, CustomerCreditsSettleTransaction
)
from app.modules.finance.models import (
    BankDeposits, CardPayments, ChequePayments, CreditPayments, Vouchers, Expenses
)
from app.modules.hr.models import SalaryDeductions, Reimbursements
from app.modules.attendance.models import Leaves

def seed_customers():
    db: Session = SessionLocal()
    
    try:
        print("🌱 Seeding customers...")
        
        # 0. Ensure Country exists
        country = db.query(Country).filter(Country.iso == "US").first()
        if not country:
            # Create a default country if not exists (minimal for test)
            country = Country(
                iso="US", iso3="USA", iso_numeric=840, name="United States",
                currency_code="USD", currency_symbol="$", phone="1"
            )
            db.add(country)
            db.flush()
        
        # 1. Individual Customer
        print("👤 Checking individual customers...")
        indiv_name = "John Doe (Individual)"
        indiv = db.query(Customer).filter(Customer.customer_name == indiv_name).first()
        
        if not indiv:
            print(f"   Creating individual customer: {indiv_name}")
            indiv = Customer(
                title="Mr",
                customer_name=indiv_name,
                mobile_contact_number="555-0100",
                email="john.doe@example.com",
                
                # Required fields based on previous models view
                # gender, civil_status, no_of_kids, credit_days, max_credit_limit
                gender="Male",
                civil_status="Single",
                no_of_kids="0",
                credit_days=30,
                max_credit_limit=1000.00,
                active=True,
                is_customer_agent=False,
                date_joined=datetime.now(),
                
                # Optional
                country_id=country.id if country else None
            )
            db.add(indiv)
            db.flush()
        else:
             print(f"   Customer exists: {indiv_name}")

        # 2. Business Customer
        print("🏢 Checking business customers...")
        biz_name = "Acme Corp (Business)"
        biz = db.query(Customer).filter(Customer.customer_name == biz_name).first()
        
        if not biz:
            print(f"   Creating business customer: {biz_name}")
            biz = Customer(
                title="Ms",
                customer_name=biz_name,
                company_name="Acme Corporation",
                mobile_contact_number="555-0200",
                email="contact@acme.com",
                
                gender="Other", # Placeholder for business
                civil_status="Other",
                no_of_kids="0",
                credit_days=60,
                max_credit_limit=50000.00,
                active=True,
                is_customer_agent=False, # Not an agent
                date_joined=datetime.now(),
                
                country_id=country.id if country else None
            )
            db.add(biz)
            db.flush()
        else:
             print(f"   Customer exists: {biz_name}")

        # 3. Agent Customer
        print("🕵️ Checking agent customers...")
        agent_name = "Agent Smith"
        agent = db.query(Customer).filter(Customer.customer_name == agent_name).first()
        
        if not agent:
            print(f"   Creating agent customer: {agent_name}")
            agent = Customer(
                title="Mr",
                customer_name=agent_name,
                mobile_contact_number="555-0007",
                email="agent.smith@matrix.com",
                
                gender="Male",
                civil_status="Single",
                no_of_kids="0",
                credit_days=45,
                max_credit_limit=10000.00,
                active=True,
                is_customer_agent=True, # THIS IS THE KEY
                date_joined=datetime.now(),
                
                country_id=country.id if country else None
            )
            db.add(agent)
            db.flush()
        else:
             print(f"   Customer exists: {agent_name}")

        db.commit()
        print("✅ Customer seeding completed successfully!")

    except Exception as e:
        print(f"❌ Error seeding customers: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_customers()
