# Docker Setup Guide

This project uses Docker Compose to run the ERP system with PostgreSQL, Backend (FastAPI), and Frontend (React + Vite).

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)

## Quick Start

### 1. Production Mode

Build and run all services:

```bash
docker-compose up -d
```

This will start:

- PostgreSQL on port 5432
- Backend API on port 8000
- Frontend on port 3000
- Adminer (Database UI) on port 8080

Access the application at: http://localhost:3000
Access Adminer at: http://localhost:8080

### 2. Development Mode (with hot reload)

For development with live code reloading:

```bash
docker-compose -f docker-compose.dev.yml up
```

This will start:

- PostgreSQL on port 5432
- Backend API on port 8000 (with hot reload)
- Frontend on port 5173 (Vite dev server)
- Adminer (Database UI) on port 8080

Access the application at: http://localhost:5173
Access Adminer at: http://localhost:8080

## Environment Configuration

The `.env` file in the root directory contains all configuration:

```env
# PostgreSQL
POSTGRES_USER=erp_user
POSTGRES_PASSWORD=erp_password
POSTGRES_DB=erp_db
POSTGRES_PORT=5432

# Backend
BACKEND_PORT=8000
SECRET_KEY=your-secret-key-change-in-production

# Frontend
FRONTEND_PORT=3000
VITE_API_URL=http://localhost:8000/api/v1
```

**Important:** Change the `SECRET_KEY` and `POSTGRES_PASSWORD` in production!

## Common Commands

### Start services

```bash
docker-compose up -d
```

### Stop services

```bash
docker-compose down
```

### View logs

```bash
docker-compose logs -f
docker-compose logs -f backend  # Backend only
docker-compose logs -f frontend # Frontend only
```

### Rebuild services

```bash
docker-compose up -d --build
```

### Stop and remove volumes (WARNING: deletes database data)

```bash
docker-compose down -v
```

### Access database

```bash
docker exec -it erp_postgres psql -U erp_user -d erp_db
```

### Run backend migrations

```bash
docker exec -it erp_backend alembic upgrade head
```

### Access backend shell

```bash
docker exec -it erp_backend bash
```

## Adminer - Database Management

Adminer is included as a lightweight database management tool. Access it at http://localhost:8080

### Login Credentials

- **System**: PostgreSQL
- **Server**: postgres
- **Username**: erp_user (or value from .env)
- **Password**: erp_password (or value from .env)
- **Database**: erp_db (or value from .env)

### Features

- Browse tables and data
- Run SQL queries
- Export/Import data
- Manage database schema
- View table relationships

### Change Adminer Port

Edit `.env` file:

```env
ADMINER_PORT=8081
```

## Database Migrations

Migrations run automatically when the backend starts. To run manually:

```bash
docker exec -it erp_backend alembic upgrade head
```

To create a new migration:

```bash
docker exec -it erp_backend alembic revision --autogenerate -m "description"
```

## Troubleshooting

### Port already in use

If ports are already in use, change them in `.env`:

```env
POSTGRES_PORT=5433
BACKEND_PORT=8001
FRONTEND_PORT=3001
ADMINER_PORT=8081
```

### Database connection issues

Check if PostgreSQL is healthy:

```bash
docker-compose ps
```

### Frontend can't connect to backend

Ensure CORS origins are configured correctly in `.env`:

```env
BACKEND_CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

### Clear everything and start fresh

```bash
docker-compose down -v
docker-compose up -d --build
```

## Production Deployment

For production:

1. Update `.env` with secure values
2. Use `docker-compose.yml` (not dev version)
3. Consider using Docker secrets for sensitive data
4. Set up proper reverse proxy (nginx/traefik)
5. Enable HTTPS
6. Configure proper backup strategy for PostgreSQL volume

## Architecture

```
┌─────────────┐
│   Frontend  │ :3000 (nginx)
│   (React)   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Backend   │ :8000 (FastAPI)
│   (Python)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  PostgreSQL │ :5432
│  (Database) │
└─────────────┘
```

## Volumes

- `postgres_data`: Persistent PostgreSQL data
- Backend and Frontend code are mounted as volumes in dev mode for hot reload

## Networks

All services communicate through the `erp_network` bridge network.
