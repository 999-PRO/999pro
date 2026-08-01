# PostgreSQL Baseline Migration

This directory contains the initial PostgreSQL schema for 999 PRO v25.1+.

## What's here

- `migration.sql` — the full DDL (CREATE TABLE + indexes + foreign keys)
  generated from `prisma/schema.prisma` via:
  ```bash
  npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
  ```

## How to apply

The migration is applied automatically by `npm run build` (which runs
`prisma migrate deploy`) or by `./deploy.sh`. To apply it manually:

```bash
cd mini-services/backend
npx prisma migrate deploy
npx prisma generate
```

Prisma tracks applied migrations in the `_prisma_migrations` table. Once
`0_postgres_baseline` is applied, subsequent schema changes should be made
via `npx prisma migrate dev --name <description>` (which generates a new
timestamped migration directory alongside this one).

## Migrating from SQLite

If you have an existing SQLite database (`dev.db`) that you want to migrate
to PostgreSQL:

1. Install PostgreSQL on the target server.
2. Create the database + user:
   ```bash
   sudo -u postgres psql
   CREATE USER ninepro WITH PASSWORD 'your-strong-password';
   CREATE DATABASE ninepro OWNER ninepro;
   \q
   ```
3. Set `DATABASE_URL` in `mini-services/backend/.env`:
   ```
   DATABASE_URL="postgresql://ninepro:your-strong-password@localhost:5432/ninepro?schema=public&connection_limit=10&pool_timeout=10"
   ```
4. Apply the baseline migration:
   ```bash
   cd mini-services/backend
   npx prisma migrate deploy
   ```
5. Migrate the data from SQLite to PostgreSQL using `pgloader`:
   ```bash
   # Install pgloader
   sudo apt-get install -y pgloader
   # Run the migration
   pgloader ./dev.db postgresql://ninepro:your-strong-password@localhost:5432/ninepro
   ```
   Or export/import table-by-table with `sqlite3 .dump` + `psql \i`.

6. Verify the data:
   ```bash
   npx prisma studio
   ```

7. Start the app:
   ```bash
   npm run build
   npm run start
   ```

## Why a single baseline instead of many small migrations?

The legacy SQLite migration history (`20260721092117_init_sqlite/`) was not
directly portable to PostgreSQL — the SQL dialect differs (`INTEGER PRIMARY
KEY` vs `TEXT`, `Decimal` as `TEXT` vs `DECIMAL(10,2)`, etc.). Rather than
maintain two parallel migration histories, we ship one clean PostgreSQL
baseline generated from the current schema. Future schema changes will
produce timestamped PostgreSQL migrations alongside this baseline.

v25.2: the old SQLite migration folder has been removed. The migration_lock.toml
locks the provider to `postgresql`. `prisma migrate deploy` will apply only
PostgreSQL migrations from this folder.
