-- v25.16: комментарии к объявлениям сообществ + контакты автора
-- Avito-стиль: объявления с телефонами/WhatsApp/Telegram, обсуждение
-- под объявлением с ответами (parentId) и push-уведомлениями.

ALTER TABLE "CommunityPost" ADD COLUMN "contactWhatsApp" TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN "contactTelegram" TEXT;

CREATE TABLE "CommunityComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommunityComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommunityComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommunityComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommunityComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CommunityComment_postId_createdAt_idx" ON "CommunityComment"("postId", "createdAt");
CREATE INDEX "CommunityComment_parentId_idx" ON "CommunityComment"("parentId");
CREATE INDEX "CommunityComment_authorId_idx" ON "CommunityComment"("authorId");

-- PostgreSQL variant (для прод-БД): см. комментарии ниже.
-- ALTER TABLE "CommunityPost" ADD COLUMN     "contactWhatsApp" TEXT;
-- ALTER TABLE "CommunityPost" ADD COLUMN     "contactTelegram" TEXT;
-- CREATE TABLE "CommunityComment" (
--     "id" TEXT NOT NULL,
--     "postId" TEXT NOT NULL,
--     "authorId" TEXT NOT NULL,
--     "parentId" TEXT,
--     "content" TEXT NOT NULL,
--     "isHidden" BOOLEAN NOT NULL DEFAULT false,
--     "deletedAt" TIMESTAMP(3),
--     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     "updatedAt" TIMESTAMP(3) NOT NULL,
--     CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id")
-- );
-- CREATE INDEX "CommunityComment_postId_createdAt_idx" ON "CommunityComment"("postId", "createdAt");
-- CREATE INDEX "CommunityComment_parentId_idx" ON "CommunityComment"("parentId");
-- CREATE INDEX "CommunityComment_authorId_idx" ON "CommunityComment"("authorId");
-- ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
