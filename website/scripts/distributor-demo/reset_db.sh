# Drop and recreate the demo database, then migrate. Only touches the demo container distributor-demo-db-1.
# Usage: DL_VENV=/path/to/venv bash reset_db.sh
docker exec distributor-demo-db-1 psql -U postgres -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='distribution_cloud' AND pid<>pg_backend_pid();" -c "DROP DATABASE distribution_cloud;" -c "CREATE DATABASE distribution_cloud;" >/dev/null
cd /c/MyProjects/Distribution-Cloud/backend && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5441/distribution_cloud "$DL_VENV/Scripts/alembic" upgrade head 2>&1 | tail -1
