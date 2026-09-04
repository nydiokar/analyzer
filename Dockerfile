# syntax=docker/dockerfile:1
#
# Sova Intel backend API.
#
# Runtime config comes from the process environment only — no .env is copied in.
# Memory limits are set by the orchestrator, not baked here: NODE_OPTIONS is
# derived from the container memory limit — in docker-compose.yml (BACKEND_MEMORY_MB /
# BACKEND_HEAP_MB) for local/VPS deploys, or in terraform/main.tf (container_memory_mib
# * heap_fraction) for the optional Cloud Run path. See DEPLOYMENT.md.

ARG NODE_VERSION=22-bookworm-slim
ARG PNPM_VERSION=10.28.0

# ---------------------------------------------------------------------------
# Stage 1: install dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps

# Toolchain for native modules declared in pnpm-workspace onlyBuiltDependencies:
# bcrypt, better-sqlite3, sqlite3, keccak, bigint-buffer, sharp.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
      openssl \
    && rm -rf /var/lib/apt/lists/*

ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Manifests only, so the install layer stays cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json ./packages/sdk/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: build
# ---------------------------------------------------------------------------
FROM deps AS builder

WORKDIR /app

# Prisma client for linux. The host-generated client targets Windows and cannot
# run here; the schema must be present before generate.
COPY prisma ./prisma
RUN pnpm exec prisma generate

# @sova-intel/sdk resolves to packages/sdk/dist/**. The root tsconfig excludes
# packages/, so the workspace dependency must be built on its own first —
# src/bot/intel/* imports it and root tsc compiles all of src/**.
COPY packages ./packages
RUN pnpm --filter @sova-intel/sdk run build

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm exec tsc

# ---------------------------------------------------------------------------
# Stage 3: production dependencies
# ---------------------------------------------------------------------------
# Resolved in a stage separate from the build so devDependencies never reach the
# runtime image. Native postinstall scripts must still run, hence no
# --ignore-scripts.
FROM deps AS prod-deps

WORKDIR /app

COPY prisma ./prisma

# prisma is a production dependency (needed at runtime for `prisma migrate
# deploy`, see docker-compose.yml's migrate service), so it survives --prod
# pruning below along with the client it generates into node_modules/.prisma.
RUN pnpm exec prisma generate

# CI=true: this install prunes the devDependency tree inherited from `deps`,
# and pnpm refuses a non-interactive destructive modules-dir removal without it.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    CI=true pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage 4: runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# openssl: Prisma query engine runtime dependency on bookworm.
# tini: reaps zombies and forwards SIGTERM for clean orchestrator shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    TS_NODE_BASEURL=./dist \
    LOG_TO_FILES=false

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder   --chown=node:node /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder   --chown=node:node /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --from=builder   --chown=node:node /app/dist ./dist
COPY --from=builder   --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json tsconfig.json ./

# tsconfig-paths/register reads tsconfig.json at boot to resolve the @/core/*
# aliases left in the compiled output; TS_NODE_BASEURL points it at ./dist.

USER node

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "-r", "tsconfig-paths/register", "dist/main.js"]
