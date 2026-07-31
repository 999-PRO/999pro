# 999 PRO v19.1 — Final Release

This is the final production-ready release after a comprehensive pre-release
audit covering security, performance, UX, code quality, and platform
compatibility.

## v19.1 — Audit Fixes (на основе финального аудита)

### P0 — Security (критические исправления)

1. **HTML sanitiser для Info Pages + Hero block** (P0-1)
   - Добавлен `lib/sanitise.ts` на базе `sanitize-html`
   - Все HTML-поля (InfoPage.content, heroBlock.title/badge/description)
     теперь санитизируются на сервере перед сохранением
   - Удаляются `<script>`, `on*` атрибуты, `javascript:` URLs
   - Защита от stored XSS при компрометации admin-аккаунта

2. **Rate limit на `/api/ai/chat` и `/api/ai/order`** (P0-2)
   - Добавлен `aiChatLimiter`: 10 req/min для anonymous, 30 req/min для auth
   - Защита от DeepSeek token-burn DoS (~$260/day на IP без лимита)
   - Keyed on `req.user?.id || req.ip` для корректного разделения

### P1 — Важные исправления

3. **Refresh token TTL из SecuritySettings** (P1-1)
   - `persistRefreshToken` теперь читает `SecuritySettings.refreshTokenTTLDays`
   - Кеширование 60с для производительности
   - Fallback на `JWT_REFRESH_EXPIRES_IN` env, затем default 7d
   - Studio → Безопасность → "Refresh token (дней)" теперь действительно работает

4. **Синхронизация `schema.postgres.prisma`** (P1-2)
   - Добавлены все модели v18.5 (AIKB_*) и v19.0 (AIProvider, PromoCode,
     PromoCodeUsage, BonusPointsSettings, SecuritySettings)
   - Добавлены поля User (totpBackupCodes, emailTwoFactorCode)
   - Добавлены поля Order (promoCode, pointsSpent, pointsDiscount, pointsEarned)
   - Создана миграция `3_add_v19_providers_promo_security/migration.sql`
     (совместима с SQLite и PostgreSQL)

5. **Audit log на AI KB Service + FAQ CRUD** (P1-3)
   - Добавлены `auditLog()` вызовы на все 6 mutation endpoints
   - Добавлены `broadcastChanged('ai-kb:changed')` для real-time обновления

6. **`orderStatusHistory.create` внутри транзакции** (P1-4)
   - Теперь atomic: order update + history create в одном `$transaction`
   - Раньше fire-and-forget после tx → silent failure ломал revert feature

7. **Замена native `confirm()` на `useConfirmDialog`** (P1-5)
   - Обновлены: aikb-manager, ai-providers-manager, delivery-manager,
     promo-codes-manager
   - Единый премиальный UI, доступность (focus trap, aria-labels)

8. **Обновление `.env.example`** (P1-6)
   - Backend: добавлены 7 недокументированных env vars
     (JWT_REFRESH_EXPIRES_IN, TOTP_SETUP_TOKEN_TTL_SEC, MODERATION_LLM_*,
     TURN_*, DATABASE_URL, DEEPSEEK_API_BASE)
   - Studio: полностью переписан, теперь документирует реальные переменные

9. **Исправление расчёта `total` в поиске товаров** (P1-7)
   - Раньше возвращал case-sensitive DB count для Cyrillic queries
   - Теперь возвращает filtered count, корректный для пагинации

10. **`broadcastChanged` на AI KB mutations** (P1-8)
    - Real-time обновление кеша frontend при изменении KB

11. **`console.error` → `logger.error` в lib/** (P1-9)
    - audit.ts, prisma.ts, moderation.ts, ai-kb.ts теперь используют
      структурированный logger (с Sentry forwarding)

12. **LRU cache в films/audio-hub/live-info** (P1-10)
    - Заменили unbounded `Map` на `LRUCache` из `lru-cache`
    - Лимит 100-200 entries, автоматическая eviction
    - Защита от memory leak при длительной работе

13. **Исправление `reset-admin-dialog` setAuthCookie** (P1-11)
    - Добавлен `completeReset()` action в auth-store
    - Теперь auth cookie устанавливается после reset admin
    - Раньше hard page load (F5) после reset перенаправлял на login dialog

### Cleanup — Очистка мёртвого кода

14. **Удалены неиспользуемые зависимости**
    - `sonner` (frontend) — не использовался (есть свой toast system)
    - `leaflet` + `@types/leaflet` (frontend + studio) — приложение использует
      Yandex Maps, не Leaflet
    - Экономия ~2MB в node_modules

15. **Удалены статические assets Leaflet**
    - `public/leaflet/` (frontend + studio) — 384 KB неиспользуемых файлов
    - Включает leaflet.js (147 KB), leaflet.css, 5 PNG иконок

16. **Удалены дубликаты `share-types.ts`**
    - Было 3 одинаковые копии (frontend, studio, shared package)
    - Теперь все импорты идут через `@999pro/shared`
    - Устранён риск рассинхронизации типов

17. **Удалён `lib/rate-limiters.ts`** (38 строк dead code)
    - Файл экспортировал authLimiter/apiLimiter/uploadLimiter
    - Ни один файл не импортировал их (использовались inline в index.ts)

18. **Удалён `requireAdminAuth` dead export**
    - `export const requireAdminAuth = [requireAuth, requireAdmin]` — ни разу
      не использовался (все роуты используют `requireAuth, requireAdmin` как
      отдельные middleware args)

19. **Удалён мёртвый CSS в `globals.css`**
    - Удалены legacy voice-bubble классы (33 строки)
    - Удалены Leaflet override классы (37 строк)
    - Всего ~70 строк мёртвого CSS

20. **Auto-fix неиспользуемых импортов**
    - `bunx eslint src/ --fix` удалил ~49 неиспользуемых импортов
    - Осталось 494 warnings (в основном `any` типы и empty blocks —
      не блокируют release)

## Полный список возможностей v19.0 (предыдущий релиз)

- **AI API** — multi-provider (DeepSeek, OpenAI, Gemini, Claude, Grok,
  OpenRouter, Ollama, Custom) с шифрованием AES-256-GCM
- **Промокоды** — CRUD, % и фиксированная скидка, лимиты, срок действия
- **Бонусные баллы** — настраиваемое начисление/списание, слайдер в чекауте
- **Геолокация** — auto-request + корректный reverse-geocode
- **Доступ к модулям** — 17 тумблеров в Studio
- **Юридические документы** — 8 редактируемых страниц
- **Регистрация** — подтверждение пароля + индикатор надёжности
- **Email-верификация** — настраиваемая в Studio → Безопасность
- **2FA** — TOTP + резервные коды (bcrypt-hashed)
- **Безопасность** — полная политика в Studio (пароли, сессии, 2FA, rate limits)

## Tech Stack

- **Frontend:** Next.js 16 (Turbopack), React 19, Tailwind 4, Zustand,
  Framer Motion, Socket.IO client
- **Backend:** Express 4, Prisma 6, SQLite (dev) / PostgreSQL 16 (prod),
  Socket.IO 4, JWT, argon2id, AES-256-GCM, sanitize-html
- **Studio:** Next.js 16 (basePath=/studio), React 19, Tailwind 4
- **Infrastructure:** Docker, docker-compose, Caddy (reverse proxy + TLS)

## Установка

```bash
# 1. Установить зависимости
bun install
cd mini-services/backend && bun install && cd ../..
cd mini-services/studio && bun install && cd ../..

# 2. Настроить .env (см. .env.example в каждом из 3 проектов)
cp .env.example .env
cp mini-services/backend/.env.example mini-services/backend/.env
cp mini-services/studio/.env.example mini-services/studio/.env
# Сгенерировать секреты:
#   JWT_SECRET=$(openssl rand -hex 48)
#   FIRST_RUN_TOKEN=$(openssl rand -hex 32)
#   RESET_ADMIN_TOKEN=$(openssl rand -hex 32)
#   IP_HASH_PEPPER=$(openssl rand -hex 32)

# 3. Применить схему БД + seed
cd mini-services/backend
bunx prisma generate
bunx prisma db push          # для SQLite dev
# ИЛИ
bunx prisma migrate deploy   # для PostgreSQL prod
bunx tsx prisma/seed-info-pages.ts
SEED_USER_PASSWORD=demo12345 bunx tsx prisma/seed-demo.ts
ADMIN_PASSWORD="admin12345" bunx tsx scripts/create-admin.ts --force
cd ../..

# 4. Запустить все 3 сервиса
bash scripts/start-services-local.sh
```

## Тестовые аккаунты
- **Admin:** `admin@999.pro` / `admin12345`
- **Demo users:** `maria@999.pro`, `denis@999.pro`, `kate@999.pro`, `ivan@999.pro` / `demo12345`

## Production Checklist

- [x] TypeScript: 0 ошибок во всех 3 проектах
- [x] ESLint: 0 ошибок (494 warnings — non-blocking)
- [x] Все сервисы запускаются (backend:4000, frontend:3000, studio:3001)
- [x] HTML sanitiser на всех HTML-полях (XSS protection)
- [x] Rate limits на AI endpoints (DoS protection)
- [x] Audit log на всех mutations
- [x] Schema sync SQLite ↔ PostgreSQL
- [x] Migration для v19.0 моделей
- [x] .env.example полностью документирован
- [x] Dead code удалён (deps, assets, CSS, exports)
- [x] LRU caches везде (no memory leaks)
- [x] Refresh token TTL из DB (Studio-configurable)
- [x] Reset admin flow устанавливает auth cookie
- [x] Native confirm() заменён на accessible dialog
- [x] All new endpoints протестированы вручную

## Архив
- **Файл:** `999pro-v19.1.zip`
- **Размер:** ~3.8 MB
- **Содержит:** 605+ файлов (исходники, миграции, .env.example, документация)
- **Исключено:** node_modules, .next, dev.db, .env (secrets!), logs, uploads
