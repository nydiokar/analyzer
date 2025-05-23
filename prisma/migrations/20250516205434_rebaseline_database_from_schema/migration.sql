-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "firstProcessedTimestamp" INTEGER,
    "newestProcessedSignature" TEXT,
    "newestProcessedTimestamp" INTEGER,
    "lastSuccessfulFetchTimestamp" DATETIME,
    "lastSignatureAnalyzed" TEXT
);

-- CreateTable
CREATE TABLE "HeliusTransactionCache" (
    "signature" TEXT NOT NULL PRIMARY KEY,
    "timestamp" INTEGER NOT NULL,
    "rawData" BLOB NOT NULL,
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
    "direction" TEXT NOT NULL,
    "associatedSolValue" REAL NOT NULL,
    "associatedUsdcValue" REAL,
    "interactionType" TEXT NOT NULL,
    "feeAmount" REAL,
    "feePercentage" REAL
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

-- CreateTable
CREATE TABLE "AdvancedStatsResult" (
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

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apiKey" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestParameters" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "sourceIp" TEXT,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
CREATE INDEX "SwapAnalysisInput_signature_idx" ON "SwapAnalysisInput"("signature");

-- CreateIndex
CREATE INDEX "SwapAnalysisInput_mint_idx" ON "SwapAnalysisInput"("mint");

-- CreateIndex
CREATE UNIQUE INDEX "SwapAnalysisInput_signature_mint_direction_amount_key" ON "SwapAnalysisInput"("signature", "mint", "direction", "amount");

-- CreateIndex
CREATE INDEX "AnalysisRun_walletAddress_runTimestamp_idx" ON "AnalysisRun"("walletAddress", "runTimestamp");

-- CreateIndex
CREATE INDEX "AnalysisResult_walletAddress_idx" ON "AnalysisResult"("walletAddress");

-- CreateIndex
CREATE INDEX "AnalysisResult_tokenAddress_idx" ON "AnalysisResult"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_walletAddress_tokenAddress_key" ON "AnalysisResult"("walletAddress", "tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AdvancedStatsResult_runId_key" ON "AdvancedStatsResult"("runId");

-- CreateIndex
CREATE INDEX "AdvancedStatsResult_walletAddress_idx" ON "AdvancedStatsResult"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_actionType_idx" ON "ActivityLog"("actionType");

-- CreateIndex
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");
