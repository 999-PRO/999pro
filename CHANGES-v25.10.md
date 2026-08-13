# 999 PRO — v25.10 Changelog

## What's Fixed / Added

### Task №1 — Share + Deep-link Architecture (PRIORITY)
- **share-page-client.tsx**: rewrote as a minimal redirect splash. Real users
  are auto-redirected to `/?product=<id>` which opens the EXISTING Product
  Viewer in the SPA. Crawlers (WhatsApp/Telegram/FB/X) don't execute JS, so
  they read the OG meta tags emitted by `generateMetadata` and stop there.
  PWA installed: OS Universal Link intercepts the click → app opens at
  `/?product=<id>` → SPA opens the viewer. The old standalone share UI
  (gallery, 3 CTAs, related, reviews) is GONE — the user sees the SAME
  Product Viewer they'd see when tapping a product card inside the app.
- **og/[shortId]/route.ts**: rewrote to use letterbox-with-blurred-bg layout.
  Background: source resized to COVER 1200×1200 + blurred + darkened.
  Foreground: source resized to CONTAIN (no crop) — original 3:4 photo is
  shown in full. PNG alpha preserved for transparency. Solves the
  "vertical photo gets cropped to square" complaint.
- **scripts/setup.js**: now writes `NEXT_PUBLIC_APP_URL` + `APP_PUBLIC_URL`
  + new `STUDIO_URL` to the frontend `.env`. Previously the frontend .env
  had NO public URL → metadataBase fell back to `http://localhost:3000` →
  broken share previews in WhatsApp/FB/X.

### Task №2 — Product Cards 3:4 + Smaller Radius
- **product-card.tsx**: `aspect-square` → `aspect-[3/4]`; `rounded-3xl` (40px)
  → `rounded-xl` (20px); `containIntrinsicSize: 320px` → `440px` to avoid
  scrollbar jitter with taller cards.
- Updated 6 skeletons + duplicate inline cards:
  - `products-grid.tsx`, `smart-blocks.tsx`, `desktop-home.tsx`
  - `favorites-sheet.tsx`, `reviews-view.tsx`
  - `product-page.tsx` (similar-products strip)
- Product Viewer main images (mobile + desktop) are unchanged — they were
  already 3:4 + cover.

### Task №3 — Fullscreen Vertical Product Feed (NEW)
- **product-feed.tsx** (new): Reels/TikTok-style vertical snap-scrolling feed.
  - Pulls products from existing `/api/products?shuffle=true&limit=20` — no
    second data source. When admin adds a product, it can appear here.
  - Each slide: 3:4 video/image (NO crop, `object-contain`), bottom info bar
    with title + price + short description, two primary CTAs ("Описание" +
    "Перейти к товару"), and a row of existing contact CTAs (WhatsApp, Phone,
    Leave Request) preserved from the product page.
  - "Описание" opens a bottom sheet overlay with full description + CTA.
  - "Перейти к товару" dispatches `999pro:open-product` event → existing
    Product Viewer opens; feed closes.
  - Auto-plays video on the active slide only (paused on others).
- Mounted globally in `app-shell.tsx`. Triggered by a new "Открыть ленту"
  button on the home page next to "Открыть каталог".

### Task №4 — Push Notifications Audit (P0 + P1 fixes)
- **providers.tsx** (P0 fix): `PUSH_SUBSCRIPTION_CHANGED` handler was making
  raw `fetch()` calls to `/api/push/subscribe` + `/api/push/unsubscribe`
  WITHOUT an `Authorization` header. Both routes are `requireAuth` → silent
  401. After ~60 days when the browser rotated the push endpoint, the SW
  re-subscribed locally but the backend never learned → user silently
  stopped receiving push. Now reads token from `useAuthStore.getState().token`
  at event time and attaches `Authorization: Bearer <token>`. If user is
  logged out, skips sync (SW retries on next focus via IDB-cached VAPID).
- **use-push.ts** (P1 fix): `VAPID_DISABLED_KEY` was permanent (no TTL, no
  auto-recovery). If backend returned 503 once, the user NEVER received
  push again until manual localStorage clear. Now stores `1|<timestamp>`
  and auto-recovers after 24h. Also migrates existing legacy `'1'` flags.

### Task №5 — User Search Fixes
- **universal-search.ts**: added `mode: 'insensitive'` to all `contains`
  calls (works on Postgres; harmless on SQLite). Added JS-side `.toLowerCase()
  .includes()` filter for SQLite Cyrillic case-insensitivity. Added
  `normalizePhone()` helper — strips non-digits so "+7 999 123-45-67" matches
  stored "+79991234567". Over-fetches 30 candidates then JS-filters to LIMIT.
- **users.ts**: same phone normalization + `mode: 'insensitive'` added.
  Admin email/phone search now uses normalized comparison too.

### Task №6 — Video Upload in Products (admin-only)
- **prisma/schema.prisma**: added `videoUrl String?` + `videoPoster String?`
  to Product model.
- **prisma/migrations/v25_10_product_video/migration.sql**: migration
  adding both columns (works on SQLite + Postgres).
- **schemas.ts** + **products.ts**: extended create/update schemas + route
  handlers to accept and persist videoUrl/videoPoster.
- **studio/products-manager.tsx**: new `<ProductVideoUploader>` component
  with progress bar, file picker (MP4/WebM/MOV/AVI/MKV, 100MB limit),
  preview, replace, delete. Uses XMLHttpRequest for upload progress events.
- **product-page.tsx** + **product-page-desktop.tsx**: render `<video
  controls>` above the image carousel when `product.videoUrl` is set.
  Same 3:4 aspect as the gallery.

### Task №10 — Server-side Video Compression (FFmpeg)
- **lib/video-compress.ts** (new): spawns ffmpeg as child process.
  - H.264 (libx264) High profile, CRF 23, preset medium.
  - Scale to 720×960 (3:4) with `force_original_aspect_ratio=decrease,pad`
    → preserves source aspect, pads to exactly 3:4.
  - AAC 128k stereo (retries without audio if source has no audio track).
  - `+faststart` for instant playback + Range seek support.
  - Extracts first frame as JPEG poster.
  - If ffmpeg is missing: falls back to original (with warning toast).
  - Deletes raw original after successful compression.
- **upload.ts**: new `POST /api/upload/video` endpoint — admin-only,
  100MB limit, validates video MIME, runs `compressProductVideo()`, returns
  `{ url, posterUrl, compressed, warning? }`.

### Task №12 — Video in Chat
- **chat.tsx**: removed the explicit video upload block (lines 1455-1466).
  Added a 50MB per-file size guard for videos. The backend has always
  supported video (`mediaType: 'video'`, video MIME allowlist, video
  attachment extraction + full-screen player) — only the SEND path was
  blocked. Existing video messages now render correctly.

### Task №13 — AudioHub Seek Bug + Media Session API
- **audio-hub.ts** (root cause fix): `/api/audio-hub/stream` was setting
  `Accept-Ranges: bytes` but ignoring the client's Range header — streamed
  the entire file from byte 0. iOS Safari refused to play/seek entirely;
  Chrome waited for full download + replayed 1-2s around seek point (the
  "stutter / loop" bug). Now: reads incoming Range header, forwards to
  upstream fetch, mirrors 206 + Content-Range + Content-Length. If upstream
  doesn't honour Range (returns 200), honestly sets `Accept-Ranges: none`.
- **audio-player-manager.ts**: added `seeking` / `seeked` event listeners
  + `isSeeking` state. The `timeupdate` handler now SKIPS updates while
  `isSeeking` is true → no more flicker between old/new positions during
  seek. Added Media Session API integration: `navigator.mediaSession.metadata
  = new MediaMetadata({ title, artist, artwork })` on every play() +
  `setActionHandler('play' | 'pause' | 'seekbackward' | 'seekforward' |
  'seekto' | 'previoustrack' | 'nexttrack')`. Lock-screen / Control Center /
  Bluetooth buttons / hardware media keys now work. iOS background playback
  is no longer auto-paused because the OS knows it's "media".

### Task №14 — TV / Smart-TV Audit
- **next.config.ts**: replaced hardcoded `http://localhost:3001` for the
  `/studio` rewrite with `process.env.STUDIO_URL || 'http://localhost:3001'`.
  On Smart TV / multi-host deployments the operator sets `STUDIO_URL` to
  the studio's public URL — otherwise the TV can't reach studio via localhost.
- **.env.example** + **scripts/setup.js**: documented `STUDIO_URL` env var
  and writes it to the frontend `.env` on `npm run setup`.

### Task №15 — VideoHub Opened
- **media-hub-overlay.tsx**: removed the admin-only gate on the Video Hub
  button. Was `if (isAdmin) openSection('films') else toast('скоро будет
  доступен')`. Now opens for ALL users. The films module (HLS/DASH/iframe/
  native adapters) is stable. Admin-only restrictions for film UPLOADS
  remain enforced server-side (POST /api/films still requires admin).

### Task №16 — Buy → Leave Request
- **lead-sheet.tsx** (new): minimal modal that captures name, phone,
  contact method (WhatsApp/Telegram/Phone), optional comment. POSTs to
  existing `/api/leads` (public, rate-limited). Pre-fills from logged-in
  user. Auth-aware (`auth: true` optional → attaches userId when logged in).
- **product-page.tsx** + **product-page-desktop.tsx**: replaced "Купить" /
  "Купить сейчас" CTA with "Оставить заявку" — dispatches `open-lead` event
  instead of `open-checkout`. The cart / checkout flow is preserved (the
  "В корзину" button next to it is unchanged) — users can still add to
  cart and check out via the cart icon if needed.
- **app-shell.tsx**: mounts `<LeadSheet />` globally + the new
  `<ProductFeed />`.

## Build Status

- Frontend `next build`: ✅ PASS
- Backend `tsc`: ✅ PASS
- Studio `next build`: ✅ PASS
- All 3 services TypeScript-clean (no `tsc --noEmit` errors).

## Deployment Notes

1. **Run `npm run setup`** on the server — rewrites `.env` files with the
   new `STUDIO_URL` + `NEXT_PUBLIC_APP_URL` keys. **Or manually add** these
   to your existing `.env`:
   ```
   STUDIO_URL=http://localhost:3001
   NEXT_PUBLIC_APP_URL=https://tri-999.online
   APP_PUBLIC_URL=https://tri-999.online
   ```
2. **Run Prisma migration** to add the new video columns:
   ```bash
   cd mini-services/backend
   npx prisma migrate deploy
   # or for dev:
   npx prisma migrate dev --name v25_10_product_video
   ```
3. **Install FFmpeg** for video compression (optional but recommended):
   ```bash
   sudo apt-get install -y ffmpeg
   ```
   Without FFmpeg, video uploads still work but skip compression (admin UI
   shows a warning toast).
4. **Restart services**:
   ```bash
   sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio
   ```

## Files Modified / Added

### Frontend (src/)
- MODIFIED: components/app-shell.tsx
- MODIFIED: components/product-card.tsx
- MODIFIED: components/product-page.tsx
- MODIFIED: components/product-page-desktop.tsx
- MODIFIED: components/products-grid.tsx
- MODIFIED: components/smart-blocks.tsx
- MODIFIED: components/desktop-home.tsx
- MODIFIED: components/favorites-sheet.tsx
- MODIFIED: components/reviews-view.tsx
- MODIFIED: components/chat.tsx
- MODIFIED: components/providers.tsx
- MODIFIED: lib/use-push.ts
- MODIFIED: lib/audio-player-manager.ts
- MODIFIED: lib/types.ts
- MODIFIED: modules/media-hub/components/media-hub-overlay.tsx
- MODIFIED: app/page.tsx
- MODIFIED: app/p/[shortId]/share-page-client.tsx (rewrote)
- MODIFIED: app/og/[shortId]/route.ts
- ADDED: components/lead-sheet.tsx
- ADDED: components/product-feed.tsx

### Backend (mini-services/backend/)
- MODIFIED: src/lib/schemas.ts
- MODIFIED: src/routes/products.ts
- MODIFIED: src/routes/universal-search.ts
- MODIFIED: src/routes/users.ts
- MODIFIED: src/routes/audio-hub.ts
- MODIFIED: src/routes/upload.ts
- MODIFIED: prisma/schema.prisma
- ADDED: src/lib/video-compress.ts
- ADDED: prisma/migrations/v25_10_product_video/migration.sql

### Studio (mini-services/studio/)
- MODIFIED: src/components/products-manager.tsx
- MODIFIED: src/lib/types.ts

### Config / Root
- MODIFIED: next.config.ts
- MODIFIED: .env.example
- MODIFIED: scripts/setup.js
- ADDED: CHANGES-v25.10.md (this file)
