# Database Access Credentials

This document contains all the credentials needed to access your ERP system database.

## 🗄️ PostgreSQL Database

**Direct Connection:**

- **Host**: localhost (or `postgres` from within Docker network)
- **Port**: 5432
- **Database**: erp_db
- **Username**: erp_user
- **Password**: erp_password

**Connection String:**

```
postgresql://erp_user:erp_password@localhost:5432/erp_db
```

**Docker Command Line Access:**

```bash
docker exec -it erp_postgres psql -U erp_user -d erp_db
```

---

## 🔧 Adminer (Lightweight Database UI)

**Access URL:** http://localhost:8080

**Login Credentials:**

- **System**: PostgreSQL
- **Server**: postgres
- **Username**: erp_user
- **Password**: erp_password
- **Database**: erp_db (optional, leave blank to see all databases)

**Features:**

- Simple, lightweight interface
- Quick SQL queries
- Table browsing
- Data export/import
- No setup required - just login and go!

---

## 🐘 pgAdmin (Full-Featured PostgreSQL Admin)

**Access URL:** http://localhost:5050

### Step 1: Login to pgAdmin

- **Email**: admin@example.com
- **Password**: admin

### Step 2: Add Database Server (First Time Only)

After logging in:

1. Right-click "Servers" in the left sidebar
2. Select "Register" → "Server"
3. Fill in the following:

**General Tab:**

- **Name**: ERP Database (or any name you like)

**Connection Tab:**

- **Host name/address**: postgres
- **Port**: 5432
- **Maintenance database**: erp_db
- **Username**: erp_user
- **Password**: erp_password
- ✅ Check "Save password"

4. Click "Save"

**Features:**

- Advanced query tool with autocomplete
- Visual query builder
- Database backup and restore
- ERD diagram generation
- Performance monitoring
- User management
- Import/Export wizards

---

## 🚀 Quick Start

### Start All Services

```bash
docker-compose up -d
```

### Check Services Status

```bash
docker-compose ps
```

### View Logs

```bash
docker-compose logs -f
```

### Stop All Services

```bash
docker-compose down
```

---

## 📊 Service URLs

| Service     | URL                        | Purpose                        |
| ----------- | -------------------------- | ------------------------------ |
| Frontend    | http://localhost:3000      | Main application UI            |
| Backend API | http://localhost:8000      | REST API                       |
| API Docs    | http://localhost:8000/docs | Swagger/OpenAPI documentation  |
| Adminer     | http://localhost:8080      | Lightweight database UI        |
| pgAdmin     | http://localhost:5050      | Full-featured PostgreSQL admin |
| PostgreSQL  | localhost:5432             | Database server                |

---

## 🔐 Security Notes

**⚠️ IMPORTANT FOR PRODUCTION:**

These are development credentials. For production deployment:

1. Change all passwords in `.env` file
2. Use strong, randomly generated passwords
3. Never commit `.env` file to version control
4. Consider using Docker secrets or environment-specific configs
5. Restrict database access to internal network only
6. Enable SSL/TLS for database connections
7. Use a reverse proxy with HTTPS for web interfaces

---

## 🆘 Troubleshooting

### Can't connect to database?

Check if PostgreSQL is running:

```bash
docker-compose ps postgres
```

Check PostgreSQL logs:

```bash
docker-compose logs postgres
```

### Adminer or pgAdmin not loading?

Check if containers are running:

```bash
docker-compose ps
```

Restart specific service:

```bash
docker-compose restart adminer
docker-compose restart pgadmin
```

### Port conflicts?

Edit `.env` file to change ports:

```env
POSTGRES_PORT=5433
ADMINER_PORT=8081
PGADMIN_PORT=5051
```

Then restart:

```bash
docker-compose down
docker-compose up -d
```

---

## 📝 Notes

- **Adminer** is great for quick tasks and simple queries
- **pgAdmin** is better for complex administration, backups, and advanced features
- Both tools connect to the same PostgreSQL database
- Changes made in one tool are immediately visible in the other
- Database data persists in Docker volume `postgres_data`
- pgAdmin settings persist in Docker volume `pgadmin_data`
