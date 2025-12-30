from fastapi import APIRouter
from app.auth.api import router as auth_router
from app.api.v1 import users, groups, permissions, health
from app.modules.customers.api import router as customers_router
from app.modules.products.api import router as products_router
from app.modules.employees.api import router as employees_router
from app.modules.branches.api import router as branches_router
from app.modules.sales.api import router as sales_router
from app.modules.purchasing.api import router as purchasing_router
from app.modules.finance.api import router as finance_router
from app.modules.hr.api import router as hr_router
from app.modules.warehouse.api import router as warehouse_router
from app.modules.support.api import router as support_router
from app.modules.reporting.api import router as reporting_router
from app.modules.settings.api import router as settings_router

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(permissions.router, prefix="/permissions", tags=["permissions"])
api_router.include_router(customers_router, prefix="/customers", tags=["customers"])
api_router.include_router(products_router, prefix="/inventory", tags=["inventory"])
api_router.include_router(sales_router, prefix="/sales", tags=["sales"])
api_router.include_router(purchasing_router)  # Has its own prefix
api_router.include_router(finance_router)  # Has its own prefix
api_router.include_router(hr_router)  # Has its own prefix
api_router.include_router(warehouse_router)  # Has its own prefix
api_router.include_router(support_router)  # Has its own prefix
api_router.include_router(reporting_router)  # Has its own prefix
api_router.include_router(settings_router)  # Has its own prefix
api_router.include_router(employees_router, prefix="/employees", tags=["employees"])
api_router.include_router(branches_router, prefix="/branches", tags=["branches"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
