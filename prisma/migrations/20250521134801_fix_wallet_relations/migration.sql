-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "firstProcessedTimestamp" INTEGER,
    "newestProcessedSignature" TEXT,
    "newestProcessedTimestamp" INTEGER,
    "lastSuccessfulFetchTimestamp" DATETIME,
    "lastSignatureAnalyzed" TEXT
);
INSERT INTO "new_Wallet" ("address", "firstProcessedTimestamp", "lastSignatureAnalyzed", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp") SELECT "address", "firstProcessedTimestamp", "lastSignatureAnalyzed", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX IF NOT EXISTS "Wallet_address_key" ON "Wallet"("address");
CREATE TABLE "new_WalletBehaviorProfile" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletBehaviorProfile_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WalletBehaviorProfile" ("activeTradingPeriods", "averageFlipDurationHours", "averageSessionDurationMinutes", "averageSessionStartHour", "averageTradesPerToken", "avgTradesPerSession", "buySellRatio", "buySellSymmetry", "completePairsCount", "confidenceScore", "firstTransactionTimestamp", "flipperScore", "id", "lastTransactionTimestamp", "medianHoldTime", "percentTradesUnder1Hour", "percentTradesUnder4Hours", "percentageOfUnpairedTokens", "reentryRate", "riskMetrics", "sequenceConsistency", "sessionCount", "tokenPreferences", "tokensWithBothBuyAndSell", "totalBuyCount", "totalSellCount", "totalTradeCount", "tradingFrequency", "tradingStyle", "tradingTimeDistribution", "uniqueTokensTraded", "updatedAt", "walletAddress") SELECT "activeTradingPeriods", "averageFlipDurationHours", "averageSessionDurationMinutes", "averageSessionStartHour", "averageTradesPerToken", "avgTradesPerSession", "buySellRatio", "buySellSymmetry", "completePairsCount", "confidenceScore", "firstTransactionTimestamp", "flipperScore", "id", "lastTransactionTimestamp", "medianHoldTime", "percentTradesUnder1Hour", "percentTradesUnder4Hours", "percentageOfUnpairedTokens", "reentryRate", "riskMetrics", "sequenceConsistency", "sessionCount", "tokenPreferences", "tokensWithBothBuyAndSell", "totalBuyCount", "totalSellCount", "totalTradeCount", "tradingFrequency", "tradingStyle", "tradingTimeDistribution", "uniqueTokensTraded", "updatedAt", "walletAddress" FROM "WalletBehaviorProfile";
DROP TABLE "WalletBehaviorProfile";
ALTER TABLE "new_WalletBehaviorProfile" RENAME TO "WalletBehaviorProfile";
CREATE UNIQUE INDEX IF NOT EXISTS "WalletBehaviorProfile_walletAddress_key" ON "WalletBehaviorProfile"("walletAddress");
CREATE INDEX IF NOT EXISTS "WalletBehaviorProfile_walletAddress_idx" ON "WalletBehaviorProfile"("walletAddress");
CREATE TABLE "new_WalletPnlSummary" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletPnlSummary_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WalletPnlSummary" ("averageRealizedPnlPerExecutedSwap", "averageSwapSize", "id", "netPnl", "overallFirstTimestamp", "overallLastTimestamp", "profitableTokensCount", "realizedPnl", "realizedPnlToTotalVolumeRatio", "stablecoinNetFlow", "totalExecutedSwapsCount", "totalFees", "totalSignaturesProcessed", "totalVolume", "unprofitableTokensCount", "unrealizedPnl", "updatedAt", "walletAddress") SELECT "averageRealizedPnlPerExecutedSwap", "averageSwapSize", "id", "netPnl", "overallFirstTimestamp", "overallLastTimestamp", "profitableTokensCount", "realizedPnl", "realizedPnlToTotalVolumeRatio", "stablecoinNetFlow", "totalExecutedSwapsCount", "totalFees", "totalSignaturesProcessed", "totalVolume", "unprofitableTokensCount", "unrealizedPnl", "updatedAt", "walletAddress" FROM "WalletPnlSummary";
DROP TABLE "WalletPnlSummary";
ALTER TABLE "new_WalletPnlSummary" RENAME TO "WalletPnlSummary";
CREATE UNIQUE INDEX IF NOT EXISTS "WalletPnlSummary_walletAddress_key" ON "WalletPnlSummary"("walletAddress");
CREATE INDEX IF NOT EXISTS "WalletPnlSummary_walletAddress_idx" ON "WalletPnlSummary"("walletAddress");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
