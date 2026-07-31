# ============================================================================
# 999 PRO Studio — production Dockerfile
# Wave 2 (C-DEPLOY-001): multi-stage build, Next.js standalone output
# Stack: Next.js 16, React 19, Tailwind 4 (admin panel)
# ============================================================================
FROM node:24-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN npm install --omit=dev --no-fund --no-audit

# ─── Stage 2: builder ───────────────────────────────────────────────────────
FROM base AS builder
COPY package.json bun.lock* ./
RUN npm install --no-fund --no-audit
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: runtime ───────────────────────────────────────────────────────
FROM base AS runner
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

USER appuser
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/studio', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
