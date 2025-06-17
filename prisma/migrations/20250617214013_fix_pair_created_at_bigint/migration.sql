/*
  Warnings:

  - You are about to alter the column `pairCreatedAt` on the `TokenInfo` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TokenInfo" (
    "tokenAddress" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "symbol" TEXT,
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "telegramUrl" TEXT,
    "marketCapUsd" REAL,
    "liquidityUsd" REAL,
    "pairCreatedAt" BIGINT,
    "fdv" REAL,
    "volume24h" REAL,
    "priceUsd" TEXT,
    "dexscreenerUpdatedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TokenInfo" ("dexscreenerUpdatedAt", "fdv", "fetchedAt", "imageUrl", "liquidityUsd", "marketCapUsd", "name", "pairCreatedAt", "priceUsd", "symbol", "telegramUrl", "tokenAddress", "twitterUrl", "updatedAt", "volume24h", "websiteUrl") SELECT "dexscreenerUpdatedAt", "fdv", "fetchedAt", "imageUrl", "liquidityUsd", "marketCapUsd", "name", "pairCreatedAt", "priceUsd", "symbol", "telegramUrl", "tokenAddress", "twitterUrl", "updatedAt", "volume24h", "websiteUrl" FROM "TokenInfo";
DROP TABLE "TokenInfo";
ALTER TABLE "new_TokenInfo" RENAME TO "TokenInfo";
CREATE UNIQUE INDEX "TokenInfo_tokenAddress_key" ON "TokenInfo"("tokenAddress");
CREATE INDEX "TokenInfo_name_idx" ON "TokenInfo"("name");
CREATE INDEX "TokenInfo_symbol_idx" ON "TokenInfo"("symbol");
CREATE INDEX "TokenInfo_marketCapUsd_idx" ON "TokenInfo"("marketCapUsd");
CREATE INDEX "TokenInfo_liquidityUsd_idx" ON "TokenInfo"("liquidityUsd");
CREATE INDEX "TokenInfo_pairCreatedAt_idx" ON "TokenInfo"("pairCreatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
