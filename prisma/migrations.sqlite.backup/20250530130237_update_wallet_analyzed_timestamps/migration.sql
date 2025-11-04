/*
  Warnings:

  - You are about to drop the column `lastSignatureAnalyzed` on the `Wallet` table. All the data in the column will be lost.

*/
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
    "analyzedTimestampEnd" INTEGER
);
INSERT INTO "new_Wallet" ("address", "firstProcessedTimestamp", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp") SELECT "address", "firstProcessedTimestamp", "lastSuccessfulFetchTimestamp", "newestProcessedSignature", "newestProcessedTimestamp" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
