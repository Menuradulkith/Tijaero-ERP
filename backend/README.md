# ERP System Backend

FastAPI-based ERP system with modular architecture.

## Features

- Authentication & Authorization (JWT, RBAC)
- Customer Management
- Sales Management
- Inventory Management
- Purchasing Management
- Finance & Accounting
- HR Management
- Warehouse Management
- Support Ticketing
- Reporting
- **Comprehensive API Documentation (Swagger/OpenAPI)**

## Setup

1. Install dependencies:

```bash
poetry install
```

2. Configure environment:

```bash
cp .env.example .env
# Edit .env with your settings
```

3. Initialize database:

```bash
poetry run python scripts/init_db.py
poetry run alembic upgrade head
```

4. Create superuser:

```bash
poetry run python scripts/create_superuser.py
```

5. Run development server:

```bash
poetry run uvicorn app.main:app --reload
```

## API Documentation

The API comes with comprehensive interactive documentation:

### Swagger UI (Recommended)

Visit `http://localhost:8000/docs` for interactive API documentation with:

- Try-it-out functionality for all endpoints
- Request/response examples
- Authentication testing
- Schema validation
- Detailed endpoint descriptions

### ReDoc

Visit `http://localhost:8000/redoc` for alternative documentation view with:

- Clean, organized layout
- Searchable endpoints
- Detailed schema documentation
- Code samples

### OpenAPI JSON

Access raw OpenAPI specification at `http://localhost:8000/api/v1/openapi.json`

## Using the API

### Authentication

1. Go to `http://localhost:8000/docs`
2. Click on "Authorize" button (lock icon)
3. Login via `/api/v1/auth/login` endpoint to get JWT token
4. Enter token in format: `Bearer <your-token>`
5. All authenticated endpoints will now work

### Example API Calls

**Login:**

```bash
curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"
```

**Create Customer:**

```bash
curl -X POST "http://localhost:8000/api/v1/customers/" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "email": "contact@acme.com",
    "customer_type": "business"
  }'
```

## Email Feature Setup

The system includes an integrated email service to send documents (Quotations, Invoices, Purchase Orders, etc.) natively as PDFs via background workers.

To configure and enable the email service:

1. Copy `.env.server` (or your primary environment file) and configure the following SMTP variables:
   ```env
   # Email Settings
   ENABLE_EMAIL_SERVICE=True
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email@gmail.com
   SMTP_PASSWORD=your_app_password
   SMTP_FROM_EMAIL=your_email@gmail.com
   SMTP_FROM_NAME="Tijaero ERP"
   ```
2. The `ENABLE_EMAIL_SERVICE` acts as a master toggle. If set to `False`, no emails will be dispatched even if SMTP is configured.
3. Templates for Subjects and Bodies can be visually configured by an Admin directly within the UI under the **Settings > Email Templates** tab.

## Testing

```bash
poetry run pytest
```

## Project Structure

- `app/` - Main application code
  - `core/` - Core functionality (config, security, logging, swagger)
  - `db/` - Database configuration
  - `auth/` - Authentication & authorization
  - `common/` - Shared utilities
  - `api/` - API routes with OpenAPI documentation
  - `modules/` - Business modules
  - `reporting/` - Reports
  - `utils/` - Utilities
- `alembic/` - Database migrations
- `tests/` - Test suite
- `scripts/` - Utility scripts

## API Modules

- **Auth** - `/api/v1/auth/*` - Authentication endpoints
- **Users** - `/api/v1/users/*` - User management
- **Customers** - `/api/v1/customers/*` - Customer management
- **Sales** - `/api/v1/sales/*` - Sales orders
- **Inventory** - `/api/v1/inventory/*` - Product management
- **Purchasing** - `/api/v1/purchasing/*` - Purchase orders
- **Finance** - `/api/v1/finance/*` - Financial operations
- **HR** - `/api/v1/hr/*` - Employee management
- **Warehouse** - `/api/v1/warehouse/*` - Warehouse operations
- **Support** - `/api/v1/support/*` - Support tickets
- **Reporting** - `/api/v1/reporting/*` - Reports
- **Health** - `/api/v1/health` - Health check
