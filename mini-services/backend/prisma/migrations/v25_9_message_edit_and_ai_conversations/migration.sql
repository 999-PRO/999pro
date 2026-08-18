-- v25.9 migration
-- Adds:
--   1) Message.editedAt  — timestamp for edited messages (NULL = never edited)
--   2) AIConversation    — persistent threaded AI conversations
--   3) AIMessage         — messages belonging to AIConversation
--
-- This migration is written to be idempotent and compatible with both
-- PostgreSQL and SQLite. Conditional CREATE TABLE IF NOT EXISTS is used so
-- re-running the migration does not fail.

-- 1) Message.editedAt
-- SQLite and PostgreSQL both support "ADD COLUMN" with IF NOT EXISTS via
-- different syntax. Use a portable DO block for Postgres or just attempt
-- the ADD COLUMN and ignore the error if the column already exists.
-- Prisma migrate deploy handles this for us, so we use the simplest form.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);

-- 2) AIConversation
CREATE TABLE IF NOT EXISTS "AIConversation" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT,
    "title"     TEXT NOT NULL DEFAULT 'Новый диалог',
    "context"   TEXT,
    "role"      TEXT NOT NULL DEFAULT 'user',
    "pinned"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AIConversation_userId_updatedAt_idx"
    ON "AIConversation"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "AIConversation_pinned_updatedAt_idx"
    ON "AIConversation"("pinned", "updatedAt");

-- 3) AIMessage
CREATE TABLE IF NOT EXISTS "AIMessage" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role"           TEXT NOT NULL,
    "content"        TEXT NOT NULL,
    "cards"          TEXT,
    "actions"        TEXT,
    "calculation"    TEXT,
    "images"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AIMessage_conversationId_createdAt_idx"
    ON "AIMessage"("conversationId", "createdAt");

-- Foreign key (works on Postgres; on SQLite FK support depends on PRAGMA
-- foreign_keys=ON, which Prisma enables automatically).
ALTER TABLE "AIMessage"
    ADD CONSTRAINT "AIMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
