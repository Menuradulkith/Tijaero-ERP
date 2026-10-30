"""Manufacturing endpoints (/manufacturing/...).

work-centers   master data
boms           bills of materials with routing, cost roll-up, versioning
orders         production orders: lifecycle, material issue / return, output, time
job-cards      open operations for the shop floor
mrp            demand-driven requirements planning, firming into PO / production orders
reorder-rules  min / max stock levels per product and branch
quote-demand   open quotation lines for make-to-order production
dashboard      KPIs
"""
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_user_branch_filter, validate_branch_access
from app.auth.models import User
from app.auth.rbac import Permissions, require_any_permission, require_permission, user_has_permission
from app.db.session import get_db
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.planning import MrpService, ReorderRuleService, quote_demand_lines
from app.modules.manufacturing.service import (
    BOMService,
    PlanningService,
    ProductionOrderService,
    WorkCenterService,
)

RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]
OptQueryId = Annotated[Optional[int], Query(ge=1, le=2_147_483_647)]

router = APIRouter(prefix="/manufacturing", tags=["manufacturing"])

# Masters are read by every manufacturing screen
WC_READ = Depends(require_any_permission(Permissions.WORK_CENTER_VIEW, Permissions.BOM_VIEW,
                                         Permissions.PRODUCTION_ORDER_VIEW, Permissions.SHOP_FLOOR_VIEW))
BOM_READ = Depends(require_any_permission(Permissions.BOM_VIEW, Permissions.PRODUCTION_ORDER_VIEW))
ORDER_READ = require_any_permission(Permissions.PRODUCTION_ORDER_VIEW, Permissions.SHOP_FLOOR_VIEW)


def _scope(branches: Optional[List[str]], branch_code: Optional[str]) -> Optional[List[str]]:
    """The user's branch scope narrowed to ``branch_code`` when one is asked for."""
    if branch_code:
        if branches is not None and branch_code not in branches:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")
        return [branch_code]
    return branches


def _branch_access(user: User, branch_code: str) -> None:
    if not validate_branch_access(user, branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")


def _also_needs(user: User, perm: tuple) -> None:
    if not user_has_permission(user, *perm):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Permission denied. Required: {perm[0]}:{perm[1]}")


def _order_access(db: Session, user: User, order_id: int) -> None:
    order = ProductionOrderService(db).get(order_id)
    if not validate_branch_access(user, order.branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {order.branch_code}")


# ═══════════════════════════ work centers ═══════════════════════════
@router.get("/work-centers", response_model=List[s.WorkCenterOut], dependencies=[WC_READ])
def list_work_centers(q: Optional[str] = Query(None, max_length=100), active: Optional[bool] = None,
                      db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return WorkCenterService(db).list(q, active, branches)


@router.get("/work-centers/{wc_id}", response_model=s.WorkCenterOut, dependencies=[WC_READ])
def get_work_center(wc_id: RowId, db: Session = Depends(get_db)):
    return WorkCenterService(db).get_out(wc_id)


@router.post("/work-centers", response_model=s.WorkCenterOut, status_code=201)
def create_work_center(data: s.WorkCenterIn, db: Session = Depends(get_db),
                       user: User = Depends(require_permission(*Permissions.WORK_CENTER_CREATE))):
    return WorkCenterService(db).create(data, user.id)


@router.put("/work-centers/{wc_id}", response_model=s.WorkCenterOut)
def update_work_center(wc_id: RowId, data: s.WorkCenterUpdate, db: Session = Depends(get_db),
                       user: User = Depends(require_permission(*Permissions.WORK_CENTER_UPDATE))):
    return WorkCenterService(db).update(wc_id, data, user.id)


@router.delete("/work-centers/{wc_id}", status_code=204)
def delete_work_center(wc_id: RowId, db: Session = Depends(get_db),
                       user: User = Depends(require_permission(*Permissions.WORK_CENTER_DELETE))):
    WorkCenterService(db).delete(wc_id, user.id)


# ═══════════════════════════ BOMs ═══════════════════════════
@router.get("/boms", response_model=List[s.BOMOut], dependencies=[BOM_READ])
def list_boms(q: Optional[str] = Query(None, max_length=100),
              status_: Optional[Literal["draft", "active", "archived"]] = Query(None, alias="status"),
              product_id: OptQueryId = None, db: Session = Depends(get_db)):
    return BOMService(db).list(q, status_, product_id)


@router.get("/boms/{bom_id}", response_model=s.BOMOut, dependencies=[BOM_READ])
def get_bom(bom_id: RowId, db: Session = Depends(get_db)):
    return BOMService(db).get_out(bom_id)


@router.post("/boms", response_model=s.BOMOut, status_code=201)
def create_bom(data: s.BOMIn, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.BOM_CREATE))):
    return BOMService(db).create(data, user.id)


@router.put("/boms/{bom_id}", response_model=s.BOMOut)
def update_bom(bom_id: RowId, data: s.BOMUpdate, db: Session = Depends(get_db),
               user: User = Depends(require_permission(*Permissions.BOM_UPDATE))):
    return BOMService(db).update(bom_id, data, user.id)


@router.delete("/boms/{bom_id}", status_code=204)
def delete_bom(bom_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.BOM_DELETE))):
    BOMService(db).delete(bom_id, user.id)


@router.post("/boms/{bom_id}/activate", response_model=s.BOMOut)
def activate_bom(bom_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.BOM_UPDATE))):
    return BOMService(db).activate(bom_id, user.id)


@router.post("/boms/{bom_id}/set-default", response_model=s.BOMOut)
def set_default_bom(bom_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.BOM_UPDATE))):
    return BOMService(db).set_default(bom_id, user.id)


@router.post("/boms/{bom_id}/archive", response_model=s.BOMOut)
def archive_bom(bom_id: RowId, db: Session = Depends(get_db), user: User = Depends(require_permission(*Permissions.BOM_UPDATE))):
    return BOMService(db).archive(bom_id, user.id)


@router.post("/boms/{bom_id}/copy", response_model=s.BOMOut, status_code=201)
def copy_bom(bom_id: RowId, data: s.BOMCopyIn, db: Session = Depends(get_db),
             user: User = Depends(require_permission(*Permissions.BOM_CREATE))):
    return BOMService(db).copy(bom_id, data, user.id)


@router.post("/boms/{bom_id}/update-product-cost", response_model=s.BOMOut)
def update_product_cost(bom_id: RowId, db: Session = Depends(get_db),
                        user: User = Depends(require_permission(*Permissions.BOM_UPDATE))):
    return BOMService(db).update_product_cost(bom_id, user.id)


# ═══════════════════════════ production orders ═══════════════════════════
@router.get("/orders", response_model=s.ProductionOrderPage)
def list_orders(q: Optional[str] = Query(None, max_length=100), status_: Optional[List[str]] = Query(None, alias="status"),
                branch_code: Optional[str] = Query(None, max_length=200), product_id: OptQueryId = None,
                late_only: bool = False, page: int = Query(1, ge=1, le=100000), size: int = Query(50, ge=1, le=500),
                db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter),
                _user: User = Depends(ORDER_READ)):
    return ProductionOrderService(db).list(q=q, status_=status_, branch_codes=_scope(branches, branch_code),
                                           product_id=product_id, late_only=late_only, page=page, size=size)


@router.get("/orders/{order_id}", response_model=s.ProductionOrderOut)
def get_order(order_id: RowId, db: Session = Depends(get_db), user: User = Depends(ORDER_READ)):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).get_out(order_id)


@router.get("/orders/{order_id}/activity", response_model=s.OrderActivityOut)
def get_order_activity(order_id: RowId, db: Session = Depends(get_db), user: User = Depends(ORDER_READ)):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).activity(order_id)


@router.post("/orders", response_model=s.ProductionOrderOut, status_code=201)
def create_order(data: s.ProductionOrderIn, db: Session = Depends(get_db),
                 user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_CREATE))):
    if not validate_branch_access(user, data.branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {data.branch_code}")
    return ProductionOrderService(db).create(data, user.id)


@router.post("/orders/from-quote", response_model=s.ProductionOrderOut, status_code=201)
def create_order_from_quote(data: s.FromQuoteIn, db: Session = Depends(get_db),
                            user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_CREATE))):
    """Make-to-order: a production order for an open line of an approved quotation."""
    from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
    branch = (db.query(SalesQuote.branch_code).join(SalesQuoteItem, SalesQuoteItem.quote_id == SalesQuote.id)
              .filter(SalesQuoteItem.id == data.quote_item_id).scalar())
    if branch:
        _branch_access(user, branch)
    return ProductionOrderService(db).create_from_quote_item(data, user.id)


@router.get("/quote-demand", response_model=List[s.QuoteDemandOut],
            dependencies=[Depends(require_any_permission(Permissions.PRODUCTION_ORDER_CREATE, Permissions.MRP_VIEW))])
def quote_demand(q: Optional[str] = Query(None, max_length=100), branch_code: Optional[str] = Query(None, max_length=200),
                 manufactured_only: bool = True, db: Session = Depends(get_db),
                 branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    """Open lines of approved quotations with what is left to produce for each."""
    return quote_demand_lines(db, branch_codes=_scope(branches, branch_code), q=q, manufactured_only=manufactured_only)


@router.put("/orders/{order_id}", response_model=s.ProductionOrderOut)
def update_order(order_id: RowId, data: s.ProductionOrderUpdate, db: Session = Depends(get_db),
                 user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_UPDATE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).update(order_id, data, user.id)


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(order_id: RowId, db: Session = Depends(get_db),
                 user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_DELETE))):
    _order_access(db, user, order_id)
    ProductionOrderService(db).delete(order_id, user.id)


@router.post("/orders/{order_id}/release", response_model=s.ProductionOrderOut)
def release_order(order_id: RowId, db: Session = Depends(get_db),
                  user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_APPROVE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).release(order_id, user.id)


@router.post("/orders/{order_id}/start", response_model=s.ProductionOrderOut)
def start_order(order_id: RowId, db: Session = Depends(get_db),
                user: User = Depends(require_permission(*Permissions.SHOP_FLOOR_UPDATE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).start(order_id, user.id)


@router.post("/orders/{order_id}/issue-materials", response_model=s.ProductionOrderOut)
def issue_materials(order_id: RowId, data: s.MaterialMoveIn, db: Session = Depends(get_db),
                    user: User = Depends(require_permission(*Permissions.SHOP_FLOOR_UPDATE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).issue_materials(order_id, data, user.id)


@router.post("/orders/{order_id}/return-materials", response_model=s.ProductionOrderOut)
def return_materials(order_id: RowId, data: s.MaterialMoveIn, db: Session = Depends(get_db),
                     user: User = Depends(require_permission(*Permissions.SHOP_FLOOR_UPDATE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).return_materials(order_id, data, user.id)


@router.post("/orders/{order_id}/output", response_model=s.ProductionOrderOut)
def record_output(order_id: RowId, data: s.OutputIn, db: Session = Depends(get_db),
                  user: User = Depends(require_permission(*Permissions.SHOP_FLOOR_UPDATE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).record_output(order_id, data, user.id)


@router.post("/orders/{order_id}/time-logs", response_model=s.ProductionOrderOut)
def log_time(order_id: RowId, data: s.TimeLogIn, db: Session = Depends(get_db),
             user: User = Depends(require_permission(*Permissions.SHOP_FLOOR_UPDATE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).log_time(order_id, data, user.id)


@router.post("/orders/{order_id}/complete", response_model=s.ProductionOrderOut)
def complete_order(order_id: RowId, db: Session = Depends(get_db),
                   user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_APPROVE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).complete(order_id, user.id)


@router.post("/orders/{order_id}/close", response_model=s.ProductionOrderOut)
def close_order(order_id: RowId, db: Session = Depends(get_db),
                user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_APPROVE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).close(order_id, user.id)


@router.post("/orders/{order_id}/cancel", response_model=s.ProductionOrderOut)
def cancel_order(order_id: RowId, data: s.CancelIn, db: Session = Depends(get_db),
                 user: User = Depends(require_permission(*Permissions.PRODUCTION_ORDER_APPROVE))):
    _order_access(db, user, order_id)
    return ProductionOrderService(db).cancel(order_id, data, user.id)


# ═══════════════════════════ shop floor / planning ═══════════════════════════
@router.get("/job-cards", response_model=List[s.JobCardOut],
            dependencies=[Depends(require_permission(*Permissions.SHOP_FLOOR_VIEW))])
def job_cards(work_center_id: OptQueryId = None, branch_code: Optional[str] = Query(None, max_length=200),
              include_completed: bool = False, db: Session = Depends(get_db),
              branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return PlanningService(db).job_cards(work_center_id=work_center_id, branch_codes=_scope(branches, branch_code),
                                         include_completed=include_completed)


@router.get("/operators", dependencies=[Depends(require_permission(*Permissions.SHOP_FLOOR_VIEW))])
def operators(db: Session = Depends(get_db)):
    """Active employees, for booking job-card time."""
    from app.modules.employees.models import Employee
    from app.modules.hr_core.service import LIVE_STATUSES
    out = []
    for e in db.query(Employee).filter(Employee.status.in_(LIVE_STATUSES)).order_by(Employee.employee_id).all():
        u = e.user
        name = (f"{u.first_name or ''} {u.last_name or ''}".strip() if u else "") or e.employee_id
        out.append({"id": e.id, "employee_id": e.employee_id, "name": name})
    return out


@router.get("/mrp", response_model=List[s.MrpLineOut], dependencies=[Depends(require_permission(*Permissions.MRP_VIEW))])
def mrp(branch_code: Optional[str] = Query(None, max_length=200), shortages_only: bool = False,
        db: Session = Depends(get_db), branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return MrpService(db).run(branch_codes=_scope(branches, branch_code), shortages_only=shortages_only)


@router.post("/mrp/purchase-orders", response_model=s.MrpFirmResult, status_code=201)
def mrp_purchase_orders(data: s.MrpPurchaseIn, db: Session = Depends(get_db),
                        user: User = Depends(require_permission(*Permissions.MRP_UPDATE))):
    """Firm purchase suggestions: one purchase order per supplier, sent for the usual PO approval."""
    _also_needs(user, Permissions.PURCHASE_ORDER_CREATE)
    _branch_access(user, data.branch_code)
    return MrpService(db).create_purchase_orders(data, user.id)


@router.post("/mrp/production-orders", response_model=s.MrpFirmResult, status_code=201)
def mrp_production_orders(data: s.MrpProduceIn, db: Session = Depends(get_db),
                          user: User = Depends(require_permission(*Permissions.MRP_UPDATE))):
    """Firm production suggestions into draft production orders."""
    _also_needs(user, Permissions.PRODUCTION_ORDER_CREATE)
    _branch_access(user, data.branch_code)
    return MrpService(db).create_production_orders(data, user.id)


@router.get("/reorder-rules", response_model=List[s.ReorderRuleOut],
            dependencies=[Depends(require_permission(*Permissions.MRP_VIEW))])
def list_reorder_rules(q: Optional[str] = Query(None, max_length=100), branch_code: Optional[str] = Query(None, max_length=200),
                       active: Optional[bool] = None, db: Session = Depends(get_db),
                       branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return ReorderRuleService(db).list(q=q, branch_codes=_scope(branches, branch_code), active=active)


@router.post("/reorder-rules", response_model=s.ReorderRuleOut, status_code=201)
def create_reorder_rule(data: s.ReorderRuleIn, db: Session = Depends(get_db),
                        user: User = Depends(require_permission(*Permissions.MRP_UPDATE))):
    _branch_access(user, data.branch_code)
    return ReorderRuleService(db).create(data, user.id)


@router.put("/reorder-rules/{rule_id}", response_model=s.ReorderRuleOut)
def update_reorder_rule(rule_id: RowId, data: s.ReorderRuleUpdate, db: Session = Depends(get_db),
                        user: User = Depends(require_permission(*Permissions.MRP_UPDATE))):
    _branch_access(user, ReorderRuleService(db).get(rule_id).branch_code)
    return ReorderRuleService(db).update(rule_id, data, user.id)


@router.delete("/reorder-rules/{rule_id}", status_code=204)
def delete_reorder_rule(rule_id: RowId, db: Session = Depends(get_db),
                        user: User = Depends(require_permission(*Permissions.MRP_UPDATE))):
    _branch_access(user, ReorderRuleService(db).get(rule_id).branch_code)
    ReorderRuleService(db).delete(rule_id, user.id)


@router.get("/dashboard", response_model=s.ManufacturingDashboardOut,
            dependencies=[Depends(require_permission(*Permissions.MANUFACTURING_DASHBOARD_VIEW))])
def dashboard(branch_code: Optional[str] = Query(None, max_length=200), db: Session = Depends(get_db),
              branches: Optional[List[str]] = Depends(get_user_branch_filter)):
    return PlanningService(db).dashboard(branch_codes=_scope(branches, branch_code))
