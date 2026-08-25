-- CAPHIST-1 (SPEC-003 substrate): append-only capital/outcome vector history.
-- Mirrors WalletVectorHistory so each wallet carries TWO trajectories (behavior + capital).
-- Adds "dataQuality" (every capital point must carry it — drift on transfer-distorted PnL is
-- not signal, SPEC-003 §55). No HNSW index: kNN runs over the live WalletCapitalVector; this
-- table is trajectory storage only, read newest-first by wallet. Additive-only.

CREATE TABLE "WalletCapitalVectorHistory" (
  "id" SERIAL NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "vector" vector(16) NOT NULL,
  "sourceVector" JSONB NOT NULL,
  "sourceVectorHash" TEXT NOT NULL,
  "dataQuality" DOUBLE PRECISION NOT NULL,
  "driftFromPrevious" DOUBLE PRECISION,
  "sourceProfileUpdatedAt" TIMESTAMP(3) NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WalletCapitalVectorHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletCapitalVectorHistory_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WalletCapitalVectorHistory_walletAddress_schemaVersion_sourceVectorHash_key" ON "WalletCapitalVectorHistory"("walletAddress", "schemaVersion", "sourceVectorHash");
CREATE INDEX "WalletCapitalVectorHistory_walletAddress_schemaVersion_builtAt_idx" ON "WalletCapitalVectorHistory"("walletAddress", "schemaVersion", "builtAt");
CREATE INDEX "WalletCapitalVectorHistory_schemaVersion_idx" ON "WalletCapitalVectorHistory"("schemaVersion");
