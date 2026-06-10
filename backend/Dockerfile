FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
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
# Disable GPG signature verification to work around time sync issues
RUN mkdir -p /etc/apt/apt.conf.d && \
    echo 'APT::Get::AllowUnauthenticated "true";' > /etc/apt/apt.conf.d/99auth && \
    echo 'Acquire::AllowInsecureRepositories "true";' >> /etc/apt/apt.conf.d/99auth && \
    echo 'Acquire::AllowDowngradeToInsecureRepositories "true";' >> /etc/apt/apt.conf.d/99auth && \
    apt-get update -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowUnauthenticatedPackages=true && \
    playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
