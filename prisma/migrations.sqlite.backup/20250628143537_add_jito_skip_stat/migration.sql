/*
  Warnings:

  - Added the required column `unknownTxSkippedNoJito` to the `MappingActivityLog` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MappingActivityLog" (
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
    "countByInteractionType" JSONB NOT NULL,
    "unknownTxSkippedNoJito" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_MappingActivityLog" ("analysisInputsGenerated", "associatedValueFromEventMatcher", "associatedValueFromNetChange", "associatedValueFromSplToSpl", "associatedValueFromTotalMovement", "countByInteractionType", "eventMatcherAmbiguous", "eventMatcherAttempts", "eventMatcherConsistentSolFound", "eventMatcherConsistentUsdcFound", "eventMatcherNoConsistentValue", "eventMatcherPrimaryMintsIdentified", "feePayerHeuristicApplied", "feesCalculated", "id", "nativeSolTransfersProcessed", "otherTokenTransfersProcessed", "skippedDuplicateRecordKey", "smallOutgoingHeuristicApplied", "splToSplSwapDetections", "timestamp", "tokenTransfersProcessed", "totalTransactionsReceived", "transactionsSkippedError", "transactionsSuccessfullyProcessed", "usdcTransfersProcessed", "walletAddress", "wsolTransfersProcessed", "unknownTxSkippedNoJito") SELECT "analysisInputsGenerated", "associatedValueFromEventMatcher", "associatedValueFromNetChange", "associatedValueFromSplToSpl", "associatedValueFromTotalMovement", "countByInteractionType", "eventMatcherAmbiguous", "eventMatcherAttempts", "eventMatcherConsistentSolFound", "eventMatcherConsistentUsdcFound", "eventMatcherNoConsistentValue", "eventMatcherPrimaryMintsIdentified", "feePayerHeuristicApplied", "feesCalculated", "id", "nativeSolTransfersProcessed", "otherTokenTransfersProcessed", "skippedDuplicateRecordKey", "smallOutgoingHeuristicApplied", "splToSplSwapDetections", "timestamp", "tokenTransfersProcessed", "totalTransactionsReceived", "transactionsSkippedError", "transactionsSuccessfullyProcessed", "usdcTransfersProcessed", "walletAddress", "wsolTransfersProcessed", 0 FROM "MappingActivityLog";
DROP TABLE "MappingActivityLog";
ALTER TABLE "new_MappingActivityLog" RENAME TO "MappingActivityLog";
CREATE INDEX "MappingActivityLog_walletAddress_idx" ON "MappingActivityLog"("walletAddress");
CREATE INDEX "MappingActivityLog_timestamp_idx" ON "MappingActivityLog"("timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
