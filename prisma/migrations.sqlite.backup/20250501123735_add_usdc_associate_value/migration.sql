/*
  Warnings:

  - Made the column `interactionType` on table `SwapAnalysisInput` required. This step will fail if there are existing NULL values in that column.

*/
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
    "associatedSolValue" REAL NOT NULL,
    "associatedUsdcValue" REAL,
    "interactionType" TEXT NOT NULL
);
INSERT INTO "new_SwapAnalysisInput" ("amount", "associatedSolValue", "direction", "id", "interactionType", "mint", "signature", "timestamp", "walletAddress") SELECT "amount", "associatedSolValue", "direction", "id", "interactionType", "mint", "signature", "timestamp", "walletAddress" FROM "SwapAnalysisInput";
DROP TABLE "SwapAnalysisInput";
ALTER TABLE "new_SwapAnalysisInput" RENAME TO "SwapAnalysisInput";
CREATE INDEX "SwapAnalysisInput_walletAddress_timestamp_idx" ON "SwapAnalysisInput"("walletAddress", "timestamp");
CREATE INDEX "SwapAnalysisInput_signature_idx" ON "SwapAnalysisInput"("signature");
CREATE INDEX "SwapAnalysisInput_mint_idx" ON "SwapAnalysisInput"("mint");
CREATE UNIQUE INDEX "SwapAnalysisInput_signature_mint_direction_key" ON "SwapAnalysisInput"("signature", "mint", "direction");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
