# TijaeroERP — Engineering Standards

This document defines the **mandatory rules** for any code that touches
the TijaeroERP codebase. It maps to sections 2.1 – 2.6 of the engineering
review and is the canonical reference for new modules and code reviews.

> 🔒 = a rule whose violation is a **bug** (financial, audit, security).
> 🧹 = a rule for maintainability / clean code.

---

## 2.1 Financial Integrity 🔒

ERP money handling is unforgiving. These rules apply everywhere:
invoices, payments, GRNs, advances, GL postings, expense reports, payroll.

| # | Rule | How to follow it |
|---|------|------------------|
| F1 | **Use `Decimal`, never `float`, for money** | All amounts pass through `app.core.money.D()` / `money()`. ORM columns: `Numeric(18, 2)`. Never call `float(x)` on monetary values inside business logic — only at the JSON boundary if absolutely required. |
| F2 | **Quantize at boundaries** | Use `money(value)` (2 dp, `ROUND_HALF_UP`) before persisting or returning a monetary value. |
| F3 | **Compare with tolerance** | Use `amounts_equal(a, b)` instead of `a == b`. |
| F4 | **Every GL posting must balance** | Call `app.core.gl_guard.assert_balanced(lines)` before flushing the JE. Sum of debits == sum of credits. |
| F5 | **Idempotent GL postings** | Call `assert_not_already_posted(db, source_type, source_id)` before creating a JE for a source document. Re-posts must go through an explicit reversal. |
| F6 | **Closed periods are immutable** | Call `app.core.period_guard.assert_period_open(db, txn_date, document="...")` in every service method that records a financial event (invoice create/cancel, payment record, GRN GL hook, expense post, JE create). |
| F7 | **Single calculator per document** | All "outstanding / paid / advance" math for a document type lives in **one** function (e.g. `purchasing.credit_service._get_non_credit_purchase_orders`). UI never recomputes server-truth values. |
| F8 | **Wrap a financial operation in one DB transaction** | Repository operations that span multiple writes (e.g. PO + GL + audit + balance refresh) commit once, at the end. Use `db.flush()` between steps, not `db.commit()`. |
| F9 | **Never `UPDATE` a posted journal entry** | Reverse + re-post. Never edit a row whose `status == "posted"`. |

### Code template — posting an event to GL

```python
from app.core.gl_guard import assert_balanced, assert_not_already_posted
from app.core.period_guard import assert_period_open
from app.core.money import money

def post_grn_to_gl(self, grn, user_id: int) -> JournalEntry:
    assert_period_open(self.db, grn.good_received_date, document="GRN")
    assert_not_already_posted(self.db, "grn", grn.id)

    lines = self._build_grn_lines(grn)        # returns list[JELine]
    assert_balanced(lines)

    je = JournalEntry(
        ...,
        total_debit=money(sum(l.debit_amount for l in lines)),
        total_credit=money(sum(l.credit_amount for l in lines)),
        created_by=user_id,
    )
    self.db.add(je)
    for l in lines:
        l.journal_entry_id = je.id
        self.db.add(l)
    self.db.flush()
    return je
```

---

## 2.2 Auditability 🔒

Every change to a financial / configurable entity must be attributable.

| # | Rule | How to follow it |
|---|------|------------------|
| A1 | **`created_by` / `updated_by` on every domain table** | Inherit from `app.common.base_models.AuditMixin`. Never set these to hardcoded `0` or `1` — always pass `current_user.id`. |
| A2 | **Service methods accept `user_id`** | Public service methods that mutate state must take `user_id: int` (or `Optional[int]` only for genuinely system-triggered flows, with an explanatory comment — *not* a `# TODO`). |
| A3 | **API endpoints inject `current_user`** | Always: `current_user: User = Depends(require_permission(*Permissions.X_Y))`. Pass `current_user.id` down to the service. |
| A4 | **Audit log on sensitive operations** | Use `app.common.audit.log_audit(db, user_id, action, entity_type, entity_id, changes={...})`. Mandatory for: approvals, payments, GL postings, period close, permission changes, supplier credit limit changes. |
| A5 | **Append-only journals** | `journal_entries` and `general_ledger` rows are never deleted. Reversals create new rows with `entry_type = "reversal"`. |
| A6 | **No `# TODO: Get current user`** | Forbidden. CI grep should fail the build. |

---

## 2.3 Authorisation 🔒

| # | Rule | How to follow it |
|---|------|------------------|
| Z1 | **Every mutating endpoint declares a permission** | `Depends(require_permission(*Permissions.RESOURCE_ACTION))`. Read endpoints declare `_VIEW`. Endpoints that have no `Depends` for permissions are bugs. |
| Z2 | **Add new permissions to `auth.rbac.Permissions`** | Single registry. After adding, run the seed/init script so DB rows match. |
| Z3 | **Branch scoping on every multi-branch query** | Inject `branch_codes = Depends(get_user_branch_filter)`. If the value is `None` the user is a superuser; otherwise filter by `Model.branch_code.in_(branch_codes)`. |
| Z4 | **Cross-branch writes blocked at service** | When operating on an existing record, call `validate_branch_access(current_user, record.branch_code)` before mutating. Don't trust the URL. |
| Z5 | **Superuser is not a free pass to closed periods** | Period guard, balanced-JE guard, and idempotency guards ignore superuser status. |

---

## 2.4 Concurrency 🔒

PostgreSQL races and double-clicks are real. Use:

| # | Rule | How to follow it |
|---|------|------------------|
| C1 | **Lock the row before mutating it** | `app.core.concurrency.lock_row(db, Model, pk)` (= `SELECT … FOR UPDATE`). Required for: PO/GRN/Invoice status changes, supplier credit balance updates, sales-stock status flips, advance application. |
| C2 | **Document-number generation uses an advisory lock** | `app.core.concurrency.advisory_xact_lock(db, "po-2026")`. Already used in `repository.py`; new generators must follow. |
| C3 | **Backstop with a unique DB constraint** | `unique=True` on `invoice_no`, `po_no`, `grn_no`, `journal_entry_no`, `advance_no` — even if generation is locked. |
| C4 | **Single transaction per business operation** | Don't `commit()` mid-flow. Holding a row lock across the whole transaction is what makes C1 work. |
| C5 | **Idempotency keys for external-trigger endpoints** | Webhooks / payment gateway callbacks must accept and check an idempotency key. |

---

## 2.5 Data Validation 🔒 + 🧹

Validate at the **schema layer**, not in pages or service bodies.

| # | Rule | How to follow it |
|---|------|------------------|
| V1 | **Reuse `app.common.validators`** | `non_negative_money`, `positive_money`, `non_negative_quantity`, `positive_quantity`, `not_in_future`, `trimmed_non_empty`. Apply with `field_validator`. |
| V2 | **Quantity / price rules on every line schema** | GRN qty ≥ 0, unit price ≥ 0, GRN qty ≤ remaining PO qty (model-level check in service). |
| V3 | **Date rules** | Posting date may not be in the future; cheque date must be parseable; period must be open (F6). |
| V4 | **Currency consistency** | Reject documents that mix currencies. (Today TijaeroERP is single-currency LKR — explicitly assert it where currency fields appear.) |
| V5 | **Branch code must be active** | Use `app.common.branch_validation.validate_branch_is_active(db, code)`. |
| V6 | **No silent coercion** | Replace bare `except:` and `except: pass` with a typed exception or `logger.exception(...)`. |
| V7 | **Pydantic models for both request and response** | No `dict[str, Any]` request bodies. No raw ORM objects returned without a response model. |

### Code template — schema with validators

```python
from pydantic import BaseModel, field_validator
from app.common.validators import positive_quantity, non_negative_money, not_in_future

class GRNItemCreate(BaseModel):
    product_id: int
    quantity: float
    unit_price: float
    grn_date: date

    _q = field_validator("quantity")(positive_quantity)
    _p = field_validator("unit_price")(non_negative_money)
    _d = field_validator("grn_date")(not_in_future)
```

---

## 2.6 Reporting & Logging 🔒 + 🧹

| # | Rule | How to follow it |
|---|------|------------------|
| R1 | **Use `logging`, never `print()`** | `logger = logging.getLogger(__name__)` at the top of every module. `logger.exception(...)` inside `except:` blocks. |
| R2 | **Never silently swallow exceptions** | `except Exception:` is allowed only when paired with a `logger.warning(..., exc_info=True)` or `logger.exception(...)`. Bare `except:` is forbidden. |
| R3 | **Reports are deterministic** | Always `ORDER BY` on a stable key, always paginate with `skip/limit`, always snapshot the filter set in the response so the caller knows what they got. |
| R4 | **Reports never mutate state** | `GET` endpoints don't write. If a report needs derived data, materialise it via a separate post step. |
| R5 | **Filters validated** | Date ranges, statuses, and IDs are validated by Pydantic — no raw string concatenation into SQL. |
| R6 | **Money/qty in reports goes through `format_money`** | UI helpers render via the same formatter so totals always match. |
| R7 | **Long-running reports are async** | If a report exceeds ~3 s, move it to a background job and return a job id; don't block the HTTP worker. |

---

## Quick checklist for any new endpoint

1. Permission declared via `require_permission(*Permissions.X_Y)`.
2. Branch access enforced (filter for reads, validate for writes).
3. Period guard called for any financial event.
4. `current_user.id` threaded into the service call.
5. Pydantic schema validates inputs (quantities, money, dates, strings).
6. Service uses `Decimal` end-to-end and `money()` at boundaries.
7. Mutations occur inside one DB transaction with row-locks where needed.
8. GL postings call `assert_balanced` + `assert_not_already_posted`.
9. Audit log written for sensitive actions.
10. No `print(...)`, no bare `except:`, no `# TODO: current user`.

---

## Where the primitives live

| Concern | Module |
|---|---|
| Decimal / money | `app.core.money` |
| GL balance + idempotency | `app.core.gl_guard` |
| Period open/closed | `app.core.period_guard` |
| Row + advisory locks | `app.core.concurrency` |
| Pydantic validators | `app.common.validators` |
| Audit log | `app.common.audit` |
| Branch scoping | `app.common.branch_validation`, `app.auth.dependencies.get_user_branch_filter` |
| RBAC | `app.auth.rbac.Permissions`, `require_permission` |
| Document numbers | `app.common.sequences`, `repository.py` per module |

---

*Owner: Backend Lead. Last updated: April 2026.*
