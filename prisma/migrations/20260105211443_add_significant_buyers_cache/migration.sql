-- AlterTable
ALTER TABLE "AnalysisResult" ALTER COLUMN "netSolProfitLoss" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SignificantBuyersCache" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "startBlockTime" INTEGER NOT NULL,
    "endBlockTime" INTEGER NOT NULL,
    "walletAddresses" TEXT NOT NULL,
    "totalTransactions" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignificantBuyersCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignificantBuyersCache_mint_idx" ON "SignificantBuyersCache"("mint");

-- CreateIndex
CREATE INDEX "SignificantBuyersCache_processedAt_idx" ON "SignificantBuyersCache"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignificantBuyersCache_mint_startBlockTime_endBlockTime_key" ON "SignificantBuyersCache"("mint", "startBlockTime", "endBlockTime");
