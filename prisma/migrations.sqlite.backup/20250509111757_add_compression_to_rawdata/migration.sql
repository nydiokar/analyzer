/*
  Warnings:

  - You are about to alter the column `rawData` on the `HeliusTransactionCache` table. The data in that column could be lost. The data in that column will be cast from `Json` to `Binary`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HeliusTransactionCache" (
    "signature" TEXT NOT NULL PRIMARY KEY,
    "timestamp" INTEGER NOT NULL,
    "rawData" BLOB NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_HeliusTransactionCache" ("fetchedAt", "rawData", "signature", "timestamp") SELECT "fetchedAt", "rawData", "signature", "timestamp" FROM "HeliusTransactionCache";
DROP TABLE "HeliusTransactionCache";
ALTER TABLE "new_HeliusTransactionCache" RENAME TO "HeliusTransactionCache";
CREATE UNIQUE INDEX "HeliusTransactionCache_signature_key" ON "HeliusTransactionCache"("signature");
CREATE INDEX "HeliusTransactionCache_timestamp_idx" ON "HeliusTransactionCache"("timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
