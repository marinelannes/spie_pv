# syntax=docker/dockerfile:1.7
# Image unique (spec §8.3) : API + PWA (`node dist/server.js`, défaut) et worker (`node dist/worker.js`).
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV CI=true
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

# Dépendances d'abord, pour profiter du cache Docker.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/templates/package.json packages/templates/
COPY packages/io-import/package.json packages/io-import/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @spie/web build \
 && pnpm --filter @spie/api build \
 && pnpm --filter @spie/api deploy --prod /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP_VERSION=dev
# Chromium (rendu des PDF par Playwright, spec §8.2) et polices métriquement compatibles Arial (modèle Word).
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/public \
    CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./public
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
