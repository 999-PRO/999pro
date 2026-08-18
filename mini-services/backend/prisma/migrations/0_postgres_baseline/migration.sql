-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "displayName" TEXT,
    "avatar" TEXT,
    "bio" TEXT,
    "gender" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" TIMESTAMP(3),
    "totpBackupCodes" TEXT,
    "totpBackupCodesGeneratedAt" TIMESTAMP(3),
    "emailTwoFactorCode" TEXT,
    "emailTwoFactorExpires" TIMESTAMP(3),
    "points" INTEGER NOT NULL DEFAULT 0,
    "pointsEarnedTotal" INTEGER NOT NULL DEFAULT 0,
    "streakCount" INTEGER NOT NULL DEFAULT 0,
    "lastVisitDate" TEXT,
    "referralCode" TEXT,
    "referredById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "oldPrice" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "category" TEXT,
    "images" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isAction" BOOLEAN NOT NULL DEFAULT false,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "cartAdds" INTEGER NOT NULL DEFAULT 0,
    "favoriteAdds" INTEGER NOT NULL DEFAULT 0,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductView" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "name" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "deliveryMethod" TEXT,
    "contactMethod" TEXT,
    "comment" TEXT,
    "receiptUrl" TEXT,
    "couponCode" TEXT,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "promoCode" TEXT,
    "promoDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "pointsDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "mapUrl" TEXT,
    "deliveryZoneId" TEXT,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "media" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'image',
    "caption" TEXT,
    "category" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'direct',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "attachments" TEXT,
    "duration" INTEGER,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "replyToId" TEXT,
    "forwardedFromId" TEXT,
    "clientMessageId" TEXT,
    "deletedFor" TEXT NOT NULL DEFAULT '[]',
    "deletedForAll" BOOLEAN NOT NULL DEFAULT false,
    "selfDestructAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "cta" TEXT NOT NULL DEFAULT 'Смотреть',
    "image" TEXT NOT NULL,
    "gradient" TEXT NOT NULL DEFAULT 'from-sky-400 via-blue-500 to-indigo-600',
    "useGradient" BOOLEAN NOT NULL DEFAULT true,
    "link" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'image-text',
    "objectFit" TEXT NOT NULL DEFAULT 'cover',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfoPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "images" TEXT NOT NULL DEFAULT '[]',
    "icon" TEXT NOT NULL DEFAULT 'FileText',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "showInMenu" BOOLEAN NOT NULL DEFAULT true,
    "metaDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfoPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" TEXT NOT NULL,
    "userAgent" TEXT,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "photos" TEXT NOT NULL DEFAULT '[]',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "comment" TEXT,
    "productId" TEXT,
    "productTitle" TEXT,
    "productPrice" INTEGER,
    "productImage" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "deliveryMethod" TEXT,
    "address" TEXT,
    "contactMethod" TEXT,
    "receiptUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "userAgent" TEXT,
    "prevHash" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "shortId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sharesCount" INTEGER NOT NULL DEFAULT 0,
    "opensCount" INTEGER NOT NULL DEFAULT 0,
    "appOpensCount" INTEGER NOT NULL DEFAULT 0,
    "installsCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareEvent" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'unknown',
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "ref" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubGift" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "pointsCost" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubGift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubGiftClaim" (
    "id" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubGiftClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubPromo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "promoCode" TEXT,
    "discountPercent" INTEGER,
    "linkedProductIds" TEXT,
    "ctaText" TEXT NOT NULL DEFAULT 'Перейти',
    "ctaUrl" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubPromo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubGiveaway" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "winnersCount" INTEGER NOT NULL DEFAULT 1,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "drawnAt" TIMESTAMP(3),
    "winnerIds" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubGiveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubGiveawayParticipant" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubGiveawayParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubBonus" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "pointsReward" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubBonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubBonusClaim" (
    "id" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubBonusClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'one-time',
    "pointsReward" INTEGER NOT NULL DEFAULT 0,
    "giftRewardId" TEXT,
    "actionKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubTaskCompletion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "forDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubTaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubCoupon" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "code" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'percent',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "linkedProductIds" TEXT,
    "quantity" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubCouponClaim" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubCouponClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "maxAttendees" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubEventRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubEventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "entityId" TEXT,
    "entityType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopWord" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "StopWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationWarning" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "expiresAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationWarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserModerationStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "violationsCount" INTEGER NOT NULL DEFAULT 0,
    "reportsCount" INTEGER NOT NULL DEFAULT 0,
    "deletedMessagesCount" INTEGER NOT NULL DEFAULT 0,
    "deletedReviewsCount" INTEGER NOT NULL DEFAULT 0,
    "warningsCount" INTEGER NOT NULL DEFAULT 0,
    "bansCount" INTEGER NOT NULL DEFAULT 0,
    "chatRestrictedUntil" TIMESTAMP(3),
    "reviewsRestrictedUntil" TIMESTAMP(3),
    "commentsRestrictedUntil" TIMESTAMP(3),
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedUntil" TIMESTAMP(3),
    "bannedBy" TEXT,
    "bannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserModerationStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "content" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "action" TEXT NOT NULL DEFAULT 'flagged',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIKB_Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIKB_Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIKB_Product" (
    "id" TEXT NOT NULL,
    "marketplaceProductId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "shortSummary" TEXT,
    "materials" TEXT NOT NULL DEFAULT '[]',
    "specs" TEXT NOT NULL DEFAULT '{}',
    "leadTime" TEXT,
    "warranty" TEXT,
    "pricingType" TEXT NOT NULL DEFAULT 'fixed',
    "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "minOrderValue" DOUBLE PRECISION,
    "formula" TEXT,
    "formulaSpec" TEXT NOT NULL DEFAULT '{}',
    "aiInstruction" TEXT,
    "images" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT,

    CONSTRAINT "AIKB_Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIKB_Service" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricingType" TEXT NOT NULL DEFAULT 'fixed',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIKB_Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIKB_FAQ" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIKB_FAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIKB_Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'Извините, я не нашёл информацию по вашему запросу. Уточните, пожалуйста, детали — и я обязательно помогу.',
    "greeting" TEXT NOT NULL DEFAULT 'Здравствуйте! Я Агент 999. Чем могу помочь?',
    "assistantName" TEXT NOT NULL DEFAULT 'Агент 999',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIKB_Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIKB_Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "context" TEXT,
    "userMessage" TEXT NOT NULL,
    "assistantReply" TEXT NOT NULL,
    "parameters" TEXT,
    "totalPrice" DOUBLE PRECISION,
    "localHandled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIKB_Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'deepseek',
    "apiKeyEnc" TEXT NOT NULL DEFAULT '',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "params" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'percent',
    "discountValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minOrderTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxDiscount" DECIMAL(10,2),
    "maxUses" INTEGER,
    "maxUsesPerUser" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCodeUsage" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCodeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusPointsSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "earnRate" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "earnPerCurrencyUnit" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "pointValue" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "minOrderTotalToSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxPercentOfOrder" INTEGER NOT NULL DEFAULT 50,
    "maxPointsBalance" INTEGER,
    "expiryDays" INTEGER,
    "welcomeBonus" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusPointsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecuritySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "totpRequiredForAdmins" BOOLEAN NOT NULL DEFAULT true,
    "totpRequiredForUsers" BOOLEAN NOT NULL DEFAULT false,
    "totpAllowBackupCodes" BOOLEAN NOT NULL DEFAULT true,
    "allowLoginWithoutVerification" BOOLEAN NOT NULL DEFAULT true,
    "sessionTimeoutMin" INTEGER NOT NULL DEFAULT 10080,
    "refreshTokenTTLDays" INTEGER NOT NULL DEFAULT 30,
    "maxFailedLogins" INTEGER NOT NULL DEFAULT 5,
    "lockoutDurationMin" INTEGER NOT NULL DEFAULT 15,
    "passwordMinLength" INTEGER NOT NULL DEFAULT 8,
    "passwordMaxLength" INTEGER NOT NULL DEFAULT 128,
    "passwordRequireUppercase" BOOLEAN NOT NULL DEFAULT false,
    "passwordRequireLowercase" BOOLEAN NOT NULL DEFAULT true,
    "passwordRequireDigit" BOOLEAN NOT NULL DEFAULT false,
    "passwordRequireSymbol" BOOLEAN NOT NULL DEFAULT false,
    "authRateLimitPer15Min" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecuritySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "whatsapp" TEXT,
    "telegram" TEXT,
    "email" TEXT,
    "address" TEXT,
    "managerName" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isOnline_idx" ON "User"("isOnline");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "User_role_deletedAt_idx" ON "User"("role", "deletedAt");

-- CreateIndex
CREATE INDEX "User_isOnline_lastSeen_idx" ON "User"("isOnline", "lastSeen");

-- CreateIndex
CREATE INDEX "User_deletedAt_createdAt_idx" ON "User"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_isOnline_deletedAt_idx" ON "User"("role", "isOnline", "deletedAt");

-- CreateIndex
CREATE INDEX "Product_isPopular_idx" ON "Product"("isPopular");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");

-- CreateIndex
CREATE INDEX "Product_isAction_idx" ON "Product"("isAction");

-- CreateIndex
CREATE INDEX "Product_isNew_idx" ON "Product"("isNew");

-- CreateIndex
CREATE INDEX "Product_isRecommended_idx" ON "Product"("isRecommended");

-- CreateIndex
CREATE INDEX "Product_isTrending_idx" ON "Product"("isTrending");

-- CreateIndex
CREATE INDEX "Product_isPremium_idx" ON "Product"("isPremium");

-- CreateIndex
CREATE INDEX "Product_rating_idx" ON "Product"("rating");

-- CreateIndex
CREATE INDEX "Product_reviewsCount_idx" ON "Product"("reviewsCount");

-- CreateIndex
CREATE INDEX "Product_views_idx" ON "Product"("views");

-- CreateIndex
CREATE INDEX "Product_purchases_idx" ON "Product"("purchases");

-- CreateIndex
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");

-- CreateIndex
CREATE INDEX "Product_departmentId_idx" ON "Product"("departmentId");

-- CreateIndex
CREATE INDEX "ProductView_productId_createdAt_idx" ON "ProductView"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductView_userId_createdAt_idx" ON "ProductView"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductView_createdAt_idx" ON "ProductView"("createdAt");

-- CreateIndex
CREATE INDEX "SearchHistory_userId_createdAt_idx" ON "SearchHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchHistory_createdAt_idx" ON "SearchHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_productId_key" ON "Favorite"("userId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_userId_productId_key" ON "CartItem"("userId", "productId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_category_idx" ON "Order"("category");

-- CreateIndex
CREATE INDEX "Order_userId_status_createdAt_idx" ON "Order"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryZone_isActive_sortOrder_idx" ON "DeliveryZone"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "Story_createdAt_idx" ON "Story"("createdAt");

-- CreateIndex
CREATE INDEX "Story_expiresAt_idx" ON "Story"("expiresAt");

-- CreateIndex
CREATE INDEX "Story_userId_idx" ON "Story"("userId");

-- CreateIndex
CREATE INDEX "Story_category_idx" ON "Story"("category");

-- CreateIndex
CREATE INDEX "Conversation_type_idx" ON "Conversation"("type");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_clientMessageId_key" ON "Message"("clientMessageId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");

-- CreateIndex
CREATE INDEX "Message_forwardedFromId_idx" ON "Message"("forwardedFromId");

-- CreateIndex
CREATE INDEX "Message_senderId_clientMessageId_idx" ON "Message"("senderId", "clientMessageId");

-- CreateIndex
CREATE INDEX "Message_selfDestructAt_idx" ON "Message"("selfDestructAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_senderId_idx" ON "Message"("conversationId", "createdAt", "senderId");

-- CreateIndex
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_selfDestructAt_conversationId_idx" ON "Message"("selfDestructAt", "conversationId");

-- CreateIndex
CREATE INDEX "Call_conversationId_idx" ON "Call"("conversationId");

-- CreateIndex
CREATE INDEX "Call_callerId_idx" ON "Call"("callerId");

-- CreateIndex
CREATE INDEX "Call_recipientId_idx" ON "Call"("recipientId");

-- CreateIndex
CREATE INDEX "Call_status_idx" ON "Call"("status");

-- CreateIndex
CREATE INDEX "Banner_isActive_order_idx" ON "Banner"("isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "InfoPage_slug_key" ON "InfoPage"("slug");

-- CreateIndex
CREATE INDEX "InfoPage_isPublished_order_idx" ON "InfoPage"("isPublished", "order");

-- CreateIndex
CREATE INDEX "InfoPage_showInMenu_isPublished_idx" ON "InfoPage"("showInMenu", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_userAgent_idx" ON "PushSubscription"("userId", "userAgent");

-- CreateIndex
CREATE INDEX "Review_productId_createdAt_idx" ON "Review"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_productId_isHidden_createdAt_idx" ON "Review"("productId", "isHidden", "createdAt");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE INDEX "Review_rating_idx" ON "Review"("rating");

-- CreateIndex
CREATE INDEX "Review_isHidden_idx" ON "Review"("isHidden");

-- CreateIndex
CREATE UNIQUE INDEX "Review_productId_userId_key" ON "Review"("productId", "userId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_userId_idx" ON "Lead"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_action_createdAt_idx" ON "AuditLog"("entity", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_shortId_key" ON "ShareLink"("shortId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_productId_key" ON "ShareLink"("productId");

-- CreateIndex
CREATE INDEX "ShareLink_productId_idx" ON "ShareLink"("productId");

-- CreateIndex
CREATE INDEX "ShareLink_updatedAt_idx" ON "ShareLink"("updatedAt");

-- CreateIndex
CREATE INDEX "ShareEvent_shareLinkId_createdAt_idx" ON "ShareEvent"("shareLinkId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareEvent_productId_eventType_createdAt_idx" ON "ShareEvent"("productId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ShareEvent_ref_eventType_idx" ON "ShareEvent"("ref", "eventType");

-- CreateIndex
CREATE INDEX "ShareEvent_utmSource_utmCampaign_idx" ON "ShareEvent"("utmSource", "utmCampaign");

-- CreateIndex
CREATE INDEX "ShareEvent_platform_eventType_createdAt_idx" ON "ShareEvent"("platform", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ShareEvent_createdAt_idx" ON "ShareEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ClubGift_active_order_idx" ON "ClubGift"("active", "order");

-- CreateIndex
CREATE INDEX "ClubGift_endsAt_idx" ON "ClubGift"("endsAt");

-- CreateIndex
CREATE INDEX "ClubGiftClaim_userId_createdAt_idx" ON "ClubGiftClaim"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubGiftClaim_giftId_userId_key" ON "ClubGiftClaim"("giftId", "userId");

-- CreateIndex
CREATE INDEX "ClubPromo_active_order_idx" ON "ClubPromo"("active", "order");

-- CreateIndex
CREATE INDEX "ClubPromo_endsAt_idx" ON "ClubPromo"("endsAt");

-- CreateIndex
CREATE INDEX "ClubGiveaway_active_order_idx" ON "ClubGiveaway"("active", "order");

-- CreateIndex
CREATE INDEX "ClubGiveaway_drawAt_idx" ON "ClubGiveaway"("drawAt");

-- CreateIndex
CREATE INDEX "ClubGiveawayParticipant_giveawayId_createdAt_idx" ON "ClubGiveawayParticipant"("giveawayId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubGiveawayParticipant_giveawayId_userId_key" ON "ClubGiveawayParticipant"("giveawayId", "userId");

-- CreateIndex
CREATE INDEX "ClubBonus_active_order_idx" ON "ClubBonus"("active", "order");

-- CreateIndex
CREATE INDEX "ClubBonus_endsAt_idx" ON "ClubBonus"("endsAt");

-- CreateIndex
CREATE INDEX "ClubBonusClaim_userId_createdAt_idx" ON "ClubBonusClaim"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubBonusClaim_bonusId_userId_key" ON "ClubBonusClaim"("bonusId", "userId");

-- CreateIndex
CREATE INDEX "ClubTask_active_order_idx" ON "ClubTask"("active", "order");

-- CreateIndex
CREATE INDEX "ClubTask_taskType_idx" ON "ClubTask"("taskType");

-- CreateIndex
CREATE INDEX "ClubTaskCompletion_userId_createdAt_idx" ON "ClubTaskCompletion"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubTaskCompletion_taskId_userId_forDate_key" ON "ClubTaskCompletion"("taskId", "userId", "forDate");

-- CreateIndex
CREATE INDEX "ClubCoupon_active_order_idx" ON "ClubCoupon"("active", "order");

-- CreateIndex
CREATE INDEX "ClubCoupon_endsAt_idx" ON "ClubCoupon"("endsAt");

-- CreateIndex
CREATE INDEX "ClubCouponClaim_userId_createdAt_idx" ON "ClubCouponClaim"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubCouponClaim_couponId_userId_key" ON "ClubCouponClaim"("couponId", "userId");

-- CreateIndex
CREATE INDEX "ClubEvent_active_order_idx" ON "ClubEvent"("active", "order");

-- CreateIndex
CREATE INDEX "ClubEvent_startsAt_idx" ON "ClubEvent"("startsAt");

-- CreateIndex
CREATE INDEX "ClubEventRegistration_userId_createdAt_idx" ON "ClubEventRegistration"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubEventRegistration_eventId_userId_key" ON "ClubEventRegistration"("eventId", "userId");

-- CreateIndex
CREATE INDEX "PointsTransaction_userId_createdAt_idx" ON "PointsTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsTransaction_reason_createdAt_idx" ON "PointsTransaction"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "StopWord_category_isActive_idx" ON "StopWord"("category", "isActive");

-- CreateIndex
CREATE INDEX "StopWord_word_idx" ON "StopWord"("word");

-- CreateIndex
CREATE INDEX "StopWord_isActive_idx" ON "StopWord"("isActive");

-- CreateIndex
CREATE INDEX "ModerationReport_status_createdAt_idx" ON "ModerationReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationReport_targetType_targetId_idx" ON "ModerationReport"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModerationReport_reporterId_idx" ON "ModerationReport"("reporterId");

-- CreateIndex
CREATE INDEX "ModerationReport_createdAt_idx" ON "ModerationReport"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationLog_actorType_createdAt_idx" ON "ModerationLog"("actorType", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationLog_targetType_targetId_idx" ON "ModerationLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModerationLog_createdAt_idx" ON "ModerationLog"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationLog_action_createdAt_idx" ON "ModerationLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationWarning_userId_createdAt_idx" ON "ModerationWarning"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationWarning_expiresAt_idx" ON "ModerationWarning"("expiresAt");

-- CreateIndex
CREATE INDEX "ModerationWarning_acknowledgedAt_idx" ON "ModerationWarning"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserModerationStats_userId_key" ON "UserModerationStats"("userId");

-- CreateIndex
CREATE INDEX "UserModerationStats_isBanned_idx" ON "UserModerationStats"("isBanned");

-- CreateIndex
CREATE INDEX "UserModerationStats_chatRestrictedUntil_idx" ON "UserModerationStats"("chatRestrictedUntil");

-- CreateIndex
CREATE INDEX "UserModerationStats_reviewsRestrictedUntil_idx" ON "UserModerationStats"("reviewsRestrictedUntil");

-- CreateIndex
CREATE INDEX "UserModerationStats_bannedUntil_idx" ON "UserModerationStats"("bannedUntil");

-- CreateIndex
CREATE INDEX "AIFlag_reviewed_createdAt_idx" ON "AIFlag"("reviewed", "createdAt");

-- CreateIndex
CREATE INDEX "AIFlag_userId_createdAt_idx" ON "AIFlag"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIFlag_targetType_targetId_idx" ON "AIFlag"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AIFlag_severity_createdAt_idx" ON "AIFlag"("severity", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIKB_Category_slug_key" ON "AIKB_Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AIKB_Product_slug_key" ON "AIKB_Product"("slug");

-- CreateIndex
CREATE INDEX "AIKB_Product_categoryId_idx" ON "AIKB_Product"("categoryId");

-- CreateIndex
CREATE INDEX "AIKB_Product_isActive_idx" ON "AIKB_Product"("isActive");

-- CreateIndex
CREATE INDEX "AIKB_Product_pricingType_idx" ON "AIKB_Product"("pricingType");

-- CreateIndex
CREATE INDEX "AIKB_Product_slug_idx" ON "AIKB_Product"("slug");

-- CreateIndex
CREATE INDEX "AIKB_Service_productId_idx" ON "AIKB_Service"("productId");

-- CreateIndex
CREATE INDEX "AIKB_FAQ_productId_idx" ON "AIKB_FAQ"("productId");

-- CreateIndex
CREATE INDEX "AIKB_FAQ_isActive_idx" ON "AIKB_FAQ"("isActive");

-- CreateIndex
CREATE INDEX "AIKB_Conversation_userId_createdAt_idx" ON "AIKB_Conversation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIKB_Conversation_createdAt_idx" ON "AIKB_Conversation"("createdAt");

-- CreateIndex
CREATE INDEX "AIKB_Conversation_localHandled_idx" ON "AIKB_Conversation"("localHandled");

-- CreateIndex
CREATE INDEX "AIProvider_enabled_isDefault_idx" ON "AIProvider"("enabled", "isDefault");

-- CreateIndex
CREATE INDEX "AIProvider_type_idx" ON "AIProvider"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_active_code_idx" ON "PromoCode"("active", "code");

-- CreateIndex
CREATE INDEX "PromoCode_endsAt_idx" ON "PromoCode"("endsAt");

-- CreateIndex
CREATE INDEX "PromoCodeUsage_userId_createdAt_idx" ON "PromoCodeUsage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeUsage_promoCodeId_userId_key" ON "PromoCodeUsage"("promoCodeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_slug_key" ON "Department"("slug");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryZoneId_fkey" FOREIGN KEY ("deliveryZoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_forwardedFromId_fkey" FOREIGN KEY ("forwardedFromId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareEvent" ADD CONSTRAINT "ShareEvent_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareEvent" ADD CONSTRAINT "ShareEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareEvent" ADD CONSTRAINT "ShareEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubGiftClaim" ADD CONSTRAINT "ClubGiftClaim_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "ClubGift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubGiftClaim" ADD CONSTRAINT "ClubGiftClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubGiveawayParticipant" ADD CONSTRAINT "ClubGiveawayParticipant_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "ClubGiveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubGiveawayParticipant" ADD CONSTRAINT "ClubGiveawayParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubBonusClaim" ADD CONSTRAINT "ClubBonusClaim_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "ClubBonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubBonusClaim" ADD CONSTRAINT "ClubBonusClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubTaskCompletion" ADD CONSTRAINT "ClubTaskCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ClubTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubTaskCompletion" ADD CONSTRAINT "ClubTaskCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubCouponClaim" ADD CONSTRAINT "ClubCouponClaim_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "ClubCoupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubCouponClaim" ADD CONSTRAINT "ClubCouponClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventRegistration" ADD CONSTRAINT "ClubEventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ClubEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventRegistration" ADD CONSTRAINT "ClubEventRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationWarning" ADD CONSTRAINT "ModerationWarning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserModerationStats" ADD CONSTRAINT "UserModerationStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIFlag" ADD CONSTRAINT "AIFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIKB_Product" ADD CONSTRAINT "AIKB_Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AIKB_Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIKB_Service" ADD CONSTRAINT "AIKB_Service_productId_fkey" FOREIGN KEY ("productId") REFERENCES "AIKB_Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIKB_FAQ" ADD CONSTRAINT "AIKB_FAQ_productId_fkey" FOREIGN KEY ("productId") REFERENCES "AIKB_Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeUsage" ADD CONSTRAINT "PromoCodeUsage_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

