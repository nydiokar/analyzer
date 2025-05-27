/*
  Warnings:

  - You are about to drop the column `runId` on the `AnalysisResult` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "lastSignatureAnalyzed" TEXT;

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
    "lastTransferTimestamp" INTEGER
);
INSERT INTO "new_AnalysisResult" ("firstTransferTimestamp", "id", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalFeesPaidInSol", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut", "walletAddress") SELECT "firstTransferTimestamp", "id", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalFeesPaidInSol", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut", "walletAddress" FROM "AnalysisResult";
DROP TABLE "AnalysisResult";
ALTER TABLE "new_AnalysisResult" RENAME TO "AnalysisResult";
CREATE INDEX "AnalysisResult_walletAddress_idx" ON "AnalysisResult"("walletAddress");
CREATE INDEX "AnalysisResult_tokenAddress_idx" ON "AnalysisResult"("tokenAddress");
CREATE UNIQUE INDEX "AnalysisResult_walletAddress_tokenAddress_key" ON "AnalysisResult"("walletAddress", "tokenAddress");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
