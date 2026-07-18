FROM node:24-alpine AS frontend

WORKDIR /app
RUN npm install --global pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html tsconfig*.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN pnpm build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    EVAL_LAB_DATABASE=/tmp/eval_lab.db

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY --from=frontend /app/dist ./dist

EXPOSE 10000
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
