# Multi-stage build:
#   1. `node:22-alpine` runs `npm ci && npm run build`.
#   2. `nginx:alpine` serves the static bundle and proxies /lg/* to the
#      LangGraph deployment (the same shape Vite uses in dev — keeps the
#      frontend's same-origin assumption true in production too).
#
# Build:    docker build -t sovereign-rag-frontend ./frontend
# Run:      docker run --rm -p 8080:80 \
#             -e LANGGRAPH_UPSTREAM=http://host.docker.internal:2024 \
#             sovereign-rag-frontend
#
# In docker-compose this image is opt-in via `profiles: [ui]`; the LangGraph
# upstream is the `langgraph` service.

# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first so the layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---------- runtime stage ----------
FROM nginx:1.27-alpine AS runtime

# Inject the upstream URL at container start via envsubst on the template.
ENV LANGGRAPH_UPSTREAM=http://langgraph:2024
ENV NGINX_PORT=80

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
# nginx:alpine's default entrypoint already runs envsubst over files in
# /etc/nginx/templates/, then starts nginx in the foreground. No CMD override.
