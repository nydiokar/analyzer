-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL,
    "firstProcessedTimestamp" INTEGER,
    "newestProcessedSignature" TEXT,
    "newestProcessedTimestamp" INTEGER,
    "lastSuccessfulFetchTimestamp" TIMESTAMP(3),
    "analyzedTimestampStart" INTEGER,
    "analyzedTimestampEnd" INTEGER,
    "classification" TEXT DEFAULT 'unknown',
    "classificationConfidence" DOUBLE PRECISION,
    "classificationUpdatedAt" TIMESTAMP(3),
    "classificationMethod" TEXT,
    "isVerifiedBot" BOOLEAN NOT NULL DEFAULT false,
    "botType" TEXT,
    "botPatternTags" JSONB,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "HeliusTransactionCache" (
    "signature" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeliusTransactionCache_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "SwapAnalysisInput" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "mint" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "associatedSolValue" DOUBLE PRECISION NOT NULL,
    "associatedUsdcValue" DOUBLE PRECISION,
    "interactionType" TEXT NOT NULL,
    "feeAmount" DOUBLE PRECISION,
    "feePercentage" DOUBLE PRECISION,

    CONSTRAINT "SwapAnalysisInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "totalAmountIn" DOUBLE PRECISION NOT NULL,
    "totalAmountOut" DOUBLE PRECISION NOT NULL,
    "netAmountChange" DOUBLE PRECISION NOT NULL,
    "totalSolSpent" DOUBLE PRECISION NOT NULL,
    "totalSolReceived" DOUBLE PRECISION NOT NULL,
    "totalFeesPaidInSol" DOUBLE PRECISION,
    "netSolProfitLoss" DOUBLE PRECISION NOT NULL,
    "transferCountIn" INTEGER NOT NULL,
    "transferCountOut" INTEGER NOT NULL,
    "firstTransferTimestamp" INTEGER,
    "lastTransferTimestamp" INTEGER,
    "isValuePreservation" BOOLEAN,
    "estimatedPreservedValue" DOUBLE PRECISION,
    "preservationType" TEXT,
    "currentRawBalance" TEXT,
    "currentUiBalance" DOUBLE PRECISION,
    "currentUiBalanceString" TEXT,
    "balanceDecimals" INTEGER,
    "balanceFetchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletPnlSummary" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "totalVolume" DOUBLE PRECISION NOT NULL,
    "totalFees" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL,
    "netPnl" DOUBLE PRECISION NOT NULL,
    "stablecoinNetFlow" DOUBLE PRECISION NOT NULL,
    "averageSwapSize" DOUBLE PRECISION NOT NULL,
    "profitableTokensCount" INTEGER NOT NULL,
    "unprofitableTokensCount" INTEGER NOT NULL,
    "totalExecutedSwapsCount" INTEGER NOT NULL,
    "averageRealizedPnlPerExecutedSwap" DOUBLE PRECISION NOT NULL,
    "realizedPnlToTotalVolumeRatio" DOUBLE PRECISION NOT NULL,
    "totalSignaturesProcessed" INTEGER NOT NULL,
    "overallFirstTimestamp" INTEGER,
    "overallLastTimestamp" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentSolBalance" DOUBLE PRECISION,
    "solBalanceFetchedAt" TIMESTAMP(3),

    CONSTRAINT "WalletPnlSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancedTradeStats" (
    "id" SERIAL NOT NULL,
    "walletPnlSummaryId" INTEGER NOT NULL,
    "medianPnlPerToken" DOUBLE PRECISION NOT NULL,
    "trimmedMeanPnlPerToken" DOUBLE PRECISION NOT NULL,
    "tokenWinRatePercent" DOUBLE PRECISION NOT NULL,
    "standardDeviationPnl" DOUBLE PRECISION NOT NULL,
    "profitConsistencyIndex" DOUBLE PRECISION NOT NULL,
    "weightedEfficiencyScore" DOUBLE PRECISION NOT NULL,
    "averagePnlPerDayActiveApprox" DOUBLE PRECISION NOT NULL,
    "firstTransactionTimestamp" INTEGER,
    "lastTransactionTimestamp" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancedTradeStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletBehaviorProfile" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "buySellRatio" DOUBLE PRECISION NOT NULL,
    "buySellSymmetry" DOUBLE PRECISION NOT NULL,
    "averageFlipDurationHours" DOUBLE PRECISION NOT NULL,
    "medianHoldTime" DOUBLE PRECISION NOT NULL,
    "sequenceConsistency" DOUBLE PRECISION NOT NULL,
    "flipperScore" DOUBLE PRECISION NOT NULL,
    "uniqueTokensTraded" INTEGER NOT NULL,
    "tokensWithBothBuyAndSell" INTEGER NOT NULL,
    "totalTradeCount" INTEGER NOT NULL,
    "totalBuyCount" INTEGER NOT NULL,
    "totalSellCount" INTEGER NOT NULL,
    "completePairsCount" INTEGER NOT NULL,
    "averageTradesPerToken" DOUBLE PRECISION NOT NULL,
    "tradingTimeDistribution" JSONB NOT NULL,
    "percentTradesUnder1Hour" DOUBLE PRECISION NOT NULL,
    "percentTradesUnder4Hours" DOUBLE PRECISION NOT NULL,
    "tradingStyle" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "tradingFrequency" JSONB NOT NULL,
    "tokenPreferences" JSONB NOT NULL,
    "riskMetrics" JSONB NOT NULL,
    "reentryRate" DOUBLE PRECISION NOT NULL,
    "percentageOfUnpairedTokens" DOUBLE PRECISION NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "avgTradesPerSession" DOUBLE PRECISION NOT NULL,
    "activeTradingPeriods" JSONB NOT NULL,
    "averageSessionStartHour" DOUBLE PRECISION NOT NULL,
    "averageSessionDurationMinutes" DOUBLE PRECISION NOT NULL,
    "firstTransactionTimestamp" INTEGER,
    "lastTransactionTimestamp" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletBehaviorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "serviceInvoked" TEXT NOT NULL,
    "runTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "inputDataStartTs" INTEGER,
    "inputDataEndTs" INTEGER,
    "signaturesConsidered" INTEGER,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "notes" TEXT,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "description" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actionType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestParameters" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "sourceIp" TEXT,
    "walletAddress" TEXT,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingActivityLog" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalTransactionsReceived" INTEGER NOT NULL,
    "transactionsSkippedError" INTEGER NOT NULL,
    "transactionsSuccessfullyProcessed" INTEGER NOT NULL,
    "analysisInputsGenerated" INTEGER NOT NULL,
    "nativeSolTransfersProcessed" INTEGER NOT NULL,
    "tokenTransfersProcessed" INTEGER NOT NULL,
    "wsolTransfersProcessed" INTEGER NOT NULL,
    "usdcTransfersProcessed" INTEGER NOT NULL,
    "otherTokenTransfersProcessed" INTEGER NOT NULL,
    "feePayerHeuristicApplied" INTEGER NOT NULL,
    "feesCalculated" INTEGER NOT NULL,
    "eventMatcherAttempts" INTEGER NOT NULL,
    "eventMatcherPrimaryMintsIdentified" INTEGER NOT NULL,
    "eventMatcherConsistentSolFound" INTEGER NOT NULL,
    "eventMatcherConsistentUsdcFound" INTEGER NOT NULL,
    "eventMatcherAmbiguous" INTEGER NOT NULL,
    "eventMatcherNoConsistentValue" INTEGER NOT NULL,
    "splToSplSwapDetections" INTEGER NOT NULL,
    "associatedValueFromSplToSpl" INTEGER NOT NULL,
    "associatedValueFromEventMatcher" INTEGER NOT NULL,
    "associatedValueFromTotalMovement" INTEGER NOT NULL,
    "associatedValueFromNetChange" INTEGER NOT NULL,
    "smallOutgoingHeuristicApplied" INTEGER NOT NULL,
    "skippedDuplicateRecordKey" INTEGER NOT NULL,
    "countByInteractionType" JSONB NOT NULL,
    "unknownTxSkippedNoJito" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MappingActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WalletNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavoriteWallet" (
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collections" TEXT,
    "lastViewedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "nickname" TEXT,
    "tags" TEXT,

    CONSTRAINT "UserFavoriteWallet_pkey" PRIMARY KEY ("userId","walletAddress")
);

-- CreateTable
CREATE TABLE "TokenInfo" (
    "tokenAddress" TEXT NOT NULL,
    "name" TEXT,
    "symbol" TEXT,
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "telegramUrl" TEXT,
    "marketCapUsd" DOUBLE PRECISION,
    "liquidityUsd" DOUBLE PRECISION,
    "pairCreatedAt" BIGINT,
    "fdv" DOUBLE PRECISION,
    "volume24h" DOUBLE PRECISION,
    "priceUsd" TEXT,
    "dexscreenerUpdatedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "onchainName" TEXT,
    "onchainSymbol" TEXT,
    "onchainDescription" TEXT,
    "onchainImageUrl" TEXT,
    "onchainCreator" TEXT,
    "onchainMetadataUri" TEXT,
    "onchainBasicFetchedAt" TIMESTAMP(3),
    "onchainWebsiteUrl" TEXT,
    "onchainTwitterUrl" TEXT,
    "onchainTelegramUrl" TEXT,
    "onchainDiscordUrl" TEXT,
    "onchainSocialsFetchedAt" TIMESTAMP(3),
    "metadataSource" TEXT,

    CONSTRAINT "TokenInfo_pkey" PRIMARY KEY ("tokenAddress")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "rawValue" TEXT NOT NULL,
    "metaJson" JSONB,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId","type")
);

-- CreateTable
CREATE TABLE "MessageRevision" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenTag" (
    "tokenAddress" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenTag_pkey" PRIMARY KEY ("tokenAddress","tagId")
);

-- CreateTable
CREATE TABLE "WatchedToken" (
    "id" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "WatchedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_classification_idx" ON "Wallet"("classification");

-- CreateIndex
CREATE INDEX "Wallet_classificationConfidence_idx" ON "Wallet"("classificationConfidence");

-- CreateIndex
CREATE INDEX "Wallet_isVerifiedBot_idx" ON "Wallet"("isVerifiedBot");

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
CREATE INDEX "AnalysisResult_walletAddress_idx" ON "AnalysisResult"("walletAddress");

-- CreateIndex
CREATE INDEX "AnalysisResult_tokenAddress_idx" ON "AnalysisResult"("tokenAddress");

-- CreateIndex
CREATE INDEX "AnalysisResult_lastTransferTimestamp_idx" ON "AnalysisResult"("lastTransferTimestamp");

-- CreateIndex
CREATE INDEX "AnalysisResult_netSolProfitLoss_idx" ON "AnalysisResult"("netSolProfitLoss");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_walletAddress_tokenAddress_key" ON "AnalysisResult"("walletAddress", "tokenAddress");

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

-- CreateIndex
CREATE INDEX "AnalysisRun_walletAddress_runTimestamp_idx" ON "AnalysisRun"("walletAddress", "runTimestamp");

-- CreateIndex
CREATE INDEX "AnalysisRun_serviceInvoked_idx" ON "AnalysisRun"("serviceInvoked");

-- CreateIndex
CREATE INDEX "AnalysisRun_status_idx" ON "AnalysisRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_actionType_idx" ON "ActivityLog"("actionType");

-- CreateIndex
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");

-- CreateIndex
CREATE INDEX "MappingActivityLog_walletAddress_idx" ON "MappingActivityLog"("walletAddress");

-- CreateIndex
CREATE INDEX "MappingActivityLog_timestamp_idx" ON "MappingActivityLog"("timestamp");

-- CreateIndex
CREATE INDEX "WalletNote_walletAddress_idx" ON "WalletNote"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletNote_userId_idx" ON "WalletNote"("userId");

-- CreateIndex
CREATE INDEX "WalletNote_createdAt_idx" ON "WalletNote"("createdAt");

-- CreateIndex
CREATE INDEX "UserFavoriteWallet_userId_idx" ON "UserFavoriteWallet"("userId");

-- CreateIndex
CREATE INDEX "UserFavoriteWallet_walletAddress_idx" ON "UserFavoriteWallet"("walletAddress");

-- CreateIndex
CREATE INDEX "UserFavoriteWallet_lastViewedAt_idx" ON "UserFavoriteWallet"("lastViewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenInfo_tokenAddress_key" ON "TokenInfo"("tokenAddress");

-- CreateIndex
CREATE INDEX "TokenInfo_name_idx" ON "TokenInfo"("name");

-- CreateIndex
CREATE INDEX "TokenInfo_symbol_idx" ON "TokenInfo"("symbol");

-- CreateIndex
CREATE INDEX "TokenInfo_marketCapUsd_idx" ON "TokenInfo"("marketCapUsd");

-- CreateIndex
CREATE INDEX "TokenInfo_liquidityUsd_idx" ON "TokenInfo"("liquidityUsd");

-- CreateIndex
CREATE INDEX "TokenInfo_pairCreatedAt_idx" ON "TokenInfo"("pairCreatedAt");

-- CreateIndex
CREATE INDEX "Message_createdAt_id_idx" ON "Message"("createdAt", "id");

-- CreateIndex
CREATE INDEX "MessageMention_messageId_idx" ON "MessageMention"("messageId");

-- CreateIndex
CREATE INDEX "MessageMention_kind_refId_idx" ON "MessageMention"("kind", "refId");

-- CreateIndex
CREATE INDEX "MessageReaction_type_idx" ON "MessageReaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "TokenTag_tagId_idx" ON "TokenTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedToken_tokenAddress_list_key" ON "WatchedToken"("tokenAddress", "list");

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletPnlSummary" ADD CONSTRAINT "WalletPnlSummary_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancedTradeStats" ADD CONSTRAINT "AdvancedTradeStats_walletPnlSummaryId_fkey" FOREIGN KEY ("walletPnlSummaryId") REFERENCES "WalletPnlSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletBehaviorProfile" ADD CONSTRAINT "WalletBehaviorProfile_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletNote" ADD CONSTRAINT "WalletNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletNote" ADD CONSTRAINT "WalletNote_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteWallet" ADD CONSTRAINT "UserFavoriteWallet_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteWallet" ADD CONSTRAINT "UserFavoriteWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRevision" ADD CONSTRAINT "MessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenTag" ADD CONSTRAINT "TokenTag_tokenAddress_fkey" FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo"("tokenAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenTag" ADD CONSTRAINT "TokenTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedToken" ADD CONSTRAINT "WatchedToken_tokenAddress_fkey" FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo"("tokenAddress") ON DELETE RESTRICT ON UPDATE CASCADE;
