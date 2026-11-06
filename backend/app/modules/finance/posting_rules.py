"""
Posting rules — which GL account each automatic posting hits (IFS "posting control").

Every account an integration posts to is a *posting type*: a named business
meaning ("Bank", "Customer receivables", "Expense") with a built-in default
account. Finance can point a posting type at another account, optionally split
by a *control type* (the branch of the document, or the expense category),
without a code change.

Integrations keep building lines with module constants, but those constants are
:class:`PostingRef` values: a ``str`` equal to the default account code that
also carries the posting type. ``GLPostingService.post`` swaps each one for the
configured account (``PostingRuleResolver.apply``), so a posting type with no
rule posts exactly where it always did.

Resolution order for one line:
    1. rule detail for the line's control value (branch / expense category)
    2. rule account
    3. built-in default (the ``PostingRef`` value)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

# ─── Control types ───────────────────────────────────────────────────────────
CONTROL_NONE = "none"
CONTROL_BRANCH = "branch"
CONTROL_EXPENSE_CATEGORY = "expense_category"


CONTROL_TYPES: Dict[str, Dict[str, str]] = {
    CONTROL_NONE: {"name": "Same account everywhere", "description": "One account for every document."},
    CONTROL_BRANCH: {"name": "Split by branch", "description": "A different account per branch, e.g. one bank account per branch."},
    CONTROL_EXPENSE_CATEGORY: {"name": "Split by expense category", "description": "A different account per expense category."},

}


@dataclass(frozen=True)
class PostingType:
    code: str
    name: str
    group: str
    default_account: str
    account_types: Tuple[str, ...]  # COA account_type values the account may have
    description: str
    control_types: Tuple[str, ...] = (CONTROL_NONE, CONTROL_BRANCH)
    cashbook_method: Optional[str] = None  # cash/bank posting types feed the cashbook


_A, _L, _E, _R, _X = "Asset", "Liability", "Equity", "Revenue", "Expense"

_TYPES: List[PostingType] = [
    # Cash & bank
    PostingType("CASH", "Cash on hand", "Cash & Bank", "1010", (_A,), "Cash received or paid at the till.", cashbook_method="Cash"),
    PostingType("BANK", "Bank account", "Cash & Bank", "1020", (_A,), "Bank transfers, card and cheque payments, deposits.", cashbook_method="Bank Transfer"),
    PostingType("CHEQUES_IN_HAND", "Cheques in hand", "Cash & Bank", "1040", (_A,), "Customer cheques waiting to be deposited.", cashbook_method="Cheque"),
    PostingType("PETTY_CASH", "Petty cash", "Cash & Bank", "1030", (_A,), "Petty cash funds."),
    PostingType("BANK_CHARGES", "Bank charges", "Cash & Bank", "5184", (_X,), "Fees the bank takes, entered from the bank statement."),
    PostingType("BANK_INTEREST", "Bank interest received", "Cash & Bank", "4120", (_R,), "Interest the bank pays, entered from the bank statement."),
    # Receivables
    PostingType("AR_TRADE", "Customer receivables", "Receivables", "1110", (_A,), "What customers owe on credit sales."),
    PostingType("EMPLOYEE_ADVANCES", "Employee advances", "Receivables", "1130", (_A,), "Salary advances and loans owed by employees."),
    # Inventory
    PostingType("INVENTORY", "Inventory", "Inventory", "1210", (_A,), "Stock value: goods received, sold, issued to production."),
    PostingType("WIP", "Work in progress", "Inventory", "1230", (_A,), "Value of production orders not yet finished."),
    PostingType("GOODS_IN_TRANSIT", "Goods in transit", "Inventory", "1220", (_A,), "Stock moving between branches (clears when the receiving branch books it)."),
    PostingType("INVENTORY_WRITE_OFF", "Stock write-offs", "Inventory", "5186", (_X,), "Stock marked damaged or otherwise lost."),
    PostingType("COMPANY_ASSETS", "Stock used as company assets", "Inventory", "1310", (_A,), "Stock taken out of sale for the company's own use."),
    # Payables
    PostingType("AP_TRADE", "Supplier payables", "Payables", "2010", (_L,), "What the business owes suppliers."),
    PostingType("SUPPLIER_ADVANCES", "Supplier advances", "Payables", "2020", (_A,), "Money paid to suppliers before the goods arrive."),
    # Customer liabilities
    PostingType("GIFT_VOUCHERS", "Gift vouchers outstanding", "Customer balances", "2510", (_L,), "Gift vouchers sold but not yet used."),
    PostingType("CUSTOMER_ADVANCES", "Customer deposits", "Customer balances", "2520", (_L,), "Advances and coupons owed to customers."),
    PostingType("CUSTOMER_CREDIT_NOTES", "Customer credit notes", "Customer balances", "2530", (_L,), "Credit notes issued but not yet used."),
    # Tax
    PostingType("OUTPUT_VAT", "VAT payable (sales)", "Tax", "2210", (_L,), "VAT charged on sales."),
    PostingType("INPUT_VAT", "VAT receivable (purchases)", "Tax", "1140", (_A,), "VAT paid on supplier invoices, claimed back from the tax authority."),
    PostingType("VAT_SETTLEMENT", "VAT due to tax authority", "Tax", "2220", (_L, _A), "Net VAT for settled periods: what is owed to (or refunded by) the tax authority.",
                control_types=(CONTROL_NONE,)),
    # Payroll
    PostingType("SALARIES_PAYABLE", "Salaries payable", "Payroll", "2110", (_L,), "Net salaries owed to employees."),
    PostingType("EPF_PAYABLE", "EPF payable", "Payroll", "2120", (_L,), "EPF contributions owed."),
    PostingType("ETF_PAYABLE", "ETF payable", "Payroll", "2130", (_L,), "ETF contributions owed."),
    PostingType("OTHER_PAYROLL_DEDUCTIONS", "Other payroll deductions", "Payroll", "2140", (_L,), "Other amounts deducted from salaries."),
    PostingType("APIT_PAYABLE", "APIT payable", "Payroll", "2150", (_L,), "Income tax withheld from salaries."),
    PostingType("SALARIES_EXPENSE", "Salaries expense", "Payroll", "5110", (_X,), "Gross salary cost."),
    PostingType("EPF_EMPLOYER_EXPENSE", "EPF employer expense", "Payroll", "5210", (_X,), "Employer share of EPF."),
    PostingType("ETF_EMPLOYER_EXPENSE", "ETF employer expense", "Payroll", "5220", (_X,), "Employer share of ETF."),
    PostingType("COMMISSION_EXPENSE", "Commission expense", "Payroll", "5150", (_X,), "Sales commissions paid."),
    # Sales
    PostingType("CASH_SALES", "Cash sales", "Sales", "4010", (_R,), "Revenue from sales paid immediately."),
    PostingType("CREDIT_SALES", "Credit sales", "Sales", "4020", (_R,), "Revenue from sales on credit."),
    PostingType("SALES_RETURNS", "Sales returns", "Sales", "4030", (_R,), "Goods returned by customers (reduces revenue)."),
    PostingType("OTHER_INCOME", "Other income", "Sales", "4190", (_R,), "Miscellaneous income, e.g. forfeited vouchers."),
    # Costs
    PostingType("COGS", "Cost of goods sold", "Costs", "5010", (_X,), "Cost of the stock that was sold."),
    PostingType("DISCOUNT_EXPENSE", "Discounts given", "Costs", "5160", (_X,), "Discounts allowed to customers."),
    PostingType("CUSTOMER_WRITE_OFF", "Bad debts & write-offs", "Receivables", "5185", (_X,), "Customer balances written off as not collectable."),
    PostingType("PURCHASE_DISCOUNT", "Discounts received", "Payables", "4110", (_R,), "Discounts given by suppliers on their invoices."),
    PostingType(
        "EXPENSE", "Expenses", "Costs", "5190", (_X,),
        "Expenses, reimbursements and petty cash spending. Each category has its own default account.",
        control_types=(CONTROL_NONE, CONTROL_BRANCH, CONTROL_EXPENSE_CATEGORY),
    ),
    PostingType("PRODUCTION_VARIANCE", "Production variance", "Manufacturing", "5030", (_X,), "Difference between actual and standard production cost."),
    PostingType("ABSORBED_LABOUR_OVERHEAD", "Labour & overhead absorbed", "Manufacturing", "5040", (_X,), "Labour and overhead charged into production."),
    # Fixed assets
    PostingType("ACCUM_DEPRECIATION", "Accumulated depreciation", "Fixed assets", "1330", (_A,), "How much of the assets' cost has been depreciated so far."),
    PostingType("DEPRECIATION_EXPENSE", "Depreciation expense", "Fixed assets", "5170", (_X,), "The monthly cost of using up the assets."),
    PostingType("ASSET_DISPOSAL_GAIN", "Gain on asset disposal", "Fixed assets", "4130", (_R,), "An asset sold for more than its book value."),
    PostingType("ASSET_DISPOSAL_LOSS", "Loss on asset disposal", "Fixed assets", "5187", (_X,), "An asset sold or scrapped below its book value."),
    PostingType("OPENING_BALANCE_EQUITY", "Opening balance equity", "General", "3900", (_E,), "The other side of opening balances and assets already owned when the books start.", control_types=(CONTROL_NONE,)),
    # General ledger
    PostingType("ROUNDING", "Rounding difference", "General", "5900", (_X,), "Small differences of a few cents when an entry is balanced."),
    PostingType("RETAINED_EARNINGS", "Retained earnings", "General", "3100", (_E,), "Accumulated profit of previous years (year-end closing).", control_types=(CONTROL_NONE,)),
    PostingType("CURRENT_YEAR_PL", "Current year profit/loss", "General", "3200", (_E,), "This year's profit before year-end closing.", control_types=(CONTROL_NONE,)),
]

POSTING_TYPES: Dict[str, PostingType] = {t.code: t for t in _TYPES}


# ─── Expense categories ──────────────────────────────────────────────────────
# Default account per canonical category, plus the spellings the UI and HR send.
EXPENSE_CATEGORY_DEFAULTS: Dict[str, str] = {
    "utilities": "5130",
    "rent": "5120",
    "travel": "5140",
    "salaries": "5110",
    # Leaf accounts only — 5100 "Operating Expenses" is a header (parent of 5110-5190).
    "office_supplies": "5180",
    "maintenance": "5181",
    "marketing": "5182",
    "insurance": "5183",
    "miscellaneous": "5190",
    "freight": "5020",
    "commission": "5150",
    # A subcontractor's bill meets the outside work absorbed into WIP on 5040
    "outside_work": "5040",
}
EXPENSE_CATEGORY_ALIASES: Dict[str, str] = {
    "travel_transportation": "travel",
    "travel_expenses": "travel",
    "transport": "travel",
    "utilities_expenses": "utilities",
    "salary_expenses": "salaries",
    "commissions": "commission",
    "maintenance_repairs": "maintenance",
    "repairs_maintenance": "maintenance",
    "repairs": "maintenance",
    "marketing_advertising": "marketing",
    "advertising": "marketing",
    "other_expenses": "miscellaneous",
    "other": "miscellaneous",
}


def normalize_expense_category(category: Optional[str]) -> str:
    """Canonical category key ("Maintenance & Repairs" -> "maintenance").
    Unknown categories keep their own key, so a rule can still target them."""
    key = re.sub(r"[^a-z0-9]+", "_", (category or "miscellaneous").lower()).strip("_") or "miscellaneous"
    return EXPENSE_CATEGORY_ALIASES.get(key, key)


# ─── PostingRef ──────────────────────────────────────────────────────────────
class PostingRef(str):
    """An account code that remembers which posting type produced it.

    Behaves exactly like the default code string (comparisons, f-strings, dict
    keys), so existing integration code keeps working; the gateway reads
    ``posting_type`` / ``controls`` to apply the configured rule."""

    posting_type: str
    controls: Dict[str, str]

    def __new__(cls, posting_type: str, default: Optional[str] = None, **controls: str):
        if posting_type not in POSTING_TYPES:
            raise KeyError(f"Unknown posting type {posting_type!r}")
        obj = super().__new__(cls, default or POSTING_TYPES[posting_type].default_account)
        obj.posting_type = posting_type
        obj.controls = {k: v for k, v in controls.items() if v is not None}
        return obj

    def __reduce__(self):  # keep pickling/copying working
        return (PostingRef, (self.posting_type, str(self)), {"controls": self.controls})


def posting_ref(posting_type: str, **controls: str) -> PostingRef:
    return PostingRef(posting_type, **controls)


def expense_ref(category: Optional[str]) -> PostingRef:
    """EXPENSE posting for an expense / reimbursement / petty-cash category."""
    key = normalize_expense_category(category)
    default = EXPENSE_CATEGORY_DEFAULTS.get(key, POSTING_TYPES["EXPENSE"].default_account)
    return PostingRef("EXPENSE", default, expense_category=key)


# ─── Resolver ────────────────────────────────────────────────────────────────
@dataclass
class _Rule:
    control_type: str
    account_code: Optional[str]
    details: Dict[str, str] = field(default_factory=dict)


class PostingRuleResolver:
    """Loads the configured rules once and maps posting types to account codes."""

    def __init__(self, db: Session):
        self.db = db
        self._rules: Optional[Dict[str, _Rule]] = None

    def _load(self) -> Dict[str, _Rule]:
        if self._rules is None:
            from app.modules.finance.accounting_models import PostingRule, PostingRuleDetail

            rules = (
                self.db.query(PostingRule)
                .options(
                    joinedload(PostingRule.account),
                    joinedload(PostingRule.details).joinedload(PostingRuleDetail.account),
                )
                .all()
            )
            self._rules = {
                r.posting_type: _Rule(
                    control_type=r.control_type or CONTROL_NONE,
                    account_code=r.account.account_code if r.account else None,
                    details={d.control_value: d.account.account_code for d in r.details if d.account},
                )
                for r in rules
            }
        return self._rules

    def resolve(
        self,
        posting_type: str,
        *,
        default: Optional[str] = None,
        branch_code: Optional[str] = None,
        controls: Optional[Dict[str, str]] = None,
    ) -> str:
        fallback = default or POSTING_TYPES[posting_type].default_account
        rule = self._load().get(posting_type)
        if rule is None:
            return fallback
        value = None
        if rule.control_type == CONTROL_BRANCH:
            value = branch_code
        elif rule.control_type == CONTROL_EXPENSE_CATEGORY:
            value = (controls or {}).get(CONTROL_EXPENSE_CATEGORY)
        if value and value in rule.details:
            return rule.details[value]
        if rule.account_code:
            # Split by category: a category without its own detail keeps its
            # built-in account; the rule account catches the unknown ones.
            if rule.control_type == CONTROL_EXPENSE_CATEGORY and value in EXPENSE_CATEGORY_DEFAULTS:
                return fallback
            return rule.account_code
        return fallback

    def apply(self, lines: List[Dict[str, Any]], *, branch_code: Optional[str]) -> List[Dict[str, Any]]:
        """Return copies of ``lines`` with every posting-typed account resolved.

        A line is posting-typed when its ``account_code`` is a :class:`PostingRef`
        or it carries ``posting_type`` (lines re-read from a stored failure).
        Resolved lines keep ``posting_type`` / ``posting_default`` / ``controls``
        so a stored failure can be resolved again on retry."""
        out: List[Dict[str, Any]] = []
        for line in lines:
            code = line.get("account_code")
            if isinstance(code, PostingRef):
                ptype, default, controls = code.posting_type, str(code), code.controls
            elif line.get("posting_type") in POSTING_TYPES:
                ptype = line["posting_type"]
                default = line.get("posting_default") or code
                controls = line.get("controls") or {}
            else:
                out.append(line)
                continue
            resolved = dict(line)
            resolved["account_code"] = self.resolve(
                ptype, default=default, branch_code=branch_code, controls=controls
            )
            resolved["posting_type"] = ptype
            resolved["posting_default"] = default
            if controls:
                resolved["controls"] = dict(controls)
            out.append(resolved)
        return out

    def cashbook_accounts(self) -> Dict[str, str]:
        """``{account_code: cashbook payment method}`` for every account a
        cash/bank posting type can resolve to (defaults + configured rules)."""
        accounts: Dict[str, str] = {}
        # Every bank account registered for reconciliation is a bank account for the cashbook too.
        from app.modules.finance.accounting_models import BankAccount, ChartOfAccounts

        for (code,) in self.db.query(ChartOfAccounts.account_code).join(
            BankAccount, BankAccount.account_id == ChartOfAccounts.id
        ).filter(BankAccount.is_active.is_(True)).all():
            accounts.setdefault(code, "Bank Transfer")
        rules = self._load()
        for t in _TYPES:
            if not t.cashbook_method:
                continue
            accounts.setdefault(t.default_account, t.cashbook_method)
            rule = rules.get(t.code)
            if rule:
                for code in [rule.account_code, *rule.details.values()]:
                    if code:
                        accounts.setdefault(code, t.cashbook_method)
        return accounts


def resolve_account(db: Session, posting_type: str, *, branch_code: Optional[str] = None) -> str:
    """One-off resolution for service code outside the posting gateway."""
    return PostingRuleResolver(db).resolve(posting_type, branch_code=branch_code)


# ─── Voucher types ───────────────────────────────────────────────────────────
MANUAL_VOUCHER_TYPE = "MJ"

# (code, name, source module, is_manual, description) — seeded by migration s114.
VOUCHER_TYPES: List[Tuple[str, str, str, bool, str]] = [
    ("MJ", "Manual journal", "finance", True, "Journal entries typed by accountants, their reversals and corrections."),
    ("YE", "Year-end closing", "finance", False, "Closing entries that move the year's profit to retained earnings."),
    ("SALE", "Sales", "sales", False, "Sales invoices, returns, discounts, cost of sales and gift vouchers."),
    ("PUR", "Purchasing", "purchasing", False, "Goods received, landed costs, supplier payments, returns and credits."),
    ("ADV", "Supplier advances", "purchasing", False, "Advances paid to suppliers, their returns and application."),
    ("EXP", "Expenses", "finance", False, "Paid expenses and expense reclassifications."),
    ("PAY", "Payroll", "hr", False, "Monthly payroll batches."),
    ("STT", "Statutory payments", "hr", False, "EPF, ETF and APIT payments."),
    ("COM", "Commissions", "hr", False, "Sales commission payments."),
    ("RMB", "Reimbursements", "hr", False, "Employee reimbursement payments."),
    ("BNK", "Bank deposits", "finance", False, "Cash and cheques deposited to the bank."),
    ("CAD", "Customer advances", "customers", False, "Advances received from customers."),
    ("CAA", "Customer advance applied", "customers", False, "Customer advances used on invoices."),
    ("CAA-REV", "Customer advance reversed", "customers", False, "Reversal of an applied customer advance."),
    ("CCN", "Customer credit notes", "customers", False, "Credit notes issued to customers."),
    ("CST", "Customer credit settlement", "customers", False, "Customer credit balances settled."),
    ("PCF", "Petty cash funding", "finance", False, "Money moved from bank into a petty cash fund."),
    ("PCE", "Petty cash expense", "finance", False, "Expenses paid from petty cash."),
    ("PCR", "Petty cash replenishment", "finance", False, "Petty cash topped up from the bank."),
    ("PCC", "Petty cash closing", "finance", False, "Petty cash returned to the bank when a fund closes."),
    ("PCD", "Petty cash difference", "finance", False, "Shortages and overages found when counting petty cash."),
    ("MFG", "Manufacturing", "manufacturing", False, "Material issues, labour, output and production variance."),
    ("PINV", "Supplier invoices", "purchasing", False, "VAT and discounts on verified supplier invoices."),
    ("VAT", "VAT settlement", "finance", False, "Output and input VAT cleared to the tax authority account."),
    ("CHQB", "Bounced cheques", "finance", False, "Cheques returned unpaid: the amount is owed by the customer again."),
    ("STK", "Stock movements", "inventory", False, "Branch transfers, damaged stock and stock moved to company assets."),
    ("FA", "Fixed assets", "finance", False, "Asset purchases, depreciation and disposals."),
    ("OB", "Opening balances", "finance", True, "Balances brought in when the books start."),
    ("WOFF", "Customer write-offs", "finance", False, "Customer balances written off and their reversals."),
    ("BREC", "Bank statement items", "finance", False, "Bank charges, interest and other items entered from a bank statement."),
    ("AUTO", "Other automatic", "finance", False, "Automatic postings without a more specific type."),
]


def voucher_type_for_prefix(je_prefix: Optional[str]) -> str:
    """JE-SALE -> SALE; JE / JE-AUTO -> AUTO."""
    code = (je_prefix or "").upper()
    if code.startswith("JE-"):
        code = code[3:]
    elif code == "JE":
        code = ""
    return (code or "AUTO")[:20]
