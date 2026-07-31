# 999 PRO v24.2 — UX Fixes Release

This release fixes 6 bugs in the AI assistant (main app + Studio admin panel).

## What's Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | AI agent in main app said "AI не настроен" even after adding API key in Studio | `getActiveProvider()` now falls back to ANY enabled provider (not just `isDefault:true` ones). Admins no longer need to tick "Use by default" on a single provider. |
| 2 | Studio AI assistant input field didn't accept text (in product editor) | Set `modal={false}` on the product-edit `Dialog` to disable Radix's FocusScope trap that was yanking focus back from the Portal-rendered AI input. |
| 3 | Main app AI input field "flew up" when focused (page visible below) | Removed double keyboard compensation — overlay already shrinks to `visualViewport.height`, so the extra `paddingBottom = keyboardHeight + 8` was lifting the input off-screen. |
| 4 | Animated circular mic button stayed visible during conversation (in the way) | Compact `NeonCore` now only renders when `!hasUserSentMessage` OR user is actively speaking. Phase label stays visible for status. |
| 5 | AI response text overflowed below screen — no auto-scroll | Removed `!isTyping` guard (was skipping scroll when typing ended), added `response` + `conversationLog` to scroll deps, added `ResizeObserver` for async card/image rendering. |
| 6 | Studio AI agent scroll didn't work | Removed inline `height: 0` from scroll container (broke flexbox overflow detection), changed empty-state `h-full` → `min-h-full` so content can grow and trigger scrollbar. |

## Quick Start (Linux/macOS with Bun)

```bash
# 1. Install dependencies for all 3 services
bun install                              # frontend (workspace root)
cd mini-services/backend && bun install  # backend (Express + Prisma)
cd ../studio && bun install              # studio admin panel
cd ../..

# 2. Initialize database
cd mini-services/backend
bunx prisma generate
bunx prisma migrate deploy
bunx tsx prisma/seed-demo.ts                              # 4 demo users + 20 products + 3 banners
ADMIN_PASSWORD=admin12345 bunx tsx scripts/create-admin.ts --force  # admin user
cd ../..

# 3. Start all 3 services (each in its own terminal, or use the scripts)
#    Backend  → http://localhost:4000  (Express + Socket.IO + Prisma)
#    Frontend → http://localhost:3000  (Next.js 16 main app)
#    Studio   → http://localhost:3001  (Next.js admin at /studio)
bash scripts/start-backend.sh &
bash scripts/start-frontend.sh &
bash scripts/start-studio.sh &
```

## Test Accounts

| Role | Email | Password | Where |
|------|-------|----------|-------|
| Admin | admin@999.pro | admin12345 | Studio (`/studio`) — TOTP bypassed in dev |
| Demo user | maria@999.pro | demo12345 | Main app |
| Demo user | denis@999.pro | demo12345 | Main app |
| Demo user | kate@999.pro | demo12345 | Main app |
| Demo user | ivan@999.pro | demo12345 | Main app |

## Configuration

All `.env` files are included with dev defaults (valid VAPID keys, random JWT secret).
To use a real AI provider, either:
1. **Studio → AI API**: Add a provider (DeepSeek, OpenAI, etc.) with your API key. It's stored encrypted in the DB. (Bug 1 fix means you no longer need to tick "Use by default".)
2. **OR** set `DEEPSEEK_API_KEY` in `mini-services/backend/.env` and restart the backend.

## Files Changed in v24.2

- `mini-services/backend/src/lib/ai-provider.ts` — Bug 1 fix
- `mini-services/backend/src/routes/ai-providers.ts` — Bug 1 fix (status endpoint)
- `mini-services/studio/src/components/products-manager.tsx` — Bug 2 fix (`modal={false}`)
- `mini-services/studio/src/components/studio-ai-assistant.tsx` — Bug 2 & 6 fixes
- `src/modules/ai-assistant/index.tsx` — Bug 3, 4, 5 fixes
- `scripts/start-{backend,frontend,studio}.sh` — new launch scripts (Bun-based)
