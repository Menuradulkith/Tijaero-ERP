FROM python:3.11-bookworm

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libcairo2 \
    libgdk-pixbuf-xlib-2.0-0 \
    libgobject-2.0-0 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN pip install poetry

# Copy dependency files
COPY pyproject.toml poetry.lock* ./

# Install dependencies (regenerate lock if pyproject.toml changed)
RUN poetry config virtualenvs.create false \
    && poetry lock \
    && poetry install --no-interaction --no-ansi

# Install Chromium for Playwright PDF rendering
# Bypass signature verification in case of time sync issues
RUN apt-get update -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowUnauthenticatedPackages=true && \
    apt-get install -y --no-install-recommends -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowUnauthenticatedPackages=true \
    libnss3 libatk1.0 libatk-bridge2.0 libcups2 libdbus-1-3 libdrm2 libgbm1 libxkbcommon0 libxshmfence1 && \
    rm -rf /var/lib/apt/lists/* && \
    playwright install --with-deps chromium

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
