from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from app.core.config import settings
from app.core.middleware import setup_middleware
from app.core.swagger import tags_metadata, swagger_ui_parameters
from app.api.v1.router import api_router

# Import all models to register them with SQLAlchemy
import app.models  # noqa: F401

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Comprehensive ERP System API with modules for Sales, Inventory, Finance, HR, and more",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=tags_metadata,
    swagger_ui_parameters=swagger_ui_parameters,
    contact={
        "name": "API Support",
        "email": "support@example.com",
    },
    license_info={
        "name": "MIT",
    },
)

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    
    openapi_schema = get_openapi(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description="""
## ERP System API Documentation

This API provides comprehensive endpoints for managing:

* **Authentication** - User login, registration, and JWT token management
* **Customers** - Customer management and CRM
* **Sales** - Sales orders, quotations, and invoicing
* **Inventory** - Product catalog and stock management
* **Purchasing** - Purchase orders and supplier management
* **Finance** - Accounting, journal entries, and financial reports
* **HR** - Employee management and payroll
* **Warehouse** - Warehouse and location management
* **Support** - Ticketing and customer support
* **Reporting** - Business intelligence and analytics

### Authentication

Click the **Authorize** button and enter:
- **Username**: admin
- **Password**: admin123

The system will automatically obtain and use your JWT token for all requests.

### Rate Limiting

API calls are rate-limited to ensure fair usage.
        """,
        routes=app.routes,
        contact={
            "name": "API Support",
            "email": "support@example.com",
        },
        license_info={
            "name": "MIT",
        },
    )
    
    # Add security scheme with OAuth2 password flow
    openapi_schema["components"]["securitySchemes"] = {
        "OAuth2PasswordBearer": {
            "type": "oauth2",
            "flows": {
                "password": {
                    "tokenUrl": "/api/v1/auth/login",
                    "scopes": {}
                }
            },
            "description": "Enter your username and password to get a JWT token"
        }
    }
    
    # Add tags metadata
    openapi_schema["tags"] = [
        {"name": "auth", "description": "Authentication and authorization operations"},
        {"name": "users", "description": "User management operations"},
        {"name": "customers", "description": "Customer management operations"},
        {"name": "sales", "description": "Sales order management"},
        {"name": "inventory", "description": "Inventory and product management"},
        {"name": "purchasing", "description": "Purchase order management"},
        {"name": "finance", "description": "Financial and accounting operations"},
        {"name": "hr", "description": "Human resources management"},
        {"name": "warehouse", "description": "Warehouse management"},
        {"name": "support", "description": "Support ticket management"},
        {"name": "reporting", "description": "Reports and analytics"},
        {"name": "health", "description": "Health check endpoints"},
    ]
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

setup_middleware(app)
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {"message": "ERP API", "version": settings.VERSION}
