# TijaeroERP

A comprehensive ERP system built with FastAPI (Backend) and React + TypeScript (Frontend).

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Running the Project](#running-the-project)
- [Database Setup & Migrations](#database-setup--migrations)
- [Login Credentials](#login-credentials)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

## 🔧 Prerequisites

- **Python 3.9+** with Poetry
- **Node.js 16+** with npm
- **PostgreSQL 13+**
- **Docker & Docker Compose** (optional, for containerized setup)

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Start all services (PostgreSQL, Backend, Frontend)
docker-compose up -d

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
# Adminer (DB UI): http://localhost:8080
```

### Option 2: Local Development

```bash
# 1. Setup Backend
cd backend
poetry install
cp .env.example .env
# Edit .env with your database settings

# Initialize database
poetry run python scripts/init_db.py
poetry run alembic upgrade head

# Create admin user
poetry run python scripts/create_superuser.py

# Start backend
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 2. Setup Frontend (in a new terminal)
cd frontend
npm install
cp .env.example .env
# Edit .env if needed

# Start frontend
npm run dev
```

## 🏃 Running the Project

### Using Docker

**Production Mode:**

```bash
docker-compose up -d
```

**Development Mode (with hot reload):**

```bash
docker-compose -f docker-compose.dev.yml up
```

**View Logs:**

```bash
docker-compose logs -f
docker-compose logs -f backend   # Backend only
docker-compose logs -f frontend  # Frontend only
```

**Stop Services:**

```bash
docker-compose down
```

### Using Local Setup

**Backend:**

```bash
cd backend
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Or use the convenience script:

```bash
./START_BACKEND.sh
```

**Frontend:**

```bash
cd frontend
npm run dev
```

## 🗄️ Database Setup & Migrations

### Initial Database Setup

```bash
cd backend

# 1. Initialize database tables
poetry run python scripts/init_db.py

# 2. Run migrations
poetry run alembic upgrade head

# 3. Create superuser/admin
poetry run python scripts/create_superuser.py
```

### Database Migration Commands

**Apply all pending migrations:**

```bash
cd backend
poetry run alembic upgrade head
```

**Create a new migration (auto-generate from models):**

```bash
cd backend
poetry run alembic revision --autogenerate -m "description of changes"
```

**Rollback to previous migration:**

```bash
cd backend
poetry run alembic downgrade -1
```

**View migration history:**

```bash
cd backend
poetry run alembic history
```

**View current migration version:**

```bash
cd backend
poetry run alembic current
```

**Rollback to specific migration:**

```bash
cd backend
poetry run alembic downgrade <revision_id>
```

### Docker Migration Commands

**Run migrations in Docker:**

```bash
docker exec -it erp_backend alembic upgrade head
```

**Create new migration in Docker:**

```bash
docker exec -it erp_backend alembic revision --autogenerate -m "description"
```

**View migration history in Docker:**

```bash
docker exec -it erp_backend alembic history
```

### Database Access

**Local PostgreSQL:**

```bash
psql -U erp_user -d erp_db
```

**Docker PostgreSQL:**

```bash
docker exec -it erp_postgres psql -U erp_user -d erp_db
```

**Using Adminer (Docker only):**

- URL: http://localhost:8080
- System: PostgreSQL
- Server: postgres
- Username: erp_user
- Password: erp_password
- Database: erp_db

## 🔑 Login Credentials

Default admin credentials:

```
Username: admin
Password: admin123
```

## 📚 API Documentation

Once the backend is running, access interactive API documentation:

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc
- **OpenAPI JSON:** http://localhost:8000/api/v1/openapi.json

### Using the API

1. Go to http://localhost:8000/docs
2. Click "Authorize" button
3. Login via `/api/v1/auth/login` to get JWT token
4. Enter token in format: `Bearer <your-token>`
5. Test any endpoint

## 📁 Project Structure

```
TijaeroERP/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/            # API routes
│   │   ├── auth/           # Authentication
│   │   ├── core/           # Core config
│   │   ├── db/             # Database setup
│   │   ├── modules/        # Business modules
│   │   └── utils/          # Utilities
│   ├── alembic/            # Database migrations
│   ├── scripts/            # Utility scripts
│   └── tests/              # Test suite
├── frontend/               # React + TypeScript frontend
│   └── src/
│       ├── api/            # API client
│       ├── auth/           # Auth components
│       ├── features/       # Feature modules
│       └── modules/        # Business modules
├── docs/                   # Documentation
└── docker-compose.yml      # Docker configuration
```

## 🐛 Troubleshooting

### Backend won't start

**Port already in use:**

```bash
# Find process using port 8000
lsof -i :8000

# Kill it
lsof -ti:8000 | xargs kill -9
```

### Database connection errors

**Check PostgreSQL is running:**

```bash
# Local
sudo systemctl status postgresql

# Docker
docker-compose ps
```

**Reset database (WARNING: deletes all data):**

```bash
# Docker
docker-compose down -v
docker-compose up -d

# Local
dropdb erp_db
createdb erp_db
cd backend
poetry run python scripts/init_db.py
poetry run alembic upgrade head
```

### CORS errors in frontend

Ensure backend CORS is configured in `.env`:

```env
BACKEND_CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

Then restart backend:

```bash
# Kill backend
Ctrl+C

# Restart
cd backend
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Migration conflicts

**Reset migrations (WARNING: deletes all data):**

```bash
cd backend
poetry run alembic downgrade base
poetry run alembic upgrade head
```

## 📖 Additional Documentation

- [Docker Setup Guide](README.Docker.md)
- [Backend Documentation](backend/README.md)
- [Complete Setup Guide](docs/setup/COMPLETE_SETUP_GUIDE.md)
- [API Reference](docs/api/QUICK_API_REFERENCE.md)
- [System Architecture](docs/guides/SYSTEM_ARCHITECTURE.md)

## 🧪 Testing

```bash
cd backend
poetry run pytest
```

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests
4. Submit a pull request

## 📄 License

[Add your license here]
