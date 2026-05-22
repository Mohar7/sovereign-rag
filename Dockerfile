# syntax=docker/dockerfile:1.7
#
# Multi-stage build. NOTE: this image is heavy by nature — Docling pulls
# torch + layout models and Crawl4AI pulls Playwright + Chromium. Expect a
# multi-GB image. For a lighter API that delegates parsing/crawling to a
# worker, split those into a separate service (see README "Deployment").

FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.4.27 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=0 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /build

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


FROM python:3.12-slim AS runtime

# Chromium runtime libs for Crawl4AI/Playwright.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG APP_UID=10001
RUN groupadd --gid ${APP_UID} app \
    && useradd --uid ${APP_UID} --gid ${APP_UID} --no-create-home --shell /sbin/nologin app

WORKDIR /app
COPY --from=builder --chown=app:app /build/.venv /app/.venv
COPY --chown=app:app src ./src

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()" || exit 1

CMD ["uvicorn", "sovereign_rag.api:app", "--host", "0.0.0.0", "--port", "8000"]
