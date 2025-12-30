#!/bin/bash

echo "🚀 Starting Backend with CORS Configuration..."
echo ""
echo "Backend will run on: http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo "CORS enabled for: http://localhost:3000"
echo ""
echo "Login credentials:"
echo "  Username: admin"
echo "  Password: admin123"
echo ""
echo "Press Ctrl+C to stop"
echo ""

cd backend
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
