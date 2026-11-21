from enum import Enum

class CustomerType(str, Enum):
    INDIVIDUAL = "individual"
    BUSINESS = "business"


class CustomerCategory(str, Enum):
    """Where the customer is in the sales relationship."""
    CUSTOMER = "customer"
    PROSPECT = "prospect"          # prospect customer: not buying yet
    END_CUSTOMER = "end_customer"  # end customer (final consumer)


class CustomerAccountingGroup(str, Enum):
    """Receivables group used to group customers for accounting and reporting
    (cf. IFS customer accounting group / SAP customer account group)."""
    LOCAL_TRADE = "local_trade"
    FOREIGN_TRADE = "foreign_trade"
    RELATED_PARTY = "related_party"
    GOVERNMENT = "government"
    OTHER = "other"
