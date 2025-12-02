/*
  Warnings:

  - Added the required column `walletAddress` to the `AdvancedStatsResult` table without a default value. This is not possible if the table is not empty.
  - Added the required column `walletAddress` to the `AnalysisResult` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdvancedStatsResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "medianPnlPerToken" REAL NOT NULL,
    "trimmedMeanPnlPerToken" REAL NOT NULL,
    "tokenWinRatePercent" REAL NOT NULL,
    "standardDeviationPnl" REAL NOT NULL,
    "profitConsistencyIndex" REAL NOT NULL,
    "weightedEfficiencyScore" REAL NOT NULL,
    "averagePnlPerDayActiveApprox" REAL NOT NULL,
    CONSTRAINT "AdvancedStatsResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AdvancedStatsResult" ("averagePnlPerDayActiveApprox", "id", "medianPnlPerToken", "profitConsistencyIndex", "runId", "standardDeviationPnl", "tokenWinRatePercent", "trimmedMeanPnlPerToken", "weightedEfficiencyScore") SELECT "averagePnlPerDayActiveApprox", "id", "medianPnlPerToken", "profitConsistencyIndex", "runId", "standardDeviationPnl", "tokenWinRatePercent", "trimmedMeanPnlPerToken", "weightedEfficiencyScore" FROM "AdvancedStatsResult";
DROP TABLE "AdvancedStatsResult";
ALTER TABLE "new_AdvancedStatsResult" RENAME TO "AdvancedStatsResult";
CREATE UNIQUE INDEX "AdvancedStatsResult_runId_key" ON "AdvancedStatsResult"("runId");
CREATE INDEX "AdvancedStatsResult_walletAddress_idx" ON "AdvancedStatsResult"("walletAddress");
CREATE TABLE "new_AnalysisResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "totalAmountIn" REAL NOT NULL,
    "totalAmountOut" REAL NOT NULL,
    "netAmountChange" REAL NOT NULL,
    "totalSolSpent" REAL NOT NULL,
    "totalSolReceived" REAL NOT NULL,
    "netSolProfitLoss" REAL NOT NULL,
    "transferCountIn" INTEGER NOT NULL,
    "transferCountOut" INTEGER NOT NULL,
    "firstTransferTimestamp" INTEGER,
    "lastTransferTimestamp" INTEGER,
    CONSTRAINT "AnalysisResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnalysisResult" ("firstTransferTimestamp", "id", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "runId", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut") SELECT "firstTransferTimestamp", "id", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "runId", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut" FROM "AnalysisResult";
DROP TABLE "AnalysisResult";
ALTER TABLE "new_AnalysisResult" RENAME TO "AnalysisResult";
CREATE INDEX "AnalysisResult_runId_idx" ON "AnalysisResult"("runId");
CREATE INDEX "AnalysisResult_walletAddress_idx" ON "AnalysisResult"("walletAddress");
CREATE INDEX "AnalysisResult_runId_walletAddress_idx" ON "AnalysisResult"("runId", "walletAddress");
CREATE INDEX "AnalysisResult_runId_tokenAddress_idx" ON "AnalysisResult"("runId", "tokenAddress");
CREATE INDEX "AnalysisResult_runId_netSolProfitLoss_idx" ON "AnalysisResult"("runId", "netSolProfitLoss");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
