FROM python:3.12-slim

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

# 1 worker: o realce roda no threadpool (CPU-bound); escala por replica.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
