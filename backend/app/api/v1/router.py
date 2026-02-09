from app.api.v1 import health
from app.auth.api import router as auth_router
from app.modules.branches.api import router as branches_router
from app.modules.common.api import router as common_router
from app.modules.customers.api import router as customers_router
from app.modules.customers.commission_api import router as commissions_router
from app.modules.employees.api import router as employees_router
from app.modules.finance.api import router as finance_router
from app.modules.groups.api import router as groups_router
from app.modules.hr.api import router as hr_router
from app.modules.inventory.api import router as inventory_router
from app.modules.permissions.api import router as permissions_router
from app.modules.products.api import router as products_router
from app.modules.purchasing.api import router as purchasing_router
from app.modules.reporting.api import router as reporting_router
from app.modules.sales.api import router as sales_router
from app.modules.sales.quotation_api import router as quotation_router
from app.modules.settings.api import router as settings_router
from app.modules.support.api import router as support_router
from app.modules.users.api import router as users_router
from app.modules.warehouse.api import router as warehouse_router
from fastapi import APIRouter

api_router = APIRouter()


api_router.include_router(auth_router, prefix="/auth", tags=["auth"])

api_router.include_router(users_router)
api_router.include_router(groups_router)
api_router.include_router(permissions_router)

api_router.include_router(commissions_router, prefix="/customers/commissions", tags=["agent-commissions"])
api_router.include_router(customers_router, prefix="/customers", tags=["customers"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["inventory"])
api_router.include_router(products_router, prefix="/inventory", tags=["inventory"])
api_router.include_router(sales_router, prefix="/sales", tags=["sales"])
api_router.include_router(
    quotation_router, prefix="/sales/quotes", tags=["sales-quotes"]
)
api_router.include_router(purchasing_router)
api_router.include_router(finance_router)
api_router.include_router(hr_router)
api_router.include_router(warehouse_router)
api_router.include_router(support_router)
api_router.include_router(reporting_router)
api_router.include_router(settings_router)
api_router.include_router(common_router)
api_router.include_router(employees_router, prefix="/employees", tags=["employees"])
api_router.include_router(branches_router, prefix="/branches", tags=["branches"])

api_router.include_router(health.router, prefix="/health", tags=["health"])
