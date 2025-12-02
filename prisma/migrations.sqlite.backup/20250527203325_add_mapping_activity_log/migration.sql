-- CreateTable
CREATE TABLE "MappingActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "countByInteractionType" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "MappingActivityLog_walletAddress_idx" ON "MappingActivityLog"("walletAddress");

-- CreateIndex
CREATE INDEX "MappingActivityLog_timestamp_idx" ON "MappingActivityLog"("timestamp");
