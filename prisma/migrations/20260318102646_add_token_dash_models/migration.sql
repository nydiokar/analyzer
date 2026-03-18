-- CreateTable
CREATE TABLE "MessageReadState" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "label" TEXT,
    "condition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "channels" JSONB NOT NULL,
    "lastTriggeredAt" TIMESTAMP(3),
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "baselinePrice" TEXT,

    CONSTRAINT "TokenAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertNotification" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "AlertNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageReadState_scope_idx" ON "MessageReadState"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReadState_userId_scope_key" ON "MessageReadState"("userId", "scope");

-- CreateIndex
CREATE INDEX "TokenAlert_userId_isActive_idx" ON "TokenAlert"("userId", "isActive");

-- CreateIndex
CREATE INDEX "TokenAlert_tokenAddress_isActive_idx" ON "TokenAlert"("tokenAddress", "isActive");

-- CreateIndex
CREATE INDEX "AlertNotification_userId_isRead_idx" ON "AlertNotification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "AlertNotification_triggeredAt_idx" ON "AlertNotification"("triggeredAt");

-- AddForeignKey
ALTER TABLE "MessageReadState" ADD CONSTRAINT "MessageReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenAlert" ADD CONSTRAINT "TokenAlert_tokenAddress_fkey" FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo"("tokenAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenAlert" ADD CONSTRAINT "TokenAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNotification" ADD CONSTRAINT "AlertNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNotification" ADD CONSTRAINT "AlertNotification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "TokenAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
