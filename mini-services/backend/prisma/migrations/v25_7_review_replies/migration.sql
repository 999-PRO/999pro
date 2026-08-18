-- v25.7 (TZ ЭТАП 2.3): Review replies — add parentId + self-relation.
--
-- Goals:
--   • Allow admins to post threaded replies under any review.
--   • Keep existing top-level reviews intact (no data migration needed).
--   • Drop the strict @@unique([productId, userId]) constraint so an admin
--     (or any user) can post multiple replies on the same product. The
--     "one top-level review per user per product" rule is now enforced in
--     application code (POST /api/reviews handler).
--
-- Compatible with PostgreSQL (production baseline — see 0_postgres_baseline).
-- For SQLite dev fallback (scripts/use-sqlite.js), Prisma will auto-generate
-- an equivalent migration on `prisma migrate dev`.

-- 1. Add nullable parentId column (existing rows get NULL — they are
--    top-level reviews, which is correct).
ALTER TABLE "Review" ADD COLUMN "parentId" TEXT;

-- 2. Drop the strict per-user-per-product unique constraint.
--    Name follows Prisma's convention: <Table>_<col1>_<col2>_key
DROP INDEX IF EXISTS "Review_productId_userId_key";
-- Also drop the legacy variant in case some deployments use the older
-- Prisma convention (table-qualified).
DROP INDEX IF EXISTS "review_productid_userid_key";

-- 3. Add an index on parentId so listing replies for a review is fast
--    (Prisma generates a "Review_parentId_idx" name; we create the same
--    index here so existing DBs match a fresh `prisma migrate reset`).
CREATE INDEX IF NOT EXISTS "Review_parentId_idx" ON "Review"("parentId");

-- 4. Add the self-referencing foreign key. ON DELETE CASCADE so deleting
--    a parent review automatically deletes all its replies (matches the
--    Prisma schema's `onDelete: Cascade` on the `parent` relation).
--    The constraint name follows Prisma's convention: Review_parentId_fkey
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Review"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
