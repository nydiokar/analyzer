CREATE TABLE "WalletVectorHistory" (
  "id" SERIAL NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "vector" vector(64) NOT NULL,
  "sourceVector" JSONB NOT NULL,
  "sourceVectorHash" TEXT NOT NULL,
  "driftFromPrevious" DOUBLE PRECISION,
  "sourceProfileUpdatedAt" TIMESTAMP(3) NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WalletVectorHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletVectorHistory_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WalletVectorHistory_walletAddress_schemaVersion_sourceVectorHash_key" ON "WalletVectorHistory"("walletAddress", "schemaVersion", "sourceVectorHash");
CREATE INDEX "WalletVectorHistory_walletAddress_schemaVersion_builtAt_idx" ON "WalletVectorHistory"("walletAddress", "schemaVersion", "builtAt");
CREATE INDEX "WalletVectorHistory_schemaVersion_idx" ON "WalletVectorHistory"("schemaVersion");