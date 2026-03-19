-- Per-user token watchlist for navbar modal.
-- Keeps analyst collaborative watched tokens (`WatchedToken`) separate.

CREATE TABLE "UserWatchedToken" (
    "userId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWatchedToken_pkey" PRIMARY KEY ("userId","tokenAddress")
);

CREATE INDEX "UserWatchedToken_tokenAddress_idx" ON "UserWatchedToken"("tokenAddress");
CREATE INDEX "UserWatchedToken_createdAt_idx" ON "UserWatchedToken"("createdAt");

ALTER TABLE "UserWatchedToken"
ADD CONSTRAINT "UserWatchedToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserWatchedToken"
ADD CONSTRAINT "UserWatchedToken_tokenAddress_fkey"
FOREIGN KEY ("tokenAddress") REFERENCES "TokenInfo"("tokenAddress")
ON DELETE CASCADE ON UPDATE CASCADE;
