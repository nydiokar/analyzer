-- CreateTable
CREATE TABLE "TokenInfo" (
    "tokenAddress" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "symbol" TEXT,
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "telegramUrl" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "currentRawBalance" TEXT,
    "currentUiBalance" REAL,
    "currentUiBalanceString" TEXT,
    "balanceDecimals" INTEGER,
    "balanceFetchedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisResult_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnalysisResult" ("balanceDecimals", "balanceFetchedAt", "currentRawBalance", "currentUiBalance", "currentUiBalanceString", "estimatedPreservedValue", "firstTransferTimestamp", "id", "isValuePreservation", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "preservationType", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalFeesPaidInSol", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut", "updatedAt", "walletAddress") SELECT "balanceDecimals", "balanceFetchedAt", "currentRawBalance", "currentUiBalance", "currentUiBalanceString", "estimatedPreservedValue", "firstTransferTimestamp", "id", "isValuePreservation", "lastTransferTimestamp", "netAmountChange", "netSolProfitLoss", "preservationType", "tokenAddress", "totalAmountIn", "totalAmountOut", "totalFeesPaidInSol", "totalSolReceived", "totalSolSpent", "transferCountIn", "transferCountOut", "updatedAt", "walletAddress" FROM "AnalysisResult";
DROP TABLE "AnalysisResult";
ALTER TABLE "new_AnalysisResult" RENAME TO "AnalysisResult";
CREATE INDEX "AnalysisResult_walletAddress_idx" ON "AnalysisResult"("walletAddress");
CREATE INDEX "AnalysisResult_tokenAddress_idx" ON "AnalysisResult"("tokenAddress");
CREATE INDEX "AnalysisResult_lastTransferTimestamp_idx" ON "AnalysisResult"("lastTransferTimestamp");
CREATE INDEX "AnalysisResult_netSolProfitLoss_idx" ON "AnalysisResult"("netSolProfitLoss");
CREATE UNIQUE INDEX "AnalysisResult_walletAddress_tokenAddress_key" ON "AnalysisResult"("walletAddress", "tokenAddress");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TokenInfo_tokenAddress_key" ON "TokenInfo"("tokenAddress");

-- CreateIndex
CREATE INDEX "TokenInfo_name_idx" ON "TokenInfo"("name");

-- CreateIndex
CREATE INDEX "TokenInfo_symbol_idx" ON "TokenInfo"("symbol");
