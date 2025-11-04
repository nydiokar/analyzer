-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "firstProcessedTimestamp" INTEGER,
    "newestProcessedSignature" TEXT,
    "newestProcessedTimestamp" INTEGER,
    "lastSuccessfulFetchTimestamp" DATETIME
);

-- CreateTable
CREATE TABLE "HeliusTransactionCache" (
    "signature" TEXT NOT NULL PRIMARY KEY,
    "timestamp" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SwapAnalysisInput" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "mint" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "direction" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "runTimestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "analysisStartTs" INTEGER,
    "analysisEndTs" INTEGER,
    "signaturesProcessed" INTEGER,
    "errorMessage" TEXT
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "AdvancedStatsResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "medianPnlPerToken" REAL NOT NULL,
    "trimmedMeanPnlPerToken" REAL NOT NULL,
    "tokenWinRatePercent" REAL NOT NULL,
    "standardDeviationPnl" REAL NOT NULL,
    "profitConsistencyIndex" REAL NOT NULL,
    "weightedEfficiencyScore" REAL NOT NULL,
    "averagePnlPerDayActiveApprox" REAL NOT NULL,
    CONSTRAINT "AdvancedStatsResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "HeliusTransactionCache_signature_key" ON "HeliusTransactionCache"("signature");

-- CreateIndex
CREATE INDEX "HeliusTransactionCache_timestamp_idx" ON "HeliusTransactionCache"("timestamp");

-- CreateIndex
CREATE INDEX "SwapAnalysisInput_walletAddress_timestamp_idx" ON "SwapAnalysisInput"("walletAddress", "timestamp");

-- CreateIndex
CREATE INDEX "SwapAnalysisInput_walletAddress_mint_idx" ON "SwapAnalysisInput"("walletAddress", "mint");

-- CreateIndex
CREATE INDEX "SwapAnalysisInput_signature_idx" ON "SwapAnalysisInput"("signature");

-- CreateIndex
CREATE INDEX "AnalysisRun_walletAddress_runTimestamp_idx" ON "AnalysisRun"("walletAddress", "runTimestamp");

-- CreateIndex
CREATE INDEX "AnalysisResult_runId_idx" ON "AnalysisResult"("runId");

-- CreateIndex
CREATE INDEX "AnalysisResult_runId_tokenAddress_idx" ON "AnalysisResult"("runId", "tokenAddress");

-- CreateIndex
CREATE INDEX "AnalysisResult_runId_netSolProfitLoss_idx" ON "AnalysisResult"("runId", "netSolProfitLoss");

-- CreateIndex
CREATE UNIQUE INDEX "AdvancedStatsResult_runId_key" ON "AdvancedStatsResult"("runId");
