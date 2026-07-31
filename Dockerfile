# ============================================================================
# 999 PRO Frontend (Next.js) — production Dockerfile
# v25.0-audit-fix: full Bun-based pipeline (matches bun.lock in repo)
#   - uses `bun install --frozen-lockfile` (no npm ci / no package-lock.json)
#   - removes reference to non-existent eslint.config.mjs
#   - bundles @999pro/shared workspace package correctly
# Stack: Next.js 16 standalone, React 19, Tailwind 4
# Output mode: `standalone` (next.config.ts) → self-contained server.js
# ============================================================================
FROM oven/bun:1-debian AS base
ENV NODE_ENV=production
WORKDIR /app

# openssl (Prisma client preload during build) + tini (PID 1) + ca-certs
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
# Copy workspace + shared package manifests first for cache hits.
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
# Reproducible install from bun.lock. --frozen-lockfile fails if lockfile drift.
RUN bun install --frozen-lockfile

# ─── Stage 2: build ─────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile
# Copy workspace shared package source (resolved via workspace:*).
COPY packages/shared ./packages/shared
# Copy frontend source + configs. NO eslint.config.mjs — root project doesn't
# have one (only studio does). Build doesn't require it.
COPY src ./src
COPY public ./public
COPY next.config.ts ./next.config.ts
COPY tsconfig.json ./tsconfig.json
COPY postcss.config.mjs ./postcss.config.mjs
COPY tailwind.config.ts ./tailwind.config.ts
COPY next-env.d.ts ./next-env.d.ts
# Build with NEXT_TELEMETRY_DISABLED=1 to keep build logs clean.
ENV NEXT_TELEMETRY_DISABLED=1
# Build produces .next/standalone/ (server.js + minimal node_modules) and
# .next/static/ (client chunks). Both are copied to the runner stage.
# Use Bun to invoke Next.js build (Next.js CLI is engine-agnostic).
RUN bun run build

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
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

# Use tini as PID 1 for proper signal handling (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
# Next.js standalone server.js is Node-compatible — runs under bun or node.
# Using node for maximum stability with Next.js standalone runtime.
CMD ["node", "server.js"]
