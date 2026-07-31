# ============================================================================
# 999 PRO Studio — production Dockerfile
# v25.0-audit-fix: full Bun-based pipeline
#   - build context is the PROJECT ROOT so the `@999pro/shared` workspace
#     package (file:../../packages/shared) is reachable.
#   - uses `bun install --frozen-lockfile --ignore-scripts`
#   - uses `bun run build` (Next.js 16 standalone output, flat structure
#     because next.config.ts sets `turbopack.root: __dirname`)
# Stack: Next.js 16, React 19, Tailwind 4 (admin panel)
# ============================================================================
FROM oven/bun:1-debian AS base
ENV NODE_ENV=production
WORKDIR /app

# openssl + tini + ca-certs
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
# Studio's package.json declares @999pro/shared as `file:../../packages/shared`.
# Copy BOTH manifests before install so the file: dependency resolves.
COPY mini-services/studio/package.json ./package.json
COPY mini-services/studio/bun.lock ./bun.lock
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile --ignore-scripts

# ─── Stage 2: builder ───────────────────────────────────────────────────────
FROM base AS builder
COPY mini-services/studio/package.json ./package.json
COPY mini-services/studio/bun.lock ./bun.lock
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile --ignore-scripts
# Copy shared package source so the file: dependency resolves to real code.
COPY packages/shared ./packages/shared
# Copy studio source + configs (paths relative to root context).
COPY mini-services/studio/src ./src
COPY mini-services/studio/public ./public
COPY mini-services/studio/next.config.ts ./next.config.ts
COPY mini-services/studio/tsconfig.json ./tsconfig.json
COPY mini-services/studio/postcss.config.mjs ./postcss.config.mjs
COPY mini-services/studio/eslint.config.mjs ./eslint.config.mjs
COPY mini-services/studio/next-env.d.ts ./next-env.d.ts

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ─── Stage 3: runtime ───────────────────────────────────────────────────────
FROM base AS runner
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

WORKDIR /app

# Next.js standalone output is flat (server.js at /app/server.js) thanks to
# `turbopack.root: __dirname` in next.config.ts. Copy the whole standalone dir
# (server.js + minimal node_modules), then static + public assets.
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

USER appuser
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/studio', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
