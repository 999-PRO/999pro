# Локальная разработка на SQLite (без PostgreSQL)

Проект в продакшене работает на **PostgreSQL** (см. `deploy/README.md`).
В архиве активная схема — `mini-services/backend/prisma/schema.prisma` с
`provider = "postgresql"`.

Для локальной разработки на машине без PostgreSQL:

1. Подмените схему на SQLite-вариант:

   ```bash
   cd mini-services/backend/prisma
   cp schema.prisma schema.prisma.pg.bak      # сохраните postgres-версию
   cp schema.prisma.sqlite.bak schema.prisma  # включите sqlite-версию
   ```

2. Пропишите DATABASE_URL в `mini-services/backend/.env`:

   ```
   DATABASE_URL="file:./db/custom.db"
   ```

3. Примените схему и запустите:

   ```bash
   cd mini-services/backend
   npx prisma db push
   npm run seed        # демо-данные (по желанию)
   npm run dev
   ```

4. Перед деплоем верните PostgreSQL-схему и выполните
   `npx prisma migrate deploy` (см. `deploy.sh`).

> Файлы `.env` в архив не входят — создайте их по образцу `.env.example`.
