#!/bin/bash
# Script to generate Alembic migration from models

set -e

echo "Generating Alembic migration from models..."

# Check if message is provided
if [ -z "$1" ]; then
    MESSAGE="auto generated migration"
else
    MESSAGE="$1"
fi

echo "Migration message: $MESSAGE"

# Generate migration
alembic revision --autogenerate -m "$MESSAGE"

echo "Migration generated successfully!"
echo "Please review the generated migration file in alembic/versions/"
echo ""
echo "To apply the migration, run:"
echo "  alembic upgrade head"
