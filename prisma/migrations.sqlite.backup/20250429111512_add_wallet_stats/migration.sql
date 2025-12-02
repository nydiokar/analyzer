/*
  Warnings:

  - You are about to drop the column `decimals` on the `SwapAnalysisInput` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "WalletStats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "address" TEXT NOT NULL,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "successfulTransactions" INTEGER NOT NULL DEFAULT 0,
    "failedTransactions" INTEGER NOT NULL DEFAULT 0,
    "uniqueSplTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "splTokensInDirection" TEXT,
    "totalWsolVolume" REAL NOT NULL DEFAULT 0,
    "avgWsolPerTransaction" REAL NOT NULL DEFAULT 0,
    "directSwapCount" INTEGER NOT NULL DEFAULT 0,
    "multiTokenSwapCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedRoi" REAL,
    "firstActivityTimestamp" INTEGER,
    "lastActivityTimestamp" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SwapAnalysisInput" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "mint" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "associatedSolValue" REAL NOT NULL
);
INSERT INTO "new_SwapAnalysisInput" ("amount", "associatedSolValue", "direction", "id", "mint", "signature", "timestamp", "walletAddress") SELECT "amount", "associatedSolValue", "direction", "id", "mint", "signature", "timestamp", "walletAddress" FROM "SwapAnalysisInput";
DROP TABLE "SwapAnalysisInput";
ALTER TABLE "new_SwapAnalysisInput" RENAME TO "SwapAnalysisInput";
CREATE INDEX "SwapAnalysisInput_walletAddress_timestamp_idx" ON "SwapAnalysisInput"("walletAddress", "timestamp");
CREATE INDEX "SwapAnalysisInput_walletAddress_mint_idx" ON "SwapAnalysisInput"("walletAddress", "mint");
CREATE INDEX "SwapAnalysisInput_signature_idx" ON "SwapAnalysisInput"("signature");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WalletStats_address_key" ON "WalletStats"("address");

-- CreateIndex
CREATE INDEX "WalletStats_address_idx" ON "WalletStats"("address");
