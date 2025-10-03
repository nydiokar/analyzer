-- CreateTable
CREATE TABLE "TokenAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "label" TEXT,
    "condition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "channels" JSONB NOT NULL,
    "lastTriggeredAt" DATETIME,
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TokenAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TokenAlert_tokenAddress_fkey" FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo" ("tokenAddress") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    CONSTRAINT "AlertNotification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "TokenAlert" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AlertNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TokenAlert_userId_isActive_idx" ON "TokenAlert"("userId", "isActive");

-- CreateIndex
CREATE INDEX "TokenAlert_tokenAddress_isActive_idx" ON "TokenAlert"("tokenAddress", "isActive");

-- CreateIndex
CREATE INDEX "AlertNotification_userId_isRead_idx" ON "AlertNotification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "AlertNotification_triggeredAt_idx" ON "AlertNotification"("triggeredAt");
