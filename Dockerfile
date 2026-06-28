FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y libpq-dev gcc python3-dev && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install sqlalchemy psycopg2-binary tenacity fastapi uvicorn

# Copy the rest of the application
COPY . .

# Expose API port
EXPOSE 8000

# Start both the daemon and the FastAPI server using a simple bash script or supervisor
CMD ["sh", "-c", "python run_live_service.py & uvicorn api:app --host 0.0.0.0 --port 8000"]
