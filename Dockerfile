FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-pdf-worker.mjs scripts/copy-pdf-worker.mjs
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY lib ./lib
COPY next.config.ts tsconfig.json ./
ENV NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_DEMO_MODE=false NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt && useradd --create-home --uid 10001 app
COPY backend ./backend
COPY scripts/seed.py scripts/seed.py
COPY examples ./examples
COPY --from=web /app/out ./out
RUN mkdir -p /app/data && chown -R app:app /app
USER app
ENV DATA_DIR=/app/data PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
