/*
  Warnings:

  - You are about to drop the column `rawData` on the `HeliusTransactionCache` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HeliusTransactionCache" (
    "signature" TEXT NOT NULL PRIMARY KEY,
    "timestamp" INTEGER NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_HeliusTransactionCache" ("fetchedAt", "signature", "timestamp") SELECT "fetchedAt", "signature", "timestamp" FROM "HeliusTransactionCache";
DROP TABLE "HeliusTransactionCache";
ALTER TABLE "new_HeliusTransactionCache" RENAME TO "HeliusTransactionCache";
CREATE UNIQUE INDEX "HeliusTransactionCache_signature_key" ON "HeliusTransactionCache"("signature");
CREATE INDEX "HeliusTransactionCache_timestamp_idx" ON "HeliusTransactionCache"("timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
