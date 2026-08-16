# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY assets ./assets
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine AS runtime

ARG SERVICE_VERSION=dev
ARG SERVICE_COMMIT=unknown

ENV NODE_ENV=production \
  SERVICE_DATA_DIR=/app/data \
  SERVICE_VERSION=$SERVICE_VERSION \
  SERVICE_COMMIT=$SERVICE_COMMIT
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/assets ./assets

RUN mkdir -p /app/data/assets /app/data/runtime \
  && chown -R node:node /app/data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.js"]
