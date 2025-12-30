#!/bin/bash

echo "🚀 Starting ERP Backend Server..."
echo ""
echo "Configuration:"
echo "  - Port: 8000"
echo "  - API: http://localhost:8000/api/v1"
echo "  - Docs: http://localhost:8000/docs"
echo "  - CORS: Enabled for http://localhost:3000"
echo ""

# Run migrations
echo "Running database migrations..."
alembic upgrade head

# Initialize permissions
echo ""
echo "Initializing permissions and groups..."
python scripts/init_permissions.py

# Ensure admin user exists
echo ""
echo "Ensuring admin user exists..."
python scripts/ensure_admin.py

# Test CORS config first
echo ""
echo "Testing CORS configuration..."
python test_cors.py

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ CORS configuration is correct!"
    echo ""
    echo "Starting server with auto-reload..."
    echo "Press Ctrl+C to stop"
    echo ""
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
else
    echo ""
    echo "❌ CORS configuration test failed!"
    echo "Please check the configuration."
    exit 1
fi
