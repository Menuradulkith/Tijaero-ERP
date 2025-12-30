#!/bin/bash

echo "=========================================="
echo "ERP System - Setup and Demo Data Creation"
echo "=========================================="
echo ""

# Change to backend directory
cd "$(dirname "$0")/.."

# Check if database exists
if [ ! -f "erp.db" ]; then
    echo "⚠️  Database not found. Creating database..."
    echo ""
    
    # Run migrations
    echo "Running database migrations..."
    alembic upgrade head
    
    if [ $? -ne 0 ]; then
        echo "❌ Migration failed!"
        exit 1
    fi
    
    echo "✅ Database created successfully"
    echo ""
fi

# Create demo users if not exists
echo "Creating demo users..."
python scripts/create_demo_users.py

if [ $? -ne 0 ]; then
    echo "⚠️  Users might already exist, continuing..."
fi

echo ""
echo "Creating demo data..."
python scripts/create_all_demo_data.py

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ Setup Complete!"
    echo "=========================================="
    echo ""
    echo "🎉 Your ERP system is ready with demo data!"
    echo ""
    echo "📍 Access the application:"
    echo "   Frontend: http://localhost:3000"
    echo "   Backend:  http://localhost:8000"
    echo ""
    echo "🔐 Login credentials:"
    echo "   Username: admin"
    echo "   Password: admin123"
    echo ""
    echo "💡 Navigate to Finance module to see demo data!"
    echo "=========================================="
else
    echo ""
    echo "❌ Demo data creation failed!"
    echo "Please check the error messages above."
    exit 1
fi
