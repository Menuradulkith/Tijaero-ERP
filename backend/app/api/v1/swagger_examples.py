from app.auth.schemas import UserCreate, Token
from app.modules.customers.schemas import CustomerCreate

login_example = {
    "username": "admin",
    "password": "admin123"
}

register_example = {
    "email": "newuser@example.com",
    "username": "newuser",
    "password": "SecurePass123!",
    "is_active": True
}

token_response_example = {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "bearer"
}

customer_create_example = {
    "name": "Acme Corporation",
    "email": "contact@acme.com",
    "phone": "+1-555-0123",
    "customer_type": "business",
    "address": "123 Business Street, Suite 100, New York, NY 10001",
    "tax_id": "12-3456789"
}

customer_response_example = {
    "id": 1,
    "name": "Acme Corporation",
    "email": "contact@acme.com",
    "phone": "+1-555-0123",
    "customer_type": "business",
    "address": "123 Business Street, Suite 100, New York, NY 10001",
    "tax_id": "12-3456789"
}


sales_order_create_example = {
    "customer_id": 1,
    "order_date": "2024-01-15",
    "items": [
        {
            "product_id": 1,
            "quantity": 10.0,
            "unit_price": 99.99
        },
        {
            "product_id": 2,
            "quantity": 5.0,
            "unit_price": 149.99
        }
    ]
}

product_create_example = {
    "sku": "WIDGET-001",
    "name": "Premium Widget",
    "description": "High-quality industrial widget with extended warranty",
    "unit_price": 99.99,
    "stock_quantity": 150.0
}

employee_create_example = {
    "first_name": "John",
    "last_name": "Doe",
    "email": "john.doe@company.com",
    "phone": "+1-555-0199",
    "hire_date": "2024-01-01",
    "salary": 75000.00
}

purchase_order_create_example = {
    "supplier_id": 1,
    "order_date": "2024-01-15"
}

support_ticket_create_example = {
    "subject": "Unable to process payment",
    "description": "Customer reports error when trying to complete checkout process",
    "priority": "high"
}

warehouse_create_example = {
    "code": "WH-001",
    "name": "Main Warehouse",
    "location": "123 Storage Lane, Industrial Park"
}

journal_entry_create_example = {
    "entry_date": "2024-01-15",
    "description": "Monthly sales revenue recognition"
}
