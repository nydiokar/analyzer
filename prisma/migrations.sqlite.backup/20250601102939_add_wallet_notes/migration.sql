-- CreateTable
CREATE TABLE "WalletNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "WalletNote_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestParameters" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "sourceIp" TEXT,
    "walletAddress" TEXT,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ActivityLog" ("actionType", "durationMs", "errorMessage", "id", "requestParameters", "sourceIp", "status", "timestamp", "userId") SELECT "actionType", "durationMs", "errorMessage", "id", "requestParameters", "sourceIp", "status", "timestamp", "userId" FROM "ActivityLog";
DROP TABLE "ActivityLog";
ALTER TABLE "new_ActivityLog" RENAME TO "ActivityLog";
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");
CREATE INDEX "ActivityLog_actionType_idx" ON "ActivityLog"("actionType");
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WalletNote_walletAddress_idx" ON "WalletNote"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletNote_userId_idx" ON "WalletNote"("userId");

-- CreateIndex
CREATE INDEX "WalletNote_createdAt_idx" ON "WalletNote"("createdAt");
