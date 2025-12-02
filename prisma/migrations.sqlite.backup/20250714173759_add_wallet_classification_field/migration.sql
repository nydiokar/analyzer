-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "firstProcessedTimestamp" INTEGER,
    "newestProcessedSignature" TEXT,
    "newestProcessedTimestamp" INTEGER,
    "lastSuccessfulFetchTimestamp" DATETIME,
    "analyzedTimestampStart" INTEGER,
    "analyzedTimestampEnd" INTEGER,
    "classification" TEXT DEFAULT 'unknown',
    "classificationConfidence" REAL,
    "classificationUpdatedAt" DATETIME,
    "classificationMethod" TEXT,
    "isVerifiedBot" BOOLEAN NOT NULL DEFAULT false,
    "botType" TEXT,
    "botPatternTags" JSONB
);
INSERT INTO "new_Wallet" ("address", "analyzedTimestampEnd", "analyzedTimestampStart", "firstProcessedTimestamp", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp") SELECT "address", "analyzedTimestampEnd", "analyzedTimestampStart", "firstProcessedTimestamp", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");
CREATE INDEX "Wallet_classification_idx" ON "Wallet"("classification");
CREATE INDEX "Wallet_classificationConfidence_idx" ON "Wallet"("classificationConfidence");
CREATE INDEX "Wallet_isVerifiedBot_idx" ON "Wallet"("isVerifiedBot");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
