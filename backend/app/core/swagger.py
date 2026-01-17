
swagger_ui_parameters = {
    "deepLinking": True,
    "displayRequestDuration": True,
    "filter": True,
    "showExtensions": True,
    "showCommonExtensions": True,
    "syntaxHighlight.theme": "monokai",
    "tryItOutEnabled": True,
    "persistAuthorization": True,
}

examples = {
    "user_login": {
        "summary": "Login Example",
        "description": "Example login request",
        "value": {
            "username": "admin",
            "password": "admin123"
        }
    },
    "user_register": {
        "summary": "Register Example",
        "description": "Example user registration",
        "value": {
            "email": "user@example.com",
            "username": "newuser",
            "password": "securepass123",
            "is_active": True
        }
    },
    "customer_create": {
        "summary": "Create Customer Example",
        "description": "Example customer creation",
        "value": {
            "name": "Acme Corporation",
            "email": "contact@acme.com",
            "phone": "+1234567890",
            "customer_type": "business",
            "address": "123 Business St, City, Country",
            "tax_id": "TAX123456"
        }
    },
    "sales_order_create": {
        "summary": "Create Sales Order Example",
        "description": "Example sales order creation",
        "value": {
            "customer_id": 1,
            "order_date": "2024-01-15",
            "items": [
                {
                    "product_id": 1,
                    "quantity": 10,
                    "unit_price": 99.99
                },
                {
                    "product_id": 2,
                    "quantity": 5,
                    "unit_price": 149.99
                }
            ]
        }
    },
    "product_create": {
        "summary": "Create Product Example",
        "description": "Example product creation",
        "value": {
            "sku": "PROD-001",
            "name": "Premium Widget",
            "description": "High-quality widget for industrial use",
            "unit_price": 99.99,
            "stock_quantity": 100
        }
    }
}

security_schemes = {
    "Bearer": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": """
        JWT Authorization header using the Bearer scheme.
        
        Enter 'Bearer' [space] and then your token in the text input below.
        
        Example: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        """
    }
}

tags_metadata = [
    {
        "name": "auth",
        "description": "Authentication and authorization operations. Login, register, and token management.",
    },
    {
        "name": "users",
        "description": "User management operations. Manage user accounts and profiles.",
    },
    {
        "name": "customers",
        "description": "Customer management operations. Create and manage customer records, contacts, and relationships.",
    },
    {
        "name": "sales",
        "description": "Sales order management. Create quotations, sales orders, and invoices.",
    },
    {
        "name": "inventory",
        "description": "Inventory and product management. Manage product catalog, stock levels, and movements.",
    },
    {
        "name": "purchasing",
        "description": "Purchase order management. Create and manage purchase orders and supplier relationships.",
    },
    {
        "name": "finance",
        "description": "Financial and accounting operations. Journal entries, ledgers, and financial reports.",
    },
    {
        "name": "hr",
        "description": "Human resources management. Employee records, payroll, and attendance.",
    },
    {
        "name": "warehouse",
        "description": "Warehouse management. Manage warehouses, locations, and stock transfers.",
    },
    {
        "name": "support",
        "description": "Support ticket management. Create and track customer support tickets.",
    },
    {
        "name": "reporting",
        "description": "Reports and analytics. Generate business intelligence reports and dashboards.",
    },
    {
        "name": "health",
        "description": "Health check endpoints. Monitor API status and availability.",
    },
]
