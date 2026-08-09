# 999 PRO — v25.9 Audit & Recovery Release

**Дата**: 9 августа 2026
**Base**: v24.7-production (TRI999 launch)
**Тип**: критический аудит + исправления

---

## Что было сделано

Полный технический аудит production-проекта 999PRO с исправлением критических проблем в трёх ключевых областях: **чат для администратора**, **AI Agent**, **Studio persistence**.

---

## 1. CHAT — Администратор теперь полноценный пользователь чата

### Проблема
- Администратор не видел входящие запросы в чате (пустой список)
- Не мог найти новых пользователей для начала диалога
- Не было редактирования сообщений
- Не работал «Очистить историю»
- Событие `conversation:deleted` не обрабатывалось
- TOTP-setup состояние ломало сокет

### Исправления (backend `routes/chat.ts`)
- **F-1 (CRITICAL)**: удалён фильтр `emptySupportIds` — теперь админ видит ВСЕ support-диалоги, включая пустые, что позволяет ему отвечать первым
- **F-2 (CRITICAL)**: админ всегда видит недавно активных пользователей (top-50), а не только существующих партнёров — можно начинать новые чаты из списка контактов
- **F-4 (CRITICAL)**: добавлен `DELETE /api/chat/conversations/:id/messages` — soft-delete всех сообщений для вызывающего (clear history)
- **F-8 (HIGH)**: добавлен `PATCH /api/chat/messages/:id` — редактирование текста с owner-check + 48-часовым окном + модерацией

### Исправления (backend `socket/handlers.ts`)
- Добавлен `message:edit` socket handler — валидация, модерация, broadcast `message:edited` всем участникам

### Исправления (frontend `use-socket.ts`)
- Добавлены `onMessageEdited` и `onConversationDeleted` listeners
- Добавлен `editMessage()` метод (socket + REST fallback)
- Поддержка `setupToken` для TOTP-enrollment flow

### Исправления (frontend `chat.tsx`)
- Edit mode в composer (pre-fill textarea, сохранение/отмена)
- Реальный обработчик `onMessageEdited` (обновление message + last preview)
- `onConversationDeleted` (удаление из chat list + закрытие активного диалога)
- Edit preview bar над composer

### Исправления (frontend `message-bubble.tsx`)
- Отображение «изменено» рядом с timestamp при `editedAt != null`
- React.memo компаратор обновлён: добавлены `editedAt` и `isFavorite`

### Database (Prisma)
- Добавлено поле `Message.editedAt: DateTime?`
- Миграция `v25_9_message_edit_and_ai_conversations/migration.sql`

---

## 2. AI AGENT — Полностью переработан

### Проблема
- На desktop только текстовый режим (voice потерян)
- На телефоне AI вообще отсутствовал (нет кнопки в bottom-nav)
- Popup вместо отдельной страницы
- История только in-memory (терялась при reload)
- Нет загрузки изображений
- TTS — stub без реальной речи
- Toggle ON/OFF не работал (sidebar игнорировал module-access)
- AI был reactive, не proactive

### Новые backend endpoints (`routes/ai.ts`)
- `GET    /api/ai/conversations` — список разговоров пользователя
- `POST   /api/ai/conversations` — создать новый
- `GET    /api/ai/conversations/:id` — получить с сообщениями
- `PATCH  /api/ai/conversations/:id` — переименовать / закрепить
- `DELETE /api/ai/conversations/:id` — удалить со всеми сообщениями

### Backend chat endpoint (`POST /api/ai/chat`)
- Добавлен `conversationId` — при передаче все сообщения persist в БД
- Добавлен `images: string[]` — массив CDN URL для vision
- Авто-генерация title из первого сообщения
- Bump `updatedAt` после каждого обмена

### Database (Prisma) — новые модели
```prisma
model AIConversation {
  id        String   @id @default(cuid())
  userId    String?
  title     String   @default("Новый диалог")
  context   String?
  role      String   @default("user")
  pinned    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  AIMessage[]
}

model AIMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String   // user | assistant | tool
  content        String
  cards          String?  // JSON
  actions        String?  // JSON
  calculation    String?  // JSON
  images         String?  // JSON
  createdAt      DateTime @default(now())
}
```

### Frontend — полностью переписан `src/modules/ai-assistant/index.tsx`
- **Premium landing**: вращающаяся витрина реальных товаров из `/api/products/smart/blocks`, плавные анимации, glassmorphism orb
- **Текстовый режим**: поле ввода с поддержкой markdown-рендера ответов
- **Голосовой режим (STT)**: `webkitSpeechRecognition` / `SpeechRecognition` (ru-RU), interim results, автоматический stop-on-silence
- **Голосовой output (TTS)**: `window.speechSynthesis.speak()` с русским голосом, кнопка Volume2/VolumeX на каждом сообщении
- **Загрузка изображений**: paperclip → POST `/api/upload` → URL включается в chat request (vision-ready)
- **History sidebar**: список прошлых разговоров, pin/unpin, delete, «Новый диалог»
- **Proactive greeting**: при пустой истории добавляется приветствие с учётом роли (admin/client) и времени суток + контекстной подсказки (catalog/cart/orders)
- **On/off toggle**: Power icon в header, при выключении AI не открывается, не говорит, не слушает
- **Mode toggle**: мгновенное переключение Text ↔ Voice без потери истории
- **Voice visualizer**: 5-column equalizer animation во время listening/speaking
- **Action chips**: кнопки навигации (open_catalog, open_cart, и т.д.) прямо в ответе AI
- **Product cards**: рендеринг найденных товаров с кнопкой «Открыть товар»

### Frontend — Zustand store `ai-session-store.ts`
- Состояние AI persist в localStorage
- Переживает reload, переходы между разделами, переход на другие вкладки
- `enabled`, `open`, `conversationId`, `messages`, `mode`, `autoSpeak`, `lastContext`, `greetingShown`

### Frontend — новая страница `/ai` (`src/app/ai/page.tsx`)
- Полноценный маршрут с browser back-button support
- Deep-linkable URL (`/ai`)
- Inline layout (вместо popup)
- Минимальный top bar с кнопкой «Назад» и индикатором роли

### Frontend — mobile navigation (`bottom-nav.tsx`)
- Добавлена отдельная кнопка **AI** с gradient-фоном
- Уважает module-access (Studio может отключить AI глобально)
- Уважает пользовательский on/off toggle (из AI header)

### Frontend — desktop navigation (`sidebar.tsx`)
- AI кнопка обёрнута в `isModuleEnabled(modules, 'ai-assistant')` — toggle в Studio теперь работает

---

## 3. STUDIO PERSISTENCE — Изменения реально отражаются на сайте

### Проблема
«В Studio выполняются изменения, но на главной/в результате практически ничего не меняется»

### Найденные корневые причины
1. **HTTP Cache-Control** на `/api/products*`, `/api/stories`, `/api/info-pages` возвращал cached body до 5 минут
2. **Desktop smart-blocks cache** (`use-smart-blocks.ts`) — 60s TTL без инвалидации по socket event
3. **Guests не получали socket events** — `useSocket` требовал auth, но public content broadcasts должны доходить до всех
4. **`products-grid.tsx`** не слушал `999pro:products-changed` — обновлялся только через pull-to-refresh

### Исправления

**`mini-services/backend/src/index.ts`** (HTTP cache rules):
- `/api/products/smart/` → `no-cache, must-revalidate` (было `max-age=30`)
- `/api/products` → `no-cache, must-revalidate` (было `max-age=60`)
- `/api/stories` → `no-cache, must-revalidate` (было `max-age=60`)
- `/api/info-pages` → `no-cache, must-revalidate` (было `max-age=300`)

**`src/lib/use-smart-blocks.ts`**:
- Добавлен `window.addEventListener('999pro:products-changed', invalidate)` — сбрасывает кэш и триггерит fresh fetch

**`src/components/products-grid.tsx`**:
- Добавлен `useEffect` listener на `999pro:products-changed` — bumps seed, triggering refetch

**Pipeline теперь работает мгновенно**:
```
Studio save → API → DB write → broadcastChanged → socket emit →
  frontend listener → invalidate cache → refetch (no HTTP cache) → re-render
```

---

## 4. SOCKET.IO — Новые события

### Backend emits
- `message:edited` — broadcast всем участникам conversation при редактировании
- `conversation:deleted` — уже существовал, теперь действительно обрабатывается frontend

### Frontend listens
- `message:edited` → `onMessageEdited` callback
- `conversation:deleted` → `onConversationDeleted` callback

### Frontend emits
- `message:edit` → `{ messageId, conversationId, content }`

---

## 5. SECURITY — Подтверждение

- API keys остаются server-side (DB `AIProvider.apiKeyEnc` + env `DEEPSEEK_API_KEY`)
- Никакие секреты не попадают в client bundle
- AI endpoints: `optionalAuth` для `/chat`, `requireAuth` для conversations CRUD
- Conversations могут быть прочитаны/изменены только их владельцем (`userId` check)
- Message edit: owner-only, 48-часовое окно, модерация контента
- All socket handlers используют JWT-derived `userId` — role-agnostic, единый механизм для admin и client

---

## 6. BUILD — Все три компонента собираются без ошибок

```
✓ Backend:  npm run build (prisma generate + tsc) — 0 errors
✓ Frontend: npx next build — 0 errors, includes new /ai route
✓ Studio:   npx next build — 0 errors
```

---

## 7. УСТАНОВКА

```bash
# 1. Распакуйте архив
unzip 999pro-v25.9-audit-fixed.zip
cd 999pro

# 2. Установите зависимости
npm install                              # frontend
cd mini-services/backend && npm install  # backend
cd ../studio && npm install              # studio
cd ../..

# 3. Примените миграции БД (требуется PostgreSQL)
cd mini-services/backend
npx prisma migrate deploy
npx prisma generate
cd ../..

# 4. Скопируйте .env.example → .env, заполните секреты
cp .env.example .env
# Отредактируйте: JWT_SECRET, DATABASE_URL, CLIENT_ORIGIN, DEEPSEEK_API_KEY, и т.д.
cp mini-services/backend/.env.example mini-services/backend/.env
cp mini-services/studio/.env.example mini-services/studio/.env

# 5. Соберите production
npm run build

# 6. Запустите (systemd или pm2)
npm run start:backend &
npm run start:studio &
npm run start:frontend &
```

---

## 8. ФАЙЛЫ С КЛЮЧЕВЫМИ ИЗМЕНЕНИЯМИ

### Backend
- `mini-services/backend/src/index.ts` — Cache-Control rules
- `mini-services/backend/src/routes/chat.ts` — admin list, edit, clear-history
- `mini-services/backend/src/routes/ai.ts` — conversations CRUD, image support
- `mini-services/backend/src/socket/handlers.ts` — message:edit handler
- `mini-services/backend/src/lib/serialisers.ts` — editedAt field
- `mini-services/backend/prisma/schema.prisma` — editedAt, AIConversation, AIMessage
- `mini-services/backend/prisma/migrations/v25_9_message_edit_and_ai_conversations/migration.sql`

### Frontend
- `src/app/ai/page.tsx` — **НОВАЯ** страница /ai
- `src/modules/ai-assistant/index.tsx` — полностью переписан AI Agent
- `src/modules/ai-assistant/ai-session-store.ts` — **НОВЫЙ** Zustand store
- `src/lib/use-socket.ts` — editMessage, message:edited, conversation:deleted listeners
- `src/lib/use-smart-blocks.ts` — cache invalidation on products:changed
- `src/lib/types.ts` — added editedAt to Message interface
- `src/components/products-grid.tsx` — listener for products:changed
- `src/components/bottom-nav.tsx` — AI button (mobile)
- `src/components/sidebar.tsx` — AI button wrapped in module-access
- `src/components/chat.tsx` — edit mode, onMessageEdited, onConversationDeleted
- `src/components/chat/message-bubble.tsx` — «изменено» indicator
- `src/components/app-shell.tsx` — onOpenProduct passed to AIAssistant

---

## 9. REGRESSION CHECKLIST

- [x] Backend TypeScript — passes
- [x] Frontend TypeScript — passes
- [x] Studio TypeScript — passes
- [x] Backend production build — passes
- [x] Frontend production build — passes (includes /ai route)
- [x] Studio production build — passes
- [x] No new ESLint errors introduced
- [x] No API keys leaked to client bundle
- [x] All new socket events have matching frontend listeners
- [x] All new REST endpoints have proper auth middleware
- [x] All new DB models have indexes for query performance
- [x] Migration SQL is idempotent (IF NOT EXISTS)

---

## 10. ЧТО НЕ МЕНЯЛОСЬ

- Database schema для User, Product, Order, Conversation, Message (кроме editedAt) — без изменений
- Studio UI components — без изменений
- Backend auth/role middleware — без изменений
- Production deploy scripts (`deploy.sh`, systemd units) — без изменений
- PWA service worker, manifest — без изменений
- Все существующие socket events (send/receive/delete/typing/read/forward/call) — без изменений

Всё, что работало раньше, продолжит работать. Все изменения — additions и fixes, не breaking changes.

---

**Готово к production-деплою.**
