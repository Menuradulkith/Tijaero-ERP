"""Expense payment UX fixes (2026-11-07 review): a cash payment needs cash in
the till, people's names instead of user ids, the "pay" event in the history,
and the old "expense method" follows the category."""

from __future__ import annotations


from tests.cash_helpers import give_branch_cash

F = "/api/v1/finance"


def _approved_expense(client, branch, amount="500.00", category="utilities"):
    e = client.post(F + "/expenses", json={
        "expense_category": category, "expense_amount": amount,
        "branch_code": branch.branch_code, "vendor_name": "CEB", "description": "bill"})
    assert e.status_code in (200, 201), e.text
    eid = e.json()["id"]
    assert client.post(f"{F}/expenses/{eid}/submit").status_code == 200
    assert client.post(f"{F}/expenses/{eid}/approve", json={}).status_code == 200
    return e.json(), eid


def test_cash_payment_refused_when_till_is_short(db, superclient, make_branch):
    branch = make_branch()
    _, eid = _approved_expense(superclient, branch, "500.00")
    r = superclient.post(f"{F}/expenses/{eid}/process-payment", json={"payment_method": "cash"})
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == (
        f"Only Rs. 0.00 cash at {branch.branch_code}. Pay by bank, or deposit cash first."
    )
    # nothing paid
    assert superclient.get(f"{F}/expenses/{eid}").json()["status"] == "approved"

    # with only part of it in the till it is still refused, and says how much is there
    give_branch_cash(db, branch.branch_code, "200.00")
    r = superclient.post(f"{F}/expenses/{eid}/process-payment", json={"payment_method": "cash"})
    assert r.status_code == 400 and "Only Rs. 200.00 cash" in r.json()["detail"], r.text


def test_cash_payment_goes_through_with_cash_and_bank_never_checks_cash(db, superclient, make_branch):
    branch = make_branch()
    give_branch_cash(db, branch.branch_code, "500.00")
    _, eid = _approved_expense(superclient, branch, "500.00")
    r = superclient.post(f"{F}/expenses/{eid}/process-payment", json={"payment_method": "cash"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"

    _, eid2 = _approved_expense(superclient, branch, "900.00")  # till now empty
    r = superclient.post(f"{F}/expenses/{eid2}/process-payment",
                         json={"payment_method": "bank_transfer", "payment_reference": "TRF-1"})
    assert r.status_code == 200, r.text


def test_names_and_paid_event_in_history(db, superclient, superuser, make_branch):
    branch = make_branch()
    give_branch_cash(db, branch.branch_code, "100.00")
    created, eid = _approved_expense(superclient, branch, "100.00")
    paid = superclient.post(f"{F}/expenses/{eid}/process-payment",
                            json={"payment_method": "cash"})
    assert paid.status_code == 200, paid.text
    body = paid.json()
    user = superuser[0]
    expected = f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username
    assert body["submitted_by_name"] == expected and body["approved_by_name"] == expected, body
    listed = superclient.get(F + "/expenses", params={"branch_code": branch.branch_code}).json()["items"]
    assert listed[0]["approved_by_name"] == expected, listed[0]

    history = superclient.get("/api/v1/common/activity-log",
                              params={"entity_type": "expense", "entity_id": eid}).json()
    actions = [h["action"] for h in history]
    assert "pay" in actions, actions


def test_expense_method_follows_category(superclient, make_branch):
    branch = make_branch()
    created, eid = _approved_expense(superclient, branch, "10.00", category="utilities")
    assert created["expenses_method"] == "utilities_expenses"
    e = superclient.post(F + "/expenses", json={
        "expense_category": "office_supplies", "expenses_method": "meal_expenses", "expense_amount": "5",
        "branch_code": branch.branch_code, "vendor_name": "X"})
    assert e.json()["expenses_method"] == "other_expenses"  # derived, not taken from the client
    r = superclient.put(f"{F}/expenses/{e.json()['id']}", json={"expense_category": "travel_transportation"})
    assert r.status_code == 200 and r.json()["expenses_method"] == "travel_expenses", r.text


def test_bank_payment_credits_the_chosen_bank_account(db, superclient, make_branch):
    """Paying from a registered bank account books the money out of THAT bank."""
    from datetime import date, timedelta
    from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
    branch = make_branch()
    _, eid = _approved_expense(superclient, branch)
    bank = superclient.post("/api/v1/finance/accounting/bank-accounts", json={
        "name": "QA second bank", "bank_name": "HNB", "account_number": "777",
        "reconcile_from": str(date.today() - timedelta(days=5))}).json()
    r = superclient.post(f"/api/v1/finance/expenses/{eid}/process-payment",
                         json={"payment_method": "bank_transfer", "payment_reference": "TRF-9", "bank_account_id": bank["id"]})
    assert r.status_code == 200, r.text
    credited = {code for code, cr in db.query(ChartOfAccounts.account_code, GeneralLedger.credit_amount)
                .join(GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id)
                .filter(GeneralLedger.reference_type == "Expense", GeneralLedger.reference_id == eid,
                        GeneralLedger.credit_amount > 0)}
    assert credited == {bank["account_code"]}, credited
