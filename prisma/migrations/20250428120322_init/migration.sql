/*
  Warnings:

  - You are about to drop the column `fromUserAccount` on the `SwapAnalysisInput` table. All the data in the column will be lost.
  - You are about to drop the column `toUserAccount` on the `SwapAnalysisInput` table. All the data in the column will be lost.
  - Added the required column `associatedSolValue` to the `SwapAnalysisInput` table without a default value. This is not possible if the table is not empty.
  - Added the required column `direction` to the `SwapAnalysisInput` table without a default value. This is not possible if the table is not empty.

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
    "decimals" INTEGER,
    "direction" TEXT NOT NULL,
    "associatedSolValue" REAL NOT NULL
);
INSERT INTO "new_SwapAnalysisInput" ("amount", "id", "mint", "signature", "timestamp", "walletAddress") SELECT "amount", "id", "mint", "signature", "timestamp", "walletAddress" FROM "SwapAnalysisInput";
DROP TABLE "SwapAnalysisInput";
ALTER TABLE "new_SwapAnalysisInput" RENAME TO "SwapAnalysisInput";
CREATE INDEX "SwapAnalysisInput_walletAddress_timestamp_idx" ON "SwapAnalysisInput"("walletAddress", "timestamp");
CREATE INDEX "SwapAnalysisInput_walletAddress_mint_idx" ON "SwapAnalysisInput"("walletAddress", "mint");
CREATE INDEX "SwapAnalysisInput_signature_idx" ON "SwapAnalysisInput"("signature");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
