/*
  Warnings:

  - You are about to drop the `AdvancedStatsResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `analysisEndTs` on the `AnalysisRun` table. All the data in the column will be lost.
  - You are about to drop the column `analysisStartTs` on the `AnalysisRun` table. All the data in the column will be lost.
  - You are about to drop the column `signaturesProcessed` on the `AnalysisRun` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `AnalysisResult` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceInvoked` to the `AnalysisRun` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AdvancedStatsResult_walletAddress_idx";

-- DropIndex
DROP INDEX "AdvancedStatsResult_runId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AdvancedStatsResult";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "WalletPnlSummary" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "totalVolume" REAL NOT NULL,
    "totalFees" REAL NOT NULL,
    "realizedPnl" REAL NOT NULL,
    "unrealizedPnl" REAL NOT NULL,
    "netPnl" REAL NOT NULL,
    "stablecoinNetFlow" REAL NOT NULL,
    "averageSwapSize" REAL NOT NULL,
    "profitableTokensCount" INTEGER NOT NULL,
    "unprofitableTokensCount" INTEGER NOT NULL,
    "totalExecutedSwapsCount" INTEGER NOT NULL,
    "averageRealizedPnlPerExecutedSwap" REAL NOT NULL,
    "realizedPnlToTotalVolumeRatio" REAL NOT NULL,
    "totalSignaturesProcessed" INTEGER NOT NULL,
    "overallFirstTimestamp" INTEGER,
    "overallLastTimestamp" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdvancedTradeStats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletPnlSummaryId" INTEGER NOT NULL,
    "medianPnlPerToken" REAL NOT NULL,
    "trimmedMeanPnlPerToken" REAL NOT NULL,
    "tokenWinRatePercent" REAL NOT NULL,
    "standardDeviationPnl" REAL NOT NULL,
    "profitConsistencyIndex" REAL NOT NULL,
    "weightedEfficiencyScore" REAL NOT NULL,
    "averagePnlPerDayActiveApprox" REAL NOT NULL,
    "firstTransactionTimestamp" INTEGER,
    "lastTransactionTimestamp" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdvancedTradeStats_walletPnlSummaryId_fkey" FOREIGN KEY ("walletPnlSummaryId") REFERENCES "WalletPnlSummary" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletBehaviorProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "buySellRatio" REAL NOT NULL,
    "buySellSymmetry" REAL NOT NULL,
    "averageFlipDurationHours" REAL NOT NULL,
    "medianHoldTime" REAL NOT NULL,
    "sequenceConsistency" REAL NOT NULL,
    "flipperScore" REAL NOT NULL,
    "uniqueTokensTraded" INTEGER NOT NULL,
    "tokensWithBothBuyAndSell" INTEGER NOT NULL,
    "totalTradeCount" INTEGER NOT NULL,
    "totalBuyCount" INTEGER NOT NULL,
    "totalSellCount" INTEGER NOT NULL,
    "completePairsCount" INTEGER NOT NULL,
    "averageTradesPerToken" REAL NOT NULL,
    "tradingTimeDistribution" JSONB NOT NULL,
    "percentTradesUnder1Hour" REAL NOT NULL,
    "percentTradesUnder4Hours" REAL NOT NULL,
    "tradingStyle" TEXT NOT NULL,
    "confidenceScore" REAL NOT NULL,
    "tradingFrequency" JSONB NOT NULL,
    "tokenPreferences" JSONB NOT NULL,
    "riskMetrics" JSONB NOT NULL,
    "reentryRate" REAL NOT NULL,
    "percentageOfUnpairedTokens" REAL NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "avgTradesPerSession" REAL NOT NULL,
    "activeTradingPeriods" JSONB NOT NULL,
    "averageSessionStartHour" REAL NOT NULL,
    "averageSessionDurationMinutes" REAL NOT NULL,
    "firstTransactionTimestamp" INTEGER,
    "lastTransactionTimestamp" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnalysisResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "totalAmountIn" REAL NOT NULL,
    "totalAmountOut" REAL NOT NULL,
    "netAmountChange" REAL NOT NULL,
    "totalSolSpent" REAL NOT NULL,
    "totalSolReceived" REAL NOT NULL,
    "totalFeesPaidInSol" REAL,
    "netSolProfitLoss" REAL NOT NULL,
    "transferCountIn" INTEGER NOT NULL,
    "transferCountOut" INTEGER NOT NULL,
    "firstTransferTimestamp" INTEGER,
    "lastTransferTimestamp" INTEGER,
    "isValuePreservation" BOOLEAN,
    "estimatedPreservedValue" REAL,
    "preservationType" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AnalysisResult" ("firstTransferTimestamp", "id", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalFeesPaidInSol", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut", "walletAddress") SELECT "firstTransferTimestamp", "id", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalFeesPaidInSol", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut", "walletAddress" FROM "AnalysisResult";
DROP TABLE "AnalysisResult";
ALTER TABLE "new_AnalysisResult" RENAME TO "AnalysisResult";
CREATE INDEX "AnalysisResult_walletAddress_idx" ON "AnalysisResult"("walletAddress");
CREATE INDEX "AnalysisResult_tokenAddress_idx" ON "AnalysisResult"("tokenAddress");
CREATE UNIQUE INDEX "AnalysisResult_walletAddress_tokenAddress_key" ON "AnalysisResult"("walletAddress", "tokenAddress");
CREATE TABLE "new_AnalysisRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "serviceInvoked" TEXT NOT NULL,
    "runTimestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "inputDataStartTs" INTEGER,
    "inputDataEndTs" INTEGER,
    "signaturesConsidered" INTEGER,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "notes" TEXT
);
INSERT INTO "new_AnalysisRun" ("errorMessage", "id", "runTimestamp", "status", "walletAddress") SELECT "errorMessage", "id", "runTimestamp", "status", "walletAddress" FROM "AnalysisRun";
DROP TABLE "AnalysisRun";
ALTER TABLE "new_AnalysisRun" RENAME TO "AnalysisRun";
CREATE INDEX "AnalysisRun_walletAddress_runTimestamp_idx" ON "AnalysisRun"("walletAddress", "runTimestamp");
CREATE INDEX "AnalysisRun_serviceInvoked_idx" ON "AnalysisRun"("serviceInvoked");
CREATE INDEX "AnalysisRun_status_idx" ON "AnalysisRun"("status");
CREATE TABLE "new_Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "firstProcessedTimestamp" INTEGER,
    "newestProcessedSignature" TEXT,
    "newestProcessedTimestamp" INTEGER,
    "lastSuccessfulFetchTimestamp" DATETIME,
    "lastSignatureAnalyzed" TEXT,
    CONSTRAINT "Wallet_address_fkey" FOREIGN KEY ("address") REFERENCES "WalletPnlSummary" ("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Wallet_address_fkey" FOREIGN KEY ("address") REFERENCES "WalletBehaviorProfile" ("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Wallet" ("address", "firstProcessedTimestamp", "lastSignatureAnalyzed", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp") SELECT "address", "firstProcessedTimestamp", "lastSignatureAnalyzed", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WalletPnlSummary_walletAddress_key" ON "WalletPnlSummary"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletPnlSummary_walletAddress_idx" ON "WalletPnlSummary"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AdvancedTradeStats_walletPnlSummaryId_key" ON "AdvancedTradeStats"("walletPnlSummaryId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletBehaviorProfile_walletAddress_key" ON "WalletBehaviorProfile"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_walletAddress_idx" ON "WalletBehaviorProfile"("walletAddress");
