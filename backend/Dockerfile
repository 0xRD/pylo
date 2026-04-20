FROM python:3.12-slim

WORKDIR /app

# Copy requirements first for layer caching
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy backend source as the 'backend' package
COPY . /app/backend/

RUN mkdir -p /app/pybooks_storage /app/objects_storage

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
