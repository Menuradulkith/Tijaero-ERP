#!/bin/bash
# Docker Setup Script for ERP System

set -e

echo "========================================="
echo "ERP System - Docker Setup"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    echo "Please install Docker Compose first: https://docs.docker.com/compose/install/"
    exit 1
fi

echo -e "${GREEN}✓ Docker and Docker Compose are installed${NC}"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Creating .env file from template..."
    cat > .env << 'EOF'
# PostgreSQL Configuration
POSTGRES_USER=erp_user
POSTGRES_PASSWORD=erp_password
POSTGRES_DB=erp_db
POSTGRES_PORT=5432

# Backend Configuration
BACKEND_PORT=8000
SECRET_KEY=your-secret-key-change-in-production-min-32-chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
PROJECT_NAME=ERP System
API_V1_STR=/api/v1
BACKEND_CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]

# Frontend Configuration
FRONTEND_PORT=3000
VITE_API_URL=http://localhost:8000/api/v1
EOF
    echo -e "${GREEN}✓ .env file created${NC}"
    echo -e "${YELLOW}⚠ Please update the SECRET_KEY and POSTGRES_PASSWORD in .env file${NC}"
else
    echo -e "${GREEN}✓ .env file exists${NC}"
fi

echo ""
echo "========================================="
echo "Choose setup mode:"
echo "========================================="
echo "1) Production (optimized builds)"
echo "2) Development (with hot reload)"
echo ""
read -p "Enter your choice (1 or 2): " choice

case $choice in
    1)
        echo ""
        echo "Starting in PRODUCTION mode..."
        COMPOSE_FILE="docker-compose.yml"
        ;;
    2)
        echo ""
        echo "Starting in DEVELOPMENT mode..."
        COMPOSE_FILE="docker-compose.dev.yml"
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
esac

echo ""
echo "Building and starting containers..."
docker-compose -f $COMPOSE_FILE up -d --build

echo ""
echo "Waiting for services to be ready..."
sleep 5

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""

if [ "$choice" == "1" ]; then
    echo -e "${GREEN}Frontend:${NC} http://localhost:3000"
    echo -e "${GREEN}Backend API:${NC} http://localhost:8000"
    echo -e "${GREEN}API Docs:${NC} http://localhost:8000/docs"
    echo -e "${GREEN}Adminer (DB):${NC} http://localhost:8080"
else
    echo -e "${GREEN}Frontend:${NC} http://localhost:5173"
    echo -e "${GREEN}Backend API:${NC} http://localhost:8000"
    echo -e "${GREEN}API Docs:${NC} http://localhost:8000/docs"
    echo -e "${GREEN}Adminer (DB):${NC} http://localhost:8080"
fi

echo -e "${GREEN}PostgreSQL:${NC} localhost:5432"
echo ""
echo "========================================="
echo "Useful Commands:"
echo "========================================="
echo "View logs:           docker-compose -f $COMPOSE_FILE logs -f"
echo "Stop services:       docker-compose -f $COMPOSE_FILE down"
echo "Restart services:    docker-compose -f $COMPOSE_FILE restart"
echo "Run migrations:      docker exec -it erp_backend alembic upgrade head"
echo "Generate migration:  docker exec -it erp_backend alembic revision --autogenerate -m 'description'"
echo "Access database:     docker exec -it erp_postgres psql -U erp_user -d erp_db"
echo ""
echo -e "${YELLOW}Note: Database migrations run automatically on backend startup${NC}"
echo ""
