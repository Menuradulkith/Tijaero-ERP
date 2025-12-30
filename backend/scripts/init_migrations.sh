#!/bin/bash
# Script to initialize Alembic migrations from scratch

set -e

echo "Initializing database migrations..."

# Generate initial migration from models
alembic revision --autogenerate -m "initial_schema"

echo "Migration generated successfully!"
echo ""
echo "To apply the migration, run:"
echo "  alembic upgrade head"
