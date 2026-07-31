# ============================================================================
# 999 PRO Backend — production Dockerfile
# Wave 2 (C-DEPLOY-001): multi-stage build, runs as non-root user
# Stack: Express 4, Prisma 6, Socket.IO 4, JWT, argon2, web-push
#
# C2 fix: PostgreSQL is the production database. SQLite is dev-only.
#   This Dockerfile COPIES schema.postgres.prisma over schema.prisma before
#   running `prisma generate`, so the production image ships with the
#   Postgres Prisma client. The dev workflow (bun install + bun run dev on
#   the host) still uses the SQLite schema.prisma unchanged.
#
# H14 fix: npm ci --omit=dev instead of npm install (reproducible builds).
#
# C3 fix: prisma/migrations/0_postgres_baseline/migration.sql is committed
#   to the repo; the entrypoint runs `prisma migrate deploy` before starting
#   the server so the schema is always in sync with the code.
# ============================================================================
FROM node:24-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# Install openssl (needed by Prisma) and tini (PID 1 init for graceful shutdown)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl tini && \
    rm -rf /var/lib/apt/lists/*

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* package-lock.json* ./
# H14 fix: npm ci для воспроизводимых сборок (lockfile-driven).
RUN npm ci --omit=dev --no-fund --no-audit

# ─── Stage 2: build ─────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json bun.lock* package-lock.json* ./
RUN npm ci --no-fund --no-audit
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
# C2 fix: replace SQLite schema with Postgres schema for production build.
# This makes `prisma generate` produce a Postgres-compatible Prisma client.
RUN cp prisma/schema.postgres.prisma prisma/schema.prisma
# Generate Prisma client + compile TypeScript
RUN npx prisma generate && npx tsc

# ─── Stage 3: runtime ───────────────────────────────────────────────────────
FROM base AS runner
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

# Copy compiled output + dependencies.
# C2 fix: берём ВСЁ node_modules из builder (а не из deps) — там уже
# сгенерированный Prisma client для Postgres. Раньше при рассинхроне версий
# Prisma engine между deps и builder был segfault.
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --chown=appuser:appgroup package.json ./
# Copy Prisma schemas + migrations (Postgres schema is canonical in prod).
COPY --chown=appuser:appgroup prisma ./prisma
# Ensure Postgres schema is canonical in the runtime image too.
RUN cp prisma/schema.postgres.prisma prisma/schema.prisma

# Create uploads dir with proper permissions
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads

# Switch to non-root user
USER appuser

# Expose backend port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/ready', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use tini as PID 1 for proper signal handling (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
# C3 fix: apply migrations before starting the server. If migrations are
# already up-to-date, `migrate deploy` is a no-op (idempotent).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
