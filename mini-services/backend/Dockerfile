# ============================================================================
# 999 PRO Backend — production Dockerfile
# v25.0-audit-fix: full Bun-based pipeline (matches bun.lock in repo)
#   - uses `bun install --frozen-lockfile` (no npm ci / no package-lock.json)
#   - skips postinstall (prisma generate) during install, runs it after copy
#   - generates PostgreSQL baseline migration at build time via `prisma migrate diff`
#     (existing committed migration is SQLite-only and would fail on Postgres)
#   - uses `prisma migrate deploy` at runtime (idempotent, safe for prod)
# Stack: Express 4, Prisma 6, Socket.IO 4, JWT, argon2, web-push
# ============================================================================
FROM oven/bun:1-debian AS base
ENV NODE_ENV=production
WORKDIR /app

# openssl (Prisma engine) + tini (PID 1) + python3 + make + g++ (native builds
# for argon2 if prebuilt binary is not available for the platform) + ca-certs
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl tini ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock ./
# --ignore-scripts: skips `postinstall: prisma generate` (prisma/ not yet copied)
# --frozen-lockfile: reproducible install from bun.lock
RUN bun install --frozen-lockfile --ignore-scripts

# ─── Stage 2: build ─────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./

# C2 fix: replace SQLite schema with Postgres schema for production build.
# This makes `prisma generate` produce a Postgres-compatible Prisma client.
RUN cp prisma/schema.postgres.prisma prisma/schema.prisma

# Generate Prisma client (now using Postgres schema).
RUN bunx prisma generate

# Generate PostgreSQL baseline migration from current schema.
# The committed migrations/ dir is SQLite-only (migration_lock.toml = sqlite,
# SQL uses DATETIME/BOOLEAN literals). We DELETE the SQLite migration folder
# and replace it with a fresh Postgres baseline generated via `migrate diff`.
# `migrate deploy` at runtime then has a clean Postgres-only history to apply.
RUN rm -rf prisma/migrations && \
    mkdir -p prisma/migrations/0_postgres_baseline && \
    bunx prisma migrate diff \
      --from-empty \
      --to-schema-datamodel prisma/schema.prisma \
      --script > prisma/migrations/0_postgres_baseline/migration.sql && \
    echo 'provider = "postgresql"' > prisma/migrations/migration_lock.toml

# Compile TypeScript to dist/. Use Bun's tsc wrapper (engine-agnostic).
RUN bunx tsc

# ─── Stage 3: runtime ───────────────────────────────────────────────────────
FROM base AS runner
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

# Copy compiled output + dependencies from builder (Prisma client for Postgres
# is already generated there). prisma client binary is in node_modules.
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --chown=appuser:appgroup package.json ./
# Copy Prisma schemas + migrations (already swapped to Postgres schema in
# builder; migrations/ now contains only the postgres baseline).
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma

# Create uploads dir with proper permissions
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads

# Switch to non-root user
USER appuser

# Expose backend port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/ready', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use tini as PID 1 for proper signal handling (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
# C3 fix: apply migrations before starting the server. If migrations are
# already up-to-date, `migrate deploy` is a no-op (idempotent).
# BACKEND_DATABASE_URL must be set in the runtime environment (compose does
# this from a Docker secret + env var, see docker-compose.prod.yml).
CMD ["sh", "-c", "bunx prisma migrate deploy && node dist/index.js"]
