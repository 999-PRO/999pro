# ============================================================================
# 999 PRO Frontend (Next.js) — production Dockerfile
# v24.6-audit (S-CRIT-2 / C2 fix): was missing — docker-compose.prod.yml:127
# referenced this file but it didn't exist, so `docker compose up --build`
# would fail immediately on the frontend service.
#
# Stack: Next.js 16 standalone build, React 19, Turbopack (build only), Tailwind 4
# Output mode: `standalone` (configured in next.config.ts) — produces a
# self-contained server.js + minimal node_modules in .next/standalone/.
# ============================================================================
FROM node:24-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# Install openssl (Prisma query engine preload during build) + tini for PID 1
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl tini && \
    rm -rf /var/lib/apt/lists/*

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
# Copy workspace + shared package manifests first for cache hits.
COPY package.json bun.lock* package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
# Install ALL deps (including dev) — we need them for the build.
# `npm ci` is reproducible from lockfile.
RUN npm ci --no-fund --no-audit

# ─── Stage 2: build ─────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json bun.lock* package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --no-fund --no-audit
# Copy workspace shared package source (resolved via workspace:*).
COPY packages/shared ./packages/shared
# Copy frontend source + configs.
COPY src ./src
COPY public ./public
COPY next.config.ts ./next.config.ts
COPY tsconfig.json ./tsconfig.json
COPY postcss.config.mjs ./postcss.config.mjs
COPY tailwind.config.ts ./tailwind.config.ts
COPY eslint.config.mjs ./eslint.config.mjs
# Build with NEXT_TELEMETRY_DISABLED=1 to keep build logs clean.
ENV NEXT_TELEMETRY_DISABLED=1
# Build produces .next/standalone/ (server.js + minimal node_modules) and
# .next/static/ (client chunks). Both are copied to the runner stage.
RUN npm run build

# ─── Stage 3: runtime ───────────────────────────────────────────────────────
FROM base AS runner
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

# Copy standalone server (already has minimal node_modules bundled).
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
# Copy static assets (NOT included in standalone by default).
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
# Copy public assets (manifest, icons, sw.js, offline.html).
COPY --from=builder --chown=appuser:appgroup /app/public ./public
# Copy package.json (for `npm start` script + version metadata).
COPY --chown=appuser:appgroup package.json ./

# Switch to non-root user
USER appuser

# Expose frontend port
EXPOSE 3000

# Health check — Next.js standalone server.js responds on /
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use tini as PID 1 for proper signal handling (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
# Start the standalone Next.js server (binds to 0.0.0.0:3000 by default).
CMD ["node", "server.js"]
