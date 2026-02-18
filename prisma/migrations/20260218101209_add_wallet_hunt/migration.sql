-- CreateTable
CREATE TABLE "WalletHunt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletHunt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletHuntSnapshot" (
    "id" TEXT NOT NULL,
    "huntId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "holders" TEXT[],
    "note" TEXT,

    CONSTRAINT "WalletHuntSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletHunt_userId_idx" ON "WalletHunt"("userId");

-- CreateIndex
CREATE INDEX "WalletHunt_lastVisitedAt_idx" ON "WalletHunt"("lastVisitedAt");

-- CreateIndex
CREATE INDEX "WalletHuntSnapshot_huntId_idx" ON "WalletHuntSnapshot"("huntId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletHuntSnapshot_huntId_tokenMint_sourceType_key" ON "WalletHuntSnapshot"("huntId", "tokenMint", "sourceType");

-- AddForeignKey
ALTER TABLE "WalletHunt" ADD CONSTRAINT "WalletHunt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHuntSnapshot" ADD CONSTRAINT "WalletHuntSnapshot_huntId_fkey" FOREIGN KEY ("huntId") REFERENCES "WalletHunt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
