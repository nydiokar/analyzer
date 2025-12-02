-- CreateTable
CREATE TABLE "UserFavoriteWallet" (
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "walletAddress"),
    CONSTRAINT "UserFavoriteWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserFavoriteWallet_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserFavoriteWallet_userId_idx" ON "UserFavoriteWallet"("userId");

-- CreateIndex
CREATE INDEX "UserFavoriteWallet_walletAddress_idx" ON "UserFavoriteWallet"("walletAddress");
