-- v25.7 (TZ ЭТАП 2.5): Visit model — site-wide page-view tracking.
--
-- Records every visit (page view) to the frontend app. Used by
-- /api/analytics/visits to compute "today / yesterday / week / month /
-- total" visit counts.
--
-- Compatible with PostgreSQL (production baseline).

CREATE TABLE "Visit" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "sessionId" TEXT,
  "path" TEXT NOT NULL,
  "userAgent" TEXT,
  "ip" TEXT,
  "referrer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Visit_createdAt_idx" ON "Visit"("createdAt");
CREATE INDEX "Visit_userId_createdAt_idx" ON "Visit"("userId", "createdAt");
CREATE INDEX "Visit_sessionId_idx" ON "Visit"("sessionId");

ALTER TABLE "Visit"
  ADD CONSTRAINT "Visit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
