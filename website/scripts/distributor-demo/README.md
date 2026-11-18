# Distributor Lanka demo screenshots

The `/distribution/` page uses real screens of the Distributor Lanka app (`C:\MyProjects\Distribution-Cloud`),
captured from a made-up company, "Lanka Fresh Distributors" (Kurunegala, Kandy, Puttalam; 4 trucks; ~45 days of
loads, truck and counter sales, returns, expenses and payments). Nothing in the Distribution-Cloud repo is changed.

```bash
# 1. database only, in Docker, on 127.0.0.1:5441 (5432 is the ERP's)
cd /c/MyProjects/Distribution-Cloud/backend
docker compose -p distributor-demo -f docker-compose.yml -f /c/MyProjects/Tijaero-ERP/website/scripts/distributor-demo/compose.override.yml up -d db

# 2. API natively (Docker builds can't reach PyPI on this network): a venv outside the repo
export DL_VENV=~/.venvs/distributor-demo UV_PROJECT_ENVIRONMENT=~/.venvs/distributor-demo
uv sync --frozen --no-dev --python 3.12
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5441/distribution_cloud ENVIRONMENT=development
"$DL_VENV/Scripts/alembic" upgrade head
"$DL_VENV/Scripts/uvicorn" app.main:app --host 127.0.0.1 --port 8000     # leave running

# 3. seed (reset first if reseeding), start launch config "distributor-demo" (:5180), capture
cd /c/MyProjects/Tijaero-ERP/website
DL_VENV=$DL_VENV bash scripts/distributor-demo/reset_db.sh
"$DL_VENV/Scripts/python" scripts/distributor-demo/seed.py
node scripts/distributor-demo/capture.mjs          # writes public/screens/dl-*.jpg
```

`seed.py` writes random test logins to `creds.json` here (gitignored). People and shops have no phone numbers,
so no real number appears in a screenshot. Inventory and Finance screens are not used.
