-- AlterTable
ALTER TABLE "TokenInfo" ADD COLUMN "dexscreenerUpdatedAt" DATETIME;
ALTER TABLE "TokenInfo" ADD COLUMN "fdv" REAL;
ALTER TABLE "TokenInfo" ADD COLUMN "liquidityUsd" REAL;
ALTER TABLE "TokenInfo" ADD COLUMN "marketCapUsd" REAL;
ALTER TABLE "TokenInfo" ADD COLUMN "pairCreatedAt" INTEGER;
ALTER TABLE "TokenInfo" ADD COLUMN "priceUsd" TEXT;
ALTER TABLE "TokenInfo" ADD COLUMN "volume24h" REAL;

-- CreateIndex
CREATE INDEX "TokenInfo_marketCapUsd_idx" ON "TokenInfo"("marketCapUsd");

-- CreateIndex
CREATE INDEX "TokenInfo_liquidityUsd_idx" ON "TokenInfo"("liquidityUsd");

-- CreateIndex
CREATE INDEX "TokenInfo_pairCreatedAt_idx" ON "TokenInfo"("pairCreatedAt");
