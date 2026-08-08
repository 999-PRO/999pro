-- v25.7 (TZ ЭТАП 2.6): make User.phone NOT NULL.
-- Existing NULL phones are backfilled with a unique placeholder so the
-- NOT NULL constraint can be added without breaking existing rows.
-- Format: "pending-<userId>" — admin can clean these up via Studio later.

UPDATE "User"
SET "phone" = 'pending-' || "id"
WHERE "phone" IS NULL;

ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
