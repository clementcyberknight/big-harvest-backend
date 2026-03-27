# ─────────────────────────────────────────────────────────────
#  Ravolo Backend — Multi-stage Docker build
#  Base: Ubuntu 24.04 (glibc 2.39) required by uWebSockets.js ≥ v20.51
# ─────────────────────────────────────────────────────────────

# ── Stage 0: base ────────────────────────────────────────────
# Shared foundation with Node 22 + pnpm for all stages.
FROM ubuntu:24.04 AS base

# Prevent interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 22 from NodeSource + essential runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Stage 1: deps ───────────────────────────────────────────
# Install ALL dependencies (dev + prod) so native addons compile.
FROM base AS deps

# Build tools needed for bcrypt, msgpackr, uWebSockets.js, protobufjs
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential python3 git \
    && rm -rf /var/lib/apt/lists/*

# Copy only package manifests first → maximises Docker layer cache
COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ──────────────────────────────────────────
# Compile TypeScript and copy Lua scripts into dist/
FROM deps AS build

COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/

RUN pnpm run build

# ── Stage 3: runtime ────────────────────────────────────────
# Minimal production image — no build tools, no dev deps, no source.
FROM base AS runtime

ENV NODE_ENV=production

# Prune to production-only deps
COPY package.json pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm prune --prod --no-optional && pnpm store prune

# Copy compiled output (JS + Lua)
COPY --from=build /app/dist ./dist

# Create non-root user for security
RUN groupadd --system node && useradd --system --gid node --create-home node \
    && chown -R node:node /app
USER node

# Default WebSocket port — override with WS_PORT env var on Railway
EXPOSE 9001

CMD ["node", "dist/server.js"]
